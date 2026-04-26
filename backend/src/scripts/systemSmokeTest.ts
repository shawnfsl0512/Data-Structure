import { initializeDatabase, AppDataSource } from '../config/database';
import { RecommendationService } from '../services/RecommendationService';
import { PathPlanningService } from '../services/PathPlanningService';
import { QueryService } from '../services/QueryService';
import { DiaryService } from '../services/DiaryService';
import { SocialService } from '../services/SocialService';
import { FoodService } from '../services/FoodService';
import { User } from '../entities/User';
import { Attraction } from '../entities/Attraction';
import { ScenicArea } from '../entities/ScenicArea';

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureSeedUser(): Promise<User> {
  if (!AppDataSource || !AppDataSource.isInitialized) {
    throw new Error('Database not initialized');
  }
  const repo = AppDataSource.getRepository(User);
  const existing = await repo.find({ take: 1, order: { createdAt: 'ASC' } });
  if (existing[0]) {
    return existing[0];
  }
  const now = Date.now();
  const created = repo.create({
    username: `测试用户${String(now).slice(-6)}`,
    email: `smoke_${now}@travel.local`,
    passwordHash: 'smoke',
    interests: [],
    interestWeights: {},
  });
  return repo.save(created);
}

async function ensureAttractionId(): Promise<string | undefined> {
  if (!AppDataSource || !AppDataSource.isInitialized) {
    return undefined;
  }
  const repo = AppDataSource.getRepository(Attraction);
  const found = await repo.find({ take: 1, order: { createdAt: 'DESC' } });
  return found[0]?.id;
}

async function ensureScenicAreaId(): Promise<string | undefined> {
  if (!AppDataSource || !AppDataSource.isInitialized) {
    return undefined;
  }
  const repo = AppDataSource.getRepository(ScenicArea);
  const found = await repo.find({ take: 1, order: { createdAt: 'DESC' } });
  return found[0]?.id;
}

async function run() {
  await initializeDatabase();

  const recommendationService = new RecommendationService();
  const pathPlanningService = new PathPlanningService();
  const queryService = new QueryService();
  const diaryService = new DiaryService();
  const socialService = new SocialService();
  const foodService = new FoodService();

  const user = await ensureSeedUser();
  const scenicAreaId = await ensureScenicAreaId();
  const attractionId = await ensureAttractionId();

  try {
    const ranking = await recommendationService.getPopularityRanking(5);
    assert(Array.isArray(ranking.items), '????????');
    record('????-???', true, `?? ${ranking.items.length} ?`);
  } catch (error: any) {
    record('推荐服务-热度榜', false, error.message);
  }

  try {
    await pathPlanningService.initializeRoadGraph();
    const roadNetwork = await pathPlanningService.getRoadNetwork();
    assert(Array.isArray(roadNetwork.nodes), '路网节点格式错误');
    assert(Array.isArray(roadNetwork.edges), '路网边格式错误');
    record('路径规划-路网加载', true, `节点 ${roadNetwork.nodes.length} / 边 ${roadNetwork.edges.length}`);

    if (roadNetwork.nodes.length >= 2) {
      const startNodeId = roadNetwork.nodes[0].id;
      const endNodeId = roadNetwork.nodes[Math.min(3, roadNetwork.nodes.length - 1)].id;
      const path = await pathPlanningService.getShortestTimePath(startNodeId, endNodeId);
      assert(Array.isArray(path.path) && path.path.length >= 2, '最短时间路径结果异常');
      record('路径规划-最短时间', true, `距离 ${path.distance} 米 / 用时 ${path.time} 分钟`);
    } else {
      record('路径规划-最短时间', true, '节点不足，跳过路径计算');
    }
  } catch (error: any) {
    record('路径规划', false, error.message);
  }

  try {
    const scenicResult = await queryService.searchScenicAreas('景', 5);
    assert(Array.isArray(scenicResult), '景区查询结果不是数组');
    record('查询服务-景区检索', true, `返回 ${scenicResult.length} 条`);
  } catch (error: any) {
    record('查询服务-景区检索', false, error.message);
  }

  let createdDiaryId: string | undefined;
  try {
    const diary = await diaryService.createDiary({
      userId: user.id,
      title: '系统冒烟测试日记',
      content: '今天完成了系统测试，路径与推荐功能正常。',
      destination: scenicAreaId || '测试景区',
      isShared: true,
      route: [],
    });
    createdDiaryId = diary.id;
    const search = await diaryService.searchDiaries('系统测试', 5);
    assert(Array.isArray(search), '日记搜索结果不是数组');
    record('日记服务-创建与检索', true, `创建 ${diary.id}，检索 ${search.length} 条`);
  } catch (error: any) {
    record('日记服务-创建与检索', false, error.message);
  }

  try {
    const trending = await socialService.getTrending(scenicAreaId, 5);
    assert(Array.isArray(trending.attractions), '社交热点景点格式错误');
    assert(Array.isArray(trending.topics), '社交热点话题格式错误');
    record('社交服务-热点', true, `景点 ${trending.attractions.length} / 话题 ${trending.topics.length}`);

    const nearby = await socialService.getNearbyUsers(39.9042, 116.4074, 500, 10, user.id);
    assert(Array.isArray(nearby), '附近游客结果不是数组');
    record('社交服务-附近游客', true, `返回 ${nearby.length} 条`);

    if (attractionId) {
      const checkin = await socialService.checkIn(user.id, {
        attractionId,
        text: '系统冒烟测试签到',
      });
      assert(!!checkin.id, '签到结果缺少 id');
      record('社交服务-签到', true, `签到记录 ${checkin.id}`);
    } else {
      record('社交服务-签到', true, '无景点数据，跳过签到');
    }
  } catch (error: any) {
    record('社交服务', false, error.message);
  }

  try {
    if (scenicAreaId) {
      const foodMap = await foodService.getFoodMap(scenicAreaId);
      assert(Array.isArray(foodMap.facilities), '美食地图设施格式错误');
      record('美食服务-地图', true, `设施 ${foodMap.facilities.length}`);
    } else {
      record('美食服务-地图', true, '无景区数据，跳过');
    }
  } catch (error: any) {
    record('美食服务-地图', false, error.message);
  }

  if (createdDiaryId) {
    try {
      await diaryService.deleteDiary(createdDiaryId);
    } catch {
      // ignore cleanup errors
    }
  }

  console.log('== 系统冒烟测试结果 ==');
  for (const item of results) {
    console.log(`${item.ok ? '✅' : '❌'} ${item.name}${item.detail ? ` -> ${item.detail}` : ''}`);
  }
  const failed = results.filter((item) => !item.ok);
  console.log(`汇总：${results.length - failed.length}/${results.length} 通过`);

  if (AppDataSource?.isInitialized) {
    await AppDataSource.destroy();
  }

  if (failed.length) {
    process.exit(1);
  }
}

run().catch(async (error) => {
  console.error('系统冒烟测试执行失败:', error);
  if (AppDataSource?.isInitialized) {
    await AppDataSource.destroy();
  }
  process.exit(1);
});
