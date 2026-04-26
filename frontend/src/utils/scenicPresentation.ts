type ScenicCoverLike = {
  name: string;
  category?: string | null;
  city?: string | null;
  coverImageUrl?: string | null;
  coverPageUrl?: string | null;
  cityLabel?: string | null;
  coverImageTheme?: string | null;
  description?: string | null;
  tags?: string | string[] | null;
};

type ScenicAsset = {
  url: string;
  theme: string;
};

export type ScenicCoverPresentation = {
  coverImageUrl: string;
  cityLabel: string;
  coverImageTheme: string;
};

const cityImageBank: Record<string, ScenicAsset[]> = {
  北京: [
    { url: 'https://images.unsplash.com/photo-1528164344705-47542687000d?auto=format&fit=crop&w=1400&q=80', theme: '古都中轴' },
    { url: 'https://images.unsplash.com/photo-1508804185872-d7badad00f7?auto=format&fit=crop&w=1400&q=80', theme: '校园人文' },
  ],
  上海: [
    { url: 'https://images.unsplash.com/photo-1549692520-acc6669e2f0c?auto=format&fit=crop&w=1400&q=80', theme: '都市天际线' },
    { url: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1400&q=80', theme: '滨江夜色' },
  ],
  广州: [
    { url: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1400&q=80', theme: '岭南街区' },
    { url: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1400&q=80', theme: '城市绿意' },
  ],
  成都: [
    { url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=80', theme: '自然疗愈' },
    { url: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1400&q=80', theme: '静谧山景' },
  ],
  杭州: [
    { url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1400&q=80', theme: '湖景慢游' },
    { url: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1400&q=80', theme: '山水视野' },
  ],
  西安: [
    { url: 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?auto=format&fit=crop&w=1400&q=80', theme: '古迹巡礼' },
    { url: 'https://images.unsplash.com/photo-1521295121783-8a321d551ad2?auto=format&fit=crop&w=1400&q=80', theme: '人文遗迹' },
  ],
  武汉: [
    { url: 'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1400&q=80', theme: '湖岸风光' },
    { url: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=1400&q=80', theme: '江城夜景' },
  ],
  南京: [
    { url: 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=1400&q=80', theme: '历史街景' },
    { url: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=1400&q=80', theme: '城墙漫步' },
  ],
  重庆: [
    { url: 'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1400&q=80', theme: '山城层次' },
    { url: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1400&q=80', theme: '夜色城景' },
  ],
  天津: [
    { url: 'https://images.unsplash.com/photo-1505764706515-aa95265c5abc?auto=format&fit=crop&w=1400&q=80', theme: '河畔街区' },
    { url: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1400&q=80', theme: '城市漫游' },
  ],
};

const categoryImageBank: Record<string, ScenicAsset[]> = {
  校园: [
    { url: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1400&q=80', theme: '校园漫游' },
    { url: 'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?auto=format&fit=crop&w=1400&q=80', theme: '学府光影' },
  ],
  景区: [
    { url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=80', theme: '经典景观' },
    { url: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1400&q=80', theme: '远景视野' },
  ],
};

const fallbackAssets: ScenicAsset[] = [
  { url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=80', theme: '自然风景' },
  { url: 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=1400&q=80', theme: '城市漫游' },
];

const knownCities = Object.keys(cityImageBank);

const invalidCoverPattern =
  /(?:\.pdf|\.djvu|\.webm|student[_ -]?card|temporary[_ -]?site|name[_ -]?wall|logo|emblem|badge|icon|hospital|middle[_ -]?school|station|metro|subway|platform|route[_ -]?map|ceremony|graduation|statue|stone|decoration|campaign|memorial|museum[_ -]?decoration|michel[_ -]?talagrand|liu[_ -]?yu|总医院|医院|地铁|站台|换乘|装饰|纪念|牌匾|牌坊|动物园站|附属中学|中学)/i;

const hashText = (value: string) =>
  Array.from(value).reduce((result, char) => (result * 31 + char.charCodeAt(0)) % 2147483647, 7);

const pickAsset = (assets: ScenicAsset[], key: string) => assets[Math.abs(hashText(key)) % assets.length];

const decodeSourceText = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const hasValidCover = (scenic: ScenicCoverLike) => {
  const rawSourceText = `${scenic.coverImageUrl || ''} ${scenic.coverPageUrl || ''}`;
  const sourceText = `${rawSourceText} ${decodeSourceText(rawSourceText)}`;
  return Boolean(scenic.coverImageUrl) && !invalidCoverPattern.test(sourceText);
};

const resolveCityLabel = (
  name: string,
  explicitCityLabel?: string | null,
  description?: string | null,
  tags?: string | string[] | null,
) => {
  if (explicitCityLabel) {
    return explicitCityLabel;
  }

  const searchableText = [name, description || '', Array.isArray(tags) ? tags.join(',') : tags || ''].join(' ');
  for (const city of knownCities) {
    if (searchableText.includes(city)) {
      return city;
    }
  }

  return '精选目的地';
};

export const resolveScenicCoverPresentation = (scenic: ScenicCoverLike): ScenicCoverPresentation => {
  const name = scenic.name || '精选目的地';
  const category = scenic.category || '景区';
  const cityLabel = resolveCityLabel(name, scenic.cityLabel, scenic.description, scenic.tags);

  if (hasValidCover(scenic)) {
    return {
      coverImageUrl: scenic.coverImageUrl as string,
      cityLabel,
      coverImageTheme: scenic.coverImageTheme || category,
    };
  }

  const bank = cityImageBank[cityLabel] || categoryImageBank[category] || fallbackAssets;
  const asset = pickAsset(bank, `${name}-${category}`);

  return {
    coverImageUrl: asset.url,
    cityLabel,
    coverImageTheme: scenic.coverImageTheme || asset.theme,
  };
};
