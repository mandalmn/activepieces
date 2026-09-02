import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddPlatformApiKeyAndActivityLog1841000000000 implements Migration {
    name = 'AddPlatformApiKeyAndActivityLog1841000000000'
    breaking = false
    release = '0.88.5'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "platform_api_key" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "platformId" character varying(21) NOT NULL,
                "displayName" character varying NOT NULL,
                "hashedValue" character varying NOT NULL,
                "truncatedValue" character varying NOT NULL,
                "lastUsedAt" character varying,
                CONSTRAINT "PK_platform_api_key" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_platform_api_key_hashed_value" ON "platform_api_key" ("hashedValue")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_platform_api_key_platform_id" ON "platform_api_key" ("platformId")
        `)
        await queryRunner.query(`
            CREATE TABLE "activity_log" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "platformId" character varying(21) NOT NULL,
                "projectId" character varying(21),
                "projectDisplayName" character varying,
                "userId" character varying(21),
                "userEmail" character varying,
                "action" character varying NOT NULL,
                "ip" character varying,
                "data" jsonb NOT NULL DEFAULT '{}',
                CONSTRAINT "PK_activity_log" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_activity_log_platform_id_created" ON "activity_log" ("platformId", "created")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_activity_log_project_id" ON "activity_log" ("projectId")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX "idx_activity_log_project_id"')
        await queryRunner.query('DROP INDEX "idx_activity_log_platform_id_created"')
        await queryRunner.query('DROP TABLE "activity_log"')
        await queryRunner.query('DROP INDEX "idx_platform_api_key_platform_id"')
        await queryRunner.query('DROP INDEX "idx_platform_api_key_hashed_value"')
        await queryRunner.query('DROP TABLE "platform_api_key"')
    }
}
