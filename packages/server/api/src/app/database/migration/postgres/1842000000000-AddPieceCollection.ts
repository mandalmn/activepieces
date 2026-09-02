import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddPieceCollection1842000000000 implements Migration {
    name = 'AddPieceCollection1842000000000'
    breaking = false
    release = '0.88.6'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "piece_collection" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "platformId" character varying(21) NOT NULL,
                "name" character varying NOT NULL,
                "key" character varying,
                "isDefault" boolean NOT NULL DEFAULT false,
                "generatedForProjectId" character varying(21),
                "config" jsonb NOT NULL,
                CONSTRAINT "PK_piece_collection" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_piece_collection_platform_id" ON "piece_collection" ("platformId")
        `)
        await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_piece_collection_platform_id_key" ON "piece_collection" ("platformId", "key")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX "idx_piece_collection_platform_id_key"')
        await queryRunner.query('DROP INDEX "idx_piece_collection_platform_id"')
        await queryRunner.query('DROP TABLE "piece_collection"')
    }
}
