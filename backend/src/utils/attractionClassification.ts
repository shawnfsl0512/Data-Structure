import { normalizeStringArray } from './stringArrayField';

export const LANDSCAPE_CLASSIFICATION_TAGS = ['自然景观', '人文景观'] as const;
export const FUNCTION_CLASSIFICATION_TAGS = ['观光型景区', '休闲度假型景区', '探险体验型景区', '文化教育型景区'] as const;
export const ATTRACTION_CLASSIFICATION_TAGS = [
  ...LANDSCAPE_CLASSIFICATION_TAGS,
  ...FUNCTION_CLASSIFICATION_TAGS,
] as const;

export type LandscapeClassificationTag = (typeof LANDSCAPE_CLASSIFICATION_TAGS)[number];
export type FunctionClassificationTag = (typeof FUNCTION_CLASSIFICATION_TAGS)[number];

export type AttractionClassificationInput = {
  scenicName: string;
  scenicCategory?: string | null;
  scenicDescription?: string | null;
  attractionName: string;
  attractionCategory?: string | null;
  attractionDescription?: string | null;
  attractionType?: string | null;
};

export type AttractionClassificationResult = {
  landscapeTag: LandscapeClassificationTag;
  functionTag?: FunctionClassificationTag;
};

const HUMAN_ATTRACTION_CATEGORIES = new Set([
  '教学楼',
  '实验楼',
  '办公楼',
  '宿舍楼',
  '图书馆',
  '体育馆',
  '展馆',
  '文化馆',
  '地标建筑',
]);

const NATURAL_ATTRACTION_CATEGORIES = new Set(['园林区']);

const HUMAN_SCENIC_KEYWORDS = [
  '大学',
  '学院',
  '校园',
  '博物馆',
  '博物院',
  '故宫',
  '宫',
  '祠',
  '寺',
  '塔',
  '城墙',
  '古镇',
  '古城',
  '遗址',
  '街',
  '桥',
  '文化',
  '艺术',
  '建筑',
  '科技馆',
  '纪念馆',
  '历史',
];

const NATURAL_SCENIC_KEYWORDS = [
  '山',
  '湖',
  '海',
  '江',
  '河',
  '溪',
  '峡',
  '谷',
  '洞',
  '林',
  '森林',
  '草原',
  '湿地',
  '雪山',
  '天池',
  '滩',
  '岛',
  '湾',
  '瀑',
  '泉',
  '岭',
  '峰',
  '自然',
  '生态',
  '植物园',
  '动物园',
  '海洋',
  '风景区',
  '风景名胜区',
];

const CULTURAL_FUNCTION_KEYWORDS = [
  '博物馆',
  '博物院',
  '展馆',
  '文化馆',
  '图书馆',
  '教学楼',
  '实验楼',
  '故宫',
  '宫',
  '祠',
  '寺',
  '塔',
  '城墙',
  '古镇',
  '古城',
  '遗址',
  '纪念馆',
  '科技馆',
  '历史',
  '人文',
  '文化',
];

const ADVENTURE_FUNCTION_KEYWORDS = [
  '长城',
  '雪山',
  '峡谷',
  '天池',
  '峰',
  '岭',
  '谷',
  '探险',
  '徒步',
  '漂流',
  '攀登',
  '登山',
  '栈道',
  '野生',
];

const LEISURE_FUNCTION_KEYWORDS = [
  '度假',
  '温泉',
  '乐园',
  '欢乐谷',
  '海洋公园',
  '湿地',
  '公园',
  '园林',
  '休闲',
  '海滨',
  '沙滩',
  '体育馆',
];

const SIGHTSEEING_FUNCTION_KEYWORDS = ['景点', '观景台', '地标建筑', '观光', '风景', '名胜', '打卡'];

const uniqueValues = (items: string[]) => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

const buildSearchText = (input: AttractionClassificationInput) =>
  [
    input.scenicName,
    input.scenicCategory || '',
    input.scenicDescription || '',
    input.attractionName,
    input.attractionCategory || '',
    input.attractionDescription || '',
    input.attractionType || '',
  ]
    .join(' ')
    .toLowerCase();

const containsAny = (text: string, keywords: string[]) => keywords.some((keyword) => text.includes(keyword.toLowerCase()));

export const classifyAttraction = (input: AttractionClassificationInput): AttractionClassificationResult => {
  const scenicCategory = String(input.scenicCategory || '').trim();
  const attractionCategory = String(input.attractionCategory || '').trim();
  const scenicName = String(input.scenicName || '').trim();
  const attractionName = String(input.attractionName || '').trim();
  const isCampus = scenicCategory === '校园';
  const text = buildSearchText(input);
  const scenicText = [scenicName, scenicCategory, input.scenicDescription || ''].join(' ').toLowerCase();

  let landscapeTag: LandscapeClassificationTag;
  if (isCampus) {
    landscapeTag = '人文景观';
  } else if (HUMAN_ATTRACTION_CATEGORIES.has(attractionCategory)) {
    landscapeTag = '人文景观';
  } else if (containsAny(scenicText, HUMAN_SCENIC_KEYWORDS)) {
    landscapeTag = '人文景观';
  } else if (NATURAL_ATTRACTION_CATEGORIES.has(attractionCategory)) {
    landscapeTag = '自然景观';
  } else if (containsAny(scenicText, NATURAL_SCENIC_KEYWORDS)) {
    landscapeTag = '自然景观';
  } else {
    landscapeTag = '人文景观';
  }

  let functionTag: FunctionClassificationTag | undefined;
  if (isCampus) {
    if (['教学楼', '实验楼', '图书馆', '展馆', '文化馆'].includes(attractionCategory)) {
      functionTag = '文化教育型景区';
    } else if (attractionCategory === '体育馆') {
      functionTag = '休闲度假型景区';
    }
  } else if (
    ['展馆', '文化馆'].includes(attractionCategory) ||
    containsAny(text, CULTURAL_FUNCTION_KEYWORDS)
  ) {
    functionTag = '文化教育型景区';
  } else if (containsAny(text, ADVENTURE_FUNCTION_KEYWORDS)) {
    functionTag = '探险体验型景区';
  } else if (containsAny(text, LEISURE_FUNCTION_KEYWORDS)) {
    functionTag = '休闲度假型景区';
  } else if (
    ['景点', '观景台', '园林区', '地标建筑'].includes(attractionCategory) ||
    containsAny(text, SIGHTSEEING_FUNCTION_KEYWORDS)
  ) {
    functionTag = '观光型景区';
  }

  return { landscapeTag, functionTag };
};

export const mergeAttractionClassificationTags = (
  existingTags: unknown,
  input: AttractionClassificationInput,
): string[] => {
  const baseTags = normalizeStringArray(existingTags).filter(
    (tag) => !ATTRACTION_CLASSIFICATION_TAGS.includes(tag as (typeof ATTRACTION_CLASSIFICATION_TAGS)[number]),
  );
  const { landscapeTag, functionTag } = classifyAttraction(input);
  return uniqueValues([...baseTags, landscapeTag, ...(functionTag ? [functionTag] : [])]);
};

