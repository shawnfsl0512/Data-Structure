import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { Attraction } from './Attraction';
import { Facility } from './Facility';
import { RoadGraphNode } from './RoadGraphNode';

@Entity('scenic_areas')
@Index('IDX_SCENIC_AREA_NAME', ['name'])
@Index('IDX_SCENIC_AREA_CATEGORY', ['category'])
@Index('IDX_SCENIC_AREA_POPULARITY', ['popularity'])
@Index('IDX_SCENIC_AREA_AVERAGE_RATING', ['averageRating'])
export class ScenicArea {
  @PrimaryGeneratedColumn('uuid')
  id: string = '';

  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string = '';

  @Column({ type: 'varchar', length: 100, nullable: false })
  category: string = '';

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null = null;

  @Column({ type: 'text', nullable: true })
  description: string = '';

  @Column({ type: 'varchar', length: 500, nullable: true })
  coverImageUrl: string | null = null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  coverSource: string | null = null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  coverAuthor: string | null = null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  coverLicense: string | null = null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  coverPageUrl: string | null = null;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude: number | null = null;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude: number | null = null;

  @Column({ type: 'text', nullable: true })
  openingHours: string = '{}';

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  ticketPrice: number | null = null;

  @Column({ type: 'integer', default: 0 })
  popularity: number = 0;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  averageRating: number = 0;

  @Column({ type: 'integer', default: 0 })
  reviewCount: number = 0;

  @Column({ type: 'text', nullable: true })
  tags: string = '';

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  rating: number = 0;

  @Column({ type: 'integer', default: 0 })
  visitorCount: number = 0;

  @OneToMany(() => Attraction, attraction => attraction.scenicArea)
  attractions!: Attraction[];

  @OneToMany(() => Facility, facility => facility.scenicArea)
  facilities!: Facility[];

  @OneToMany(() => RoadGraphNode, node => node.scenicArea)
  roadGraphNodes!: RoadGraphNode[];

  @CreateDateColumn()
  createdAt: Date = new Date();

  @UpdateDateColumn()
  updatedAt: Date = new Date();
}
