import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

type CampusPoint = {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  tags: string[];
};

type RoadEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  distance: number;
  roadType: 'main_road' | 'side_road' | 'bicycle_path' | 'footpath';
  sourceWayId: number;
  roadName: string;
};

type RoadNode = {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
};

type HzauCampusMapData = {
  attractions: CampusPoint[];
  facilities: CampusPoint[];
  roadNetwork: {
    nodes: RoadNode[];
    edges: RoadEdge[];
  };
};

const INPUT_PATH = resolve(__dirname, '../data/hzauCampusMap.json');
const OUTPUT_PATH = resolve(__dirname, '../data/hzauCampusMapSample.svg');

const WIDTH = 1800;
const HEIGHT = 1300;
const MARGIN = 90;

const attractionColors: Record<string, string> = {
  教学楼: '#2f6fed',
  实验楼: '#7c3aed',
  办公楼: '#0f766e',
  宿舍楼: '#ea580c',
  图书馆: '#b91c1c',
  景点: '#d4a017',
};

const facilityColors: Record<string, string> = {
  食堂: '#dc2626',
  饭店: '#ef4444',
  超市: '#16a34a',
  商店: '#22c55e',
  停车场: '#4b5563',
  自行车停放点: '#0ea5e9',
  自行车服务: '#0284c7',
  充电站: '#8b5cf6',
  医疗点: '#ec4899',
  警务室: '#1d4ed8',
  快递点: '#f59e0b',
  接待中心: '#14b8a6',
  ATM: '#64748b',
};

const roadColors: Record<RoadEdge['roadType'], string> = {
  main_road: '#cbd5e1',
  side_road: '#dbe4f0',
  bicycle_path: '#bfdbfe',
  footpath: '#e5e7eb',
};

const xmlEscape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const data = JSON.parse(readFileSync(INPUT_PATH, 'utf8')) as HzauCampusMapData;

const allLatitudes = [
  ...data.attractions.map((item) => item.latitude),
  ...data.facilities.map((item) => item.latitude),
  ...data.roadNetwork.nodes.map((item) => item.latitude),
];
const allLongitudes = [
  ...data.attractions.map((item) => item.longitude),
  ...data.facilities.map((item) => item.longitude),
  ...data.roadNetwork.nodes.map((item) => item.longitude),
];

const minLat = Math.min(...allLatitudes);
const maxLat = Math.max(...allLatitudes);
const minLng = Math.min(...allLongitudes);
const maxLng = Math.max(...allLongitudes);

const project = (latitude: number, longitude: number) => {
  const width = WIDTH - MARGIN * 2;
  const height = HEIGHT - MARGIN * 2;
  const x = MARGIN + ((longitude - minLng) / (maxLng - minLng)) * width;
  const y = HEIGHT - MARGIN - ((latitude - minLat) / (maxLat - minLat)) * height;
  return { x, y };
};

const roadNodeMap = new Map(data.roadNetwork.nodes.map((node) => [node.id, node]));

const roadLines = data.roadNetwork.edges
  .map((edge) => {
    const from = roadNodeMap.get(edge.fromNodeId);
    const to = roadNodeMap.get(edge.toNodeId);
    if (!from || !to) {
      return '';
    }
    const start = project(from.latitude, from.longitude);
    const end = project(to.latitude, to.longitude);
    const strokeWidth =
      edge.roadType === 'main_road' ? 2.4 : edge.roadType === 'side_road' ? 1.6 : edge.roadType === 'bicycle_path' ? 1.5 : 1.1;

    return `<line x1="${start.x.toFixed(2)}" y1="${start.y.toFixed(2)}" x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(
      2,
    )}" stroke="${roadColors[edge.roadType]}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="0.82" />`;
  })
  .join('\n');

const attractionPoints = data.attractions
  .map((point) => {
    const { x, y } = project(point.latitude, point.longitude);
    const color = attractionColors[point.category] || '#334155';
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="5.5" fill="${color}" stroke="#ffffff" stroke-width="1.3" />`;
  })
  .join('\n');

const facilityPoints = data.facilities
  .map((point) => {
    const { x, y } = project(point.latitude, point.longitude);
    const color = facilityColors[point.category] || '#64748b';
    const size = 7;
    return `<rect x="${(x - size / 2).toFixed(2)}" y="${(y - size / 2).toFixed(2)}" width="${size}" height="${size}" rx="1.8" fill="${color}" stroke="#ffffff" stroke-width="1" />`;
  })
  .join('\n');

const labelCandidates = [
  ...data.attractions.filter((item) => item.category !== '宿舍楼'),
  ...data.attractions.filter((item) => item.category === '宿舍楼' && /(荟园1栋|荟园12栋|北苑1栋|北苑5栋)/.test(item.name)),
  ...data.facilities.filter((item) => /(图书馆|校医院|食堂|教超|超市|罗森|驿站|派出所|国际学术交流中心)/.test(item.name)),
];

const dedupedLabels = new Map<string, CampusPoint>();
for (const item of labelCandidates) {
  dedupedLabels.set(item.name, item);
}

const pointLabels = Array.from(dedupedLabels.values())
  .slice(0, 32)
  .map((point, index) => {
    const { x, y } = project(point.latitude, point.longitude);
    const dy = index % 2 === 0 ? -8 : 14;
    return `<text x="${(x + 8).toFixed(2)}" y="${(y + dy).toFixed(2)}" font-size="17" font-family="Arial, 'Microsoft YaHei', sans-serif" fill="#0f172a" stroke="#ffffff" stroke-width="4" paint-order="stroke" opacity="0.96">${xmlEscape(
      point.name,
    )}</text>`;
  })
  .join('\n');

const namedRoads = new Map<
  string,
  {
    count: number;
    sumX: number;
    sumY: number;
  }
>();

for (const edge of data.roadNetwork.edges) {
  if (!edge.roadName || edge.roadName.startsWith('华中农业大学道路-')) {
    continue;
  }
  const from = roadNodeMap.get(edge.fromNodeId);
  const to = roadNodeMap.get(edge.toNodeId);
  if (!from || !to) {
    continue;
  }
  const start = project(from.latitude, from.longitude);
  const end = project(to.latitude, to.longitude);
  const centerX = (start.x + end.x) / 2;
  const centerY = (start.y + end.y) / 2;
  const existing = namedRoads.get(edge.roadName) || { count: 0, sumX: 0, sumY: 0 };
  existing.count += 1;
  existing.sumX += centerX;
  existing.sumY += centerY;
  namedRoads.set(edge.roadName, existing);
}

const roadLabels = Array.from(namedRoads.entries())
  .filter(([, value]) => value.count >= 6)
  .slice(0, 12)
  .map(([name, value]) => {
    const x = value.sumX / value.count;
    const y = value.sumY / value.count;
    return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="20" font-family="Arial, 'Microsoft YaHei', sans-serif" fill="#475569" fill-opacity="0.95" stroke="#ffffff" stroke-width="5" paint-order="stroke" text-anchor="middle">${xmlEscape(
      name,
    )}</text>`;
  })
  .join('\n');

const attractionLegend = Object.entries(attractionColors)
  .map(
    ([category, color], index) =>
      `<g transform="translate(0, ${index * 28})"><circle cx="0" cy="0" r="6" fill="${color}" /><text x="16" y="6" font-size="18" fill="#0f172a" font-family="Arial, 'Microsoft YaHei', sans-serif">${xmlEscape(
        category,
      )}</text></g>`,
  )
  .join('\n');

const facilityLegend = Object.entries(facilityColors)
  .slice(0, 8)
  .map(
    ([category, color], index) =>
      `<g transform="translate(0, ${index * 28})"><rect x="-6" y="-6" width="12" height="12" rx="2" fill="${color}" /><text x="16" y="6" font-size="18" fill="#0f172a" font-family="Arial, 'Microsoft YaHei', sans-serif">${xmlEscape(
        category,
      )}</text></g>`,
  )
  .join('\n');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="100%" height="100%" fill="#f8fafc" />
  <rect x="36" y="30" width="${WIDTH - 72}" height="${HEIGHT - 60}" rx="24" fill="#ffffff" stroke="#dbe4f0" stroke-width="2" />

  <g transform="translate(86, 78)">
    <text x="0" y="0" font-size="34" font-weight="700" fill="#0f172a" font-family="Arial, 'Microsoft YaHei', sans-serif">华中农业大学校园内部地图样例</text>
    <text x="0" y="34" font-size="18" fill="#475569" font-family="Arial, 'Microsoft YaHei', sans-serif">基于 OSM 清洗数据生成，展示路网、建筑点、服务设施点和部分名称标注</text>
  </g>

  <g>
    ${roadLines}
  </g>
  <g>
    ${roadLabels}
  </g>
  <g>
    ${facilityPoints}
  </g>
  <g>
    ${attractionPoints}
  </g>
  <g>
    ${pointLabels}
  </g>

  <g transform="translate(${WIDTH - 390}, 110)">
    <rect x="0" y="0" width="300" height="460" rx="18" fill="#ffffff" fill-opacity="0.93" stroke="#dbe4f0" />
    <text x="26" y="36" font-size="24" font-weight="700" fill="#0f172a" font-family="Arial, 'Microsoft YaHei', sans-serif">图例</text>
    <text x="26" y="74" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">建筑点</text>
    <g transform="translate(34, 100)">
      ${attractionLegend}
    </g>
    <text x="26" y="292" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">设施点（部分）</text>
    <g transform="translate(34, 318)">
      ${facilityLegend}
    </g>
  </g>

  <g transform="translate(${WIDTH - 390}, 600)">
    <rect x="0" y="0" width="300" height="186" rx="18" fill="#ffffff" fill-opacity="0.93" stroke="#dbe4f0" />
    <text x="26" y="36" font-size="24" font-weight="700" fill="#0f172a" font-family="Arial, 'Microsoft YaHei', sans-serif">数据摘要</text>
    <text x="26" y="76" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">建筑点: ${data.attractions.length}</text>
    <text x="26" y="106" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">设施点: ${data.facilities.length}</text>
    <text x="26" y="136" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">路网节点: ${data.roadNetwork.nodes.length}</text>
    <text x="26" y="166" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">路网边: ${data.roadNetwork.edges.length}</text>
  </g>

  <g transform="translate(86, ${HEIGHT - 52})">
    <text x="0" y="0" font-size="16" fill="#64748b" font-family="Arial, 'Microsoft YaHei', sans-serif">注: 这是按经纬度投影生成的校园级平面样例图，不是精确制图底图。</text>
  </g>
</svg>
`;

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, svg, 'utf8');

console.log(`已生成样例图: ${OUTPUT_PATH}`);
