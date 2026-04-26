import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('map_templates')
@Index('IDX_MAP_TEMPLATE_KEY', ['templateKey'], { unique: true })
export class MapTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, nullable: false })
  templateKey: string = '';

  @Column({ type: 'varchar', length: 50, nullable: false })
  category: string = '';

  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string = '';

  @Column({ type: 'integer', default: 1 })
  version: number = 1;

  @Column({ type: 'text', nullable: false })
  payload: string = '{}';

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
