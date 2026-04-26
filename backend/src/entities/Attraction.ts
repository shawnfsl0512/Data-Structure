import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { ScenicArea } from './ScenicArea';
import { stringArrayJsonTransformer } from '../utils/stringArrayField';

@Entity('attractions')
@Index('IDX_ATTRACTION_SCENIC_AREA', ['scenicAreaId'])
@Index('IDX_ATTRACTION_NAME', ['name'])
@Index('IDX_ATTRACTION_CATEGORY', ['category'])
@Index('IDX_ATTRACTION_SCENIC_CATEGORY', ['scenicAreaId', 'category'])
export class Attraction {
  @PrimaryGeneratedColumn('uuid')
  id: string = '';

  // Recommendation-only field derived in service layer to avoid schema changes.
  baseHeat: number = 0;

  @Column({ type: 'varchar', length: 36, nullable: false })
  scenicAreaId: string = '';

  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string = '';

  @Column({ type: 'varchar', length: 100, nullable: true })
  type: string = '';

  @Column({ type: 'varchar', length: 100, nullable: true })
  category: string = '';

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null = null;

  @Column({ type: 'text', nullable: true })
  description: string = '';

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude: number | null = null;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude: number | null = null;

  @Column({ type: 'text', nullable: true })
  openingHours: string = '{}';

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  averageRating: number = 0;

  @Column({ type: 'integer', default: 0 })
  reviewCount: number = 0;

  @Column({ type: 'integer', nullable: true })
  estimatedVisitDuration: number | null = null;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 1.0 })
  congestionFactor: number = 1.0;

  @Column({ type: 'text', nullable: true, transformer: stringArrayJsonTransformer })
  tags: string[] = [];

  @Column({ type: 'text', nullable: true })
  indoorStructure: string = '{}';

  @ManyToOne(() => ScenicArea, scenicArea => scenicArea.attractions)
  scenicArea!: ScenicArea;

  @CreateDateColumn()
  createdAt: Date = new Date();

  @UpdateDateColumn()
  updatedAt: Date = new Date();
}
