import path from 'path';
import { DataSource, DataSourceOptions, In, Like } from 'typeorm';
import dotenv from 'dotenv';
import { Attraction } from '../entities/Attraction';
import { Diary } from '../entities/Diary';
import { DiaryComment } from '../entities/DiaryComment';
import { Facility } from '../entities/Facility';
import { Food } from '../entities/Food';
import { MapTemplate } from '../entities/MapTemplate';
import { PhotoCheckin } from '../entities/PhotoCheckin';
import { PhotoSpot } from '../entities/PhotoSpot';
import { RoadGraphEdge } from '../entities/RoadGraphEdge';
import { RoadGraphNode } from '../entities/RoadGraphNode';
import { ScenicArea } from '../entities/ScenicArea';
import { SocialCheckin } from '../entities/SocialCheckin';
import { SocialTeam } from '../entities/SocialTeam';
import { SocialTeamMember } from '../entities/SocialTeamMember';
import { User } from '../entities/User';
import { UserBehavior } from '../entities/UserBehavior';

dotenv.config();

type SupportedDatabaseDriver = 'sqlite' | 'postgres';

const resolveBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const resolveDriver = (): SupportedDatabaseDriver => {
  const rawValue = (process.env.DB_TYPE || process.env.DATABASE_TYPE || 'sqlite').toLowerCase();
  return rawValue === 'postgres' || rawValue === 'postgresql' ? 'postgres' : 'sqlite';
};

const createCommonOptions = () => {
  const rootDir = path.resolve(__dirname, '..');

  return {
    entities: [      Attraction,
      Diary,
      DiaryComment,
      Facility,
      Food,
      MapTemplate,
      PhotoCheckin,
      PhotoSpot,
      RoadGraphEdge,
      RoadGraphNode,
      ScenicArea,
      SocialCheckin,
      SocialTeam,
      SocialTeamMember,
      User,
      UserBehavior,
    ],
    migrations: [path.join(rootDir, 'migrations', '*.ts'), path.join(rootDir, 'migrations', '*.js')],
    synchronize: resolveBoolean(process.env.DB_SYNCHRONIZE, true),
    logging: resolveBoolean(process.env.DB_LOGGING, process.env.NODE_ENV === 'development'),
  };
};

const resolveSqliteDatabasePath = () => {
  const backendRootDir = path.resolve(__dirname, '..', '..');
  const configuredPath = process.env.SQLITE_DB_PATH || process.env.DB_PATH || path.join(backendRootDir, 'travel_system.db');
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.resolve(backendRootDir, configuredPath);
};

export const createDatabaseOptions = (): DataSourceOptions => {
  const driver = resolveDriver();
  const commonOptions = createCommonOptions();

  if (driver === 'postgres') {
    return {
      type: 'postgres',
      url: process.env.DATABASE_URL || undefined,
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      username: process.env.DB_USER || process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || process.env.DB_DATABASE || 'personalized_travel_system',
      ssl: resolveBoolean(process.env.DB_SSL, false)
        ? { rejectUnauthorized: resolveBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED, false) }
        : false,
      ...commonOptions,
    };
  }

  return {
    type: 'sqlite',
    database: resolveSqliteDatabasePath(),
    ...commonOptions,
  };
};

export const getDatabaseConfigSummary = () => {
  const options = createDatabaseOptions();

  if (options.type === 'postgres') {
    return {
      driver: options.type,
      host: options.host,
      port: options.port,
      database: options.database,
      synchronize: options.synchronize,
      logging: options.logging,
    };
  }

  return {
    driver: options.type,
    database: options.database,
    synchronize: options.synchronize,
    logging: options.logging,
  };
};

export let AppDataSource: DataSource | null = null;

export const initializeDatabase = async () => {
  if (AppDataSource?.isInitialized) {
    return AppDataSource;
  }

  try {
    const options = createDatabaseOptions();
    AppDataSource = new DataSource(options);
    await AppDataSource.initialize();
    console.log('Database connected successfully:', getDatabaseConfigSummary());
    return AppDataSource;
  } catch (error) {
    console.error('Database connection failed:', error);
    AppDataSource = null;
    throw error;
  }
};

export { In, Like };
