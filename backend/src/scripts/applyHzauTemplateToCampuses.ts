import { readFileSync } from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';

type ScenicAreaRow = {
  id: string;
  name: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
};

type TemplatePoint = {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  tags: string[];
};

type TemplateRoadNode = {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  type: 'junction';
};

type TemplateRoadEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  distance: number;
  roadType: 'main_road' | 'side_road' | 'bicycle_path' | 'footpath';
  allowedTransportation: string[];
  isElectricCartRoute: boolean;
  isBicyclePath: boolean;
};

type TemplateData = {
  meta: {
    campus: {
      center: {
        latitude: number;
        longitude: number;
      };
    };
  };
  attractions: TemplatePoint[];
  facilities: TemplatePoint[];
  roadNetwork: {
    nodes: TemplateRoadNode[];
    edges: TemplateRoadEdge[];
  };
};

type CountSummary = {
  attractions: number;
  facilities: number;
  photo_spots: number;
  road_graph_nodes: number;
  road_graph_edges: number;
  foods: number;
};

const DB_PATH = path.resolve(__dirname, '../../travel_system.db');
const TEMPLATE_PATH = path.resolve(__dirname, '../data/hzauCampusMap.json');

const template = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8')) as TemplateData;

const campusCategorySql = `
  select category as campusCategory
  from scenic_areas
  where rowid = 11
  limit 1
`;

const campusIdsSql = `
  select id
  from scenic_areas
  where category = (${campusCategorySql})
`;

const countsSql = `
  select
    (select count(*) from attractions where scenicAreaId in (${campusIdsSql})) as attractions,
    (select count(*) from facilities where scenicAreaId in (${campusIdsSql})) as facilities,
    (select count(*) from photo_spots where scenicAreaId in (${campusIdsSql})) as photo_spots,
    (select count(*) from road_graph_nodes where scenicAreaId in (${campusIdsSql})) as road_graph_nodes,
    (select count(*) from road_graph_edges where scenicAreaId in (${campusIdsSql})) as road_graph_edges,
    (select count(*) from foods where facilityId in (select id from facilities where scenicAreaId in (${campusIdsSql}))) as foods
`;

const run = (db: sqlite3.Database, sql: string, params: unknown[] = []) =>
  new Promise<void>((resolve, reject) => {
    db.run(sql, params, (error) => (error ? reject(error) : resolve()));
  });

const get = <T>(db: sqlite3.Database, sql: string, params: unknown[] = []) =>
  new Promise<T | undefined>((resolve, reject) => {
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row as T | undefined)));
  });

const all = <T>(db: sqlite3.Database, sql: string, params: unknown[] = []) =>
  new Promise<T[]>((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows as T[])));
  });

const prepare = (db: sqlite3.Database, sql: string) =>
  new Promise<sqlite3.Statement>((resolve, reject) => {
    const statement = db.prepare(sql, (error) => (error ? reject(error) : resolve(statement)));
  });

const runStatement = (statement: sqlite3.Statement, params: unknown[]) =>
  new Promise<void>((resolve, reject) => {
    statement.run(params, (error) => (error ? reject(error) : resolve()));
  });

const finalize = (statement: sqlite3.Statement) =>
  new Promise<void>((resolve, reject) => {
    statement.finalize((error) => (error ? reject(error) : resolve()));
  });

const roundCoord = (value: number) => Number(value.toFixed(8));
const pad2 = (value: number) => String(value).padStart(2, '0');
const pad4 = (value: number) => String(value).padStart(4, '0');

const attractionTypeByCategory: Record<string, string> = {
  景点: 'landmark',
  教学楼: 'culture',
  办公楼: 'landmark',
  宿舍楼: 'garden',
  实验楼: 'historic',
  图书馆: 'museum',
};

const foodCategoryPool: Record<string, string[]> = {
  食堂: ['校园套餐', '面食', '盖饭', '简餐'],
  饭店: ['地方风味', '小吃', '热菜', '简餐'],
  超市: ['便当', '零食', '饮品'],
  商店: ['饮品', '零食'],
  接待中心: ['咖啡简餐', '轻食'],
};

const bestTimePool = ['09:00-11:00', '14:00-16:00', '16:30-18:00'];

const shouldHaveIndoorStructure = (category: string) =>
  category === '教学楼' || category === '实验楼' || category === '图书馆';

const buildIndoorStructure = (buildingName: string) =>
  JSON.stringify({
    buildingName,
    floors: [
      { number: 1, rooms: ['入口大厅', '服务台', '休息区'] },
      { number: 2, rooms: ['功能区A', '自习区', '活动空间'] },
    ],
    elevators: [{ id: 'e1', floors: [1, 2] }],
  });

const buildAttractionName = (campusName: string, category: string, index: number) =>
  `${campusName}-${category}-${pad2(index)}`;

const buildFacilityName = (campusName: string, category: string, index: number) =>
  `${campusName}-${category}-${pad2(index)}`;

const buildAttractionDescription = (campusName: string, category: string) =>
  `${campusName}内部导航点位，类别为${category}，由华中农业大学校园模板实例化生成。`;

const buildFacilityDescription = (campusName: string, category: string) =>
  `${campusName}内部服务设施，类别为${category}，由华中农业大学校园模板实例化生成。`;

const buildFoodDescription = (campusName: string, facilityName: string) =>
  `${campusName}内部餐饮点，依附于${facilityName}。`;

const buildPhotoDescription = (campusName: string) =>
  `${campusName}内部摄影打卡点，由校园模板自动生成。`;

const transformCoordinate = (latitude: number, longitude: number, scenic: ScenicAreaRow) => {
  const templateCenter = template.meta.campus.center;
  const targetLatitude = Number(scenic.latitude ?? templateCenter.latitude);
  const targetLongitude = Number(scenic.longitude ?? templateCenter.longitude);

  return {
    latitude: roundCoord(targetLatitude + (latitude - templateCenter.latitude)),
    longitude: roundCoord(targetLongitude + (longitude - templateCenter.longitude)),
  };
};

const main = async () => {
  const db = new sqlite3.Database(DB_PATH);

  try {
    const campuses = await all<ScenicAreaRow>(
      db,
      `select id, name, city, latitude, longitude from scenic_areas where category = (${campusCategorySql}) order by rowid`,
    );

    if (!campuses.length) {
      throw new Error('No campus scenic areas found. Cannot apply HZAU campus template.');
    }

    const beforeCounts = await get<CountSummary>(db, countsSql);

    await run(db, 'BEGIN TRANSACTION');
    await run(
      db,
      `delete from foods where facilityId in (select id from facilities where scenicAreaId in (${campusIdsSql}))`,
    );
    await run(db, `delete from photo_spots where scenicAreaId in (${campusIdsSql})`);
    await run(db, `delete from road_graph_edges where scenicAreaId in (${campusIdsSql})`);
    await run(db, `delete from road_graph_nodes where scenicAreaId in (${campusIdsSql})`);
    await run(db, `delete from attractions where scenicAreaId in (${campusIdsSql})`);
    await run(db, `delete from facilities where scenicAreaId in (${campusIdsSql})`);

    const insertAttraction = await prepare(
      db,
      `insert into attractions (
        id, scenicAreaId, name, type, category, city, description, latitude, longitude,
        openingHours, averageRating, reviewCount, estimatedVisitDuration, congestionFactor, tags, indoorStructure
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertFacility = await prepare(
      db,
      `insert into facilities (
        id, scenicAreaId, name, category, latitude, longitude, openingHours, description
      ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertFood = await prepare(
      db,
      `insert into foods (
        id, name, facilityId, cuisine, price, description, popularity, averageRating, reviewCount, tags, isSeasonalSpecial
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertPhotoSpot = await prepare(
      db,
      `insert into photo_spots (
        id, scenicAreaId, attractionId, name, description, latitude, longitude, bestTime,
        popularity, crowdLevel, lightingCondition, examplePhotos
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertRoadNode = await prepare(
      db,
      `insert into road_graph_nodes (
        id, scenicAreaId, type, name, latitude, longitude
      ) values (?, ?, ?, ?, ?, ?)`,
    );

    const insertRoadEdge = await prepare(
      db,
      `insert into road_graph_edges (
        id, scenicAreaId, fromNodeId, toNodeId, distance, roadType, congestionFactor,
        allowedTransportation, isElectricCartRoute, isBicyclePath, transportation
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertedSummary = {
      campuses: campuses.length,
      attractions: 0,
      facilities: 0,
      foods: 0,
      photo_spots: 0,
      road_graph_nodes: 0,
      road_graph_edges: 0,
    };

    for (const campus of campuses) {
      const attractionCounters = new Map<string, number>();
      const facilityCounters = new Map<string, number>();
      const attractionIdMap = new Map<string, string>();
      const facilityIdMap = new Map<string, string>();
      const facilityNameMap = new Map<string, string>();
      const roadNodeIdMap = new Map<string, string>();
      const attractionNameMap = new Map<string, string>();

      for (const item of template.attractions) {
        const nextIndex = (attractionCounters.get(item.category) || 0) + 1;
        attractionCounters.set(item.category, nextIndex);

        const newId = uuidv4();
        const coordinate = transformCoordinate(item.latitude, item.longitude, campus);
        const attractionName = buildAttractionName(campus.name, item.category, nextIndex);

        attractionIdMap.set(item.id, newId);
        attractionNameMap.set(item.id, attractionName);

        await runStatement(insertAttraction, [
          newId,
          campus.id,
          attractionName,
          attractionTypeByCategory[item.category] || 'culture',
          item.category,
          campus.city,
          buildAttractionDescription(campus.name, item.category),
          coordinate.latitude,
          coordinate.longitude,
          '{}',
          4.5,
          120 + nextIndex,
          45,
          1,
          JSON.stringify(['校园', item.category, campus.name]),
          shouldHaveIndoorStructure(item.category) ? buildIndoorStructure(attractionName) : '{}',
        ]);
        insertedSummary.attractions += 1;
      }

      for (const item of template.facilities) {
        const nextIndex = (facilityCounters.get(item.category) || 0) + 1;
        facilityCounters.set(item.category, nextIndex);

        const newId = uuidv4();
        const coordinate = transformCoordinate(item.latitude, item.longitude, campus);
        const facilityName = buildFacilityName(campus.name, item.category, nextIndex);

        facilityIdMap.set(item.id, newId);
        facilityNameMap.set(item.id, facilityName);

        await runStatement(insertFacility, [
          newId,
          campus.id,
          facilityName,
          item.category,
          coordinate.latitude,
          coordinate.longitude,
          '{}',
          buildFacilityDescription(campus.name, item.category),
        ]);
        insertedSummary.facilities += 1;
      }

      let foodIndex = 0;
      for (const item of template.facilities) {
        if (foodIndex >= 20) {
          break;
        }

        const facilityId = facilityIdMap.get(item.id);
        const facilityName = facilityNameMap.get(item.id);
        const cuisinePool = foodCategoryPool[item.category];

        if (!facilityId || !facilityName || !cuisinePool) {
          continue;
        }

        foodIndex += 1;
        const cuisine = cuisinePool[(foodIndex - 1) % cuisinePool.length];

        await runStatement(insertFood, [
          uuidv4(),
          `${campus.name}-餐饮-${pad2(foodIndex)}`,
          facilityId,
          cuisine,
          12 + foodIndex,
          buildFoodDescription(campus.name, facilityName),
          60 + foodIndex * 3,
          4.3,
          20 + foodIndex,
          JSON.stringify(['校园餐饮', cuisine, campus.name]),
          0,
        ]);
        insertedSummary.foods += 1;
      }

      let photoIndex = 0;
      for (const item of template.attractions) {
        if (photoIndex >= 6) {
          break;
        }

        const attractionId = attractionIdMap.get(item.id);
        const attractionName = attractionNameMap.get(item.id);
        if (!attractionId || !attractionName) {
          continue;
        }

        photoIndex += 1;
        const coordinate = transformCoordinate(item.latitude, item.longitude, campus);

        await runStatement(insertPhotoSpot, [
          uuidv4(),
          campus.id,
          attractionId,
          `${attractionName}-摄影点-${pad2(photoIndex)}`,
          buildPhotoDescription(campus.name),
          coordinate.latitude,
          coordinate.longitude,
          bestTimePool[(photoIndex - 1) % bestTimePool.length],
          80 + photoIndex * 5,
          'medium',
          'good',
          '[]',
        ]);
        insertedSummary.photo_spots += 1;
      }

      let nodeIndex = 0;
      for (const node of template.roadNetwork.nodes) {
        nodeIndex += 1;
        const newId = uuidv4();
        const coordinate = transformCoordinate(node.latitude, node.longitude, campus);

        roadNodeIdMap.set(node.id, newId);

        await runStatement(insertRoadNode, [
          newId,
          campus.id,
          'junction',
          `${campus.name}-路网节点-${pad4(nodeIndex)}`,
          coordinate.latitude,
          coordinate.longitude,
        ]);
        insertedSummary.road_graph_nodes += 1;
      }

      for (const edge of template.roadNetwork.edges) {
        const fromNodeId = roadNodeIdMap.get(edge.fromNodeId);
        const toNodeId = roadNodeIdMap.get(edge.toNodeId);

        if (!fromNodeId || !toNodeId) {
          continue;
        }

        await runStatement(insertRoadEdge, [
          uuidv4(),
          campus.id,
          fromNodeId,
          toNodeId,
          edge.distance,
          edge.roadType,
          1,
          JSON.stringify(edge.allowedTransportation),
          0,
          edge.roadType === 'bicycle_path' ? 1 : 0,
          edge.roadType === 'bicycle_path' ? 'bicycle' : 'walk',
        ]);
        insertedSummary.road_graph_edges += 1;
      }
    }

    await finalize(insertAttraction);
    await finalize(insertFacility);
    await finalize(insertFood);
    await finalize(insertPhotoSpot);
    await finalize(insertRoadNode);
    await finalize(insertRoadEdge);

    await run(db, 'COMMIT');

    const afterCounts = await get<CountSummary>(db, countsSql);
    console.log(
      JSON.stringify(
        {
          database: DB_PATH,
          templatePath: TEMPLATE_PATH,
          beforeCounts,
          insertedSummary,
          afterCounts,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    try {
      await run(db, 'ROLLBACK');
    } catch {
      // Ignore rollback failures when no transaction is active.
    }
    throw error;
  } finally {
    db.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
