export const SCENIC_PRIMARY_TAGS = ['自然', '人文', '校园'] as const;
export const SCENIC_FUNCTION_TAGS = ['观光型', '休闲度假', '探险体验', '文化教育'] as const;
export const SCENIC_DETAIL_TAGS = ['博物馆', '遗址', '古建筑', '公园', '湖泊', '展馆', '图书馆', '观景台', '摄影打卡'] as const;
export const SCENIC_EXPERIENCE_TAGS = ['适合拍照', '适合亲子', '适合情侣', '适合慢逛', '适合半日游', '适合夜游'] as const;

export const SCENIC_CLASSIFICATION_TAGS = [
  ...SCENIC_PRIMARY_TAGS,
  ...SCENIC_FUNCTION_TAGS,
  ...SCENIC_DETAIL_TAGS,
  ...SCENIC_EXPERIENCE_TAGS,
] as const;

export type ScenicTaggingInput = {
  name: string;
  category?: string | null;
  description?: string | null;
  city?: string | null;
};

const HUMAN_KEYWORDS = [
  '博物馆',
  '博物院',
  '科技馆',
  '故宫',
  '宫',
  '祠',
  '寺',
  '塔',
  '城墙',
  '古镇',
  '古街',
  '文化街',
  '文化旅游区',
  '风光带',
  '总统府',
  '长城',
  '遗址',
  '陵',
  '大学',
  '学院',
  '校园',
];

const NATURAL_KEYWORDS = [
  '公园',
  '园',
  '湖',
  '湿地',
  '植物园',
  '动物园',
  '山',
  '雪山',
  '海洋',
  '风景区',
  '风景名胜区',
  '乐园',
  '度假区',
  '天池',
];

const CULTURAL_KEYWORDS = [
  '博物馆',
  '博物院',
  '科技馆',
  '故宫',
  '宫',
  '祠',
  '寺',
  '塔',
  '城墙',
  '古镇',
  '古街',
  '文化街',
  '文化旅游区',
  '风光带',
  '总统府',
  '长城',
  '遗址',
  '陵',
];

const LEISURE_KEYWORDS = [
  '公园',
  '园',
  '湖',
  '湿地',
  '植物园',
  '动物园',
  '乐园',
  '度假区',
  '海洋公园',
  '风景区',
  '风景名胜区',
  '古镇',
  '古街',
];

const ADVENTURE_KEYWORDS = ['长城', '雪山', '山', '索道', '天池'];
const MUSEUM_KEYWORDS = ['博物馆', '博物院'];
const EXHIBITION_KEYWORDS = ['科技馆', '文化馆', '展览', '展馆'];
const HERITAGE_KEYWORDS = ['遗址', '陵', '帝陵'];
const ANCIENT_ARCHITECTURE_KEYWORDS = ['故宫', '宫', '祠', '寺', '塔', '城墙', '古镇', '古街', '总统府', '长城'];
const PARK_KEYWORDS = ['公园', '园', '植物园', '动物园', '园博园'];
const LAKE_KEYWORDS = ['湖'];
const VIEWPOINT_KEYWORDS = ['观景台', '塔', '索道', '之眼', '明珠'];
const PHOTO_KEYWORDS = [
  '观景台',
  '塔',
  '古镇',
  '古街',
  '外滩',
  '洪崖洞',
  '长城',
  '湖',
  '公园',
  '园',
  '湿地',
  '植物园',
  '风景区',
  '风景名胜区',
  '乐园',
  '海洋公园',
  '明珠',
  '索道',
];
const FAMILY_KEYWORDS = ['动物园', '海洋公园', '乐园', '科技馆', '植物园', '奥林匹克公园'];
const COUPLE_KEYWORDS = ['湖', '公园', '园', '古镇', '古街', '外滩', '湿地', '索道'];
const HALF_DAY_KEYWORDS = ['博物馆', '博物院', '科技馆', '故宫', '宫', '祠', '寺', '塔', '城墙', '遗址', '陵', '大学', '学院'];
const NIGHT_KEYWORDS = ['外滩', '洪崖洞', '东方明珠', '长江索道', '天津之眼', '秦淮', '海心桥'];

const uniqueValues = (items: string[]) => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

const buildText = (input: ScenicTaggingInput) =>
  [input.name, input.category || '', input.description || '', input.city || ''].join(' ');

const containsAny = (text: string, keywords: string[]) => keywords.some((keyword) => text.includes(keyword));

export const buildScenicClassificationTags = (input: ScenicTaggingInput): string[] => {
  const text = buildText(input);
  const category = String(input.category || '').trim();

  const tags: string[] = [];

  if (category === '校园' || containsAny(text, ['大学', '学院', '校园'])) {
    tags.push('校园', '文化教育', '适合慢逛', '适合半日游');
    return uniqueValues(tags);
  }

  const humanScore = HUMAN_KEYWORDS.filter((keyword) => text.includes(keyword)).length;
  const naturalScore = NATURAL_KEYWORDS.filter((keyword) => text.includes(keyword)).length;
  tags.push(humanScore >= naturalScore ? '人文' : '自然');
  tags.push('观光型');

  if (containsAny(text, CULTURAL_KEYWORDS)) {
    tags.push('文化教育');
  }

  if (containsAny(text, LEISURE_KEYWORDS)) {
    tags.push('休闲度假');
  }

  if (containsAny(text, ADVENTURE_KEYWORDS)) {
    tags.push('探险体验');
  }

  if (containsAny(text, MUSEUM_KEYWORDS)) {
    tags.push('博物馆');
  }

  if (containsAny(text, HERITAGE_KEYWORDS)) {
    tags.push('遗址');
  }

  if (containsAny(text, ANCIENT_ARCHITECTURE_KEYWORDS)) {
    tags.push('古建筑');
  }

  if (containsAny(text, PARK_KEYWORDS)) {
    tags.push('公园');
  }

  if (containsAny(text, LAKE_KEYWORDS)) {
    tags.push('湖泊');
  }

  if (containsAny(text, EXHIBITION_KEYWORDS)) {
    tags.push('展馆');
  }

  if (containsAny(text, VIEWPOINT_KEYWORDS)) {
    tags.push('观景台');
  }

  if (containsAny(text, PHOTO_KEYWORDS)) {
    tags.push('摄影打卡', '适合拍照');
  }

  if (containsAny(text, FAMILY_KEYWORDS)) {
    tags.push('适合亲子');
  }

  if (containsAny(text, COUPLE_KEYWORDS)) {
    tags.push('适合情侣');
  }

  if (containsAny(text, LEISURE_KEYWORDS.concat(['博物馆', '博物院', '古镇', '古街']))) {
    tags.push('适合慢逛');
  }

  if (containsAny(text, HALF_DAY_KEYWORDS)) {
    tags.push('适合半日游');
  }

  if (containsAny(text, NIGHT_KEYWORDS)) {
    tags.push('适合夜游');
  }

  return uniqueValues(tags);
};
