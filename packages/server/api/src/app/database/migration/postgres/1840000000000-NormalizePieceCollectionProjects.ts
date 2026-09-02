import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class NormalizePieceCollectionProjects1840000000000 implements Migration {
    name = 'NormalizePieceCollectionProjects1840000000000'
    breaking = false
    release = '0.88.6'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX IF EXISTS "idx_piece_collection_project_ids"')
        await queryRunner.query(`
            ALTER TABLE "piece_collection"
            ALTER COLUMN "projectIds" DROP DEFAULT
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "piece_collection"
            ALTER COLUMN "projectIds" SET DEFAULT '{}'
        `)
    }
}
