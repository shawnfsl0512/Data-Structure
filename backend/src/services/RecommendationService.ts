import { AppDataSource, In } from '../config/database';
import { ScenicArea } from '../entities/ScenicArea';
import { UserBehavior } from '../entities/UserBehavior';
import { User } from '../entities/User';
import { Food } from '../entities/Food';
import { Diary } from '../entities/Diary';
import { Attraction } from '../entities/Attraction';
import { Facility } from '../entities/Facility';
import { PhotoSpot } from '../entities/PhotoSpot';
import cache from '../config/cache';
import { CITY_SCENIC_COORDINATE_OVERRIDES, CITY_TRAVEL_ANCHORS, CoordinatePoint } from '../data/cityTravelCoordinates';
import { resolveScenicPresentation, ScenicPresentation } from '../utils/scenicPresentation';

// 获取仓库
function getScenicAreaRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(ScenicArea);
}

function getUserBehaviorRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(UserBehavior);
}

function getUserRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(User);
}

function getFoodRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(Food);
}

function getDiaryRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(Diary);
}

function getAttractionRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(Attraction);
}

function getFacilityRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(Facility);
}

function getPhotoSpotRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(PhotoSpot);
}

export type CityTravelTheme =
  | 'comprehensive'
  | 'foodie'
  | 'photographer'
  | 'culture'
  | 'nature'
  | 'relaxation'
  | 'personalized';

export interface CityDestinationOption {
  cityLabel: string;
  scenicCount: number;
  averageRating: number;
  averagePopularity: number;
  center: { latitude: number; longitude: number };
  coverImageUrl: string;
  coverImageTheme: string;
  featuredScenicAreas: Array<{
    id: string;
    name: string;
    category: string;
    latitude: number | null;
    longitude: number | null;
    averageRating: number;
    popularity: number;
  }>;
}

export interface CityItineraryStop {
  id: string;
  scenicAreaId: string;
  scenicAreaName: string;
  day: number;
  order: number;
  latitude: number;
  longitude: number;
  averageRating: number;
  popularity: number;
  coverImageUrl: string;
  coverImageTheme: string;
  cityLabel: string;
  reason: string;
  highlightTags: string[];
}

export interface CityItineraryDay {
  day: number;
  title: string;
  estimatedDistanceKm: number;
  estimatedTimeMinutes: number;
  stops: CityItineraryStop[];
}

export interface CityItinerarySegment {
  id: string;
  day: number;
  order: number;
  fromStopId: string;
  toStopId: string;
  points: Array<{ latitude: number; longitude: number }>;
  color: string;
  label: string;
}

export interface CityTravelItinerary {
  cityLabel: string;
  theme: CityTravelTheme;
  tripDays: number;
  center: { latitude: number; longitude: number };
  days: CityItineraryDay[];
  segments: CityItinerarySegment[];
  legend: Array<{ id: string; label: string; color: string }>;
  summary: {
    totalStops: number;
    cityScenicCount: number;
    variationSignals: string[];
  };
}

export interface AttractionRecommendationItem {
  id: string;
  name: string;
  baseHeat: number;
  averageRating: number;
  tags: string[];
  distanceKm: number;
  scenicAreaId?: string;
  category?: string;
  type?: string;
  latitude?: number | null;
  longitude?: number | null;
  sourceAttraction?: Attraction;
}

export interface RecommendationUserProfile {
  id: string;
  interestWeights: Record<string, number>;
}

export interface ScoredAttractionRecommendation extends AttractionRecommendationItem {
  score: number;
  tagMatchScore: number;
}

export type ScenicRankingMode = 'popularity' | 'rating' | 'review' | 'personalized';

export interface ScenicRankingMeta {
  mode: ScenicRankingMode;
  fallbackMode?: 'popularity';
  reason?: 'guest_fallback' | 'interest_required' | 'no_interest_match';
  city?: string | null;
  appliedCityFilter: boolean;
  matchedCount?: number;
}

export interface ScenicRankingResult {
  items: ScenicArea[];
  meta: ScenicRankingMeta;
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

  extract(): T | undefined {
    if (this.heap.length === 0) return undefined;
    if (this.heap.length === 1) return this.heap.pop();

    const top = this.heap[0];
    this.heap[0] = this.heap.pop()!;
    this.bubbleDown(0);
    return top;
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
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

export class RecommendationService {
  private presentScenicArea<T extends ScenicArea>(area: T): T & ScenicPresentation {
    return {
      ...area,
      ...resolveScenicPresentation(area),
    };
  }

  private presentScenicAreas<T extends ScenicArea>(areas: T[]): Array<T & ScenicPresentation> {
    return areas.map((area) => this.presentScenicArea(area));
  }

  buildRecommendationUserProfile(user: User): RecommendationUserProfile {
    return {
      id: user.id,
      interestWeights: this.normalizeInterestWeights(user.interestWeights),
    };
  }

  buildAttractionRecommendationItem(
    attraction: Attraction,
    distanceKm: number = 0,
  ): AttractionRecommendationItem {
    const baseHeat = this.resolveAttractionBaseHeat(attraction);
    attraction.baseHeat = baseHeat;

    return {
      id: attraction.id,
      name: attraction.name,
      baseHeat,
      averageRating: Number(attraction.averageRating || 0),
      tags: this.normalizeAttractionTags(attraction),
      distanceKm: Number.isFinite(distanceKm) && distanceKm >= 0 ? Number(distanceKm.toFixed(3)) : 0,
      scenicAreaId: attraction.scenicAreaId,
      category: attraction.category || '',
      type: attraction.type || '',
      latitude: attraction.latitude,
      longitude: attraction.longitude,
      sourceAttraction: attraction,
    };
  }

  calculateScore(attraction: AttractionRecommendationItem, distanceKm: number = attraction.distanceKm): number {
    const normalizedHeat = this.clamp((attraction.baseHeat - 2000) / 6000, 0, 1);
    const normalizedRating = this.clamp(attraction.averageRating / 5, 0, 1);
    const safeDistance = Number.isFinite(distanceKm) && distanceKm >= 0 ? distanceKm : 0;
    const distanceScore = 1 / (1 + safeDistance);

    const score = normalizedHeat * 0.4 + normalizedRating * 0.35 + distanceScore * 0.25;
    return Number((score * 100).toFixed(4));
  }

  getTopKRecommendations(
    attractions: AttractionRecommendationItem[],
    k: number,
    user: RecommendationUserProfile,
  ): ScoredAttractionRecommendation[] {
    if (!Array.isArray(attractions) || attractions.length === 0 || k <= 0) {
      return [];
    }

    const safeK = Math.max(1, Math.floor(k));
    const profile = {
      id: user.id,
      interestWeights: this.normalizeInterestWeights(user.interestWeights),
    };
    const minHeap = new MinHeap<{ score: number; tagMatchScore: number; item: AttractionRecommendationItem }>(
      safeK,
      (left, right) => left.score - right.score,
    );

    attractions.forEach((attraction) => {
      const baseScore = this.calculateScore(attraction, attraction.distanceKm);
      const tagMatchScore = this.calculateTagMatchScore(attraction.tags, profile.interestWeights);
      const score = Number((baseScore + tagMatchScore * 20).toFixed(4));
      minHeap.insert({ score, tagMatchScore, item: attraction });
    });

    return minHeap
      .getTopK()
      .map(({ item, score, tagMatchScore }) => ({
        ...item,
        score,
        tagMatchScore,
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.tagMatchScore - left.tagMatchScore ||
          right.baseHeat - left.baseHeat ||
          right.averageRating - left.averageRating,
      );
  }

  recommendByTags(
    attractions: AttractionRecommendationItem[],
    user: RecommendationUserProfile,
    limit: number = 10,
  ): ScoredAttractionRecommendation[] {
    if (!Array.isArray(attractions) || attractions.length === 0 || limit <= 0) {
      return [];
    }

    const profile = {
      id: user.id,
      interestWeights: this.normalizeInterestWeights(user.interestWeights),
    };

    const scored = attractions.map((attraction) => {
      const tagMatchScore = this.calculateTagMatchScore(attraction.tags, profile.interestWeights);
      const heatScore = this.clamp((attraction.baseHeat - 2000) / 6000, 0, 1);
      return {
        ...attraction,
        tagMatchScore,
        score: Number((tagMatchScore * 70 + heatScore * 30).toFixed(4)),
      };
    });

    const matched = scored.filter((item) => item.tagMatchScore > 0);
    const source = matched.length > 0 ? matched : scored;

    return source
      .sort(
        (left, right) =>
          right.tagMatchScore - left.tagMatchScore ||
          right.baseHeat - left.baseHeat ||
          right.averageRating - left.averageRating,
      )
      .slice(0, Math.max(1, Math.floor(limit)));
  }

  async getTopKAttractionRecommendations(
    userId: string,
    k: number = 10,
    referencePoint?: { latitude: number; longitude: number },
  ): Promise<ScoredAttractionRecommendation[]> {
    const userRepository = getUserRepository();
    const attractionRepository = getAttractionRepository();

    const [user, attractions] = await Promise.all([
      userRepository.findOne({ where: { id: userId } }),
      attractionRepository.find({ take: 5000 }),
    ]);

    if (!user) {
      throw new Error('User not found');
    }

    const mappedAttractions = attractions.map((attraction) =>
      this.buildAttractionRecommendationItem(
        attraction,
        this.resolveAttractionDistanceKm(attraction, referencePoint),
      ),
    );

    return this.getTopKRecommendations(mappedAttractions, k, this.buildRecommendationUserProfile(user));
  }

  async getTagBasedAttractionRecommendations(
    userId: string,
    limit: number = 10,
  ): Promise<ScoredAttractionRecommendation[]> {
    const userRepository = getUserRepository();
    const attractionRepository = getAttractionRepository();

    const [user, attractions] = await Promise.all([
      userRepository.findOne({ where: { id: userId } }),
      attractionRepository.find({ take: 5000 }),
    ]);

    if (!user) {
      throw new Error('User not found');
    }

    const mappedAttractions = attractions.map((attraction) => this.buildAttractionRecommendationItem(attraction));
    return this.recommendByTags(mappedAttractions, this.buildRecommendationUserProfile(user), limit);
  }

  private normalizeCityFilter(city?: string | null): string | null {
    const normalized = String(city || '').trim();
    return normalized ? normalized : null;
  }

  private normalizeScenicAreaTags(area: ScenicArea): string[] {
    const rawTags = area.tags as unknown;
    if (Array.isArray(rawTags)) {
      return Array.from(new Set(rawTags.map((item) => String(item || '').trim()).filter(Boolean)));
    }

    const text = String(rawTags || '').trim();
    if (!text) {
      return [];
    }

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map((item) => String(item || '').trim()).filter(Boolean)));
      }
    } catch {
      // Ignore and fall back to delimiter parsing.
    }

    return Array.from(
      new Set(
        text
          .replace(/^\[|\]$/g, '')
          .split(/[,\uFF0C|]/)
          .map((item) => item.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean),
      ),
    );
  }

  private getScenicAreaMetric(area: ScenicArea, mode: Exclude<ScenicRankingMode, 'personalized'>): number {
    if (mode === 'rating') {
      return Number(area.averageRating || area.rating || 0);
    }
    if (mode === 'review') {
      return Number(area.reviewCount || 0);
    }
    return Number(area.popularity || 0);
  }

  private filterScenicAreasByCity(areas: ScenicArea[], city?: string | null): ScenicArea[] {
    const normalizedCity = this.normalizeCityFilter(city);
    if (!normalizedCity) {
      return areas;
    }

    return areas.filter((area) => String(area.city || '').trim() === normalizedCity);
  }

  private pickTopKScenicAreas(
    areas: ScenicArea[],
    k: number,
    compare: (left: ScenicArea, right: ScenicArea) => number,
  ): ScenicArea[] {
    if (!Array.isArray(areas) || areas.length === 0 || k <= 0) {
      return [];
    }

    const safeK = Math.max(1, Math.floor(k));
    const minHeap = new MinHeap<ScenicArea>(safeK, compare);
    areas.forEach((area) => minHeap.insert(area));
    return minHeap.getTopK();
  }

  private buildScenicRankingResult(
    areas: ScenicArea[],
    mode: ScenicRankingMode,
    limit: number,
    city?: string | null,
  ): ScenicRankingResult {
    const normalizedCity = this.normalizeCityFilter(city);
    const filteredAreas = this.filterScenicAreasByCity(areas, normalizedCity);
    const metricMode = mode === 'personalized' ? 'popularity' : mode;
    const topAreas = this.pickTopKScenicAreas(filteredAreas, limit, (left, right) => {
      const metricDiff = this.getScenicAreaMetric(left, metricMode) - this.getScenicAreaMetric(right, metricMode);
      if (metricDiff !== 0) {
        return metricDiff;
      }
      return Number(left.popularity || 0) - Number(right.popularity || 0);
    });

    return {
      items: this.presentScenicAreas(topAreas),
      meta: {
        mode,
        city: normalizedCity,
        appliedCityFilter: Boolean(normalizedCity),
      },
    };
  }

  private buildPopularityFallbackResult(
    areas: ScenicArea[],
    limit: number,
    city: string | null,
    reason: ScenicRankingMeta['reason'],
  ): ScenicRankingResult {
    const base = this.buildScenicRankingResult(areas, 'popularity', limit, city);
    return {
      items: base.items,
      meta: {
        ...base.meta,
        mode: 'personalized',
        fallbackMode: 'popularity',
        reason,
      },
    };
  }

  private getUserInterestTags(user: User | null | undefined): string[] {
    return Array.from(new Set(this.normalizeUserInterests(user?.interests || [])));
  }

  private matchScenicAreasByUserInterests(areas: ScenicArea[], interests: string[]): ScenicArea[] {
    if (!interests.length) {
      return [];
    }

    const interestSet = new Set(interests.map((item) => String(item || '').trim()).filter(Boolean));
    return areas.filter((area) => this.normalizeScenicAreaTags(area).some((tag) => interestSet.has(tag)));
  }

  // 热度榜
  async getPopularityRanking(limit: number = 10, city?: string | null): Promise<ScenicRankingResult> {
    const cacheKey = 'popularity_ranking_all';
    
    // 尝试从缓存获取
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return this.buildScenicRankingResult(cachedResult as ScenicArea[], 'popularity', limit, city);
    }
    
    const scenicAreaRepository = getScenicAreaRepository();
    // 按照访问量排序
    const topAreas = await scenicAreaRepository.find({
      order: { popularity: 'DESC' },
    });
    
    // 缓存结果，设置10分钟过期
    cache.set(cacheKey, topAreas, 10 * 60 * 1000);
    
    return this.buildScenicRankingResult(topAreas, 'popularity', limit, city);
  }

  // 评分榜
  async getRatingRanking(limit: number = 10, city?: string | null): Promise<ScenicRankingResult> {
    const cacheKey = 'rating_ranking_all';
    
    // 尝试从缓存获取
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return this.buildScenicRankingResult(cachedResult as ScenicArea[], 'rating', limit, city);
    }
    
    const scenicAreaRepository = getScenicAreaRepository();
    // 按照评分排序
    const topAreas = await scenicAreaRepository.find({
      order: { averageRating: 'DESC' },
    });
    
    // 缓存结果，设置10分钟过期
    cache.set(cacheKey, topAreas, 10 * 60 * 1000);
    
    return this.buildScenicRankingResult(topAreas, 'rating', limit, city);
  }

  // 评价榜
  async getReviewRanking(limit: number = 10, city?: string | null): Promise<ScenicRankingResult> {
    const cacheKey = 'review_ranking_all';
    
    // 尝试从缓存获取
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return this.buildScenicRankingResult(cachedResult as ScenicArea[], 'review', limit, city);
    }
    
    const scenicAreaRepository = getScenicAreaRepository();
    // 按照评价数量排序
    const topAreas = await scenicAreaRepository.find({
      order: { reviewCount: 'DESC' },
    });
    
    // 缓存结果，设置10分钟过期
    cache.set(cacheKey, topAreas, 10 * 60 * 1000);
    
    return this.buildScenicRankingResult(topAreas, 'review', limit, city);
  }
  // ?????
  async getPersonalizedRanking(userId: string | undefined, limit: number = 10, city?: string | null): Promise<ScenicRankingResult> {
    const userRepository = getUserRepository();
    const scenicAreaRepository = getScenicAreaRepository();

    const normalizedCity = this.normalizeCityFilter(city);
    const [user, allScenicAreas] = await Promise.all([
      userId ? userRepository.findOne({ where: { id: userId } }) : Promise.resolve(null),
      scenicAreaRepository.find(),
    ]);

    if (!user) {
      return this.buildPopularityFallbackResult(allScenicAreas, limit, normalizedCity, 'guest_fallback');
    }

    const candidateAreas = this.filterScenicAreasByCity(allScenicAreas, normalizedCity).filter(
      (area) => !(user.favorites && user.favorites.includes(area.id)),
    );
    const interests = this.getUserInterestTags(user);

    if (!interests.length) {
      return this.buildPopularityFallbackResult(candidateAreas, limit, normalizedCity, 'interest_required');
    }

    const matchedAreas = this.matchScenicAreasByUserInterests(candidateAreas, interests);
    if (!matchedAreas.length) {
      return {
        items: [],
        meta: {
          mode: 'personalized',
          city: normalizedCity,
          appliedCityFilter: Boolean(normalizedCity),
          reason: 'no_interest_match',
          matchedCount: 0,
        },
      };
    }

    const base = this.buildScenicRankingResult(matchedAreas, 'popularity', limit, normalizedCity);
    return {
      items: base.items,
      meta: {
        mode: 'personalized',
        city: normalizedCity,
        appliedCityFilter: Boolean(normalizedCity),
        matchedCount: matchedAreas.length,
      },
    };
  }

  // 基于用户行为的个性化推荐
  async getPersonalizedRecommendations(userId: string, limit: number = 10): Promise<ScenicArea[]> {
    const userRepository = getUserRepository();
    const userBehaviorRepository = getUserBehaviorRepository();
    const scenicAreaRepository = getScenicAreaRepository();
    // 获取用户信息
    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    // 获取用户行为数据
    const userBehaviors = await userBehaviorRepository.find({
      where: { userId },
      order: { timestamp: 'DESC' },
      take: 50
    });

    // 计算兴趣权重
    const interestScores = await this.calculateInterestScores(user, userBehaviors);

    // 获取所有景区
    const allScenicAreas = await scenicAreaRepository.find();

    // 使用最小堆进行Top-K推荐
    const minHeap = new MinHeap<{ score: number; area: ScenicArea }>(limit, (a, b) => a.score - b.score);

    // 构建推荐列表
    for (const area of allScenicAreas) {
      // 跳过用户已经收藏的景区
      if (user.favorites && user.favorites.includes(area.id)) {
        continue;
      }

      const score = this.calculateRecommendationScore(area, interestScores);
      minHeap.insert({ score, area });
    }

    // 从堆中提取结果
    const recommendations = minHeap.getTopK().map(item => item.area);
    
    return this.presentScenicAreas(recommendations);
  }

  // 增量推荐（基于最近行为）
  async getIncrementalRecommendations(userId: string, limit: number = 5): Promise<ScenicArea[]> {
    const userBehaviorRepository = getUserBehaviorRepository();
    const scenicAreaRepository = getScenicAreaRepository();
    // 获取用户最近的行为
    const recentBehaviors = await userBehaviorRepository.find({
      where: { userId, targetType: 'scenic_area' },
      order: { timestamp: 'DESC' },
      take: 10
    });

    if (recentBehaviors.length === 0) {
      // 如果没有行为数据，返回热门推荐
      return this.getTopAttractions(limit);
    }

    // 获取最近访问的景区
    const recentAreaIds = recentBehaviors.map(b => b.targetId);
    const recentAreas = await scenicAreaRepository.find({
      where: { id: In(recentAreaIds) }
    });

    // 提取最近访问的景区类型
    const recentCategories = new Set<string>();
    for (const area of recentAreas) {
      recentCategories.add(area.category);
    }

    // 基于最近类型推荐
    const recommendations = await scenicAreaRepository.find({
      where: {
        category: In(Array.from(recentCategories))
      },
      order: { rating: 'DESC' },
      take: limit * 2 // 获取更多结果以便过滤
    });

    // 过滤掉用户已经访问过的
    const viewedIds = new Set(recentAreaIds);
    const filteredRecommendations = recommendations.filter(area => !viewedIds.has(area.id));

    return this.presentScenicAreas(filteredRecommendations.slice(0, limit));
  }

  // 学习用户行为
  async learnUserBehavior(userId: string, behavior: {
    itemId: string;
    behaviorType: 'view' | 'favorite' | 'rate' | 'comment';
    category?: string;
    rating?: number;
  }): Promise<void> {
    const userBehaviorRepository = getUserBehaviorRepository();
    // 记录用户行为
    const userBehavior = userBehaviorRepository.create({
      userId,
      behaviorType: behavior.behaviorType,
      targetType: 'scenic_area',
      targetId: behavior.itemId,
      rating: behavior.rating,
      timestamp: new Date()
    });

    await userBehaviorRepository.save(userBehavior);

    // 更新用户兴趣权重
    await this.updateUserInterestWeights(userId);
  }

  // 计算兴趣权重
  private async calculateInterestScores(user: User, behaviors: UserBehavior[]): Promise<Record<string, number>> {
    const scenicAreaRepository = getScenicAreaRepository();
    const scores: Record<string, number> = {
      foodie: user.interestWeights?.foodie || 0,
      photographer: user.interestWeights?.photographer || 0,
      cultureEnthusiast: user.interestWeights?.cultureEnthusiast || 0,
      natureLover: user.interestWeights?.natureLover || 0,
      sportsEnthusiast: user.interestWeights?.sportsEnthusiast || 0,
      relaxationSeeker: user.interestWeights?.relaxationSeeker || 0,
      socialSharer: user.interestWeights?.socialSharer || 0
    };

    // 获取行为相关的景区信息
    const scenicAreaIds = behaviors
      .filter(b => b.targetType === 'scenic_area')
      .map(b => b.targetId);
    
    const scenicAreas = await scenicAreaRepository.find({
      where: { id: In(scenicAreaIds) }
    });
    
    const areaMap = new Map<string, ScenicArea>();
    for (const area of scenicAreas) {
      areaMap.set(area.id, area);
    }

    // 根据行为调整权重
    for (const behavior of behaviors) {
      if (behavior.targetType === 'scenic_area') {
        const area = areaMap.get(behavior.targetId);
        if (area) {
          switch (behavior.behaviorType) {
            case 'view':
              this.adjustInterestScores(scores, area.category, 0.1);
              break;
            case 'favorite':
              this.adjustInterestScores(scores, area.category, 0.5);
              break;
            case 'rate':
              if (behavior.rating && behavior.rating >= 4) {
                this.adjustInterestScores(scores, area.category, 0.8);
              }
              break;
            case 'comment':
              this.adjustInterestScores(scores, area.category, 0.3);
              break;
          }
        }
      }
    }

    return scores;
  }

  // 调整兴趣权重
  private adjustInterestScores(scores: Record<string, number>, category?: string, weight: number = 0.1): void {
    if (!category) return;

    // 根据分类调整对应兴趣权重
    const categoryToInterest: Record<string, string> = {
      '美食': 'foodie',
      '摄影': 'photographer',
      '文化': 'cultureEnthusiast',
      '自然': 'natureLover',
      '运动': 'sportsEnthusiast',
      '休闲': 'relaxationSeeker',
      '社交': 'socialSharer'
    };

    const interest = categoryToInterest[category];
    if (interest) {
      scores[interest] += weight;
    }
  }

  // 计算推荐分数
  private calculateRecommendationScore(area: ScenicArea, interestScores: Record<string, number>): number {
    let score = area.averageRating * 0.5; // 基础分数：评分占50%

    // 根据兴趣权重调整分数
    const categoryToInterest: Record<string, string> = {
      '美食': 'foodie',
      '摄影': 'photographer',
      '文化': 'cultureEnthusiast',
      '自然': 'natureLover',
      '运动': 'sportsEnthusiast',
      '休闲': 'relaxationSeeker',
      '社交': 'socialSharer'
    };

    const interest = categoryToInterest[area.category];
    if (interest) {
      score += (interestScores[interest] || 0) * 0.3; // 兴趣权重占30%
    }

    // 热门程度占20%
    score += (area.popularity || 0) / 10000 * 0.2;

    return score;
  }

  // 计算个人化推荐分数
  private calculatePersonalizedScore(area: ScenicArea, user: User): number {
    let score = 0;

    // 基础分数：评分 * 0.3
    score += (area.averageRating || 0) * 0.3;

    // 热门程度：访问量 * 0.2
    score += (area.popularity || 0) / 100000 * 0.2;

    // 评价数量：评论数 * 0.1
    score += (area.reviewCount || 0) / 100 * 0.1;

    // 兴趣匹配：根据用户兴趣权重调整
    if (user.interestWeights) {
      // 根据景区类别匹配兴趣
      const categoryWeights: Record<string, string> = {
        '校园': 'cultureEnthusiast',
        '景区': 'natureLover',
        '文化古迹': 'cultureEnthusiast',
        '自然风光': 'natureLover',
        '主题公园': 'socialSharer',
        '美食': 'foodie',
        '购物': 'socialSharer'
      };

      const interestKey = categoryWeights[area.category] || 'relaxationSeeker';
      score += (user.interestWeights[interestKey] || 0) * 0.4;
    }

    return score;
  }

  // 更新用户兴趣权重
  private async updateUserInterestWeights(userId: string): Promise<void> {
    const userRepository = getUserRepository();
    const userBehaviorRepository = getUserBehaviorRepository();
    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) return;

    const behaviors = await userBehaviorRepository.find({ where: { userId } });
    const interestScores = await this.calculateInterestScores(user, behaviors);

    user.interestWeights = interestScores;
    await userRepository.save(user);
  }

  // 探索模式推荐（推荐用户未尝试过的类型）
  async getExplorationRecommendation(userId: string, limit: number = 10): Promise<ScenicArea[]> {
    const userRepository = getUserRepository();
    const userBehaviorRepository = getUserBehaviorRepository();
    const scenicAreaRepository = getScenicAreaRepository();

    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    // 获取用户已访问的景区类型
    const userBehaviors = await userBehaviorRepository.find({ where: { userId, targetType: 'scenic_area' } });
    const visitedAreaIds = userBehaviors.map(b => b.targetId);
    const visitedAreas = await scenicAreaRepository.find({ where: { id: In(visitedAreaIds) } });
    const visitedCategories = new Set(visitedAreas.map(a => a.category));

    // 获取未访问过的类型的景区
    const allScenicAreas = await scenicAreaRepository.find();
    const unvisitedTypeAreas = allScenicAreas.filter(a => !visitedCategories.has(a.category));

    // 如果没有未访问的类型，返回随机推荐
    if (unvisitedTypeAreas.length === 0) {
      return this.getTopAttractions(limit);
    }

    // 使用最小堆进行Top-K推荐
    const minHeap = new MinHeap<{ score: number; area: ScenicArea }>(limit, (a, b) => a.score - b.score);

    for (const area of unvisitedTypeAreas) {
      const score = this.calculatePersonalizedScore(area, user);
      minHeap.insert({ score, area });
    }

    return this.presentScenicAreas(minHeap.getTopK().map(item => item.area));
  }

  // 惊喜推荐（推荐与用户兴趣不完全匹配但可能喜欢的内容）
  async getSurpriseRecommendation(userId: string, limit: number = 5): Promise<ScenicArea[]> {
    const userRepository = getUserRepository();
    const scenicAreaRepository = getScenicAreaRepository();

    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    // 获取所有景区
    const allScenicAreas = await scenicAreaRepository.find();

    // 计算每个景区的惊喜度分数（结合评分和与用户兴趣的差异）
    const minHeap = new MinHeap<{ score: number; area: ScenicArea }>(limit, (a, b) => a.score - b.score);

    for (const area of allScenicAreas) {
      // 基础分数：评分
      let score = area.rating * 0.7;
      
      // 惊喜度：与用户兴趣的差异
      if (user.interestWeights) {
        const categoryWeights: Record<string, string> = {
          '校园': 'cultureEnthusiast',
          '景区': 'natureLover',
          '文化古迹': 'cultureEnthusiast',
          '自然风光': 'natureLover',
          '主题公园': 'socialSharer',
          '美食': 'foodie',
          '购物': 'socialSharer'
        };

        const interestKey = categoryWeights[area.category] || 'relaxationSeeker';
        const interestScore = user.interestWeights[interestKey] || 0;
        
        // 兴趣分数越低，惊喜度越高
        score += (1 - Math.min(interestScore, 1)) * 0.3;
      }

      minHeap.insert({ score, area });
    }

    return this.presentScenicAreas(minHeap.getTopK().map(item => item.area));
  }

  // 时间感知推荐
  async getTimeAwareRecommendation(userId: string, limit: number = 10): Promise<ScenicArea[]> {
    const userRepository = getUserRepository();
    const scenicAreaRepository = getScenicAreaRepository();

    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const now = new Date();
    const hour = now.getHours();
    const allScenicAreas = await scenicAreaRepository.find();

    // 根据时间调整推荐
    const minHeap = new MinHeap<{ score: number; area: ScenicArea }>(limit, (a, b) => a.score - b.score);

    for (const area of allScenicAreas) {
      let score = this.calculatePersonalizedScore(area, user);

      // 早上6-9点：推荐早餐店和晨景观赏点
      if (hour >= 6 && hour < 9) {
        if (area.category === '美食' || area.category === '自然风光') {
          score *= 1.2;
        }
      }
      // 傍晚17-19点：推荐观景台和日落观赏点
      else if (hour >= 17 && hour < 19) {
        if (area.category === '自然风光' || area.category === '景区') {
          score *= 1.2;
        }
      }

      minHeap.insert({ score, area });
    }

    return this.presentScenicAreas(minHeap.getTopK().map(item => item.area));
  }

  // 季节性推荐
  async getSeasonalRecommendation(userId: string, limit: number = 10): Promise<ScenicArea[]> {
    const userRepository = getUserRepository();
    const scenicAreaRepository = getScenicAreaRepository();

    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const now = new Date();
    const month = now.getMonth() + 1; // 1-12
    const allScenicAreas = await scenicAreaRepository.find();

    // 根据季节调整推荐
    const minHeap = new MinHeap<{ score: number; area: ScenicArea }>(limit, (a, b) => a.score - b.score);

    for (const area of allScenicAreas) {
      let score = this.calculatePersonalizedScore(area, user);

      // 春季（3-5月）：推荐赏花景点
      if (month >= 3 && month <= 5) {
        if (area.category === '自然风光' || area.tags?.includes('赏花')) {
          score *= 1.2;
        }
      }
      // 秋季（9-11月）：推荐赏枫景点
      else if (month >= 9 && month <= 11) {
        if (area.category === '自然风光' || area.tags?.includes('赏枫')) {
          score *= 1.2;
        }
      }
      // 冬季（12-2月）：推荐温泉和室内景点
      else if ((month >= 12 && month <= 12) || (month >= 1 && month <= 2)) {
        if (area.category === '景区' || area.tags?.includes('温泉') || area.tags?.includes('室内')) {
          score *= 1.2;
        }
      }

      minHeap.insert({ score, area });
    }

    return this.presentScenicAreas(minHeap.getTopK().map(item => item.area));
  }

  // 美食推荐
  async getFoodRecommendation(locationId: string, userId?: string, cuisine?: string, limit: number = 10): Promise<Food[]> {
    const foodRepository = getFoodRepository();
    const userRepository = getUserRepository();

    // 构建查询
    const query: any = {};
    if (cuisine) {
      query.cuisine = cuisine;
    }

    // 获取美食数据
    const allFoods = await foodRepository.find({ where: query });

    // 如果有用户ID，考虑用户兴趣
    let user;
    if (userId) {
      user = await userRepository.findOne({ where: { id: userId } });
    }

    // 使用最小堆进行Top-K推荐
    const minHeap = new MinHeap<{ score: number; food: Food }>(limit, (a, b) => a.score - b.score);

    for (const food of allFoods) {
      let score = 0;

      // 基础分数：评分 * 0.5
      score += (food.averageRating || 0) * 0.5;

      // 热门程度：访问量 * 0.3
      score += (food.popularity || 0) / 1000 * 0.3;

      // 评价数量：评论数 * 0.2
      score += (food.reviewCount || 0) / 10 * 0.2;

      // 如果有用户，考虑用户兴趣
      if (user && user.interestWeights) {
        if (user.interestWeights.foodie > 0) {
          score *= (1 + user.interestWeights.foodie * 0.5);
        }
      }

      minHeap.insert({ score, food });
    }

    return minHeap.getTopK().map(item => item.food);
  }

  // 日记推荐
  async getDiaryRecommendation(userId: string, limit: number = 10): Promise<Diary[]> {
    const diaryRepository = getDiaryRepository();
    const userRepository = getUserRepository();

    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    // 获取分享的日记
    const sharedDiaries = await diaryRepository.find({ where: { isShared: true } });

    // 使用最小堆进行Top-K推荐
    const minHeap = new MinHeap<{ score: number; diary: Diary }>(limit, (a, b) => a.score - b.score);

    for (const diary of sharedDiaries) {
      let score = 0;

      // 基础分数：评分 * 0.4
      score += (diary.averageRating || 0) * 0.4;

      // 热门程度：访问量 * 0.3
      score += (diary.popularity || 0) / 100 * 0.3;

      // 评价数量：评论数 * 0.2
      score += (diary.reviewCount || 0) / 10 * 0.2;

      // 时间因素：越新的日记分数越高
      const daysSinceCreated = (new Date().getTime() - diary.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 1 - daysSinceCreated / 30) * 0.1;

      minHeap.insert({ score, diary });
    }

    return minHeap.getTopK().map(item => item.diary);
  }

  async getCityDestinationOptions(limit: number = 12): Promise<CityDestinationOption[]> {
    const scenicAreaRepository = getScenicAreaRepository();
    const allAreas = this.presentScenicAreas(await scenicAreaRepository.find()) as Array<ScenicArea & ScenicPresentation>;
    const grouped = new Map<string, Array<ScenicArea & ScenicPresentation>>();

    allAreas
      .filter((area) => area.category === '景区')
      .forEach((area) => {
        const cityLabel = area.cityLabel || '精选目的地';
        if (!grouped.has(cityLabel)) {
          grouped.set(cityLabel, []);
        }
        grouped.get(cityLabel)!.push(area);
      });

    return Array.from(grouped.entries())
      .map(([cityLabel, areas]) => {
        const resolvedCoordinates = this.resolveCityAreaCoordinates(cityLabel, areas);
        const center = this.computeCityCenter(Array.from(resolvedCoordinates.values()));
        const featuredScenicAreas = [...areas]
          .sort(
            (left, right) =>
              Number(right.popularity || 0) - Number(left.popularity || 0) ||
              Number(right.averageRating || 0) - Number(left.averageRating || 0),
          )
          .slice(0, 3)
          .map((area) => {
            const coordinate = resolvedCoordinates.get(area.id) || this.resolveSingleAreaCoordinate(cityLabel, area);
            return {
              id: area.id,
              name: area.name,
              category: area.category,
              latitude: coordinate.latitude,
              longitude: coordinate.longitude,
              averageRating: Number(area.averageRating || 0),
              popularity: Number(area.popularity || 0),
            };
          });

        return {
          cityLabel,
          scenicCount: areas.length,
          averageRating: Number(
            (areas.reduce((sum, area) => sum + Number(area.averageRating || 0), 0) / Math.max(areas.length, 1)).toFixed(2),
          ),
          averagePopularity: Number(
            (
              areas.reduce((sum, area) => sum + Number(area.popularity || area.visitorCount || 0), 0) /
              Math.max(areas.length, 1)
            ).toFixed(0),
          ),
          center,
          coverImageUrl: areas[0]?.coverImageUrl || '',
          coverImageTheme: areas[0]?.coverImageTheme || cityLabel,
          featuredScenicAreas,
        } satisfies CityDestinationOption;
      })
      .filter((item) => Number.isFinite(item.center.latitude) && Number.isFinite(item.center.longitude))
      .sort((left, right) => right.scenicCount - left.scenicCount || right.averagePopularity - left.averagePopularity)
      .slice(0, limit);
  }

  async generateCityTravelItinerary(
    userId: string,
    cityLabel: string,
    theme: CityTravelTheme,
    tripDays: number,
  ): Promise<CityTravelItinerary> {
    const scenicAreaRepository = getScenicAreaRepository();
    const attractionRepository = getAttractionRepository();
    const facilityRepository = getFacilityRepository();
    const photoSpotRepository = getPhotoSpotRepository();
    const foodRepository = getFoodRepository();
    const userRepository = getUserRepository();

    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const normalizedTheme = this.normalizeCityTravelTheme(theme);
    const normalizedTripDays = Math.max(1, Math.min(3, Math.round(Number(tripDays) || 1)));
    const allAreas = this.presentScenicAreas(await scenicAreaRepository.find()) as Array<ScenicArea & ScenicPresentation>;
    const cityAreas = allAreas.filter(
      (area) =>
        area.category === '景区' &&
        (area.cityLabel || '精选目的地') === cityLabel &&
        true,
    );

    if (!cityAreas.length) {
      throw new Error(`No scenic areas found for city ${cityLabel}`);
    }

    const resolvedCoordinates = this.resolveCityAreaCoordinates(cityLabel, cityAreas);

    const scenicAreaIds = cityAreas.map((area) => area.id);
    const [attractions, facilities, photoSpots] = await Promise.all([
      attractionRepository.find({ where: { scenicAreaId: In(scenicAreaIds) } }),
      facilityRepository.find({ where: { scenicAreaId: In(scenicAreaIds) } }),
      photoSpotRepository.find({ where: { scenicAreaId: In(scenicAreaIds) } }),
    ]);

    const foods = facilities.length
      ? await foodRepository.find({ where: { facilityId: In(facilities.map((item) => item.id)) } })
      : [];

    const attractionMap = this.groupByScenicArea(attractions, (item) => item.scenicAreaId);
    const facilityMap = this.groupByScenicArea(facilities, (item) => item.scenicAreaId);
    const photoSpotMap = this.groupByScenicArea(photoSpots, (item) => item.scenicAreaId);
    const facilityToScenicMap = new Map(facilities.map((item) => [item.id, item.scenicAreaId] as const));
    const foodMap = new Map<string, Food[]>();
    foods.forEach((item) => {
      const scenicAreaId = facilityToScenicMap.get(item.facilityId);
      if (!scenicAreaId) {
        return;
      }
      const current = foodMap.get(scenicAreaId) || [];
      current.push(item);
      foodMap.set(scenicAreaId, current);
    });

    const selectedInterests = this.normalizeUserInterests(user.interests || []);
    const scoredAreas = cityAreas
      .map((area) =>
        this.scoreCityAreaForTheme(
          area,
          normalizedTheme,
          selectedInterests,
          attractionMap.get(area.id) || [],
          facilityMap.get(area.id) || [],
          foodMap.get(area.id) || [],
          photoSpotMap.get(area.id) || [],
        ),
      )
      .sort((left, right) => right.score - left.score);

    const stopsPerDay = normalizedTripDays === 1 ? 4 : 3;
    const selectedCount = Math.min(cityAreas.length, Math.max(normalizedTripDays * stopsPerDay, normalizedTripDays * 2));
    const selectedAreas = scoredAreas.slice(0, selectedCount);
    const dayBuckets = this.allocateStopsToDays(selectedAreas, normalizedTripDays);
    const dayColors = ['#2563eb', '#16a34a', '#f59e0b'];

    const days: CityItineraryDay[] = [];
    const segments: CityItinerarySegment[] = [];

    dayBuckets.forEach((bucket, dayIndex) => {
      const ordered = this.orderCityStopsForDay(bucket);
      const stops: CityItineraryStop[] = ordered.map((item, stopIndex) => {
        const coordinate = resolvedCoordinates.get(item.area.id) || this.resolveSingleAreaCoordinate(cityLabel, item.area);
        return {
          id: `${item.area.id}-d${dayIndex + 1}-${stopIndex + 1}`,
          scenicAreaId: item.area.id,
          scenicAreaName: item.area.name,
          day: dayIndex + 1,
          order: stopIndex + 1,
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          averageRating: Number(item.area.averageRating || 0),
          popularity: Number(item.area.popularity || item.area.visitorCount || 0),
          coverImageUrl: item.area.coverImageUrl,
          coverImageTheme: item.area.coverImageTheme,
          cityLabel: item.area.cityLabel || cityLabel,
          reason: item.reason,
          highlightTags: item.highlightTags,
        };
      });

      let distance = 0;
      for (let index = 1; index < stops.length; index += 1) {
        distance += this.haversineKm(
          stops[index - 1].latitude,
          stops[index - 1].longitude,
          stops[index].latitude,
          stops[index].longitude,
        );
        segments.push({
          id: `day-${dayIndex + 1}-segment-${index}`,
          day: dayIndex + 1,
          order: index,
          fromStopId: stops[index - 1].id,
          toStopId: stops[index].id,
          points: this.buildOverviewSegmentPoints(stops[index - 1], stops[index], dayIndex + 1, index),
          color: dayColors[dayIndex % dayColors.length],
          label: `第${dayIndex + 1}天 · 第${index}段`,
        });
      }

      days.push({
        day: dayIndex + 1,
        title: `第 ${dayIndex + 1} 天`,
        estimatedDistanceKm: Number(distance.toFixed(2)),
        estimatedTimeMinutes: this.estimateCityDayTimeMinutes(stops.length, distance, normalizedTheme),
        stops,
      });
    });

    return {
      cityLabel,
      theme: normalizedTheme,
      tripDays: normalizedTripDays,
      center: this.computeCityCenter(Array.from(resolvedCoordinates.values())),
      days,
      segments,
      legend: days.map((day, index) => ({
        id: `day-${day.day}`,
        label: day.title,
        color: dayColors[index % dayColors.length],
      })),
      summary: {
        totalStops: days.reduce((sum, day) => sum + day.stops.length, 0),
        cityScenicCount: cityAreas.length,
        variationSignals: this.buildVariationSignals(normalizedTheme, selectedInterests),
      },
    };
  }

  // 获取热门景点（作为备选推荐）
  private normalizeCityTravelTheme(theme: string): CityTravelTheme {
    if (
      theme === 'foodie' ||
      theme === 'photographer' ||
      theme === 'culture' ||
      theme === 'nature' ||
      theme === 'relaxation' ||
      theme === 'personalized'
    ) {
      return theme;
    }
    return 'comprehensive';
  }

  private normalizeUserInterests(interests: unknown): string[] {
    if (Array.isArray(interests)) {
      return Array.from(new Set(interests.map((item) => String(item || '').trim()).filter(Boolean)));
    }

    if (typeof interests === 'string') {
      const trimmed = interests.trim();
      if (!trimmed || trimmed === '[object Object]') {
        return [];
      }

      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return Array.from(new Set(parsed.map((item) => String(item || '').trim()).filter(Boolean)));
        }
      } catch {
        // fall through to delimiter parsing
      }

      return Array.from(
        new Set(
          trimmed
            .replace(/^\[|\]$/g, '')
            .split(/[,\uFF0C|]/)
            .map((item) => item.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean),
        ),
      );
    }

    return [];
  }

  private toCoordinatePoint(latitude: number | null | undefined, longitude: number | null | undefined): CoordinatePoint | null {
    const safeLatitude = Number(latitude);
    const safeLongitude = Number(longitude);
    if (!Number.isFinite(safeLatitude) || !Number.isFinite(safeLongitude)) {
      return null;
    }

    return {
      latitude: Number(safeLatitude.toFixed(6)),
      longitude: Number(safeLongitude.toFixed(6)),
    };
  }

  private areCoordinatesCollapsed(points: CoordinatePoint[]) {
    const valid = points.filter(
      (point) => Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)),
    );

    if (valid.length <= 1) {
      return true;
    }

    const uniqueRounded = new Set(valid.map((point) => `${point.latitude.toFixed(4)}:${point.longitude.toFixed(4)}`));
    if (uniqueRounded.size <= Math.max(2, Math.ceil(valid.length / 4))) {
      return true;
    }

    let maxDistance = 0;
    for (let index = 0; index < valid.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < valid.length; nextIndex += 1) {
        maxDistance = Math.max(
          maxDistance,
          this.haversineKm(
            valid[index].latitude,
            valid[index].longitude,
            valid[nextIndex].latitude,
            valid[nextIndex].longitude,
          ),
        );
      }
    }

    return maxDistance < 2;
  }

  private getCityAnchor(cityLabel: string) {
    return CITY_TRAVEL_ANCHORS[cityLabel] || { latitude: 39.9042, longitude: 116.4074, spreadKm: 16 };
  }

  private offsetCoordinate(anchor: CoordinatePoint, distanceKm: number, bearingDegrees: number): CoordinatePoint {
    const earthRadiusKm = 6371;
    const bearing = (bearingDegrees * Math.PI) / 180;
    const lat1 = (anchor.latitude * Math.PI) / 180;
    const lng1 = (anchor.longitude * Math.PI) / 180;
    const angularDistance = distanceKm / earthRadiusKm;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) +
        Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
      );

    return {
      latitude: Number(((lat2 * 180) / Math.PI).toFixed(6)),
      longitude: Number(((lng2 * 180) / Math.PI).toFixed(6)),
    };
  }

  private buildGeneratedAreaCoordinate(cityLabel: string, area: ScenicArea & ScenicPresentation, index: number) {
    const anchor = this.getCityAnchor(cityLabel);
    const baseAngle = this.stableHash(`${cityLabel}:${area.name}`) % 360;
    const ringIndex = Math.floor(index / 4);
    const slotIndex = index % 4;
    const ringDistanceKm = Math.min(anchor.spreadKm, 2.5 + ringIndex * 3.1 + slotIndex * 0.35);
    const bearingDegrees = (baseAngle + slotIndex * 67 + ringIndex * 19) % 360;
    return this.offsetCoordinate(anchor, ringDistanceKm, bearingDegrees);
  }

  private resolveSingleAreaCoordinate(cityLabel: string, area: ScenicArea & ScenicPresentation): CoordinatePoint {
    const knownCoordinate = CITY_SCENIC_COORDINATE_OVERRIDES[cityLabel]?.[area.name];
    if (knownCoordinate) {
      return knownCoordinate;
    }

    return this.toCoordinatePoint(area.latitude, area.longitude) || this.buildGeneratedAreaCoordinate(cityLabel, area, 0);
  }

  private resolveCityAreaCoordinates(cityLabel: string, areas: Array<ScenicArea & ScenicPresentation>) {
    const resolved = new Map<string, CoordinatePoint>();
    const rawCoordinates = areas
      .map((area) => this.toCoordinatePoint(area.latitude, area.longitude))
      .filter((point): point is CoordinatePoint => point !== null);
    const useFallbackCoordinates = this.areCoordinatesCollapsed(rawCoordinates);
    const sortedAreas = [...areas].sort(
      (left, right) =>
        Number(right.popularity || right.visitorCount || 0) - Number(left.popularity || left.visitorCount || 0) ||
        Number(right.averageRating || 0) - Number(left.averageRating || 0),
    );

    sortedAreas.forEach((area, index) => {
      const knownCoordinate = CITY_SCENIC_COORDINATE_OVERRIDES[cityLabel]?.[area.name];
      const rawCoordinate = this.toCoordinatePoint(area.latitude, area.longitude);
      const coordinate =
        knownCoordinate ||
        (!useFallbackCoordinates && rawCoordinate ? rawCoordinate : null) ||
        this.buildGeneratedAreaCoordinate(cityLabel, area, index);
      resolved.set(area.id, coordinate);
    });

    return resolved;
  }

  private buildOverviewSegmentPoints(
    fromStop: { latitude: number; longitude: number },
    toStop: { latitude: number; longitude: number },
    day: number,
    order: number,
  ) {
    const from = { latitude: fromStop.latitude, longitude: fromStop.longitude };
    const to = { latitude: toStop.latitude, longitude: toStop.longitude };
    const straightDistance = this.haversineKm(from.latitude, from.longitude, to.latitude, to.longitude);

    if (straightDistance < 0.6) {
      return [from, to];
    }

    const midLatitude = (from.latitude + to.latitude) / 2;
    const midLongitude = (from.longitude + to.longitude) / 2;
    const latDelta = to.latitude - from.latitude;
    const lngDelta = to.longitude - from.longitude;
    const vectorLength = Math.sqrt(latDelta * latDelta + lngDelta * lngDelta) || 1;
    const curveDirection = this.stableHash(`${day}:${order}:${from.latitude}:${to.longitude}`) % 2 === 0 ? 1 : -1;
    const curveOffset = Math.min(0.04, vectorLength * 0.18) * curveDirection;

    return [
      from,
      {
        latitude: Number((midLatitude - (lngDelta / vectorLength) * curveOffset).toFixed(6)),
        longitude: Number((midLongitude + (latDelta / vectorLength) * curveOffset).toFixed(6)),
      },
      to,
    ];
  }

  private computeCityCenter(areas: Array<{ latitude: number | null; longitude: number | null }>) {
    const valid = areas.filter(
      (area) => Number.isFinite(Number(area.latitude)) && Number.isFinite(Number(area.longitude)),
    );
    if (!valid.length) {
      return { latitude: 39.9042, longitude: 116.4074 };
    }

    const latitude = valid.reduce((sum, area) => sum + Number(area.latitude || 0), 0) / Math.max(valid.length, 1);
    const longitude = valid.reduce((sum, area) => sum + Number(area.longitude || 0), 0) / Math.max(valid.length, 1);
    return {
      latitude: Number(latitude.toFixed(6)),
      longitude: Number(longitude.toFixed(6)),
    };
  }

  private groupByScenicArea<T>(items: T[], getScenicAreaId: (item: T) => string) {
    const grouped = new Map<string, T[]>();
    items.forEach((item) => {
      const scenicAreaId = getScenicAreaId(item);
      if (!grouped.has(scenicAreaId)) {
        grouped.set(scenicAreaId, []);
      }
      grouped.get(scenicAreaId)!.push(item);
    });
    return grouped;
  }

  private scoreCityAreaForTheme(
    area: ScenicArea & ScenicPresentation,
    theme: CityTravelTheme,
    selectedInterests: string[],
    attractions: Attraction[],
    facilities: Facility[],
    foods: Food[],
    photoSpots: PhotoSpot[],
  ) {
    const text = [
      area.name,
      area.description || '',
      Array.isArray(area.tags) ? area.tags.join(' ') : area.tags || '',
      ...attractions.map((item) => `${item.name} ${item.category || ''} ${item.type || ''} ${item.description || ''}`),
      ...facilities.map((item) => `${item.name} ${item.category || ''} ${item.description || ''}`),
      ...foods.map((item) => `${item.name} ${item.cuisine || ''} ${item.description || ''}`),
      ...photoSpots.map((item) => `${item.name} ${item.description || ''} ${item.bestTime || ''}`),
    ]
      .join(' ')
      .toLowerCase();

    const cuisineDiversity = new Set(foods.map((item) => String(item.cuisine || '').trim()).filter(Boolean)).size;
    const photoPopularity = photoSpots.reduce((sum, item) => sum + Number(item.popularity || 0), 0);
    const cultureCount = attractions.filter((item) =>
      ['historic', 'museum', 'culture'].includes(String(item.type || '').toLowerCase()),
    ).length;
    const viewpointCount = attractions.filter((item) =>
      ['viewpoint', 'garden'].includes(String(item.type || '').toLowerCase()) ||
      String(item.category || '').includes('观景'),
    ).length;

    const ratingScore = Number(area.averageRating || area.rating || 0) * 1.5;
    const popularityScore = Number(area.popularity || area.visitorCount || 0) / 35000;
    const foodScore =
      foods.length * 0.12 +
      cuisineDiversity * 0.9 +
      this.keywordScore(text, ['美食', '小吃', '火锅', '面', '饭', '街', '巷', '坊', '夜', '吃']) * 1.2;
    const photoScore =
      photoSpots.length * 0.9 +
      photoPopularity / 400 +
      viewpointCount * 0.8 +
      this.keywordScore(text, ['摄影', '拍照', '打卡', '观景', '夜景', '塔', '楼', '湖', '桥']) * 1.15;
    const cultureScore =
      cultureCount * 1.1 +
      this.keywordScore(text, ['博物', '故宫', '宫', '寺', '楼', '古', '遗址', '文化', '历史']) * 1.35;
    const natureScore =
      viewpointCount * 0.55 +
      this.keywordScore(text, ['公园', '山', '湖', '湿地', '谷', '园', '海', '林', '自然']) * 1.25;
    const relaxScore = natureScore * 0.7 + ratingScore * 0.35 + Math.max(0, 4 - popularityScore);
    const comprehensiveScore =
      ratingScore +
      popularityScore +
      (foodScore + photoScore + cultureScore + natureScore) * 0.22;

    const personalizedBoost = selectedInterests.reduce((sum, interest) => {
      if (interest === 'foodie') return sum + foodScore * 0.45;
      if (interest === 'photographer') return sum + photoScore * 0.45;
      if (interest === 'cultureEnthusiast') return sum + cultureScore * 0.45;
      if (interest === 'natureLover') return sum + natureScore * 0.45;
      if (interest === 'relaxationSeeker') return sum + relaxScore * 0.35;
      return sum + comprehensiveScore * 0.08;
    }, 0);

    const stableBias = (this.stableHash(`${theme}:${area.id}`) % 19) / 100;
    const totalScore =
      theme === 'foodie'
        ? foodScore * 1.8 + ratingScore * 0.4 + popularityScore * 0.35 + stableBias
        : theme === 'photographer'
        ? photoScore * 1.9 + natureScore * 0.35 + ratingScore * 0.3 + stableBias
        : theme === 'culture'
        ? cultureScore * 1.9 + ratingScore * 0.4 + popularityScore * 0.25 + stableBias
        : theme === 'nature'
        ? natureScore * 1.9 + photoScore * 0.35 + relaxScore * 0.25 + stableBias
        : theme === 'relaxation'
        ? relaxScore * 1.9 + natureScore * 0.35 + ratingScore * 0.25 + stableBias
        : theme === 'personalized'
        ? comprehensiveScore * 0.9 + personalizedBoost + stableBias
        : comprehensiveScore + stableBias;

    const highlightTags = this.buildHighlightTags(theme, {
      cuisineDiversity,
      foodCount: foods.length,
      photoCount: photoSpots.length,
      cultureCount,
      viewpointCount,
    });

    return {
      area,
      score: Number(totalScore.toFixed(4)),
      reason: this.buildThemeReason(theme, area.name, highlightTags, selectedInterests),
      highlightTags,
    };
  }

  private buildHighlightTags(
    theme: CityTravelTheme,
    metrics: {
      cuisineDiversity: number;
      foodCount: number;
      photoCount: number;
      cultureCount: number;
      viewpointCount: number;
    },
  ) {
    const tags: string[] = [];
    if (metrics.foodCount >= 12 || metrics.cuisineDiversity >= 4) tags.push('美食丰富');
    if (metrics.photoCount >= 3 || metrics.viewpointCount >= 2) tags.push('适合拍照');
    if (metrics.cultureCount >= 3) tags.push('文化看点');
    if (metrics.viewpointCount >= 3) tags.push('景观路线');
    if (!tags.length) {
      tags.push(theme === 'foodie' ? '适合吃逛' : theme === 'photographer' ? '适合打卡' : '综合体验');
    }
    return tags.slice(0, 3);
  }

  private buildThemeReason(
    theme: CityTravelTheme,
    areaName: string,
    highlightTags: string[],
    selectedInterests: string[],
  ) {
    if (theme === 'foodie') {
      return `${areaName} 的餐饮与逛吃内容更集中，适合排进美食主题行程。`;
    }
    if (theme === 'photographer') {
      return `${areaName} 的摄影位和观景内容更突出，适合作为拍照主题站点。`;
    }
    if (theme === 'culture') {
      return `${areaName} 的历史文化标签更强，适合作为文化主题重点站。`;
    }
    if (theme === 'nature') {
      return `${areaName} 的景观与自然氛围更明显，适合作为自然主题游览点。`;
    }
    if (theme === 'relaxation') {
      return `${areaName} 更适合慢节奏停留，可放入轻松休闲路线。`;
    }
    if (theme === 'personalized') {
      return `${areaName} 与你的兴趣画像匹配更高，命中了 ${highlightTags.concat(selectedInterests).slice(0, 2).join('、')}。`;
    }
    return `${areaName} 在热度、评分和体验维度上更均衡，适合作为综合路线站点。`;
  }

  private normalizeInterestWeights(value: Record<string, number> | null | undefined) {
    const normalized: Record<string, number> = {};
    Object.entries(value || {}).forEach(([key, rawWeight]) => {
      const normalizedKey = String(key).trim();
      const numericWeight = Number(rawWeight);
      if (!normalizedKey || !Number.isFinite(numericWeight)) {
        return;
      }
      normalized[normalizedKey] = numericWeight;
    });
    return normalized;
  }

  private normalizeAttractionTags(attraction: Attraction): string[] {
    const tags = [
      ...(Array.isArray(attraction.tags) ? attraction.tags : []),
      attraction.category || '',
      attraction.type || '',
    ]
      .map((item) => String(item).trim())
      .filter(Boolean);

    return Array.from(new Set(tags));
  }

  private resolveAttractionBaseHeat(attraction: Attraction): number {
    const hash = this.stableHash(`${attraction.id}:${attraction.name}:${attraction.category || ''}`);
    return 2000 + (hash % 6001);
  }

  private calculateTagMatchScore(tags: string[], interestWeights: Record<string, number>): number {
    if (!tags.length) {
      return 0;
    }

    const normalizedInterestWeights = this.normalizeInterestWeights(interestWeights);
    const weights = tags
      .map((tag) => normalizedInterestWeights[String(tag).trim()])
      .filter((value): value is number => Number.isFinite(value));

    if (!weights.length) {
      return 0;
    }

    const maxWeight = Math.max(...weights);
    const averageWeight = weights.reduce((sum, value) => sum + value, 0) / weights.length;
    return Number((maxWeight * 0.6 + averageWeight * 0.4).toFixed(4));
  }

  private resolveAttractionDistanceKm(
    attraction: Attraction,
    referencePoint?: { latitude: number; longitude: number },
  ): number {
    if (
      referencePoint &&
      Number.isFinite(Number(attraction.latitude)) &&
      Number.isFinite(Number(attraction.longitude))
    ) {
      return Number(
        this.haversineKm(
          referencePoint.latitude,
          referencePoint.longitude,
          Number(attraction.latitude || 0),
          Number(attraction.longitude || 0),
        ).toFixed(3),
      );
    }

    return 0;
  }

  private clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  private keywordScore(text: string, keywords: string[]) {
    return keywords.reduce((sum, keyword) => sum + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0);
  }

  private stableHash(value: string) {
    let result = 7;
    for (const char of value) {
      result = (result * 31 + char.charCodeAt(0)) % 2147483647;
    }
    return result;
  }

  private allocateStopsToDays<T>(items: T[], tripDays: number) {
    const buckets = Array.from({ length: tripDays }, () => [] as T[]);
    items.forEach((item, index) => {
      buckets[index % tripDays].push(item);
    });
    return buckets.filter((bucket) => bucket.length > 0);
  }

  private orderCityStopsForDay<T extends { area: { latitude: number | null; longitude: number | null } }>(items: T[]) {
    if (items.length <= 2) {
      return items;
    }

    const remaining = [...items.slice(1)];
    const ordered = [items[0]];

    while (remaining.length) {
      const current = ordered[ordered.length - 1];
      let nextIndex = 0;
      let minDistance = Number.POSITIVE_INFINITY;
      remaining.forEach((candidate, index) => {
        const distance = this.haversineKm(
          Number(current.area.latitude || 0),
          Number(current.area.longitude || 0),
          Number(candidate.area.latitude || 0),
          Number(candidate.area.longitude || 0),
        );
        if (distance < minDistance) {
          minDistance = distance;
          nextIndex = index;
        }
      });
      ordered.push(remaining.splice(nextIndex, 1)[0]);
    }

    return ordered;
  }

  private haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
    const toRadians = (value: number) => (value * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  }

  private estimateCityDayTimeMinutes(stopCount: number, distanceKm: number, theme: CityTravelTheme) {
    const stayPerStop =
      theme === 'foodie' ? 110 :
      theme === 'photographer' ? 95 :
      theme === 'culture' ? 100 :
      theme === 'nature' ? 90 :
      theme === 'relaxation' ? 120 :
      95;

    return Number((stopCount * stayPerStop + distanceKm * 18).toFixed(0));
  }

  private buildVariationSignals(theme: CityTravelTheme, selectedInterests: string[]) {
    if (theme === 'foodie') {
      return ['优先选择餐饮丰富的景区', '更偏向街区与逛吃型目的地'];
    }
    if (theme === 'photographer') {
      return ['优先选择摄影位与观景内容更多的景区', '更强调出片与打卡顺序'];
    }
    if (theme === 'culture') {
      return ['优先选择历史文化向景区', '更强调博物馆、古迹与文化内容'];
    }
    if (theme === 'nature') {
      return ['优先选择公园、山水与景观类景区', '更强调户外视野与自然体验'];
    }
    if (theme === 'relaxation') {
      return ['减少高密度打卡', '优先选择更适合慢游停留的景区'];
    }
    if (theme === 'personalized') {
      return [`已结合兴趣画像：${selectedInterests.join('、') || '综合偏好'}`, '标签变化会直接改变景区评分和路线分配'];
    }
    return ['综合热度、评分与主题要素进行平衡推荐', '适合作为默认城市旅行日程'];
  }

  private async getTopAttractions(limit: number = 10): Promise<ScenicArea[]> {
    const scenicAreaRepository = getScenicAreaRepository();
    const areas = await scenicAreaRepository.find({
      order: { averageRating: 'DESC' },
      take: limit
    });
    return this.presentScenicAreas(areas);
  }

  // 获取推荐解释
  async getRecommendationExplanation(userId: string, itemId: string): Promise<{ factors: Array<{ name: string; weight: number; explanation: string }>; totalScore: number }> {
    const userRepository = getUserRepository();
    const scenicAreaRepository = getScenicAreaRepository();

    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const area = await scenicAreaRepository.findOne({ where: { id: itemId } });
    if (!area) {
      throw new Error('Scenic area not found');
    }

    const factors = [];
    let totalScore = 0;

    // 评分因素
    const ratingScore = (area.averageRating || 0) * 0.3;
    factors.push({
      name: '评分',
      weight: ratingScore,
      explanation: `该景区评分为 ${area.averageRating || 0} 分，占推荐权重的 30%`
    });
    totalScore += ratingScore;

    // 热度因素
    const popularityScore = (area.popularity || 0) / 100000 * 0.2;
    factors.push({
      name: '热度',
      weight: popularityScore,
      explanation: `该景区访问量为 ${area.popularity || 0}，占推荐权重的 20%`
    });
    totalScore += popularityScore;

    // 评价数量因素
    const reviewScore = (area.reviewCount || 0) / 100 * 0.1;
    factors.push({
      name: '评价数量',
      weight: reviewScore,
      explanation: `该景区有 ${area.reviewCount || 0} 条评价，占推荐权重的 10%`
    });
    totalScore += reviewScore;

    // 兴趣匹配因素
    if (user.interestWeights) {
      const categoryWeights: Record<string, string> = {
        '校园': 'cultureEnthusiast',
        '景区': 'natureLover',
        '文化古迹': 'cultureEnthusiast',
        '自然风光': 'natureLover',
        '主题公园': 'socialSharer',
        '美食': 'foodie',
        '购物': 'socialSharer'
      };

      const interestKey = categoryWeights[area.category] || 'relaxationSeeker';
      const interestScore = (user.interestWeights[interestKey] || 0) * 0.4;
      factors.push({
        name: '兴趣匹配',
        weight: interestScore,
        explanation: `根据您的兴趣偏好，该景区与您的${interestKey === 'foodie' ? '美食' : interestKey === 'photographer' ? '摄影' : interestKey === 'cultureEnthusiast' ? '历史文化' : interestKey === 'natureLover' ? '自然风光' : interestKey === 'sportsEnthusiast' ? '运动健身' : interestKey === 'relaxationSeeker' ? '休闲放松' : '社交分享'}兴趣匹配度高，占推荐权重的 40%`
      });
      totalScore += interestScore;
    }

    return {
      factors,
      totalScore
    };
  }
}
