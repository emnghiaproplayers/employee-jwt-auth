import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DataSource } from 'typeorm';

describe('Auth (e2e)', () => {
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
    try {
      await dataSource.query('TRUNCATE TABLE "users" CASCADE');
      await dataSource.query('TRUNCATE TABLE "device_sessions" CASCADE');
    } catch (err) {
      // Ignore if tables do not exist yet
    }
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      try {
        await dataSource.query('TRUNCATE TABLE "users" CASCADE');
        await dataSource.query('TRUNCATE TABLE "device_sessions" CASCADE');
      } catch (err) {
        // Ignore
      }
    }
    await app.close();
  });

  const testEmail = `user-${Date.now()}@company.com`;
  const testPassword = 'securepassword123';
  const testDeviceId = 'device-uuid-v4-123456';
  const testDeviceId2 = 'device-uuid-v4-789012';
  let accessTokenA: string;
  let refreshTokenA: string;
  let accessTokenB: string;

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
        deviceId: testDeviceId,
      })
      .expect(401);
  });

  it('POST /auth/signin (1st login with deviceId) -> should return token pair and deviceId (200)', () => {
    return request(app.getHttpServer())
      .post('/auth/signin')
      .send({
        email: testEmail,
        password: testPassword,
        deviceId: testDeviceId,
      })
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('access_token');
        expect(res.body).toHaveProperty('refresh_token');
        expect(res.body).toHaveProperty('deviceId');
        expect(res.body.deviceId).toBe(testDeviceId);
        accessTokenA = res.body.access_token;
        refreshTokenA = res.body.refresh_token;
      });
  });

  it('POST /auth/signin (2nd login with different deviceId) -> should return different tokens (200)', () => {
    return request(app.getHttpServer())
      .post('/auth/signin')
      .send({
        email: testEmail,
        password: testPassword,
        deviceId: testDeviceId2,
      })
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('access_token');
        expect(res.body).toHaveProperty('refresh_token');
        expect(res.body).toHaveProperty('deviceId');
        expect(res.body.deviceId).toBe(testDeviceId2);
        accessTokenB = res.body.access_token;
        expect(accessTokenA).not.toBe(accessTokenB);
      });
  });
});
