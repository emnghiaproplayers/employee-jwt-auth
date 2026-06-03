import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DataSource } from 'typeorm';

describe('Auth & Employee (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    await dataSource.query('TRUNCATE TABLE "employees" CASCADE');
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.query('TRUNCATE TABLE "employees" CASCADE');
    }
    await app.close();
  });

  const testEmail = `employee-${Date.now()}@company.com`;
  const testPassword = 'securepassword123';
  let jwtToken: string;

  it('POST /auth/signup -> should sign up successfully (201)', () => {
    return request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: testEmail,
        password: testPassword,
      })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body.email).toBe(testEmail);
        expect(res.body).not.toHaveProperty('passwordHash');
        expect(res.body).not.toHaveProperty('password');
      });
  });

  it('POST /auth/signup -> should fail for duplicate email (409)', () => {
    return request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: testEmail,
        password: testPassword,
      })
      .expect(409);
  });

  it('POST /auth/signin -> should fail with wrong credentials (401)', () => {
    return request(app.getHttpServer())
      .post('/auth/signin')
      .send({
        email: testEmail,
        password: 'wrongpassword',
      })
      .expect(401);
  });

  it('POST /auth/signin -> should login successfully and return access token (200)', () => {
    return request(app.getHttpServer())
      .post('/auth/signin')
      .send({
        email: testEmail,
        password: testPassword,
      })
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('access_token');
        jwtToken = res.body.access_token;
      });
  });

  it('GET /employees/profile -> should fail when no JWT is provided (401)', () => {
    return request(app.getHttpServer())
      .get('/employees/profile')
      .expect(401);
  });

  it('GET /employees/profile -> should return employee profile when valid JWT is provided (200)', () => {
    return request(app.getHttpServer())
      .get('/employees/profile')
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('message');
        expect(res.body).toHaveProperty('user');
        expect(res.body.user).toHaveProperty('userId');
        expect(typeof res.body.user.userId).toBe('string');
      });
  });
});
