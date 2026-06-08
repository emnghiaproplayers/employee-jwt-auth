import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1780518377493 implements MigrationInterface {
  name = 'InitialSchema1780518377493';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "employees" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "passwordHash" text NOT NULL, CONSTRAINT "UQ_765bc1ac8967533a04c74a9f6af" UNIQUE ("email"), CONSTRAINT "PK_b9535a98350d5b26e7eb0c26af4" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "employees"`);
  }
}
