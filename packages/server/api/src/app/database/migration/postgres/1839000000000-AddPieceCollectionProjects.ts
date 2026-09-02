import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddPieceCollectionProjects1839000000000 implements Migration {
    name = 'AddPieceCollectionProjects1839000000000'
    breaking = false
    release = '0.88.6'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "piece_collection"
            ADD COLUMN "projectIds" character varying array NOT NULL DEFAULT '{}'
        `)
        await queryRunner.query(`
            ALTER TABLE "piece_collection"
            ALTER COLUMN "projectIds" DROP DEFAULT
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "piece_collection" DROP COLUMN "projectIds"')
    }
}
