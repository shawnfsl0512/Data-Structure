import { In, Like } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Food } from '../entities/Food';
import { Facility } from '../entities/Facility';
import cache from '../config/cache';
import { mapTemplateRuntimeService } from './MapTemplateRuntimeService';

// 获取仓库
function getFoodRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(Food);
}

function getFacilityRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(Facility);
}

// 简单的最小堆实现
class MinHeap<T> {
  private heap: T[];
  private compare: (a: T, b: T) => number;
  private limit: number;

  constructor(limit: number, compare: (a: T, b: T) => number) {
    this.heap = [];
    this.limit = limit;
    this.compare = compare;
  }

  insert(item: T): void {
    if (this.heap.length < this.limit) {
      this.heap.push(item);
      this.bubbleUp(this.heap.length - 1);
    } else if (this.compare(item, this.heap[0]) > 0) {
      this.heap[0] = item;
      this.bubbleDown(0);
    }
  }

  getTopK(): T[] {
    return [...this.heap].sort((a, b) => this.compare(b, a));
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.compare(this.heap[index], this.heap[parentIndex]) >= 0) break;
      [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    while (true) {
      let minIndex = index;
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;

      if (leftChild < this.heap.length && this.compare(this.heap[leftChild], this.heap[minIndex]) < 0) {
        minIndex = leftChild;
      }
      if (rightChild < this.heap.length && this.compare(this.heap[rightChild], this.heap[minIndex]) < 0) {
        minIndex = rightChild;
      }

      if (minIndex === index) break;
      [this.heap[index], this.heap[minIndex]] = [this.heap[minIndex], this.heap[index]];
      index = minIndex;
    }
  }
}

export class FoodService {
  async getFoodMap(scenicAreaId: string): Promise<{
    facilities: Array<{
      id: string;
      name: string;
      category: string;
      location: { latitude: number; longitude: number };
      foods: Food[];
    }>;
  }> {
    const facilityRepository = getFacilityRepository();
    const foodRepository = getFoodRepository();

    const facilities = await facilityRepository.find({
      where: { scenicAreaId }
    });

    let runtimeFoods: Food[] = [];
    let effectiveFacilities = facilities;
    let foods: Food[] = [];

    if (facilities.length === 0) {
      const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId);
      if (!runtimeMap) {
        return { facilities: [] };
      }
      effectiveFacilities = runtimeMap.facilities;
      runtimeFoods = runtimeMap.foods;
      foods = runtimeFoods;
    } else {
      const facilityIds = facilities.map(facility => facility.id);
      foods = await foodRepository.find({
        where: { facilityId: In(facilityIds) },
        relations: ['facility']
      });
      if (!foods.length) {
        const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId);
        if (runtimeMap) {
          const allowedIds = new Set(effectiveFacilities.map((facility) => facility.id));
          runtimeFoods = runtimeMap.foods.filter((food) => allowedIds.has(food.facilityId));
          foods = runtimeFoods;
        }
      }
    }

    const foodsByFacility = new Map<string, Food[]>();
    for (const food of foods) {
      const list = foodsByFacility.get(food.facilityId) || [];
      list.push(food);
      foodsByFacility.set(food.facilityId, list);
    }

    return {
      facilities: effectiveFacilities.map(facility => ({
        id: facility.id,
        name: facility.name,
        category: facility.category || 'facility',
        location: {
          latitude: Number(facility.latitude || 0),
          longitude: Number(facility.longitude || 0)
        },
        foods: foodsByFacility.get(facility.id) || []
      }))
    };
  }
  // 获取美食推荐
  async getFoodRecommendations(scenicAreaId: string, limit: number = 10, cuisine?: string): Promise<Food[]> {
    const cacheKey = `food_recommendations_${scenicAreaId}_${limit}_${cuisine || 'all'}`;
    
    // 尝试从缓存获取
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }
    
    const foodRepository = getFoodRepository();
    const facilityRepository = getFacilityRepository();

    // 获取景区内的所有设施
    const facilities = await facilityRepository.find({
      where: { scenicAreaId }
    });

    const facilityIds = facilities.map(facility => facility.id);

    if (facilityIds.length === 0) {
      const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId);
      if (!runtimeMap) {
        return [];
      }
      const filtered = cuisine
        ? runtimeMap.foods.filter((food) => food.cuisine === cuisine)
        : runtimeMap.foods;
      return filtered
        .sort((a, b) => this.calculateFoodScore(b) - this.calculateFoodScore(a))
        .slice(0, limit);
    }

    // 查询条件
    const whereCondition: any = {
      facilityId: In(facilityIds)
    };

    // 按菜系筛选
    if (cuisine) {
      whereCondition.cuisine = cuisine;
    }

    // 获取所有符合条件的美食
    const allFoods = await foodRepository.find({
      where: whereCondition,
      relations: ['facility']
    });

    if (!allFoods.length) {
      const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId);
      if (!runtimeMap) {
        return [];
      }
      const allowedIds = new Set(facilityIds);
      const filtered = runtimeMap.foods.filter((food) => allowedIds.has(food.facilityId) && (!cuisine || food.cuisine === cuisine));
      return filtered
        .sort((a, b) => this.calculateFoodScore(b) - this.calculateFoodScore(a))
        .slice(0, limit);
    }

    // 使用最小堆进行Top-K推荐
    const minHeap = new MinHeap<{ score: number; food: Food }>(limit, (a, b) => a.score - b.score);

    // 计算推荐分数
    for (const food of allFoods) {
      const score = this.calculateFoodScore(food);
      minHeap.insert({ score, food });
    }

    // 提取结果
    const recommendations = minHeap.getTopK().map(item => item.food);
    
    // 缓存结果，设置5分钟过期
    cache.set(cacheKey, recommendations, 5 * 60 * 1000);

    return recommendations;
  }

  // 模糊搜索美食
  async fuzzySearchFood(keyword: string, scenicAreaId: string, limit: number = 10): Promise<Food[]> {
    const foodRepository = getFoodRepository();
    const facilityRepository = getFacilityRepository();

    // 获取景区内的所有设施
    const facilities = await facilityRepository.find({
      where: { scenicAreaId }
    });

    const facilityIds = facilities.map(facility => facility.id);

    if (facilityIds.length === 0) {
      const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId);
      if (!runtimeMap) {
        return [];
      }
      return runtimeMap.foods
        .filter((food) => food.name.includes(keyword))
        .slice(0, limit);
    }

    // 搜索条件
    const foods = await foodRepository.find({
      where: {
        facilityId: In(facilityIds),
        name: Like(`%${keyword}%`)
      },
      relations: ['facility'],
      take: limit
    });

    if (!foods.length) {
      const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId);
      if (!runtimeMap) {
        return [];
      }
      const allowedIds = new Set(facilityIds);
      return runtimeMap.foods
        .filter((food) => allowedIds.has(food.facilityId) && food.name.includes(keyword))
        .slice(0, limit);
    }

    return foods;
  }

  // 计算美食推荐分数
  private calculateFoodScore(food: Food): number {
    let score = 0;

    // 热度占30%
    score += (food.popularity || 0) / 1000 * 0.3;

    // 评分占40%
    score += (food.averageRating || 0) * 0.4;

    // 评价数量占20%
    score += (food.reviewCount || 0) / 100 * 0.2;

    // 季节性特色占10%
    if (food.isSeasonalSpecial) {
      score += 0.1;
    }

    return score;
  }

  // 获取所有菜系
  async getAllCuisines(scenicAreaId: string): Promise<string[]> {
    const cacheKey = `food_cuisines_${scenicAreaId}`;
    
    // 尝试从缓存获取
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }
    
    const foodRepository = getFoodRepository();
    const facilityRepository = getFacilityRepository();

    // 获取景区内的所有设施
    const facilities = await facilityRepository.find({
      where: { scenicAreaId }
    });

    const facilityIds = facilities.map(facility => facility.id);

    if (facilityIds.length === 0) {
      const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId);
      if (!runtimeMap) {
        return [];
      }
      return Array.from(new Set(runtimeMap.foods.map((food) => String(food.cuisine || '').trim()).filter(Boolean)));
    }

    // 查询所有菜系
    const foods = await foodRepository.find({
      where: { facilityId: In(facilityIds) },
      select: ['cuisine']
    });

    if (!foods.length) {
      const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId);
      if (!runtimeMap) {
        return [];
      }
      return Array.from(new Set(runtimeMap.foods.map((food) => String(food.cuisine || '').trim()).filter(Boolean)));
    }

    // 去重并过滤空值
    const cuisines = [...new Set(foods.map(food => food.cuisine).filter(Boolean))];
    
    // 缓存结果，设置10分钟过期
    cache.set(cacheKey, cuisines, 10 * 60 * 1000);

    return cuisines;
  }
}
