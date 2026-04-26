import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import sqlite3 from 'sqlite3';

type AttractionRow = {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
};

type FacilityRow = {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
};

type RoadNodeRow = {
  id: string;
  name: string;
  type: 'gateway' | 'attraction' | 'facility' | 'junction';
  latitude: number;
  longitude: number;
};

type RoadEdgeRow = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  distance: number;
  roadType: 'main_road' | 'footpath' | 'connector' | 'bicycle_path' | 'side_road';
};

type ScenicRow = {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
};

const DB_PATH = resolve(__dirname, '../../travel_system.db');
const OUTPUT_PATH = resolve(__dirname, '../data/buptCampusMapSample.svg');
const SCENIC_NAME = '北京邮电大学';

const WIDTH = 1800;
const HEIGHT = 1300;
const MARGIN = 90;

const attractionColors: Record<string, string> = {
  教学楼: '#2f6fed',
  实验楼: '#7c3aed',
  办公楼: '#0f766e',
  宿舍楼: '#ea580c',
  图书馆: '#b91c1c',
  体育馆: '#d4a017',
};

const facilityColors: Record<string, string> = {
  洗手间: '#8b5cf6',
  图书馆: '#b91c1c',
  超市: '#16a34a',
  食堂: '#dc2626',
  咖啡馆: '#f59e0b',
  停车场: '#4b5563',
  医疗点: '#ec4899',
  商店: '#22c55e',
  游客中心: '#06b6d4',
  饭店: '#ef4444',
};

const roadColors: Record<RoadEdgeRow['roadType'], string> = {
  main_road: '#cbd5e1',
  side_road: '#dbe4f0',
  bicycle_path: '#bfdbfe',
  footpath: '#e5e7eb',
  connector: '#94a3b8',
};

const xmlEscape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const toArray = <T>(rows: T[] | undefined) => rows || [];

const allAsync = <T>(db: sqlite3.Database, sql: string, params: unknown[] = []) =>
  new Promise<T[]>((resolvePromise, rejectPromise) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise(rows as T[]);
    });
  });

const getAsync = <T>(db: sqlite3.Database, sql: string, params: unknown[] = []) =>
  new Promise<T | undefined>((resolvePromise, rejectPromise) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise(row as T | undefined);
    });
  });

const main = async () => {
  const db = new sqlite3.Database(DB_PATH);

  try {
    const scenic = await getAsync<ScenicRow>(db, 'select id, name, category, latitude, longitude from scenic_areas where name = ? limit 1', [
      SCENIC_NAME,
    ]);

    if (!scenic) {
      throw new Error(`未找到景区/校园: ${SCENIC_NAME}`);
    }

    const [attractions, facilities, roadNodes, roadEdges] = await Promise.all([
      allAsync<AttractionRow>(
        db,
        'select id, name, category, latitude, longitude from attractions where scenicAreaId = ? order by name',
        [scenic.id],
      ),
      allAsync<FacilityRow>(
        db,
        'select id, name, category, latitude, longitude from facilities where scenicAreaId = ? order by name',
        [scenic.id],
      ),
      allAsync<RoadNodeRow>(
        db,
        'select id, name, type, latitude, longitude from road_graph_nodes where scenicAreaId = ? order by name',
        [scenic.id],
      ),
      allAsync<RoadEdgeRow>(
        db,
        'select id, fromNodeId, toNodeId, distance, roadType from road_graph_edges where scenicAreaId = ? order by id',
        [scenic.id],
      ),
    ]);

    const validAttractions = toArray(attractions).filter((item) => item.latitude !== null && item.longitude !== null);
    const validFacilities = toArray(facilities).filter((item) => item.latitude !== null && item.longitude !== null);
    const validRoadNodes = toArray(roadNodes).filter((item) => item.latitude !== null && item.longitude !== null);
    const validRoadEdges = toArray(roadEdges);

    const allLatitudes = [
      ...validAttractions.map((item) => Number(item.latitude)),
      ...validFacilities.map((item) => Number(item.latitude)),
      ...validRoadNodes.map((item) => Number(item.latitude)),
    ];
    const allLongitudes = [
      ...validAttractions.map((item) => Number(item.longitude)),
      ...validFacilities.map((item) => Number(item.longitude)),
      ...validRoadNodes.map((item) => Number(item.longitude)),
    ];

    const minLat = Math.min(...allLatitudes);
    const maxLat = Math.max(...allLatitudes);
    const minLng = Math.min(...allLongitudes);
    const maxLng = Math.max(...allLongitudes);

    const project = (latitude: number, longitude: number) => {
      const width = WIDTH - MARGIN * 2;
      const height = HEIGHT - MARGIN * 2;
      const x = MARGIN + ((longitude - minLng) / (maxLng - minLng || 1)) * width;
      const y = HEIGHT - MARGIN - ((latitude - minLat) / (maxLat - minLat || 1)) * height;
      return { x, y };
    };

    const roadNodeMap = new Map(validRoadNodes.map((node) => [node.id, node]));

    const roadLines = validRoadEdges
      .map((edge) => {
        const from = roadNodeMap.get(edge.fromNodeId);
        const to = roadNodeMap.get(edge.toNodeId);
        if (!from || !to) {
          return '';
        }
        const start = project(Number(from.latitude), Number(from.longitude));
        const end = project(Number(to.latitude), Number(to.longitude));
        const strokeWidth =
          edge.roadType === 'main_road'
            ? 2.5
            : edge.roadType === 'connector'
              ? 1.4
              : edge.roadType === 'bicycle_path'
                ? 1.5
                : edge.roadType === 'side_road'
                  ? 1.6
                  : 1.1;

        return `<line x1="${start.x.toFixed(2)}" y1="${start.y.toFixed(2)}" x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(
          2,
        )}" stroke="${roadColors[edge.roadType]}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="0.84" />`;
      })
      .join('\n');

    const attractionPoints = validAttractions
      .map((point) => {
        const { x, y } = project(Number(point.latitude), Number(point.longitude));
        const color = attractionColors[point.category] || '#334155';
        return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="6" fill="${color}" stroke="#ffffff" stroke-width="1.3" />`;
      })
      .join('\n');

    const facilityPoints = validFacilities
      .map((point) => {
        const { x, y } = project(Number(point.latitude), Number(point.longitude));
        const color = facilityColors[point.category] || '#64748b';
        return `<rect x="${(x - 3.8).toFixed(2)}" y="${(y - 3.8).toFixed(2)}" width="7.6" height="7.6" rx="1.8" fill="${color}" stroke="#ffffff" stroke-width="1" />`;
      })
      .join('\n');

    const gatewayPoints = validRoadNodes
      .filter((item) => item.type === 'gateway')
      .map((point) => {
        const { x, y } = project(Number(point.latitude), Number(point.longitude));
        return `<path d="M ${x.toFixed(2)} ${(y - 9).toFixed(2)} L ${(x + 8).toFixed(2)} ${y.toFixed(2)} L ${x.toFixed(
          2,
        )} ${(y + 9).toFixed(2)} L ${(x - 8).toFixed(2)} ${y.toFixed(2)} Z" fill="#111827" stroke="#ffffff" stroke-width="1.2" />`;
      })
      .join('\n');

    const labelCandidates = [
      ...validRoadNodes.filter((item) => item.type === 'gateway'),
      ...validAttractions,
      ...validFacilities.filter((item) => /(食堂|图书馆|咖啡馆|超市|医疗点|游客中心|停车场)/.test(item.category)),
    ];

    const dedupedLabels = new Map<string, { name: string; latitude: number; longitude: number }>();
    for (const item of labelCandidates) {
      if (!dedupedLabels.has(item.name)) {
        dedupedLabels.set(item.name, {
          name: item.name.replace(/^北京邮电大学-/, ''),
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
        });
      }
    }

    const pointLabels = Array.from(dedupedLabels.values())
      .slice(0, 36)
      .map((point, index) => {
        const { x, y } = project(point.latitude, point.longitude);
        const dy = index % 2 === 0 ? -8 : 14;
        return `<text x="${(x + 8).toFixed(2)}" y="${(y + dy).toFixed(2)}" font-size="16" font-family="Arial, 'Microsoft YaHei', sans-serif" fill="#0f172a" stroke="#ffffff" stroke-width="4" paint-order="stroke" opacity="0.97">${xmlEscape(
          point.name,
        )}</text>`;
      })
      .join('\n');

    const gatewayLabels = validRoadNodes
      .filter((item) => item.type === 'gateway')
      .map((point) => {
        const { x, y } = project(Number(point.latitude), Number(point.longitude));
        return `<text x="${(x + 10).toFixed(2)}" y="${(y - 10).toFixed(2)}" font-size="18" font-weight="700" font-family="Arial, 'Microsoft YaHei', sans-serif" fill="#111827" stroke="#ffffff" stroke-width="4" paint-order="stroke">${xmlEscape(
          point.name.replace(/^北京邮电大学-/, ''),
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
    <text x="0" y="0" font-size="34" font-weight="700" fill="#0f172a" font-family="Arial, 'Microsoft YaHei', sans-serif">北京邮电大学校园内部地图样例</text>
    <text x="0" y="34" font-size="18" fill="#475569" font-family="Arial, 'Microsoft YaHei', sans-serif">基于项目数据库中的校园内部数据生成，展示路网、建筑点、设施点和部分名称标注</text>
  </g>

  <g>${roadLines}</g>
  <g>${facilityPoints}</g>
  <g>${attractionPoints}</g>
  <g>${gatewayPoints}</g>
  <g>${pointLabels}</g>
  <g>${gatewayLabels}</g>

  <g transform="translate(${WIDTH - 390}, 110)">
    <rect x="0" y="0" width="300" height="460" rx="18" fill="#ffffff" fill-opacity="0.93" stroke="#dbe4f0" />
    <text x="26" y="36" font-size="24" font-weight="700" fill="#0f172a" font-family="Arial, 'Microsoft YaHei', sans-serif">图例</text>
    <text x="26" y="74" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">建筑点</text>
    <g transform="translate(34, 100)">${attractionLegend}</g>
    <text x="26" y="292" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">设施点（部分）</text>
    <g transform="translate(34, 318)">${facilityLegend}</g>
  </g>

  <g transform="translate(${WIDTH - 390}, 600)">
    <rect x="0" y="0" width="300" height="206" rx="18" fill="#ffffff" fill-opacity="0.93" stroke="#dbe4f0" />
    <text x="26" y="36" font-size="24" font-weight="700" fill="#0f172a" font-family="Arial, 'Microsoft YaHei', sans-serif">数据摘要</text>
    <text x="26" y="76" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">建筑点: ${validAttractions.length}</text>
    <text x="26" y="106" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">设施点: ${validFacilities.length}</text>
    <text x="26" y="136" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">路网节点: ${validRoadNodes.length}</text>
    <text x="26" y="166" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">路网边: ${validRoadEdges.length}</text>
    <text x="26" y="196" font-size="18" fill="#334155" font-family="Arial, 'Microsoft YaHei', sans-serif">入口节点: ${validRoadNodes.filter((item) => item.type === 'gateway').length}</text>
  </g>

  <g transform="translate(86, ${HEIGHT - 52})">
    <text x="0" y="0" font-size="16" fill="#64748b" font-family="Arial, 'Microsoft YaHei', sans-serif">注: 这是按校园内部经纬度投影生成的展示样例图，用于说明点线面结构，不是精确测绘底图。</text>
  </g>
</svg>
`;

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, svg, 'utf8');
    console.log(`已生成样例图: ${OUTPUT_PATH}`);
  } finally {
    db.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
