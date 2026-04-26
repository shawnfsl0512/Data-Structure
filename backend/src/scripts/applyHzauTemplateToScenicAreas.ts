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
  latitude: number;
  longitude: number;
};

type TemplateRoadNode = {
  id: string;
  latitude: number;
  longitude: number;
};

type TemplateRoadEdge = {
  fromNodeId: string;
  toNodeId: string;
  distance: number;
  roadType: 'main_road' | 'side_road' | 'bicycle_path' | 'footpath';
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

type ScenicAttractionDefinition = {
  name: string;
  category: string;
  type: string;
  theme: string;
};

type ScenicFacilityDefinition = {
  name: string;
  category: string;
};

const DB_PATH = path.resolve(__dirname, '../../travel_system.db');
const TEMPLATE_PATH = path.resolve(__dirname, '../data/hzauCampusMap.json');

const template = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8')) as TemplateData;

const attractionNames = [
  '欢乐时光',
  '欢乐广场',
  '星光大道',
  '欢乐剧场',
  '时光塔',
  '时光花园',
  '旋转木马',
  '飞天秋千',
  '飓风湾',
  '激流勇进',
  '海浪飞椅',
  '海盗船',
  '水幕码头',
  '风暴之眼',
  '飓风滑道',
  '海岸栈桥',
  '魔幻城堡',
  '魔法学院',
  '幻影剧场',
  '精灵花园',
  '星愿塔',
  '魔镜迷宫',
  '奇幻巡游台',
  '童话钟楼',
  '极速世界',
  '雪山飞龙',
  '天地双雄',
  '雷霆赛车',
  '极速飞轮',
  '失重塔',
  '追风者',
  '云霄观景台',
  '阳光海岸',
  '海岸观景台',
  '椰林水寨',
  '沙滩舞台',
  '朝阳广场',
  '彩虹栈道',
  '逐浪码头',
  '水岸剧场',
  '冒险山',
  '丛林漂流',
  '探险营地',
  '远古石阵',
  '山谷飞鹰',
  '迷踪古道',
  '峡谷索桥',
  '勇士峰',
  '梦想大道',
  '欢乐巡游广场',
  '光影秀场',
  '梦想剧院',
  '星愿喷泉',
  '彩车工坊',
  '缤纷舞台',
  '许愿长廊',
  '卡通工厂',
  '快乐碰碰车',
  '糖果乐园',
  '玩具列车',
  '泡泡实验室',
  '彩绘工坊',
  '童梦小镇',
  '亲子乐园',
] as const;

const facilityDefinitions: ScenicFacilityDefinition[] = [
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
];

const themeNames = ['欢乐时光', '飓风湾', '魔幻城堡', '极速世界', '阳光海岸', '冒险山', '梦想大道', '卡通工厂'];

const foodCategoryPool: Record<string, string[]> = {
  特色餐厅: ['主题套餐', '地方风味', '热菜', '小吃'],
  餐饮广场: ['快餐', '面食', '小吃', '简餐'],
  咖啡馆: ['咖啡', '甜品', '轻食'],
  便利店: ['零食', '饮品', '便当'],
};

const bestTimePool = ['09:00-11:00', '14:00-16:00', '16:30-18:00'];

const scenicCategorySql = `
  select category as scenicCategory
  from scenic_areas
  where rowid = 1
  limit 1
`;

const scenicIdsSql = `
  select id
  from scenic_areas
  where category = (${scenicCategorySql})
`;

const countsSql = `
  select
    (select count(*) from attractions where scenicAreaId in (${scenicIdsSql})) as attractions,
    (select count(*) from facilities where scenicAreaId in (${scenicIdsSql})) as facilities,
    (select count(*) from photo_spots where scenicAreaId in (${scenicIdsSql})) as photo_spots,
    (select count(*) from road_graph_nodes where scenicAreaId in (${scenicIdsSql})) as road_graph_nodes,
    (select count(*) from road_graph_edges where scenicAreaId in (${scenicIdsSql})) as road_graph_edges,
    (select count(*) from foods where facilityId in (select id from facilities where scenicAreaId in (${scenicIdsSql}))) as foods
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

const buildAttractionDefinitions = (): ScenicAttractionDefinition[] => {
  const projectKeywords = ['旋转木马', '飞天秋千', '激流勇进', '海浪飞椅', '海盗船', '飓风滑道', '雪山飞龙', '天地双雄', '雷霆赛车', '极速飞轮', '失重塔', '丛林漂流', '快乐碰碰车', '玩具列车'];

  return attractionNames.map((name, index) => {
    const theme = themeNames[Math.floor(index / 8)] || '欢乐时光';
    if (name.includes('剧场') || name.includes('剧院') || name.includes('秀场') || name.includes('舞台')) {
      return { name, category: '演艺点', type: 'culture', theme };
    }
    if (name.includes('观景台') || name.includes('塔') || name.includes('栈桥') || name.includes('码头') || name.includes('长廊')) {
      return { name, category: '观景点', type: 'landmark', theme };
    }
    if (projectKeywords.some((keyword) => name.includes(keyword))) {
      return { name, category: '游乐项目', type: 'landmark', theme };
    }
    return { name, category: '景点', type: 'landmark', theme };
  });
};

const attractionDefinitions = buildAttractionDefinitions();

const buildAttractionDescription = (scenicName: string, attractionName: string, theme: string) =>
  `${scenicName}内部景点“${attractionName}”，主题归属为${theme}，由景区统一模板实例化生成。`;

const buildFacilityDescription = (scenicName: string, facilityName: string, category: string) =>
  `${scenicName}内部服务设施“${facilityName}”，类别为${category}，由景区统一模板实例化生成。`;

const buildFoodDescription = (scenicName: string, facilityName: string) =>
  `${scenicName}内部餐饮点，依附于${facilityName}。`;

const buildPhotoDescription = (scenicName: string, attractionName: string) =>
  `${scenicName}内部摄影打卡点，位于${attractionName}附近。`;

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
  if (template.attractions.length !== attractionDefinitions.length) {
    throw new Error(`Attraction template count mismatch: ${template.attractions.length} != ${attractionDefinitions.length}`);
  }
  if (template.facilities.length !== facilityDefinitions.length) {
    throw new Error(`Facility template count mismatch: ${template.facilities.length} != ${facilityDefinitions.length}`);
  }

  const db = new sqlite3.Database(DB_PATH);

  try {
    const scenicAreas = await all<ScenicAreaRow>(
      db,
      `select id, name, city, latitude, longitude from scenic_areas where category = (${scenicCategorySql}) order by rowid`,
    );

    if (!scenicAreas.length) {
      throw new Error('No scenic areas found. Cannot apply scenic template.');
    }

    const beforeCounts = await get<CountSummary>(db, countsSql);

    await run(db, 'BEGIN TRANSACTION');
    await run(
      db,
      `delete from foods where facilityId in (select id from facilities where scenicAreaId in (${scenicIdsSql}))`,
    );
    await run(db, `delete from photo_spots where scenicAreaId in (${scenicIdsSql})`);
    await run(db, `delete from road_graph_edges where scenicAreaId in (${scenicIdsSql})`);
    await run(db, `delete from road_graph_nodes where scenicAreaId in (${scenicIdsSql})`);
    await run(db, `delete from attractions where scenicAreaId in (${scenicIdsSql})`);
    await run(db, `delete from facilities where scenicAreaId in (${scenicIdsSql})`);

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
      scenicAreas: scenicAreas.length,
      attractions: 0,
      facilities: 0,
      foods: 0,
      photo_spots: 0,
      road_graph_nodes: 0,
      road_graph_edges: 0,
    };

    for (const scenic of scenicAreas) {
      const attractionIdMap = new Map<string, string>();
      const attractionNameMap = new Map<string, string>();
      const facilityIdMap = new Map<string, string>();
      const facilityNameMap = new Map<string, string>();
      const roadNodeIdMap = new Map<string, string>();

      for (let index = 0; index < template.attractions.length; index += 1) {
        const point = template.attractions[index];
        const definition = attractionDefinitions[index];
        const newId = uuidv4();
        const coordinate = transformCoordinate(point.latitude, point.longitude, scenic);

        attractionIdMap.set(point.id, newId);
        attractionNameMap.set(point.id, definition.name);

        await runStatement(insertAttraction, [
          newId,
          scenic.id,
          definition.name,
          definition.type,
          definition.category,
          scenic.city,
          buildAttractionDescription(scenic.name, definition.name, definition.theme),
          coordinate.latitude,
          coordinate.longitude,
          '{}',
          4.6,
          180 + index,
          35,
          1,
          JSON.stringify(['景区', definition.category, definition.theme]),
          '{}',
        ]);
        insertedSummary.attractions += 1;
      }

      for (let index = 0; index < template.facilities.length; index += 1) {
        const point = template.facilities[index];
        const definition = facilityDefinitions[index];
        const newId = uuidv4();
        const coordinate = transformCoordinate(point.latitude, point.longitude, scenic);

        facilityIdMap.set(point.id, newId);
        facilityNameMap.set(point.id, definition.name);

        await runStatement(insertFacility, [
          newId,
          scenic.id,
          definition.name,
          definition.category,
          coordinate.latitude,
          coordinate.longitude,
          '{}',
          buildFacilityDescription(scenic.name, definition.name, definition.category),
        ]);
        insertedSummary.facilities += 1;
      }

      let foodIndex = 0;
      for (let index = 0; index < template.facilities.length; index += 1) {
        if (foodIndex >= 20) {
          break;
        }

        const point = template.facilities[index];
        const definition = facilityDefinitions[index];
        const facilityId = facilityIdMap.get(point.id);
        const facilityName = facilityNameMap.get(point.id);
        const cuisinePool = foodCategoryPool[definition.category];

        if (!facilityId || !facilityName || !cuisinePool) {
          continue;
        }

        foodIndex += 1;
        const cuisine = cuisinePool[(foodIndex - 1) % cuisinePool.length];

        await runStatement(insertFood, [
          uuidv4(),
          `景区餐饮-${pad2(foodIndex)}`,
          facilityId,
          cuisine,
          20 + foodIndex,
          buildFoodDescription(scenic.name, facilityName),
          80 + foodIndex * 4,
          4.4,
          40 + foodIndex,
          JSON.stringify(['景区餐饮', cuisine]),
          0,
        ]);
        insertedSummary.foods += 1;
      }

      let photoIndex = 0;
      for (let index = 0; index < template.attractions.length; index += 1) {
        if (photoIndex >= 6) {
          break;
        }

        const point = template.attractions[index];
        const attractionId = attractionIdMap.get(point.id);
        const attractionName = attractionNameMap.get(point.id);
        if (!attractionId || !attractionName) {
          continue;
        }

        photoIndex += 1;
        const coordinate = transformCoordinate(point.latitude, point.longitude, scenic);

        await runStatement(insertPhotoSpot, [
          uuidv4(),
          scenic.id,
          attractionId,
          `${attractionName}-摄影点-${pad2(photoIndex)}`,
          buildPhotoDescription(scenic.name, attractionName),
          coordinate.latitude,
          coordinate.longitude,
          bestTimePool[(photoIndex - 1) % bestTimePool.length],
          90 + photoIndex * 5,
          'medium',
          'good',
          '[]',
        ]);
        insertedSummary.photo_spots += 1;
      }

      for (let index = 0; index < template.roadNetwork.nodes.length; index += 1) {
        const node = template.roadNetwork.nodes[index];
        const newId = uuidv4();
        const coordinate = transformCoordinate(node.latitude, node.longitude, scenic);

        roadNodeIdMap.set(node.id, newId);

        await runStatement(insertRoadNode, [
          newId,
          scenic.id,
          'junction',
          `${scenic.name}-路网节点-${pad4(index + 1)}`,
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

        const isElectricCartRoute = edge.roadType === 'bicycle_path';
        const allowedTransportation = isElectricCartRoute ? ['walk', 'electric_cart'] : ['walk'];
        const transportation = isElectricCartRoute ? 'electric_cart' : 'walk';

        await runStatement(insertRoadEdge, [
          uuidv4(),
          scenic.id,
          fromNodeId,
          toNodeId,
          edge.distance,
          edge.roadType,
          1,
          JSON.stringify(allowedTransportation),
          isElectricCartRoute ? 1 : 0,
          0,
          transportation,
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
