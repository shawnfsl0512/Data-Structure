import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { HzauCampusMapData } from './hzauCampusMap';

const resolveHzauCampusMapPath = () => {
  const localPath = path.resolve(__dirname, './hzauCampusMap.json');
  if (existsSync(localPath)) {
    return localPath;
  }
  return path.resolve(__dirname, '../../src/data/hzauCampusMap.json');
};

const HZAU_CAMPUS_MAP = JSON.parse(
  readFileSync(resolveHzauCampusMapPath(), 'utf8'),
) as HzauCampusMapData;

export type TemplateKind = 'campus' | 'scenic';

export interface RuntimeTemplateAttraction {
  templateId: string;
  name: string;
  category: string;
  type: string;
  latitude: number;
  longitude: number;
  description: string;
  tags: string[];
  averageRating: number;
  reviewCount: number;
  estimatedVisitDuration: number;
  congestionFactor: number;
  indoorStructure?: string;
}

export interface RuntimeTemplateFacility {
  templateId: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  openingHours: string;
  description: string;
}

export interface RuntimeTemplateFood {
  templateId: string;
  facilityTemplateId: string;
  name: string;
  cuisine: string;
  price: number;
  description: string;
  popularity: number;
  averageRating: number;
  reviewCount: number;
  tags: string[];
  isSeasonalSpecial: boolean;
}

export interface RuntimeTemplatePhotoSpot {
  templateId: string;
  attractionTemplateId: string | null;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  bestTime: string;
  popularity: number;
  crowdLevel: 'low' | 'medium' | 'high';
  lightingCondition: 'excellent' | 'good' | 'fair' | 'poor';
  examplePhotos: string[];
}

export interface RuntimeTemplateRoadNode {
  templateId: string;
  type: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface RuntimeTemplateRoadEdge {
  templateId: string;
  fromTemplateId: string;
  toTemplateId: string;
  distance: number;
  roadType: string;
  congestionFactor: number;
  allowedTransportation: string[];
  isElectricCartRoute: boolean;
  isBicyclePath: boolean;
  transportation: string;
}

export interface RuntimeTemplatePayload {
  templateKey: TemplateKind;
  name: string;
  version: number;
  center: {
    latitude: number;
    longitude: number;
  };
  attractions: RuntimeTemplateAttraction[];
  facilities: RuntimeTemplateFacility[];
  foods: RuntimeTemplateFood[];
  photoSpots: RuntimeTemplatePhotoSpot[];
  roadNodes: RuntimeTemplateRoadNode[];
  roadEdges: RuntimeTemplateRoadEdge[];
}

const TEMPLATE_VERSION = 1;

const roundCoord = (value: number) => Number(value.toFixed(8));
const pad2 = (value: number) => String(value).padStart(2, '0');

const campusAttractionTypeByCategory: Record<string, string> = {
  景点: 'landmark',
  教学楼: 'culture',
  办公楼: 'landmark',
  宿舍楼: 'garden',
  实验楼: 'historic',
  图书馆: 'museum',
};

const scenicAttractionNames = [
  '欢乐时光', '欢乐广场', '星光大道', '欢乐剧场', '时光塔', '时光花园', '旋转木马', '飞天秋千',
  '飓风湾', '激流勇进', '海浪飞椅', '海盗船', '水幕码头', '风暴之眼', '飓风滑道', '海岸栈桥',
  '魔幻城堡', '魔法学院', '幻影剧场', '精灵花园', '星愿塔', '魔镜迷宫', '奇幻巡游台', '童话钟楼',
  '极速世界', '雪山飞龙', '天地双雄', '雷霆赛车', '极速飞轮', '失重塔', '追风者', '云霄观景台',
  '阳光海岸', '海岸观景台', '椰林水寨', '沙滩舞台', '朝阳广场', '彩虹栈道', '逐浪码头', '水岸剧场',
  '冒险山', '丛林漂流', '探险营地', '远古石阵', '山谷飞鹰', '迷踪古道', '峡谷索桥', '勇士峰',
  '梦想大道', '欢乐巡游广场', '光影秀场', '梦想剧院', '星愿喷泉', '彩车工坊', '缤纷舞台', '许愿长廊',
  '卡通工厂', '快乐碰碰车', '糖果乐园', '玩具列车', '泡泡实验室', '彩绘工坊', '童梦小镇', '亲子乐园',
] as const;

const scenicThemeNames = ['欢乐时光', '飓风湾', '魔幻城堡', '极速世界', '阳光海岸', '冒险山', '梦想大道', '卡通工厂'];

const scenicFacilityDefinitions: Array<{ name: string; category: string }> = [
  { name: '中央游客中心', category: '游客中心' },
  { name: '欢乐时光游客中心', category: '游客中心' },
  { name: '飓风湾游客中心', category: '游客中心' },
  { name: '魔幻城堡游客中心', category: '游客中心' },
  { name: '极速世界游客中心', category: '游客中心' },
  { name: '欢乐集市', category: '纪念品商店' },
  { name: '风暴礼品屋', category: '纪念品商店' },
  { name: '魔法商店', category: '纪念品商店' },
  { name: '极速补给站', category: '纪念品商店' },
  { name: '童梦礼物坊', category: '纪念品商店' },
  { name: '欢乐便利店-01', category: '便利店' },
  { name: '欢乐便利店-02', category: '便利店' },
  { name: '欢乐便利店-03', category: '便利店' },
  { name: '欢乐便利店-04', category: '便利店' },
  { name: '欢乐便利店-05', category: '便利店' },
  { name: '欢乐便利店-06', category: '便利店' },
  { name: '欢乐便利店-07', category: '便利店' },
  { name: '飓风餐厅', category: '特色餐厅' },
  { name: '冒险山餐厅', category: '特色餐厅' },
  { name: '城堡宴会厅', category: '特色餐厅' },
  { name: '时光小馆', category: '特色餐厅' },
  { name: '海岸餐吧', category: '特色餐厅' },
  { name: '梦想大道美食屋', category: '特色餐厅' },
  { name: '卡通厨房', category: '特色餐厅' },
  { name: '欢乐美食广场-01', category: '餐饮广场' },
  { name: '欢乐美食广场-02', category: '餐饮广场' },
  { name: '欢乐美食广场-03', category: '餐饮广场' },
  { name: '欢乐美食广场-04', category: '餐饮广场' },
  { name: '欢乐美食广场-05', category: '餐饮广场' },
  { name: '欢乐美食广场-06', category: '餐饮广场' },
  { name: '海岸咖啡馆', category: '咖啡馆' },
  { name: '星光咖啡馆', category: '咖啡馆' },
  { name: '城堡咖啡馆', category: '咖啡馆' },
  { name: '冒险咖啡馆', category: '咖啡馆' },
  { name: '梦想咖啡馆', category: '咖啡馆' },
  { name: '时光咖啡馆', category: '咖啡馆' },
  { name: '洗手间-01', category: '洗手间' },
  { name: '洗手间-02', category: '洗手间' },
  { name: '洗手间-03', category: '洗手间' },
  { name: '洗手间-04', category: '洗手间' },
  { name: '洗手间-05', category: '洗手间' },
  { name: '洗手间-06', category: '洗手间' },
  { name: '洗手间-07', category: '洗手间' },
  { name: '洗手间-08', category: '洗手间' },
  { name: '洗手间-09', category: '洗手间' },
  { name: '洗手间-10', category: '洗手间' },
  { name: '洗手间-11', category: '洗手间' },
  { name: '洗手间-12', category: '洗手间' },
  { name: '中央医疗点', category: '医疗服务点' },
  { name: '欢乐时光医疗点', category: '医疗服务点' },
  { name: '飓风湾医疗点', category: '医疗服务点' },
  { name: '极速世界医疗点', category: '医疗服务点' },
  { name: '冒险山医疗点', category: '医疗服务点' },
  { name: '中央安保点', category: '安保服务点' },
  { name: '北门安保点', category: '安保服务点' },
  { name: '主入口寄存处', category: '寄存处' },
  { name: '欢乐时光寄存处', category: '寄存处' },
  { name: '飓风湾寄存处', category: '寄存处' },
  { name: '魔幻城堡寄存处', category: '寄存处' },
  { name: '极速世界寄存处', category: '寄存处' },
  { name: '阳光海岸寄存处', category: '寄存处' },
  { name: '停车场-01', category: '停车场' },
  { name: '停车场-02', category: '停车场' },
  { name: '停车场-03', category: '停车场' },
  { name: '停车场-04', category: '停车场' },
  { name: '停车场-05', category: '停车场' },
  { name: '停车场-06', category: '停车场' },
  { name: '停车场-07', category: '停车场' },
  { name: '停车场-08', category: '停车场' },
  { name: '停车场-09', category: '停车场' },
  { name: '停车场-10', category: '停车场' },
  { name: '停车场-11', category: '停车场' },
  { name: '停车场-12', category: '停车场' },
  { name: '主入口ATM', category: 'ATM' },
  { name: '梦想大道ATM', category: 'ATM' },
  { name: '主入口电瓶车站', category: '电瓶车站点' },
  { name: '欢乐时光电瓶车站', category: '电瓶车站点' },
  { name: '飓风湾电瓶车站', category: '电瓶车站点' },
  { name: '魔幻城堡电瓶车站', category: '电瓶车站点' },
  { name: '极速世界电瓶车站', category: '电瓶车站点' },
  { name: '阳光海岸电瓶车站', category: '电瓶车站点' },
  { name: '冒险山电瓶车站', category: '电瓶车站点' },
  { name: '景区电瓶车调度中心', category: '电瓶车调度点' },
  { name: '电瓶车充电点-01', category: '电瓶车充电点' },
  { name: '电瓶车充电点-02', category: '电瓶车充电点' },
  { name: '电瓶车充电点-03', category: '电瓶车充电点' },
  { name: '电瓶车充电点-04', category: '电瓶车充电点' },
  { name: '电瓶车充电点-05', category: '电瓶车充电点' },
  { name: '电瓶车充电点-06', category: '电瓶车充电点' },
  { name: '电瓶车充电点-07', category: '电瓶车充电点' },
] as const;

const campusFoodPool: Record<string, string[]> = {
  食堂: ['校园套餐', '面食', '盖饭', '简餐'],
  饭店: ['地方风味', '小吃', '热菜', '简餐'],
  超市: ['便当', '零食', '饮品'],
  商店: ['饮品', '零食'],
  咖啡馆: ['咖啡', '甜品', '轻食'],
};

const scenicFoodPool: Record<string, string[]> = {
  特色餐厅: ['主题套餐', '地方风味', '热菜', '小吃'],
  餐饮广场: ['快餐', '面食', '小吃', '简餐'],
  咖啡馆: ['咖啡', '甜品', '轻食'],
  便利店: ['零食', '饮品', '便当'],
};

const bestTimePool = ['09:00-11:00', '14:00-16:00', '16:30-18:00'];

const sanitizeNodeName = (name: string) => {
  const text = String(name || '').trim();
  if (!text) return '路口';
  return text.replace(/^华中农业大学[-·]*/, '');
};

const buildCampusIndoorStructure = (buildingName: string) =>
  JSON.stringify({
    buildingName,
    floors: [
      { number: 1, rooms: ['入口大厅', '服务台', '休息区'] },
      { number: 2, rooms: ['功能区 A', '自习区', '活动空间'] },
    ],
    elevators: [{ id: 'e1', floors: [1, 2] }],
  });

const buildScenicAttractionDefinitions = () => {
  const projectKeywords = ['旋转木马', '飞天秋千', '激流勇进', '海浪飞椅', '海盗船', '飓风滑道', '雪山飞龙', '天地双雄', '雷霆赛车', '极速飞轮', '失重塔', '丛林漂流', '快乐碰碰车', '玩具列车'];

  return scenicAttractionNames.map((name, index) => {
    const theme = scenicThemeNames[Math.floor(index / 8)] || '欢乐时光';
    if (name.includes('剧场') || name.includes('剧院') || name.includes('秀场') || name.includes('舞台')) {
      return { name, category: '演艺点', type: 'culture', theme };
    }
    if (name.includes('观景台') || name.includes('塔') || name.includes('栈桥') || name.includes('码头') || name.includes('长廊')) {
      return { name, category: '观景点', type: 'viewpoint', theme };
    }
    if (projectKeywords.some((keyword) => name.includes(keyword))) {
      return { name, category: '游乐项目', type: 'landmark', theme };
    }
    return { name, category: '景点', type: 'landmark', theme };
  });
};

const buildFoods = (
  facilities: RuntimeTemplateFacility[],
  foodPool: Record<string, string[]>,
  label: string,
): RuntimeTemplateFood[] => {
  const foods: RuntimeTemplateFood[] = [];
  let index = 1;
  for (const facility of facilities) {
    const cuisines = foodPool[facility.category];
    if (!cuisines || !cuisines.length) {
      continue;
    }
    const cuisine = cuisines[index % cuisines.length];
    foods.push({
      templateId: `food-${pad2(index)}`,
      facilityTemplateId: facility.templateId,
      name: `${facility.name}-${cuisine}${pad2(index)}`,
      cuisine,
      price: 18 + (index % 6) * 4,
      description: `${label}餐饮点，依附于${facility.name}。`,
      popularity: 80 + index * 7,
      averageRating: Number((4.2 + (index % 5) * 0.1).toFixed(2)),
      reviewCount: 40 + index * 9,
      tags: [label, facility.category, cuisine],
      isSeasonalSpecial: index % 5 === 0,
    });
    index += 1;
    if (foods.length >= 20) {
      break;
    }
  }
  return foods;
};

const buildPhotoSpots = (
  attractions: RuntimeTemplateAttraction[],
  label: string,
): RuntimeTemplatePhotoSpot[] =>
  attractions.slice(0, 6).map((item, index) => ({
    templateId: `photo-${pad2(index + 1)}`,
    attractionTemplateId: item.templateId,
    name: `${item.name}-摄影位`,
    description: `${label}摄影打卡点，适合记录${item.name}周边景观。`,
    latitude: item.latitude,
    longitude: item.longitude,
    bestTime: bestTimePool[index % bestTimePool.length],
    popularity: 90 + index * 15,
    crowdLevel: (['low', 'medium', 'high'] as const)[index % 3],
    lightingCondition: (['excellent', 'good', 'fair'] as const)[index % 3],
    examplePhotos: [
      `https://picsum.photos/seed/${label}-${index + 1}-a/800/500`,
      `https://picsum.photos/seed/${label}-${index + 1}-b/800/500`,
    ],
  }));

const buildRoadNodes = (): RuntimeTemplateRoadNode[] =>
  HZAU_CAMPUS_MAP.roadNetwork.nodes.map((node, index) => ({
    templateId: node.id,
    type: node.type || 'junction',
    name: sanitizeNodeName(node.name || `路口-${index + 1}`),
    latitude: roundCoord(node.latitude),
    longitude: roundCoord(node.longitude),
  }));

const buildCampusRoadEdges = (): RuntimeTemplateRoadEdge[] =>
  HZAU_CAMPUS_MAP.roadNetwork.edges.map((edge) => ({
    templateId: edge.id,
    fromTemplateId: edge.fromNodeId,
    toTemplateId: edge.toNodeId,
    distance: Number(edge.distance || 0),
    roadType: edge.roadType,
    congestionFactor: 1,
    allowedTransportation: [...edge.allowedTransportation],
    isElectricCartRoute: false,
    isBicyclePath: edge.roadType === 'bicycle_path',
    transportation: edge.roadType === 'footpath' ? 'walk' : 'bicycle',
  }));

const buildScenicRoadEdges = (): RuntimeTemplateRoadEdge[] =>
  HZAU_CAMPUS_MAP.roadNetwork.edges.map((edge) => {
    if (edge.roadType === 'bicycle_path') {
      return {
        templateId: edge.id,
        fromTemplateId: edge.fromNodeId,
        toTemplateId: edge.toNodeId,
        distance: Number(edge.distance || 0),
        roadType: 'bicycle_path',
        congestionFactor: 1,
        allowedTransportation: ['walk', 'electric_cart'],
        isElectricCartRoute: true,
        isBicyclePath: false,
        transportation: 'electric_cart',
      };
    }
    return {
      templateId: edge.id,
      fromTemplateId: edge.fromNodeId,
      toTemplateId: edge.toNodeId,
      distance: Number(edge.distance || 0),
      roadType: edge.roadType,
      congestionFactor: 1,
      allowedTransportation: ['walk'],
      isElectricCartRoute: false,
      isBicyclePath: false,
      transportation: 'walk',
    };
  });

export const buildCampusTemplatePayload = (): RuntimeTemplatePayload => {
  const attractionCounters = new Map<string, number>();
  const facilityCounters = new Map<string, number>();

  const attractions: RuntimeTemplateAttraction[] = HZAU_CAMPUS_MAP.attractions.map((item) => {
    const next = (attractionCounters.get(item.category) || 0) + 1;
    attractionCounters.set(item.category, next);
    const name = `${item.category}-${pad2(next)}`;
    return {
      templateId: item.id,
      name,
      category: item.category,
      type: campusAttractionTypeByCategory[item.category] || 'landmark',
      latitude: roundCoord(item.latitude),
      longitude: roundCoord(item.longitude),
      description: `校园内部导航点位，类别为${item.category}。`,
      tags: ['校园', item.category],
      averageRating: 4.4,
      reviewCount: 100 + next * 12,
      estimatedVisitDuration: 45,
      congestionFactor: 1,
      indoorStructure: ['教学楼', '实验楼', '图书馆'].includes(item.category)
        ? buildCampusIndoorStructure(name)
        : '{}',
    };
  });

  const facilities: RuntimeTemplateFacility[] = HZAU_CAMPUS_MAP.facilities.map((item) => {
    const next = (facilityCounters.get(item.category) || 0) + 1;
    facilityCounters.set(item.category, next);
    return {
      templateId: item.id,
      name: `${item.category}-${pad2(next)}`,
      category: item.category,
      latitude: roundCoord(item.latitude),
      longitude: roundCoord(item.longitude),
      openingHours: '{}',
      description: `校园内部服务设施，类别为${item.category}。`,
    };
  });

  return {
    templateKey: 'campus',
    name: '校园内部地图模板',
    version: TEMPLATE_VERSION,
    center: { ...HZAU_CAMPUS_MAP.meta.campus.center },
    attractions,
    facilities,
    foods: buildFoods(facilities, campusFoodPool, '校园'),
    photoSpots: buildPhotoSpots(attractions, '校园'),
    roadNodes: buildRoadNodes(),
    roadEdges: buildCampusRoadEdges(),
  };
};

export const buildScenicTemplatePayload = (): RuntimeTemplatePayload => {
  const attractionDefs = buildScenicAttractionDefinitions();
  const baseAttractions = HZAU_CAMPUS_MAP.attractions.slice(0, attractionDefs.length);
  const baseFacilities = HZAU_CAMPUS_MAP.facilities.slice(0, scenicFacilityDefinitions.length);

  const attractions: RuntimeTemplateAttraction[] = attractionDefs.map((definition, index) => {
    const base = baseAttractions[index];
    return {
      templateId: `scenic-attraction-${pad2(index + 1)}`,
      name: definition.name,
      category: definition.category,
      type: definition.type,
      latitude: roundCoord(base.latitude),
      longitude: roundCoord(base.longitude),
      description: `${definition.theme}主题片区内的重要游览点位。`,
      tags: ['景区', definition.theme, definition.category],
      averageRating: Number((4.5 + (index % 4) * 0.08).toFixed(2)),
      reviewCount: 180 + index * 11,
      estimatedVisitDuration: definition.category === '游乐项目' ? 35 : 25,
      congestionFactor: 1,
      indoorStructure: '{}',
    };
  });

  const facilities: RuntimeTemplateFacility[] = scenicFacilityDefinitions.map((definition, index) => {
    const base = baseFacilities[index];
    return {
      templateId: `scenic-facility-${pad2(index + 1)}`,
      name: definition.name,
      category: definition.category,
      latitude: roundCoord(base.latitude),
      longitude: roundCoord(base.longitude),
      openingHours: '{}',
      description: `景区服务设施，类别为${definition.category}。`,
    };
  });

  return {
    templateKey: 'scenic',
    name: '景区内部地图模板',
    version: TEMPLATE_VERSION,
    center: { ...HZAU_CAMPUS_MAP.meta.campus.center },
    attractions,
    facilities,
    foods: buildFoods(facilities, scenicFoodPool, '景区'),
    photoSpots: buildPhotoSpots(attractions, '景区'),
    roadNodes: buildRoadNodes(),
    roadEdges: buildScenicRoadEdges(),
  };
};

export const buildDefaultRuntimeTemplatePayloads = (): RuntimeTemplatePayload[] => [
  buildCampusTemplatePayload(),
  buildScenicTemplatePayload(),
];
