import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createDatabaseOptions } from '../config/database';
import { SHARED_REAL_MAP_TEMPLATE } from '../data/realMapTemplates';
import { REAL_SCENIC_CATALOG } from '../data/realScenicCatalog';
import { Attraction } from '../entities/Attraction';
import { Diary } from '../entities/Diary';
import { DiaryComment } from '../entities/DiaryComment';
import { Facility } from '../entities/Facility';
import { Food } from '../entities/Food';
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
import {
  fetchSharedRealMapTemplate,
  type SharedRealMapTemplateData,
  type SharedTemplatePoint,
} from '../utils/sharedRealMapTemplate';
import { buildScenicClassificationTags } from '../utils/scenicTagging';
import { normalizeStringArray } from '../utils/stringArrayField';

dotenv.config();

type LatLng = {
  latitude: number;
  longitude: number;
};

type TemplateTransform = {
  center: LatLng;
  rotateRad: number;
  scaleLat: number;
  scaleLng: number;
};

type SeedRoadNode = {
  id: string;
  scenicAreaId: string;
  type: string;
  name: string;
  latitude: number;
  longitude: number;
};

type ScenicCatalogEntry = (typeof REAL_SCENIC_CATALOG)[number];

type ScenicSeedContext = {
  id: string;
  name: string;
  city: string;
  category: string;
  center: LatLng;
  tags: string[];
  attractions: Array<{ id: string; name: string; category: string }>;
  facilities: Array<{ id: string; name: string; category: string }>;
  foods: Array<{ id: string; name: string; cuisine: string }>;
  photoSpots: Array<{ id: string; name: string }>;
};

type DemoUserSeed = {
  username: string;
  email: string;
  interests: string[];
};

type SeededDiary = {
  id: string;
  userId: string;
  title: string;
  content: string;
  destination: string;
  visitDate: Date;
  route: string[];
  isShared: boolean;
  popularitySeed: number;
  createdAt: Date;
  updatedAt: Date;
  scenic: ScenicSeedContext;
};

type SeededComment = {
  diaryId: string;
  userId: string;
  rating: number;
};

const SCENIC_AREA_COUNT = Number(process.env.DATA_IMPORT_SCENIC_COUNT ?? REAL_SCENIC_CATALOG.length);
const ATTRACTIONS_PER_SCENIC = Number(process.env.DATA_IMPORT_ATTRACTIONS_PER_SCENIC ?? 20);
const FACILITIES_PER_SCENIC = Number(process.env.DATA_IMPORT_FACILITIES_PER_SCENIC ?? 50);
const GRID_SIZE = Number(process.env.DATA_IMPORT_GRID_SIZE ?? 11);
const FOOD_PER_SCENIC = Number(process.env.DATA_IMPORT_FOOD_PER_SCENIC ?? 20);
const PHOTO_SPOTS_PER_SCENIC = Number(process.env.DATA_IMPORT_PHOTO_SPOTS_PER_SCENIC ?? 4);
const TARGET_USER_COUNT = Number(process.env.DATA_IMPORT_USER_COUNT ?? 12);
const DATA_IMPORT_MAP_MODE = (process.env.DATA_IMPORT_MAP_MODE ?? 'shared_real_template').trim();
const DATA_IMPORT_SEED = Number(process.env.DATA_IMPORT_SEED ?? 20260412);

const DIARIES_PER_USER_MIN = Number(process.env.DATA_IMPORT_DIARIES_PER_USER_MIN ?? 2);
const DIARIES_PER_USER_MAX = Number(process.env.DATA_IMPORT_DIARIES_PER_USER_MAX ?? 4);
const COMMENTS_PER_SHARED_DIARY_MIN = Number(process.env.DATA_IMPORT_COMMENTS_PER_SHARED_DIARY_MIN ?? 1);
const COMMENTS_PER_SHARED_DIARY_MAX = Number(process.env.DATA_IMPORT_COMMENTS_PER_SHARED_DIARY_MAX ?? 4);

const createId = () => uuidv4();

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  pick<T>(items: T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

const rng = new SeededRandom(DATA_IMPORT_SEED);

const CITY_CENTERS: Record<string, LatLng> = {
  北京: { latitude: 39.9042, longitude: 116.4074 },
  上海: { latitude: 31.2304, longitude: 121.4737 },
  广州: { latitude: 23.1291, longitude: 113.2644 },
  成都: { latitude: 30.5728, longitude: 104.0668 },
  杭州: { latitude: 30.2741, longitude: 120.1551 },
  西安: { latitude: 34.3416, longitude: 108.9398 },
  武汉: { latitude: 30.5928, longitude: 114.3055 },
  南京: { latitude: 32.0603, longitude: 118.7969 },
  重庆: { latitude: 29.563, longitude: 106.5516 },
  天津: { latitude: 39.0842, longitude: 117.2009 },
};

const SCENIC_CENTER_OVERRIDES: Record<string, LatLng> = {
  北京邮电大学: { latitude: 40.156883, longitude: 116.284066 },
};

const FACILITY_CATEGORIES = [
  '商店',
  '饭店',
  '洗手间',
  '图书馆',
  '食堂',
  '超市',
  '咖啡馆',
  '游客中心',
  '停车场',
  '医疗点',
] as const;

const CAMPUS_BUILDING_CATEGORIES = ['教学楼', '实验楼', '办公楼', '宿舍楼', '图书馆', '体育馆'];
const SCENIC_BUILDING_CATEGORIES = ['景点', '展馆', '观景台', '园林区', '文化馆', '地标建筑'];
const ATTRACTION_TYPES = ['landmark', 'museum', 'garden', 'culture', 'viewpoint', 'historic'];
const CAMPUS_GATE_LABELS = ['东门', '西门', '南门', '北门', '主楼广场', '操场入口'];
const SCENIC_GATE_LABELS = ['南门', '东门', '游客集散点', '观景平台入口', '中心广场', '游客服务区'];

const CITY_CUISINES: Record<string, string[]> = {
  北京: ['京味', '烤鸭', '面食', '咖啡', '小吃'],
  上海: ['本帮菜', '甜品', '咖啡', '海派简餐', '面食'],
  广州: ['粤菜', '早茶', '烧腊', '甜品', '咖啡'],
  成都: ['川菜', '火锅', '小吃', '甜品', '茶饮'],
  杭州: ['杭帮菜', '茶点', '甜品', '咖啡', '简餐'],
  西安: ['面食', '西北菜', '小吃', '甜品', '烧烤'],
  武汉: ['热干面', '湖北菜', '甜品', '咖啡', '小吃'],
  南京: ['鸭血粉丝', '金陵小吃', '面食', '咖啡', '甜品'],
  重庆: ['火锅', '小面', '烧烤', '甜品', '川渝小吃'],
  天津: ['津味', '早点', '甜品', '咖啡', '小吃'],
};

const DEFAULT_OPENING_HOURS = JSON.stringify({
  Monday: '08:00-22:00',
  Tuesday: '08:00-22:00',
  Wednesday: '08:00-22:00',
  Thursday: '08:00-22:00',
  Friday: '08:00-22:00',
  Saturday: '09:00-21:00',
  Sunday: '09:00-21:00',
});

const BASE_DEMO_USERS: DemoUserSeed[] = [
  { username: 'travel_admin', email: 'travel_admin@example.com', interests: ['摄影', '文化', '自然'] },
  { username: 'beijing_guest', email: 'beijing_guest@example.com', interests: ['校园', '历史', '美食'] },
  { username: 'shanghai_guest', email: 'shanghai_guest@example.com', interests: ['城市漫游', '博物馆', '咖啡'] },
  { username: 'guangzhou_guest', email: 'guangzhou_guest@example.com', interests: ['美食', '街区', '夜景'] },
  { username: 'chengdu_guest', email: 'chengdu_guest@example.com', interests: ['熊猫', '古镇', '火锅'] },
  { username: 'hangzhou_guest', email: 'hangzhou_guest@example.com', interests: ['湖景', '园林', '摄影'] },
  { username: 'xian_guest', email: 'xian_guest@example.com', interests: ['古迹', '历史', '博物馆'] },
  { username: 'wuhan_guest', email: 'wuhan_guest@example.com', interests: ['校园', '湖景', '建筑'] },
  { username: 'nanjing_guest', email: 'nanjing_guest@example.com', interests: ['民国建筑', '博物馆', '美食'] },
  { username: 'chongqing_guest', email: 'chongqing_guest@example.com', interests: ['山城', '夜景', '索道'] },
  { username: 'tianjin_guest', email: 'tianjin_guest@example.com', interests: ['老街区', '近代建筑', '海河'] },
  { username: 'campus_guide', email: 'campus_guide@example.com', interests: ['校园', '图书馆', '打卡'] },
];

const diaryMoodPool = ['路线清晰', '拍照点很多', '适合慢逛', '设施齐全', '适合一天完成'];
const diaryReflectionPool = ['推荐模块给出的候选挺准', '路径规划比预想更实用', '图文记录能把体验重新串起来', '评论区能看到不同玩法', '检索体验对复盘很有帮助'];
const commentFragments = ['路线写得很清楚', '这篇对我选点很有帮助', '拍照点和美食搭配得不错', '内容很真实，参考价值高', '看完就想按这个顺序走一遍'];


const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const toFixedNumber = (value: number, digits = 8) => Number(value.toFixed(digits));

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const shuffle = <T>(items: T[]) => {
  const cloned = [...items];
  for (let index = cloned.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.int(0, index);
    [cloned[index], cloned[swapIndex]] = [cloned[swapIndex], cloned[index]];
  }
  return cloned;
};

const pickMany = <T>(items: T[], count: number) => shuffle(items).slice(0, Math.min(count, items.length));
const expandWeightMap = (weights: Record<string, number>) =>
  Object.entries(weights).flatMap(([label, weight]) => Array.from({ length: Math.max(1, weight) }, () => label));
const uniqueValues = <T>(items: T[]) => Array.from(new Set(items));

const jitterCoord = (base: LatLng, degreeRange: number): LatLng => ({
  latitude: toFixedNumber(base.latitude + rng.float(-degreeRange, degreeRange)),
  longitude: toFixedNumber(base.longitude + rng.float(-degreeRange, degreeRange)),
});

const offsetCoord = (base: LatLng, radius: number, angleDeg: number): LatLng => {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    latitude: toFixedNumber(base.latitude + Math.sin(radians) * radius * 0.78),
    longitude: toFixedNumber(base.longitude + Math.cos(radians) * radius),
  };
};

const haversineMeter = (a: LatLng, b: LatLng): number => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const c =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return earthRadius * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
};

const roadTypeByGrid = (row: number, col: number) => {
  if (row % 3 === 0 || col % 3 === 0) return 'main_road';
  if (row % 2 === 0) return 'bicycle_path';
  return 'footpath';
};

const allowedTransportByRoadType = (roadType: string): string[] => {
  if (roadType === 'main_road' || roadType === 'side_road') return ['walk', 'bicycle', 'electric_cart'];
  if (roadType === 'bicycle_path') return ['walk', 'bicycle'];
  return ['walk'];
};

const buildIndoorStructure = (buildingName: string) =>
  JSON.stringify({
    buildingName,
    floors: [
      { number: 1, rooms: ['入口大厅', '服务台', '休息区'] },
      { number: 2, rooms: ['功能区 A', '多媒体室', '观景区'] },
    ],
    elevators: [{ id: 'e1', floors: [1, 2] }],
  });

const buildScenicDescription = (name: string, city: string, isCampus: boolean) =>
  isCampus
    ? `${name}位于${city}，用于演示校园浏览、建筑查询、室内导航与校园服务联动。`
    : `${name}位于${city}，用于演示景区推荐、景点游览、设施查询与路径规划联动。`;

const buildAttractionDescription = (buildingCategory: string, scenicName: string, isCampus: boolean) =>
  isCampus
    ? `${buildingCategory}服务于 ${scenicName} 的教学、办公、住宿与公共活动。`
    : `${buildingCategory}是 ${scenicName} 内部的重要游览节点和停留空间。`;

const buildFacilityDescription = (category: string, scenicName: string) =>
  `${category}服务于 ${scenicName} 内部游客、访客与日常使用人群。`;

const buildFoodDescription = (cuisine: string, scenicName: string) =>
  `${cuisine}餐饮点，服务于 ${scenicName} 内部游客、师生或访客。`;

const buildPhotoSpotDescription = (attractionName: string) =>
  `${attractionName}附近视野较好，适合拍摄景观、人像和打卡照片。`;

const buildUserSeeds = (targetCount: number): DemoUserSeed[] => {
  if (targetCount <= BASE_DEMO_USERS.length) {
    return BASE_DEMO_USERS.slice(0, targetCount);
  }

  const cityNames = Object.keys(CITY_CENTERS);
  const extraInterestPool = ['摄影', '美食', '古迹', '湖景', '校园', '建筑', '夜景', '园林', '博物馆', '街区'];
  const seeds = [...BASE_DEMO_USERS];

  for (let index = BASE_DEMO_USERS.length; index < targetCount; index += 1) {
    const city = cityNames[index % cityNames.length];
    const interests = uniqueValues([
      extraInterestPool[index % extraInterestPool.length],
      extraInterestPool[(index + 3) % extraInterestPool.length],
      city,
    ]);
    const suffix = String(index + 1).padStart(2, '0');
    seeds.push({
      username: `traveler_${suffix}`,
      email: `traveler_${suffix}@example.com`,
      interests,
    });
  }

  return seeds;
};

const USER_SEED_MAP = new Map(buildUserSeeds(TARGET_USER_COUNT).map((seed) => [seed.username, seed.interests]));

const getUserInterestList = (user: Pick<User, 'username' | 'interests'>) =>
  USER_SEED_MAP.get(user.username) ?? normalizeStringArray(user.interests);

const buildInterestWeights = (interests: string[]) => ({
  foodie: interests.some((item) => /美食|火锅|小吃|咖啡|甜品/.test(item)) ? 0.88 : 0.42,
  photographer: interests.some((item) => /摄影|夜景|湖景/.test(item)) ? 0.9 : 0.44,
  cultureEnthusiast: interests.some((item) => /历史|博物馆|古迹|建筑/.test(item)) ? 0.86 : 0.48,
  natureLover: interests.some((item) => /自然|湖景|园林/.test(item)) ? 0.82 : 0.4,
  sportsEnthusiast: interests.some((item) => /骑行|运动|打卡/.test(item)) ? 0.72 : 0.35,
  relaxationSeeker: interests.some((item) => /慢逛|休闲|咖啡/.test(item)) ? 0.78 : 0.38,
  socialSharer: interests.some((item) => /打卡|街区|夜景/.test(item)) ? 0.8 : 0.46,
});

const ensureDemoUsers = async (dataSource: DataSource): Promise<User[]> => {
  const userRepo = dataSource.getRepository(User);
  const userSeeds = buildUserSeeds(TARGET_USER_COUNT);
  const passwordHash = await bcrypt.hash('123456', 10);
  const users: User[] = [];

  for (const seed of userSeeds) {
    let existing = await userRepo.findOne({
      where: [{ username: seed.username }, { email: seed.email }],
    });

    if (existing && (!existing.id || !String(existing.id).trim())) {
      await userRepo.delete({ username: existing.username });
      existing = null;
    }

    if (existing) {
      existing.email = seed.email;
      existing.passwordHash = passwordHash;
      existing.interests = seed.interests;
      existing.interestWeights = buildInterestWeights(seed.interests);
      existing.viewedItems = [];
      existing.favorites = [];
      existing.dislikedCategories = [];
      const saved = await userRepo.save(existing);
      users.push(saved.id ? saved : ((await userRepo.findOne({ where: { username: seed.username } })) as User));
      continue;
    }

    const saved = await userRepo.save(
      userRepo.create({
        id: createId(),
        username: seed.username,
        email: seed.email,
        passwordHash,
        interests: seed.interests,
        interestWeights: buildInterestWeights(seed.interests),
        viewedItems: [],
        favorites: [],
        dislikedCategories: [],
      }),
    );
    users.push(saved.id ? saved : ((await userRepo.findOne({ where: { username: seed.username } })) as User));
  }

  return users.filter((user): user is User => Boolean(user?.id && String(user.id).trim()));
};

const createGridNodes = (scenicId: string, scenicName: string, center: LatLng): SeedRoadNode[] => {
  const gridSpan = 0.016;
  const step = gridSpan / (GRID_SIZE - 1);
  const startLat = center.latitude - gridSpan / 2;
  const startLng = center.longitude - gridSpan / 2;

  return Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, gridIndex) => {
    const row = Math.floor(gridIndex / GRID_SIZE);
    const col = gridIndex % GRID_SIZE;
    return {
      id: createId(),
      scenicAreaId: scenicId,
      type: 'junction',
      name: `${scenicName}-路口-${row}-${col}`,
      latitude: toFixedNumber(startLat + row * step),
      longitude: toFixedNumber(startLng + col * step),
    };
  });
};

const createScenicCenter = (item: ScenicCatalogEntry, scenicIndex: number, cityOrdinal: number): LatLng => {
  const overriddenCenter = SCENIC_CENTER_OVERRIDES[item.name];
  if (overriddenCenter) {
    return overriddenCenter;
  }

  const cityCenter = CITY_CENTERS[item.city] ?? CITY_CENTERS['北京'];
  const baseRadius = item.category === '校园' ? 0.012 : 0.018;
  const spreadRadius = baseRadius + (cityOrdinal % 5) * 0.006 + rng.float(0.002, 0.01);
  const angle = (cityOrdinal * 137.5 + scenicIndex * 19 + hashString(item.name) % 37) % 360;
  return jitterCoord(offsetCoord(cityCenter, spreadRadius, angle), 0.0012);
};

const createTemplateTransform = (center: LatLng, scenicIndex: number, isCampus: boolean): TemplateTransform => ({
  center,
  rotateRad: (((scenicIndex % 9) - 4) * Math.PI) / 90,
  scaleLat: isCampus ? rng.float(0.92, 1.08) : rng.float(0.85, 1.18),
  scaleLng: isCampus ? rng.float(0.94, 1.1) : rng.float(0.88, 1.16),
});

const transformTemplateCoordinate = (
  coordinate: LatLng,
  templateCenter: LatLng,
  transform: TemplateTransform,
  salt: string,
): LatLng => {
  const dx = coordinate.longitude - templateCenter.longitude;
  const dy = coordinate.latitude - templateCenter.latitude;
  const scaledX = dx * transform.scaleLng;
  const scaledY = dy * transform.scaleLat;
  const sin = Math.sin(transform.rotateRad);
  const cos = Math.cos(transform.rotateRad);
  const rotatedX = scaledX * cos - scaledY * sin;
  const rotatedY = scaledX * sin + scaledY * cos;
  const wobble = ((hashString(salt) % 17) - 8) * 0.0000035;

  return {
    latitude: toFixedNumber(transform.center.latitude + rotatedY + wobble),
    longitude: toFixedNumber(transform.center.longitude + rotatedX - wobble),
  };
};

const pickTemplatePoint = (
  points: SharedTemplatePoint[],
  index: number,
  fallback: LatLng,
): SharedTemplatePoint =>
  points[index % Math.max(1, points.length)] || {
    key: `fallback-${index}`,
    name: '模板回退点',
    latitude: fallback.latitude,
    longitude: fallback.longitude,
    sourceCategory: 'fallback',
  };

const buildTranslatedTemplatePoints = (
  points: SharedTemplatePoint[],
  template: SharedRealMapTemplateData,
  transform: TemplateTransform,
): SharedTemplatePoint[] =>
  points.map((point) => {
    const coordinate = transformTemplateCoordinate(
      { latitude: point.latitude, longitude: point.longitude },
      template.center,
      transform,
      point.key,
    );
    return {
      ...point,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    };
  });

const cloneSharedTemplateRoadNodes = (
  template: SharedRealMapTemplateData,
  scenicId: string,
  scenicName: string,
  transform: TemplateTransform,
) => {
  const nodeIdMap = new Map<string, string>();
  const coordinateMap = new Map<string, LatLng>();
  const nodes: SeedRoadNode[] = template.roadNodes.map((node, index) => {
    const id = createId();
    nodeIdMap.set(node.key, id);
    const coordinate = transformTemplateCoordinate(
      { latitude: node.latitude, longitude: node.longitude },
      template.center,
      transform,
      node.key,
    );
    coordinateMap.set(id, coordinate);
    return {
      id,
      scenicAreaId: scenicId,
      type: node.type,
      name: `${scenicName}-真实路网节点-${index + 1}`,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    };
  });

  return { nodes, nodeIdMap, coordinateMap };
};

const buildCategoryWeightPool = (item: ScenicCatalogEntry) => {
  if (item.category === '校园') {
    return expandWeightMap({
      图书馆: 10,
      食堂: 11,
      咖啡馆: 8,
      超市: 9,
      洗手间: 10,
      商店: 6,
      医疗点: 5,
      停车场: 4,
      游客中心: 2,
      饭店: 4,
    });
  }

  return expandWeightMap({
    游客中心: 11,
    商店: 10,
    饭店: 10,
    洗手间: 9,
    停车场: 8,
    咖啡馆: 7,
    医疗点: 5,
    超市: 3,
    图书馆: item.city === '北京' || item.city === '上海' ? 2 : 1,
    食堂: 1,
  });
};

const buildCuisinePool = (item: ScenicCatalogEntry) => {
  const cityCuisines = CITY_CUISINES[item.city] ?? ['简餐', '小吃', '咖啡', '甜品'];
  const baseWeights =
    item.category === '校园'
      ? [...cityCuisines, '食堂套餐', '简餐', '咖啡', '面食', '甜品']
      : [...cityCuisines, '地方特色', '简餐', '小吃', '咖啡', '甜品'];
  return [...baseWeights, ...baseWeights.slice(0, Math.ceil(baseWeights.length / 2))];
};

const buildAttractionCount = (item: ScenicCatalogEntry) =>
  clamp(ATTRACTIONS_PER_SCENIC + rng.int(item.category === '校园' ? -4 : -2, item.category === '校园' ? 4 : 8), 12, 32);

const buildFacilityCount = (item: ScenicCatalogEntry) =>
  clamp(FACILITIES_PER_SCENIC + rng.int(item.category === '校园' ? -8 : -12, item.category === '校园' ? 10 : 14), 24, 70);

const buildFoodCount = (item: ScenicCatalogEntry) =>
  clamp(FOOD_PER_SCENIC + rng.int(item.category === '校园' ? -4 : -3, item.category === '校园' ? 4 : 6), 10, 28);

const buildPhotoSpotCount = () => clamp(PHOTO_SPOTS_PER_SCENIC + rng.int(-1, 2), 3, 8);

const buildRoadHubNodes = (
  scenicId: string,
  scenicName: string,
  center: LatLng,
  isCampus: boolean,
  hubCount: number,
): SeedRoadNode[] => {
  const labels = isCampus ? CAMPUS_GATE_LABELS : SCENIC_GATE_LABELS;

  return Array.from({ length: hubCount }, (_, index) => {
    const coordinate = offsetCoord(center, 0.0045 + index * 0.0011 + rng.float(0.0004, 0.0012), index * (360 / hubCount) + rng.float(-18, 18));
    return {
      id: createId(),
      scenicAreaId: scenicId,
      type: 'gateway',
      name: `${scenicName}-${labels[index % labels.length]}`,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    };
  });
};

const buildEdgeRecord = (
  scenicAreaId: string,
  fromNodeId: string,
  toNodeId: string,
  from: LatLng,
  to: LatLng,
  roadType: string,
  overrides: Partial<{
    congestionFactor: number;
    allowedTransportation: string[];
    isElectricCartRoute: boolean;
    isBicyclePath: boolean;
    transportation: string;
  }> = {},
) => ({
  id: createId(),
  scenicAreaId,
  fromNodeId,
  toNodeId,
  distance: Number(haversineMeter(from, to).toFixed(2)),
  roadType,
  congestionFactor:
    overrides.congestionFactor ?? Number(rng.float(0.82, roadType === 'connector' ? 1.05 : 1.18).toFixed(2)),
  allowedTransportation: JSON.stringify(overrides.allowedTransportation ?? allowedTransportByRoadType(roadType)),
  isElectricCartRoute:
    overrides.isElectricCartRoute ?? ((roadType === 'main_road' || roadType === 'side_road') && rng.chance(0.55)),
  isBicyclePath: overrides.isBicyclePath ?? roadType === 'bicycle_path',
  transportation: overrides.transportation ?? 'mixed',
});

const createDiaryContent = (
  user: User,
  scenic: ScenicSeedContext,
  routeStops: string[],
  foodNames: string[],
  visitDate: Date,
) => {
  const interests = getUserInterestList(user);
  const summaryLine = `${user.username} 在 ${visitDate.toLocaleDateString('zh-CN')} 走了 ${scenic.city} 的 ${scenic.name}，主线是 ${routeStops.join(' -> ')}。`;
  const featureLine =
    foodNames.length > 0
      ? `中途重点体验了 ${foodNames.join('、')}，整体节奏偏 ${rng.pick(diaryMoodPool)}。`
      : `这次没有专门安排餐饮打卡，更多是在 ${routeStops.slice(0, 2).join('、')} 一带慢慢逛。`;
  const reflectionLine = `${rng.pick(diaryReflectionPool)}，尤其是在 ${routeStops[0]} 和 ${routeStops[routeStops.length - 1]} 之间切换时感受更明显。`;
  const tagsLine = `关键词：${uniqueValues([...interests, scenic.category, scenic.city]).join(' / ')}。`;
  return [summaryLine, featureLine, reflectionLine, tagsLine].join('\n\n');
};

const createCommentContent = (diary: SeededDiary, rating: number) =>
  `${rng.pick(commentFragments)}，${diary.scenic.name} 这条线我也想试试，给 ${rating.toFixed(1)} 分。`;

const randomPastDate = (maxDaysAgo: number) => {
  const now = Date.now();
  const daysAgo = rng.float(1, maxDaysAgo);
  return new Date(now - daysAgo * 24 * 60 * 60 * 1000);
};

const buildUserScenicScore = (user: User, scenic: ScenicSeedContext) => {
  let score = 0;
  if (user.username.includes('beijing') && scenic.city === '北京') score += 6;
  if (user.username.includes('shanghai') && scenic.city === '上海') score += 6;
  if (user.username.includes('guangzhou') && scenic.city === '广州') score += 6;
  if (user.username.includes('chengdu') && scenic.city === '成都') score += 6;
  if (user.username.includes('hangzhou') && scenic.city === '杭州') score += 6;
  if (user.username.includes('xian') && scenic.city === '西安') score += 6;
  if (user.username.includes('wuhan') && scenic.city === '武汉') score += 6;
  if (user.username.includes('nanjing') && scenic.city === '南京') score += 6;
  if (user.username.includes('chongqing') && scenic.city === '重庆') score += 6;
  if (user.username.includes('tianjin') && scenic.city === '天津') score += 6;

  for (const interest of getUserInterestList(user)) {
    if (scenic.category.includes(interest) || scenic.city.includes(interest)) {
      score += 4;
    }
    if (scenic.tags.some((tag) => tag.includes(interest) || interest.includes(tag))) {
      score += 2;
    }
  }

  return score + rng.float(0, 1.5);
};

const insertInChunks = async (repository: { insert: (values: any[]) => Promise<unknown> }, items: any[], chunkSize = 400) => {
  for (let index = 0; index < items.length; index += chunkSize) {
    await repository.insert(items.slice(index, index + chunkSize));
  }
};

const seedDiariesAndComments = async (
  dataSource: DataSource,
  users: User[],
  scenicContexts: ScenicSeedContext[],
) => {
  const diaryRepo = dataSource.getRepository(Diary);
  const commentRepo = dataSource.getRepository(DiaryComment);
  const diariesToInsert: Array<Partial<Diary>> = [];
  const seededDiaries: SeededDiary[] = [];

  for (const user of users) {
    const rankedScenics = [...scenicContexts]
      .sort((left, right) => buildUserScenicScore(user, right) - buildUserScenicScore(user, left))
      .slice(0, 16);
    const diaryCount = clamp(
      DIARIES_PER_USER_MIN + (user.username === 'travel_admin' ? 2 : 0) + rng.int(0, DIARIES_PER_USER_MAX - DIARIES_PER_USER_MIN),
      DIARIES_PER_USER_MIN,
      DIARIES_PER_USER_MAX + 2,
    );
    const selectedScenics = pickMany(rankedScenics, diaryCount);

    for (let index = 0; index < selectedScenics.length; index += 1) {
      const scenic = selectedScenics[index];
      const routeStops = pickMany(scenic.attractions, clamp(rng.int(3, 5), 2, scenic.attractions.length)).map((item) => item.name);
      const foodNames = pickMany(scenic.foods, rng.int(0, Math.min(2, scenic.foods.length))).map((item) => item.name);
      const visitDate = randomPastDate(180);
      const createdAt = new Date(visitDate.getTime() + rng.int(1, 7) * 24 * 60 * 60 * 1000);
      const titleSuffix = scenic.category === '校园' ? rng.pick(['校园漫游', '路线实测', '一天记录']) : rng.pick(['一日游记', '慢逛记录', '路线复盘']);
      const title = `${scenic.name}${titleSuffix}`;
      const content = createDiaryContent(user, scenic, routeStops, foodNames, visitDate);
      const isShared = index > 0 || rng.chance(0.72);
      const popularitySeed = isShared ? rng.int(18, 180) : rng.int(0, 18);
      const id = createId();

      seededDiaries.push({
        id,
        userId: user.id,
        title,
        content,
        destination: scenic.name,
        visitDate,
        route: routeStops,
        isShared,
        popularitySeed,
        createdAt,
        updatedAt: createdAt,
        scenic,
      });

      diariesToInsert.push({
        id,
        userId: user.id,
        title,
        content,
        compressedContent: Buffer.from(content, 'utf8'),
        destination: scenic.name,
        visitDate,
        route: routeStops,
        popularity: popularitySeed,
        averageRating: 0,
        reviewCount: 0,
        isShared,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }

  await insertInChunks(diaryRepo, diariesToInsert);

  const commentsToInsert: Array<Partial<DiaryComment>> = [];
  const commentStats = new Map<string, SeededComment[]>();
  const sharedDiaries = seededDiaries.filter((item) => item.isShared);

  for (const diary of sharedDiaries) {
    const availableUsers = users.filter((user) => user.id !== diary.userId);
    const commentCount = clamp(
      COMMENTS_PER_SHARED_DIARY_MIN + rng.int(0, COMMENTS_PER_SHARED_DIARY_MAX - COMMENTS_PER_SHARED_DIARY_MIN) + (diary.popularitySeed > 120 ? 1 : 0),
      COMMENTS_PER_SHARED_DIARY_MIN,
      COMMENTS_PER_SHARED_DIARY_MAX + 1,
    );
    const commenters = pickMany(availableUsers, commentCount);

    for (const commenter of commenters) {
      const rating = Number(rng.float(3.8, 4.9).toFixed(2));
      const createdAt = new Date(diary.createdAt.getTime() + rng.int(1, 12) * 60 * 60 * 1000);
      const record = {
        id: createId(),
        diaryId: diary.id,
        userId: commenter.id,
        content: createCommentContent(diary, rating),
        rating,
        createdAt,
      };
      commentsToInsert.push(record);

      const list = commentStats.get(diary.id) ?? [];
      list.push({ diaryId: diary.id, userId: commenter.id, rating });
      commentStats.set(diary.id, list);
    }
  }

  if (commentsToInsert.length > 0) {
    await insertInChunks(commentRepo, commentsToInsert);
  }

  for (const diary of seededDiaries) {
    const stats = commentStats.get(diary.id) ?? [];
    if (!stats.length) {
      continue;
    }
    const averageRating = Number((stats.reduce((sum, item) => sum + item.rating, 0) / stats.length).toFixed(2));
    await diaryRepo.update(diary.id, {
      reviewCount: stats.length,
      averageRating,
      popularity: diary.popularitySeed + stats.length * rng.int(8, 18),
      updatedAt: new Date(diary.updatedAt.getTime() + 2 * 60 * 60 * 1000),
    });
  }

  return { diaries: seededDiaries, sharedDiaries };
};

const seedBehaviors = async (
  dataSource: DataSource,
  users: User[],
  scenicContexts: ScenicSeedContext[],
  sharedDiaries: SeededDiary[],
) => {
  const behaviorRepo = dataSource.getRepository(UserBehavior);
  const userRepo = dataSource.getRepository(User);
  const behaviors: Array<Partial<UserBehavior>> = [];

  for (const user of users) {
    const rankedScenics = [...scenicContexts]
      .sort((left, right) => buildUserScenicScore(user, right) - buildUserScenicScore(user, left))
      .slice(0, 18);
    const viewedItems = new Set<string>();
    const favorites = new Set<string>();
    const dislikedCategories = new Set<string>();

    const scenicBrowseTargets = pickMany(rankedScenics, clamp(rng.int(6, 10), 4, rankedScenics.length));
    for (const scenic of scenicBrowseTargets) {
      behaviors.push({
        id: createId(),
        userId: user.id,
        behaviorType: 'browse',
        targetType: 'scenic_area',
        targetId: scenic.id,
        duration: rng.int(120, 1100),
        timestamp: randomPastDate(120),
      });
      viewedItems.add(scenic.id);
    }

    const attractionTargets = pickMany(
      rankedScenics.flatMap((item) => item.attractions.map((attraction) => ({ scenic: item, attraction }))),
      user.username === 'campus_guide' ? 14 : rng.int(10, 14),
    );
    for (const { scenic, attraction } of attractionTargets) {
      behaviors.push({
        id: createId(),
        userId: user.id,
        behaviorType: 'browse',
        targetType: 'attraction',
        targetId: attraction.id,
        duration: rng.int(90, 900),
        timestamp: randomPastDate(100),
      });
      viewedItems.add(attraction.id);

      if (rng.chance(0.28)) {
        favorites.add(attraction.id);
      }
      if (rng.chance(0.35)) {
        behaviors.push({
          id: createId(),
          userId: user.id,
          behaviorType: 'rate',
          targetType: 'attraction',
          targetId: attraction.id,
          rating: rng.int(4, 5),
          timestamp: randomPastDate(90),
        });
      }
      if (rng.chance(0.08)) {
        dislikedCategories.add(scenic.category);
      }
    }

    const foodTargets = pickMany(rankedScenics.flatMap((item) => item.foods), user.username === 'travel_admin' ? 14 : rng.int(9, 12));
    for (const food of foodTargets) {
      behaviors.push({
        id: createId(),
        userId: user.id,
        behaviorType: 'browse',
        targetType: 'food',
        targetId: food.id,
        duration: rng.int(60, 420),
        timestamp: randomPastDate(90),
      });
      behaviors.push({
        id: createId(),
        userId: user.id,
        behaviorType: 'rate',
        targetType: 'food',
        targetId: food.id,
        rating: rng.int(4, 5),
        timestamp: randomPastDate(70),
      });
      if (rng.chance(0.45)) {
        behaviors.push({
          id: createId(),
          userId: user.id,
          behaviorType: 'favorite',
          targetType: 'food',
          targetId: food.id,
          timestamp: randomPastDate(60),
        });
        favorites.add(food.id);
      }
      viewedItems.add(food.id);
    }

    const diaryTargets = pickMany(
      sharedDiaries.filter((item) => item.userId !== user.id),
      rng.int(6, 10),
    );
    for (const diary of diaryTargets) {
      behaviors.push({
        id: createId(),
        userId: user.id,
        behaviorType: 'browse',
        targetType: 'diary',
        targetId: diary.id,
        duration: rng.int(90, 560),
        timestamp: randomPastDate(45),
      });
      if (rng.chance(0.2)) {
        behaviors.push({
          id: createId(),
          userId: user.id,
          behaviorType: 'favorite',
          targetType: 'diary',
          targetId: diary.id,
          timestamp: randomPastDate(35),
        });
        favorites.add(diary.id);
      }
      viewedItems.add(diary.id);
    }

    await userRepo.update(user.id, {
      viewedItems: [...viewedItems].slice(0, 80),
      favorites: [...favorites].slice(0, 40),
      dislikedCategories: [...dislikedCategories].slice(0, 4),
      updatedAt: new Date(),
    });
  }

  if (behaviors.length > 0) {
    await insertInChunks(behaviorRepo, behaviors, 600);
  }

  return behaviors.length;
};

const seedMediaAndSocial = async (
  dataSource: DataSource,
  users: User[],
  scenicContexts: ScenicSeedContext[],
) => {
  const photoCheckinRepo = dataSource.getRepository(PhotoCheckin);
  const socialCheckinRepo = dataSource.getRepository(SocialCheckin);
  const photos: Array<Partial<PhotoCheckin>> = [];
  const socials: Array<Partial<SocialCheckin>> = [];

  for (const user of users) {
    const rankedScenics = [...scenicContexts]
      .sort((left, right) => buildUserScenicScore(user, right) - buildUserScenicScore(user, left))
      .slice(0, 10);

    const photoTargetCount = user.username === 'travel_admin' ? 22 : user.username === 'campus_guide' ? 12 : rng.int(4, 8);
    const socialTargetCount = user.username === 'travel_admin' ? 10 : rng.int(2, 5);

    const photoTargets = pickMany(rankedScenics.flatMap((item) => item.photoSpots.map((spot) => ({ scenic: item, spot }))), photoTargetCount);
    for (const { scenic, spot } of photoTargets) {
      photos.push({
        id: createId(),
        photoSpotId: spot.id,
        userId: user.id,
        photoUrl: `https://picsum.photos/seed/${spot.id}-${user.id}/960/640`,
        caption: `${scenic.name} 的 ${spot.name}，今天的光线和人流都很合适。`,
        likes: rng.int(4, 80),
        createdAt: randomPastDate(120),
      });
    }

    const socialTargets = pickMany(
      rankedScenics.flatMap((item) => item.attractions.map((attraction) => ({ scenic: item, attraction }))),
      socialTargetCount,
    );
    for (const { scenic, attraction } of socialTargets) {
      socials.push({
        id: createId(),
        userId: user.id,
        username: user.username,
        attractionId: attraction.id,
        attractionName: attraction.name,
        scenicAreaId: scenic.id,
        photo: `https://picsum.photos/seed/social-${attraction.id}-${user.id}/640/640`,
        text: `${attraction.name} 现场体验不错，${rng.pick(diaryMoodPool)}。`,
        likes: rng.int(3, 60),
        comments: rng.int(0, 16),
        timestamp: randomPastDate(90),
      });
    }
  }

  if (photos.length > 0) {
    await insertInChunks(photoCheckinRepo, photos, 500);
  }
  if (socials.length > 0) {
    await insertInChunks(socialCheckinRepo, socials, 500);
  }

  return { photoCount: photos.length, socialCount: socials.length };
};

async function importData() {
  const dataSource = new DataSource(createDatabaseOptions());

  try {
    await dataSource.initialize();
    console.log(`开始导入真实景区与校园数据，随机种子 ${DATA_IMPORT_SEED}...`);

    const scenicRepo = dataSource.getRepository(ScenicArea);
    const attractionRepo = dataSource.getRepository(Attraction);
    const facilityRepo = dataSource.getRepository(Facility);
    const foodRepo = dataSource.getRepository(Food);
    const nodeRepo = dataSource.getRepository(RoadGraphNode);
    const edgeRepo = dataSource.getRepository(RoadGraphEdge);
    const photoSpotRepo = dataSource.getRepository(PhotoSpot);
    const photoCheckinRepo = dataSource.getRepository(PhotoCheckin);
    const socialTeamRepo = dataSource.getRepository(SocialTeam);
    const socialTeamMemberRepo = dataSource.getRepository(SocialTeamMember);
    const socialCheckinRepo = dataSource.getRepository(SocialCheckin);
    const diaryRepo = dataSource.getRepository(Diary);
    const diaryCommentRepo = dataSource.getRepository(DiaryComment);
    const userBehaviorRepo = dataSource.getRepository(UserBehavior);
    const userRepo = dataSource.getRepository(User);

    const existingScenicAreas = await scenicRepo.find({
      select: {
        name: true,
        coverImageUrl: true,
        coverSource: true,
        coverAuthor: true,
        coverLicense: true,
        coverPageUrl: true,
      },
    });
    const existingCoverMap = new Map(
      existingScenicAreas.map((item) => [
        item.name,
        {
          coverImageUrl: item.coverImageUrl || null,
          coverSource: item.coverSource || null,
          coverAuthor: item.coverAuthor || null,
          coverLicense: item.coverLicense || null,
          coverPageUrl: item.coverPageUrl || null,
        },
      ]),
    );

    await socialTeamMemberRepo.clear();
    await socialTeamRepo.clear();
    await socialCheckinRepo.clear();
    await photoCheckinRepo.clear();
    await userBehaviorRepo.clear();
    await diaryCommentRepo.clear();
    await diaryRepo.clear();
    await photoSpotRepo.clear();
    await edgeRepo.clear();
    await nodeRepo.clear();
    await foodRepo.clear();
    await facilityRepo.clear();
    await attractionRepo.clear();
    await scenicRepo.clear();

    await ensureDemoUsers(dataSource);
    const userSeeds = buildUserSeeds(TARGET_USER_COUNT);
    const persistedUsers = await userRepo.find();
    const users = userSeeds
      .map((seed) => persistedUsers.find((user) => user.username === seed.username))
      .filter((user): user is User => Boolean(user?.id && String(user.id).trim()));
    const catalog = REAL_SCENIC_CATALOG.slice(0, Math.min(SCENIC_AREA_COUNT, REAL_SCENIC_CATALOG.length));
    const cityCounter = new Map<string, number>();
    const scenicContexts: ScenicSeedContext[] = [];
    let sharedRealMapTemplate: SharedRealMapTemplateData | null = null;

    if (DATA_IMPORT_MAP_MODE === 'shared_real_template') {
      try {
        sharedRealMapTemplate = await fetchSharedRealMapTemplate(SHARED_REAL_MAP_TEMPLATE);
        console.log(
          `已加载真实地图模板：${sharedRealMapTemplate.label}，路网节点 ${sharedRealMapTemplate.roadNodes.length}，路网边 ${sharedRealMapTemplate.roadEdges.length}，建筑 ${sharedRealMapTemplate.buildingPoints.length}，设施 ${sharedRealMapTemplate.facilityPoints.length}`,
        );
      } catch (templateError) {
        sharedRealMapTemplate = null;
        console.warn('真实地图模板加载失败，当前导入将回退到网格路网模式。', templateError);
      }
    }

    for (let index = 0; index < catalog.length; index += 1) {
      const item = catalog[index];
      const cityOrdinal = cityCounter.get(item.city) ?? 0;
      cityCounter.set(item.city, cityOrdinal + 1);

      const scenicId = createId();
      const scenicName = item.name;
      const isCampus = item.category === '校园';
      const center = createScenicCenter(item, index, cityOrdinal);
      const preservedCover = existingCoverMap.get(scenicName);
      const transform = sharedRealMapTemplate ? createTemplateTransform(center, index, isCampus) : null;
      const translatedBuildingPoints =
        sharedRealMapTemplate && transform
          ? buildTranslatedTemplatePoints(sharedRealMapTemplate.buildingPoints, sharedRealMapTemplate, transform)
          : [];
      const translatedFacilityPoints =
        sharedRealMapTemplate && transform
          ? buildTranslatedTemplatePoints(sharedRealMapTemplate.facilityPoints, sharedRealMapTemplate, transform)
          : [];

      const attractionCount = buildAttractionCount(item);
      const facilityCount = buildFacilityCount(item);
      const foodCount = buildFoodCount(item);
      const photoSpotCount = buildPhotoSpotCount();
      const facilityCategoryPool = buildCategoryWeightPool(item);
      const cuisinePool = buildCuisinePool(item);

      await scenicRepo.insert({
        id: scenicId,
        name: scenicName,
        category: item.category,
        city: item.city,
        description: buildScenicDescription(scenicName, item.city, isCampus),
        latitude: center.latitude,
        longitude: center.longitude,
        openingHours: DEFAULT_OPENING_HOURS,
        ticketPrice: isCampus ? 0 : Number(rng.float(20, 180).toFixed(2)),
        popularity: rng.int(3000, 180000),
        averageRating: Number(rng.float(4.0, 4.9).toFixed(2)),
        reviewCount: rng.int(200, 8000),
        tags: buildScenicClassificationTags({
          name: scenicName,
          category: item.category,
          description: buildScenicDescription(scenicName, item.city, isCampus),
          city: item.city,
        }).join(','),
        rating: Number(rng.float(4.0, 4.9).toFixed(2)),
        visitorCount: rng.int(12000, 600000),
        coverImageUrl: preservedCover?.coverImageUrl || null,
        coverSource: preservedCover?.coverSource || null,
        coverAuthor: preservedCover?.coverAuthor || null,
        coverLicense: preservedCover?.coverLicense || null,
        coverPageUrl: preservedCover?.coverPageUrl || null,
      });

      const buildingCategories = isCampus ? CAMPUS_BUILDING_CATEGORIES : SCENIC_BUILDING_CATEGORIES;
      const attractions = Array.from({ length: attractionCount }, (_, attractionIndex) => {
        const templatePoint = sharedRealMapTemplate
          ? pickTemplatePoint(translatedBuildingPoints, attractionIndex, center)
          : null;
        const coord = templatePoint
          ? { latitude: templatePoint.latitude, longitude: templatePoint.longitude }
          : jitterCoord(center, 0.01);
        const buildingCategory = buildingCategories[attractionIndex % buildingCategories.length];
        return {
          id: createId(),
          scenicAreaId: scenicId,
          name: `${scenicName}-${buildingCategory}${String(attractionIndex + 1).padStart(2, '0')}`,
          type: rng.pick(ATTRACTION_TYPES),
          category: buildingCategory,
          city: item.city,
          description: buildAttractionDescription(buildingCategory, scenicName, isCampus),
          latitude: coord.latitude,
          longitude: coord.longitude,
          openingHours: '{"default":"08:30-20:30"}',
          averageRating: Number(rng.float(3.8, 5).toFixed(2)),
          reviewCount: rng.int(20, 4000),
          estimatedVisitDuration: rng.int(20, 120),
          congestionFactor: Number(rng.float(0.72, 1.24).toFixed(2)),
          tags: [item.category, buildingCategory],
          indoorStructure:
            attractionIndex % (isCampus ? 4 : 6) === 0
              ? buildIndoorStructure(`${scenicName}-${buildingCategory}${attractionIndex + 1}`)
              : '{}',
        };
      });
      await insertInChunks(attractionRepo, attractions);

      const photoSpots = attractions.slice(0, photoSpotCount).map((attraction, photoIndex) => ({
        id: createId(),
        scenicAreaId: scenicId,
        attractionId: attraction.id,
        name: `${attraction.name}-摄影位`,
        description: buildPhotoSpotDescription(attraction.name),
        latitude: Number(attraction.latitude ?? center.latitude),
        longitude: Number(attraction.longitude ?? center.longitude),
        bestTime: ['07:00-09:30', '16:30-18:30', '09:00-11:00', '17:00-19:00'][photoIndex % 4],
        popularity: rng.int(40, 600),
        crowdLevel: ['low', 'medium', 'high', 'medium'][photoIndex % 4] as 'low' | 'medium' | 'high',
        lightingCondition: ['excellent', 'good', 'fair', 'good'][photoIndex % 4] as 'excellent' | 'good' | 'fair',
        examplePhotos: JSON.stringify([
          `https://picsum.photos/seed/${scenicId}-${photoIndex + 1}-a/900/600`,
          `https://picsum.photos/seed/${scenicId}-${photoIndex + 1}-b/900/600`,
        ]),
      }));
      if (photoSpots.length > 0) {
        await insertInChunks(photoSpotRepo, photoSpots);
      }

      const facilities = Array.from({ length: facilityCount }, (_, facilityIndex) => {
        const templatePoint = sharedRealMapTemplate
          ? pickTemplatePoint(translatedFacilityPoints, facilityIndex, center)
          : null;
        const coord = templatePoint
          ? { latitude: templatePoint.latitude, longitude: templatePoint.longitude }
          : jitterCoord(center, 0.012);
        const category = rng.pick(facilityCategoryPool);
        return {
          id: createId(),
          scenicAreaId: scenicId,
          name: `${scenicName}-${category}${String(facilityIndex + 1).padStart(2, '0')}`,
          category,
          latitude: coord.latitude,
          longitude: coord.longitude,
          openingHours: '{"default":"07:00-23:00"}',
          description: buildFacilityDescription(category, scenicName),
        };
      });
      await insertInChunks(facilityRepo, facilities);

      const foodFacilityCandidates = facilities.filter((facility) =>
        ['饭店', '食堂', '咖啡馆', '游客中心', '商店', '超市'].includes(facility.category),
      );
      const candidateFacilities = foodFacilityCandidates.length ? foodFacilityCandidates : facilities;
      const foods = Array.from({ length: foodCount }, (_, foodIndex) => {
        const facility = candidateFacilities[foodIndex % candidateFacilities.length];
        const cuisine = rng.pick(cuisinePool);
        return {
          id: createId(),
          name: `${scenicName}-${cuisine}${String(foodIndex + 1).padStart(2, '0')}`,
          facilityId: facility.id,
          cuisine,
          price: Number(rng.float(12, isCampus ? 68 : 188).toFixed(2)),
          description: buildFoodDescription(cuisine, scenicName),
          popularity: rng.int(100, 20000),
          averageRating: Number(rng.float(3.6, 4.9).toFixed(2)),
          reviewCount: rng.int(15, 3000),
          tags: [cuisine, item.category, item.city],
          isSeasonalSpecial: rng.chance(0.16),
        };
      });
      await insertInChunks(foodRepo, foods);

      const routeNodeSource =
        sharedRealMapTemplate && transform
          ? cloneSharedTemplateRoadNodes(sharedRealMapTemplate, scenicId, scenicName, transform)
          : {
              nodes: createGridNodes(scenicId, scenicName, center),
              nodeIdMap: null as Map<string, string> | null,
              coordinateMap: new Map<string, LatLng>(),
            };

      const baseRouteNodes = routeNodeSource.nodes;
      const routeNodeCoords = new Map<string, LatLng>(
        baseRouteNodes.map((node) => [
          node.id,
          { latitude: Number(node.latitude), longitude: Number(node.longitude) },
        ]),
      );

      const roadHubNodes = buildRoadHubNodes(scenicId, scenicName, center, isCampus, isCampus ? rng.int(2, 3) : rng.int(3, 5));
      const poiNodes = [
        ...attractions.slice(0, clamp(rng.int(6, 12), 4, attractions.length)).map((attraction) => ({
          id: createId(),
          scenicAreaId: scenicId,
          type: 'attraction',
          name: attraction.name,
          latitude: attraction.latitude,
          longitude: attraction.longitude,
        })),
        ...facilities.slice(0, clamp(rng.int(8, 14), 5, facilities.length)).map((facility) => ({
          id: createId(),
          scenicAreaId: scenicId,
          type: 'facility',
          name: facility.name,
          latitude: facility.latitude,
          longitude: facility.longitude,
        })),
      ];

      const allNodes = [...baseRouteNodes, ...roadHubNodes, ...poiNodes];
      for (const node of roadHubNodes) {
        routeNodeCoords.set(node.id, { latitude: node.latitude, longitude: node.longitude });
      }
      for (const node of poiNodes) {
        routeNodeCoords.set(node.id, { latitude: Number(node.latitude), longitude: Number(node.longitude) });
      }

      await insertInChunks(nodeRepo, allNodes);

      const edges: Array<{
        id: string;
        scenicAreaId: string;
        fromNodeId: string;
        toNodeId: string;
        distance: number;
        roadType: string;
        congestionFactor: number;
        allowedTransportation: string;
        isElectricCartRoute: boolean;
        isBicyclePath: boolean;
        transportation: string;
      }> = [];
      const edgeKeySet = new Set<string>();

      const pushEdge = (
        fromNodeId: string,
        toNodeId: string,
        roadType: string,
        overrides: Partial<{
          congestionFactor: number;
          allowedTransportation: string[];
          isElectricCartRoute: boolean;
          isBicyclePath: boolean;
          transportation: string;
        }> = {},
      ) => {
        const key = `${fromNodeId}->${toNodeId}`;
        if (edgeKeySet.has(key)) {
          return;
        }
        const from = routeNodeCoords.get(fromNodeId);
        const to = routeNodeCoords.get(toNodeId);
        if (!from || !to) {
          return;
        }
        edgeKeySet.add(key);
        edges.push(buildEdgeRecord(scenicId, fromNodeId, toNodeId, from, to, roadType, overrides));
      };

      const pushBidirectionalEdge = (
        fromNodeId: string,
        toNodeId: string,
        roadType: string,
        overrides: Partial<{
          congestionFactor: number;
          allowedTransportation: string[];
          isElectricCartRoute: boolean;
          isBicyclePath: boolean;
          transportation: string;
        }> = {},
      ) => {
        pushEdge(fromNodeId, toNodeId, roadType, overrides);
        pushEdge(toNodeId, fromNodeId, roadType, overrides);
      };

      if (sharedRealMapTemplate && routeNodeSource.nodeIdMap) {
        for (const edge of sharedRealMapTemplate.roadEdges) {
          const fromNodeId = routeNodeSource.nodeIdMap.get(edge.fromKey);
          const toNodeId = routeNodeSource.nodeIdMap.get(edge.toKey);
          if (!fromNodeId || !toNodeId) {
            continue;
          }
          pushEdge(fromNodeId, toNodeId, edge.roadType, {
            congestionFactor: Number((edge.congestionFactor * rng.float(0.92, 1.14)).toFixed(2)),
            allowedTransportation: edge.allowedTransportation,
            isElectricCartRoute: edge.isElectricCartRoute,
            isBicyclePath: edge.isBicyclePath,
            transportation: 'mixed',
          });
        }

        const shortcutAttempts = isCampus ? rng.int(3, 5) : rng.int(5, 9);
        const shortcutCandidates = shuffle(baseRouteNodes);
        for (let shortcutIndex = 0; shortcutIndex < shortcutAttempts; shortcutIndex += 1) {
          const from = shortcutCandidates[shortcutIndex];
          const to = shortcutCandidates[shortcutCandidates.length - 1 - shortcutIndex];
          if (!from || !to || from.id === to.id) {
            continue;
          }
          const distance = haversineMeter(
            { latitude: from.latitude, longitude: from.longitude },
            { latitude: to.latitude, longitude: to.longitude },
          );
          if (distance < 80 || distance > 420) {
            continue;
          }
          pushBidirectionalEdge(from.id, to.id, rng.chance(0.4) ? 'side_road' : 'footpath');
        }
      } else {
        const indexByRowCol = (row: number, col: number) => row * GRID_SIZE + col;
        for (let row = 0; row < GRID_SIZE; row += 1) {
          for (let col = 0; col < GRID_SIZE; col += 1) {
            const current = baseRouteNodes[indexByRowCol(row, col)];
            if (col + 1 < GRID_SIZE) {
              const right = baseRouteNodes[indexByRowCol(row, col + 1)];
              const roadType = roadTypeByGrid(row, col);
              pushBidirectionalEdge(current.id, right.id, roadType, {
                isElectricCartRoute: roadType === 'main_road' && rng.chance(0.75),
                isBicyclePath: roadType === 'bicycle_path' || (roadType === 'main_road' && rng.chance(0.35)),
              });
            }

            if (row + 1 < GRID_SIZE) {
              const down = baseRouteNodes[indexByRowCol(row + 1, col)];
              const roadType = roadTypeByGrid(row, col);
              pushBidirectionalEdge(current.id, down.id, roadType, {
                isElectricCartRoute: roadType === 'main_road' && rng.chance(0.75),
                isBicyclePath: roadType === 'bicycle_path' || (roadType === 'main_road' && rng.chance(0.35)),
              });
            }
          }
        }
      }

      const nearestRouteNode = (coord: LatLng) => {
        let nearest = baseRouteNodes[0];
        let minDistance = Number.POSITIVE_INFINITY;

        for (const node of baseRouteNodes) {
          const distance = haversineMeter({ latitude: node.latitude, longitude: node.longitude }, coord);
          if (distance < minDistance) {
            minDistance = distance;
            nearest = node;
          }
        }

        return nearest;
      };

      for (const hub of roadHubNodes) {
        const anchor = nearestRouteNode({ latitude: hub.latitude, longitude: hub.longitude });
        pushBidirectionalEdge(hub.id, anchor.id, isCampus ? 'side_road' : 'main_road');
      }

      for (const poiNode of poiNodes) {
        const anchor = nearestRouteNode({
          latitude: Number(poiNode.latitude),
          longitude: Number(poiNode.longitude),
        });
        pushBidirectionalEdge(poiNode.id, anchor.id, 'connector', {
          allowedTransportation: ['walk'],
          isElectricCartRoute: false,
          isBicyclePath: false,
          transportation: 'walk',
        });
      }

      await insertInChunks(edgeRepo, edges);

      scenicContexts.push({
        id: scenicId,
        name: scenicName,
        city: item.city,
        category: item.category,
        center,
        tags: buildScenicClassificationTags({
          name: scenicName,
          category: item.category,
          description: buildScenicDescription(scenicName, item.city, isCampus),
          city: item.city,
        }),
        attractions: attractions.map((attraction) => ({
          id: attraction.id,
          name: attraction.name,
          category: attraction.category,
        })),
        facilities: facilities.map((facility) => ({
          id: facility.id,
          name: facility.name,
          category: facility.category,
        })),
        foods: foods.map((food) => ({
          id: food.id,
          name: food.name,
          cuisine: food.cuisine,
        })),
        photoSpots: photoSpots.map((spot) => ({
          id: spot.id,
          name: spot.name,
        })),
      });

      if ((index + 1) % 10 === 0 || index + 1 === catalog.length) {
        console.log(
          `导入进度 ${index + 1}/${catalog.length}：${scenicName}，中心 ${center.latitude},${center.longitude}，建筑 ${attractions.length}，设施 ${facilities.length}，路网边 ${edges.length}`,
        );
      }
    }

    const { diaries, sharedDiaries } = await seedDiariesAndComments(dataSource, users, scenicContexts);
    const behaviorCount = await seedBehaviors(dataSource, users, scenicContexts, sharedDiaries);
    const mediaStats = await seedMediaAndSocial(dataSource, users, scenicContexts);

    const [
      scenicCount,
      attractionCount,
      facilityCount,
      foodCount,
      photoSpotCount,
      nodeCount,
      edgeCount,
      userCount,
      diaryCount,
      diaryCommentCount,
      userBehaviorCount,
      photoCheckinCount,
      socialCheckinCount,
    ] = await Promise.all([
      scenicRepo.count(),
      attractionRepo.count(),
      facilityRepo.count(),
      foodRepo.count(),
      photoSpotRepo.count(),
      nodeRepo.count(),
      edgeRepo.count(),
      userRepo.count(),
      diaryRepo.count(),
      diaryCommentRepo.count(),
      userBehaviorRepo.count(),
      photoCheckinRepo.count(),
      socialCheckinRepo.count(),
    ]);

    console.log('真实数据导入完成');
    console.log(
      `统计：景区/校园 ${scenicCount}，内部建筑 ${attractionCount}，设施 ${facilityCount}，美食 ${foodCount}，摄影点 ${photoSpotCount}，路网节点 ${nodeCount}，路网边 ${edgeCount}，用户 ${userCount}`,
    );
    console.log(
      `补充数据：日记 ${diaryCount}（共享 ${sharedDiaries.length}），评论 ${diaryCommentCount}，用户行为 ${userBehaviorCount}，摄影打卡 ${photoCheckinCount}，社交打卡 ${socialCheckinCount}`,
    );
    console.log(
      `过程统计：本次脚本生成日记 ${diaries.length}，行为 ${behaviorCount}，媒体数据 ${mediaStats.photoCount + mediaStats.socialCount}`,
    );
  } catch (error) {
    console.error('数据导入失败:', error);
    process.exitCode = 1;
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

void importData();
