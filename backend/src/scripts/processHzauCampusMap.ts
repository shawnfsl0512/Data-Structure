import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import https from 'https';

type OsmPoint = {
  lat: number;
  lon: number;
};

type OsmElement = {
  type: 'node' | 'way' | 'relation' | 'count';
  id: number;
  lat?: number;
  lon?: number;
  center?: OsmPoint;
  geometry?: OsmPoint[];
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OsmElement[];
};

type CampusMeta = {
  relationId: number;
  name: string;
  nameEn: string;
  center: {
    latitude: number;
    longitude: number;
  };
  sourceTags: Record<string, string>;
};

type CampusPoint = {
  id: string;
  sourceType: 'node' | 'way' | 'relation';
  sourceId: number;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  tags: string[];
  sourceTags: Record<string, string>;
};

type RoadNode = {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  type: 'junction';
};

type RoadEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  distance: number;
  roadType: 'main_road' | 'side_road' | 'bicycle_path' | 'footpath';
  allowedTransportation: string[];
  isElectricCartRoute: boolean;
  isBicyclePath: boolean;
  sourceWayId: number;
  sourceHighway: string;
  roadName: string;
};

type CleanedHzauCampusMap = {
  meta: {
    generatedAt: string;
    source: string;
    campus: CampusMeta;
    outputPath: string;
  };
  stats: {
    raw: {
      namedBuildings: number;
      facilityCandidates: number;
      roadWays: number;
    };
    cleaned: {
      attractions: number;
      facilities: number;
      roadNodes: number;
      roadEdges: number;
    };
  };
  attractions: CampusPoint[];
  facilities: CampusPoint[];
  roadNetwork: {
    nodes: RoadNode[];
    edges: RoadEdge[];
  };
};

type PointElement = OsmElement & {
  type: 'node' | 'way' | 'relation';
};

const CAMPUS_RELATION_ID = 10811687;
const CAMPUS_AREA_ID = 3600000000 + CAMPUS_RELATION_ID;
const OUTPUT_PATH = resolve(__dirname, '../data/hzauCampusMap.json');
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

const requestText = (url: string): Promise<string> =>
  new Promise((resolveRequest, rejectRequest) => {
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'travel-system-hzau-map-processor/1.0',
          Accept: 'application/json',
        },
      },
      (response) => {
        if (!response.statusCode || response.statusCode >= 400) {
          rejectRequest(new Error(`HTTP ${response.statusCode || 0} for ${url}`));
          response.resume();
          return;
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => resolveRequest(Buffer.concat(chunks).toString('utf8')));
      },
    );

    request.on('error', rejectRequest);
    request.setTimeout(45_000, () => request.destroy(new Error(`Timeout for ${url}`)));
  });

const runOverpassQuery = async (query: string): Promise<OverpassResponse> => {
  const encoded = encodeURIComponent(query);
  const errors: string[] = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const url = `${endpoint}?data=${encoded}`;
    try {
      const responseText = await requestText(url);
      return JSON.parse(responseText) as OverpassResponse;
    } catch (error) {
      errors.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Overpass query failed.\n${errors.join('\n')}`);
};

const toCoordinate = (element: OsmElement) => {
  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    return { latitude: element.lat, longitude: element.lon };
  }
  if (element.center) {
    return { latitude: element.center.lat, longitude: element.center.lon };
  }
  if (element.geometry?.length) {
    const sums = element.geometry.reduce(
      (accumulator, point) => ({
        latitude: accumulator.latitude + point.lat,
        longitude: accumulator.longitude + point.lon,
      }),
      { latitude: 0, longitude: 0 },
    );
    return {
      latitude: sums.latitude / element.geometry.length,
      longitude: sums.longitude / element.geometry.length,
    };
  }
  return null;
};

const haversineMeters = (
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const dLat = toRad(to.latitude - from.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();
const lower = (value: string) => normalizeWhitespace(value).toLowerCase();

const hasKeyword = (name: string, keywords: string[]) => keywords.some((keyword) => name.includes(keyword));

const buildAttractionCategory = (name: string, tags: Record<string, string>) => {
  const cleanName = normalizeWhitespace(name);

  if (!cleanName) {
    return null;
  }

  if (cleanName.includes('图书馆') || tags.amenity === 'library') {
    return '图书馆';
  }
  if (hasKeyword(cleanName, ['博物馆', '艺术馆']) || tags.tourism === 'museum') {
    return '景点';
  }
  if (hasKeyword(cleanName, ['体育馆', '体育中心', '运动场', '球馆'])) {
    return '体育馆';
  }
  if (tags.building === 'dormitory' || hasKeyword(cleanName, ['宿舍', '公寓', '北苑', '荟园'])) {
    return '宿舍楼';
  }
  if (
    hasKeyword(cleanName, ['实验室', '实验楼', '研究', '微生物', '遗传', '基因', '分子', '昆虫', '真菌', '棉花']) ||
    tags.office === 'research'
  ) {
    return '实验楼';
  }
  if (hasKeyword(cleanName, ['教学楼', '学院', '附属学校', '训练中心']) || tags.building === 'university') {
    return '教学楼';
  }
  if (hasKeyword(cleanName, ['行政楼', '办公楼', '办公', '综合楼', '逸夫楼'])) {
    return '办公楼';
  }

  return null;
};

const buildFacilityCategory = (name: string, tags: Record<string, string>) => {
  const cleanName = normalizeWhitespace(name);

  if (hasKeyword(cleanName, ['食堂']) || tags.fast_food === 'cafeteria') {
    return '食堂';
  }
  if (tags.amenity === 'restaurant') {
    return cleanName.includes('食堂') ? '食堂' : '饭店';
  }
  if (tags.amenity === 'fast_food') {
    return cleanName.includes('食堂') ? '食堂' : '饭店';
  }
  if (tags.shop === 'supermarket' || cleanName.includes('超市') || cleanName.includes('教超') || cleanName.includes('罗森')) {
    return '超市';
  }
  if (tags.shop && ['books', 'yes', 'convenience'].includes(tags.shop)) {
    return tags.shop === 'convenience' ? '商店' : '商店';
  }
  if (tags.amenity === 'parking' || tags.amenity === 'bicycle_parking') {
    return tags.amenity === 'bicycle_parking' ? '自行车停放点' : '停车场';
  }
  if (tags.amenity === 'charging_station') {
    return '充电站';
  }
  if (['clinic', 'hospital'].includes(tags.amenity || '') || hasKeyword(cleanName, ['医院', '门诊', '急诊', '住院部'])) {
    return '医疗点';
  }
  if (tags.amenity === 'police' || cleanName.includes('派出所')) {
    return '警务室';
  }
  if (tags.amenity === 'post_office' || hasKeyword(cleanName, ['驿站', '快递', '邮政', '顺丰', '京东', '德邦'])) {
    return '快递点';
  }
  if (tags.amenity === 'atm') {
    return 'ATM';
  }
  if (tags.amenity === 'bicycle_rental') {
    return '自行车服务';
  }
  if (tags.tourism === 'hotel' || hasKeyword(cleanName, ['国际学术交流中心', '一招', '国交'])) {
    return '接待中心';
  }
  if (tags.amenity === 'kindergarten') {
    return '附属机构';
  }

  return null;
};

const buildFacilityName = (
  originalName: string,
  category: string,
  categoryCounter: Map<string, number>,
) => {
  const cleanName = normalizeWhitespace(originalName);
  if (cleanName) {
    return cleanName;
  }

  const nextCount = (categoryCounter.get(category) || 0) + 1;
  categoryCounter.set(category, nextCount);
  return `华中农业大学-${category}-${String(nextCount).padStart(2, '0')}`;
};

const pointTags = (category: string) => ['校园', category, 'OSM'];

const buildPointId = (element: OsmElement) => `osm-${element.type}-${element.id}`;
const dedupeKey = (category: string, name: string, latitude: number, longitude: number) =>
  `${category}|${lower(name)}|${latitude.toFixed(6)}|${longitude.toFixed(6)}`;

const cleanAttractions = (elements: PointElement[]) => {
  const result: CampusPoint[] = [];
  const seen = new Set<string>();

  for (const element of elements) {
    if (!element.tags?.name) {
      continue;
    }

    const coordinate = toCoordinate(element);
    if (!coordinate) {
      continue;
    }

    const name = normalizeWhitespace(element.tags.name);
    const facilityCategory = buildFacilityCategory(name, element.tags);
    if (facilityCategory && facilityCategory !== '附属机构') {
      continue;
    }

    const category = buildAttractionCategory(name, element.tags);
    if (!category) {
      continue;
    }

    const key = dedupeKey(category, name, coordinate.latitude, coordinate.longitude);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    result.push({
      id: buildPointId(element),
      sourceType: element.type,
      sourceId: element.id,
      name,
      category,
      latitude: Number(coordinate.latitude.toFixed(8)),
      longitude: Number(coordinate.longitude.toFixed(8)),
      tags: pointTags(category),
      sourceTags: element.tags,
    });
  }

  return result.sort((left, right) => left.category.localeCompare(right.category, 'zh-CN') || left.name.localeCompare(right.name, 'zh-CN'));
};

const cleanFacilities = (elements: PointElement[]) => {
  const result: CampusPoint[] = [];
  const seen = new Set<string>();
  const unnamedCounters = new Map<string, number>();

  for (const element of elements) {
    const coordinate = toCoordinate(element);
    if (!coordinate || !element.tags) {
      continue;
    }

    const category = buildFacilityCategory(element.tags.name || '', element.tags);
    if (!category || category === '附属机构') {
      continue;
    }

    const name = buildFacilityName(element.tags.name || '', category, unnamedCounters);
    const key = dedupeKey(category, name, coordinate.latitude, coordinate.longitude);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    result.push({
      id: buildPointId(element),
      sourceType: element.type,
      sourceId: element.id,
      name,
      category,
      latitude: Number(coordinate.latitude.toFixed(8)),
      longitude: Number(coordinate.longitude.toFixed(8)),
      tags: pointTags(category),
      sourceTags: element.tags,
    });
  }

  return result.sort((left, right) => left.category.localeCompare(right.category, 'zh-CN') || left.name.localeCompare(right.name, 'zh-CN'));
};

const normalizeRoadType = (highway: string): 'main_road' | 'side_road' | 'bicycle_path' | 'footpath' => {
  if (['footway', 'pedestrian', 'path', 'steps', 'corridor'].includes(highway)) {
    return 'footpath';
  }
  if (highway === 'cycleway') {
    return 'bicycle_path';
  }
  if (['service', 'residential', 'living_street', 'unclassified'].includes(highway)) {
    return 'side_road';
  }
  return 'main_road';
};

const transportByRoadType = (roadType: RoadEdge['roadType']) => {
  if (roadType === 'footpath') {
    return ['walk'];
  }
  if (roadType === 'main_road' || roadType === 'side_road' || roadType === 'bicycle_path') {
    return ['walk', 'bicycle'];
  }
  return ['walk'];
};

const allowedHighwayTypes = new Set([
  'tertiary',
  'residential',
  'living_street',
  'unclassified',
  'service',
  'pedestrian',
  'footway',
  'path',
  'steps',
  'cycleway',
]);

const cleanRoadNetwork = (elements: OsmElement[]) => {
  const nodeMap = new Map<string, RoadNode>();
  const edgeMap = new Map<string, RoadEdge>();

  for (const element of elements) {
    const highway = lower(element.tags?.highway || '');
    const geometry = element.geometry || [];
    if (!allowedHighwayTypes.has(highway) || geometry.length < 2 || !element.tags) {
      continue;
    }

    const roadType = normalizeRoadType(highway);
    const allowedTransportation = transportByRoadType(roadType);
    const oneway = lower(element.tags.oneway || '');
    const roadName = normalizeWhitespace(element.tags.name || `华中农业大学道路-${element.id}`);

    for (let index = 0; index < geometry.length - 1; index += 1) {
      const from = geometry[index];
      const to = geometry[index + 1];
      const fromNodeId = `osm-node-${from.lat.toFixed(7)}-${from.lon.toFixed(7)}`;
      const toNodeId = `osm-node-${to.lat.toFixed(7)}-${to.lon.toFixed(7)}`;

      if (!nodeMap.has(fromNodeId)) {
        nodeMap.set(fromNodeId, {
          id: fromNodeId,
          latitude: Number(from.lat.toFixed(8)),
          longitude: Number(from.lon.toFixed(8)),
          name: `华中农业大学-路网节点-${nodeMap.size + 1}`,
          type: 'junction',
        });
      }

      if (!nodeMap.has(toNodeId)) {
        nodeMap.set(toNodeId, {
          id: toNodeId,
          latitude: Number(to.lat.toFixed(8)),
          longitude: Number(to.lon.toFixed(8)),
          name: `华中农业大学-路网节点-${nodeMap.size + 1}`,
          type: 'junction',
        });
      }

      const distance = Number(
        haversineMeters(
          { latitude: from.lat, longitude: from.lon },
          { latitude: to.lat, longitude: to.lon },
        ).toFixed(2),
      );

      const makeEdge = (edgeFrom: string, edgeTo: string) => {
        const edgeId = `${element.id}:${edgeFrom}:${edgeTo}`;
        if (edgeMap.has(edgeId)) {
          return;
        }
        edgeMap.set(edgeId, {
          id: edgeId,
          fromNodeId: edgeFrom,
          toNodeId: edgeTo,
          distance,
          roadType,
          allowedTransportation,
          isElectricCartRoute: false,
          isBicyclePath: roadType === 'bicycle_path',
          sourceWayId: element.id,
          sourceHighway: highway,
          roadName,
        });
      };

      if (oneway === '-1') {
        makeEdge(toNodeId, fromNodeId);
      } else if (oneway === 'yes' || oneway === '1' || oneway === 'true') {
        makeEdge(fromNodeId, toNodeId);
      } else {
        makeEdge(fromNodeId, toNodeId);
        makeEdge(toNodeId, fromNodeId);
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
  };
};

const buildCampusQuery = () => `
[out:json][timeout:90];
relation(${CAMPUS_RELATION_ID});
out center tags;
`;

const buildNamedBuildingQuery = () => `
[out:json][timeout:120];
area(${CAMPUS_AREA_ID})->.campusArea;
(
  way(area.campusArea)["building"]["name"];
  relation(area.campusArea)["building"]["name"];
  node(area.campusArea)["amenity"="college"]["name"];
);
out center tags;
`;

const buildFacilityQuery = () => `
[out:json][timeout:120];
area(${CAMPUS_AREA_ID})->.campusArea;
(
  node(area.campusArea)["amenity"];
  way(area.campusArea)["amenity"];
  relation(area.campusArea)["amenity"];
  node(area.campusArea)["shop"];
  way(area.campusArea)["shop"];
  relation(area.campusArea)["shop"];
  node(area.campusArea)["tourism"];
  way(area.campusArea)["tourism"];
  relation(area.campusArea)["tourism"];
);
out center tags;
`;

const buildRoadQuery = () => `
[out:json][timeout:150];
area(${CAMPUS_AREA_ID})->.campusArea;
(
  way(area.campusArea)["highway"];
);
out geom tags;
`;

const loadCampusMeta = async (): Promise<CampusMeta> => {
  const payload = await runOverpassQuery(buildCampusQuery());
  const campus = (payload.elements || []).find((element) => element.type === 'relation' && element.id === CAMPUS_RELATION_ID);
  if (!campus?.tags) {
    throw new Error('未从 OSM 获取到华中农业大学 relation 元数据。');
  }

  const coordinate = toCoordinate(campus);
  if (!coordinate) {
    throw new Error('华中农业大学 relation 缺少中心点坐标。');
  }

  return {
    relationId: CAMPUS_RELATION_ID,
    name: campus.tags.name || '华中农业大学',
    nameEn: campus.tags['name:en'] || 'Huazhong Agricultural University',
    center: {
      latitude: Number(coordinate.latitude.toFixed(8)),
      longitude: Number(coordinate.longitude.toFixed(8)),
    },
    sourceTags: campus.tags,
  };
};

const main = async () => {
  const [campus, buildingPayload, facilityPayload, roadPayload] = await Promise.all([
    loadCampusMeta(),
    runOverpassQuery(buildNamedBuildingQuery()),
    runOverpassQuery(buildFacilityQuery()),
    runOverpassQuery(buildRoadQuery()),
  ]);

  const buildingElements = (buildingPayload.elements || []).filter(
    (element): element is PointElement => element.type === 'node' || element.type === 'way' || element.type === 'relation',
  );
  const facilityElements = (facilityPayload.elements || []).filter(
    (element): element is PointElement => element.type === 'node' || element.type === 'way' || element.type === 'relation',
  );
  const roadElements = (roadPayload.elements || []).filter((element) => element.type === 'way');

  const attractions = cleanAttractions(buildingElements);
  const facilities = cleanFacilities(facilityElements);
  const roadNetwork = cleanRoadNetwork(roadElements);

  const cleaned: CleanedHzauCampusMap = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: 'OpenStreetMap / Overpass API',
      campus,
      outputPath: OUTPUT_PATH,
    },
    stats: {
      raw: {
        namedBuildings: buildingElements.length,
        facilityCandidates: facilityElements.length,
        roadWays: roadElements.length,
      },
      cleaned: {
        attractions: attractions.length,
        facilities: facilities.length,
        roadNodes: roadNetwork.nodes.length,
        roadEdges: roadNetwork.edges.length,
      },
    },
    attractions,
    facilities,
    roadNetwork,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf8');

  const attractionCategories = attractions.reduce<Record<string, number>>((accumulator, attraction) => {
    accumulator[attraction.category] = (accumulator[attraction.category] || 0) + 1;
    return accumulator;
  }, {});

  const facilityCategories = facilities.reduce<Record<string, number>>((accumulator, facility) => {
    accumulator[facility.category] = (accumulator[facility.category] || 0) + 1;
    return accumulator;
  }, {});

  console.log(`已生成华中农业大学校园地图数据: ${OUTPUT_PATH}`);
  console.log('建筑分类统计:', attractionCategories);
  console.log('设施分类统计:', facilityCategories);
  console.log('路网统计:', {
    ways: roadElements.length,
    nodes: roadNetwork.nodes.length,
    edges: roadNetwork.edges.length,
  });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
