import { Like } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Attraction as AttractionEntity } from '../entities/Attraction';
import { Diary as DiaryEntity } from '../entities/Diary';
import { Facility as FacilityEntity } from '../entities/Facility';
import { Food as FoodEntity } from '../entities/Food';
import { RoadGraphEdge as RoadGraphEdgeEntity } from '../entities/RoadGraphEdge';
import { RoadGraphNode as RoadGraphNodeEntity } from '../entities/RoadGraphNode';
import { ScenicArea as ScenicAreaEntity } from '../entities/ScenicArea';
import { Trie } from '../algorithms/Trie';
import { resolveScenicPresentation } from '../utils/scenicPresentation';
import { haversineDistanceKm } from '../utils/geoUtils';
import { normalizeStringArray } from '../utils/stringArrayField';

interface ScenicArea {
  id: string;
  name: string;
  description: string;
  category: string;
  city?: string | null;
  rating: number;
  tags: string;
  createdAt: Date;
  updatedAt: Date;
  latitude?: number | null;
  longitude?: number | null;
  openingHours?: string;
  ticketPrice?: number | null;
  popularity?: number;
  averageRating?: number;
  reviewCount?: number;
  visitorCount?: number;
  coverImageUrl?: string;
  cityLabel?: string;
  coverImageTheme?: string;
}

interface Attraction {
  id: string;
  name: string;
  description: string;
  category: string;
  scenicAreaId: string;
  city?: string | null;
  createdAt: Date;
  updatedAt: Date;
  type?: string;
  rating?: number;
  latitude?: number | null;
  longitude?: number | null;
  openingHours?: string;
  averageRating?: number;
  reviewCount?: number;
}

interface Facility {
  id: string;
  name: string;
  description: string;
  scenicAreaId: string;
  category: string;
  createdAt: Date;
  updatedAt: Date;
  type?: string;
  latitude?: number | null;
  longitude?: number | null;
  openingHours?: string;
  distanceKm?: number;
  distanceSource?: 'road_network' | 'haversine';
}

interface Diary {
  id: string;
  title: string;
  content: string;
  userId: string;
  destination: string;
  visitDate: Date;
  createdAt: Date;
  updatedAt: Date;
  popularity?: number;
  averageRating?: number;
  reviewCount?: number;
  isShared?: boolean;
  route?: string[];
}

interface RoadNode {
  id: string;
  scenicAreaId: string;
  latitude: number;
  longitude: number;
}

interface RoadEdge {
  fromNodeId: string;
  toNodeId: string;
  scenicAreaId: string;
  distance: number;
}

interface ScenicAreaQueryOptions {
  name?: string;
  categories?: string[];
  minRating?: number;
  limit?: number;
}

export class QueryService {
  private scenicTrie: Trie<ScenicArea> | null = null;
  private scenicSnapshot: ScenicArea[] = [];
  private scenicTrieExpireAt = 0;
  private roadGraphCache = new Map<string, { nodes: RoadNode[]; edges: RoadEdge[]; expiresAt: number }>();
  private readonly roadGraphCacheTTL = 2 * 60 * 1000;
  private readonly facilityAliasMap: Record<string, string[]> = {
    卫生间: ['卫生间', '洗手间', '厕所', '公厕'],
    洗手间: ['洗手间', '卫生间', '厕所', '公厕'],
    厕所: ['厕所', '卫生间', '洗手间', '公厕'],
    公厕: ['公厕', '卫生间', '洗手间', '厕所'],
    便利店: ['便利店', '商店', '超市'],
    超市: ['超市', '便利店', '商店'],
    游客中心: ['游客中心', '服务中心', '游客服务中心'],
    停车场: ['停车场', '停车位'],
  };

  private mapScenicArea(entity: ScenicAreaEntity): ScenicArea {
    const presentation = resolveScenicPresentation(entity);

    return {
      id: entity.id,
      name: entity.name,
      description: entity.description || '',
      category: entity.category || '',
      city: entity.city,
      rating: entity.rating || 0,
      tags: entity.tags || '',
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      latitude: entity.latitude,
      longitude: entity.longitude,
      openingHours: entity.openingHours,
      ticketPrice: entity.ticketPrice,
      popularity: entity.popularity,
      averageRating: entity.averageRating,
      reviewCount: entity.reviewCount,
      visitorCount: entity.visitorCount,
      coverImageUrl: presentation.coverImageUrl,
      cityLabel: presentation.cityLabel,
      coverImageTheme: presentation.coverImageTheme,
    };
  }

  private mapAttraction(entity: AttractionEntity): Attraction {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description || '',
      category: entity.category || '',
      scenicAreaId: entity.scenicAreaId,
      city: entity.city,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      type: entity.type || '',
      rating: entity.averageRating || 0,
      latitude: entity.latitude,
      longitude: entity.longitude,
      openingHours: entity.openingHours,
      averageRating: entity.averageRating,
      reviewCount: entity.reviewCount,
    };
  }

  private mapFacility(entity: FacilityEntity): Facility {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description || '',
      scenicAreaId: entity.scenicAreaId,
      category: entity.category || '',
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      type: entity.category || '',
      latitude: entity.latitude,
      longitude: entity.longitude,
      openingHours: entity.openingHours,
    };
  }

  private mapDiary(entity: DiaryEntity): Diary {
    return {
      id: entity.id,
      title: entity.title || '',
      content: entity.content || '',
      userId: entity.userId,
      destination: entity.destination || '',
      visitDate: entity.visitDate || new Date(),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      popularity: entity.popularity,
      averageRating: entity.averageRating,
      reviewCount: entity.reviewCount,
      isShared: entity.isShared,
      route: normalizeStringArray(entity.route),
    };
  }

  private normalizeCategories(categories?: string[]): string[] {
    return Array.from(
      new Set(
        (Array.isArray(categories) ? categories : [])
          .map((item) => String(item).trim())
          .filter(Boolean),
      ),
    );
  }

  private resolveScenicScore(item: ScenicArea): number {
    const candidate = Number(item.averageRating ?? item.rating ?? 0);
    return Number.isFinite(candidate) ? candidate : 0;
  }

  private resolveScenicHeat(item: ScenicArea): number {
    const candidate = Number(item.visitorCount ?? item.popularity ?? 0);
    return Number.isFinite(candidate) ? candidate : 0;
  }

  private sortScenicAreas(items: ScenicArea[]): ScenicArea[] {
    return [...items].sort((left, right) => {
      const scoreDiff = this.resolveScenicScore(right) - this.resolveScenicScore(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const heatDiff = this.resolveScenicHeat(right) - this.resolveScenicHeat(left);
      if (heatDiff !== 0) {
        return heatDiff;
      }

      return left.name.localeCompare(right.name, 'zh-CN');
    });
  }

  private matchesScenicKeyword(item: ScenicArea, keyword: string): boolean {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return true;
    }

    return [item.name, item.description, item.tags, item.category, item.cityLabel, item.city]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .some((value) => value.toLowerCase().includes(normalizedKeyword));
  }

  private scoreScenicSuggestion(item: ScenicArea, keyword: string): number {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return 0;
    }

    const name = item.name.toLowerCase();
    const category = (item.category || '').toLowerCase();
    const tags = (item.tags || '').toLowerCase();
    const description = (item.description || '').toLowerCase();
    const cityLabel = (item.cityLabel || item.city || '').toLowerCase();

    let score = 0;

    if (name === normalizedKeyword) {
      score += 1200;
    }

    if (name.startsWith(normalizedKeyword)) {
      score += 900;
    }

    const nameIndex = name.indexOf(normalizedKeyword);
    if (nameIndex >= 0) {
      score += 700 - Math.min(nameIndex, 50) * 10;
    }

    if (category.includes(normalizedKeyword)) {
      score += 320;
    }

    if (tags.includes(normalizedKeyword)) {
      score += 260;
    }

    if (description.includes(normalizedKeyword)) {
      score += 180;
    }

    if (cityLabel.includes(normalizedKeyword)) {
      score += 120;
    }

    score += this.resolveScenicScore(item) * 15;
    score += Math.min(this.resolveScenicHeat(item), 100000) / 5000;

    return score;
  }

  private collectScenicSuggestionMatches(keyword: string, limit: number): ScenicArea[] {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword || !this.scenicSnapshot.length) {
      return [];
    }

    const prefixMatches = this.scenicTrie
      ? this.deduplicateScenic(this.scenicTrie.searchByPrefix(normalizedKeyword, Math.max(60, limit * 8)))
      : [];

    const containsMatches = this.scenicSnapshot.filter((item) => item.name.toLowerCase().includes(normalizedKeyword.toLowerCase()));
    const keywordMatches = this.scenicSnapshot.filter((item) => this.matchesScenicKeyword(item, normalizedKeyword));

    return this.deduplicateScenic([...prefixMatches, ...containsMatches, ...keywordMatches])
      .sort((left, right) => {
        const scoreDiff = this.scoreScenicSuggestion(right, normalizedKeyword) - this.scoreScenicSuggestion(left, normalizedKeyword);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        return this.sortScenicAreas([left, right])[0].id === left.id ? -1 : 1;
      })
      .slice(0, limit);
  }

  private applyScenicAreaFilters(items: ScenicArea[], categories: string[], minRating?: number): ScenicArea[] {
    return items.filter((item) => {
      const matchesCategory = categories.length === 0 || categories.includes(item.category);
      if (!matchesCategory) {
        return false;
      }

      if (typeof minRating === 'number' && Number.isFinite(minRating)) {
        return this.resolveScenicScore(item) >= minRating;
      }

      return true;
    });
  }

  public initializeScenicTrie(items: ScenicArea[]): Trie<ScenicArea> {
    const trie = new Trie<ScenicArea>();
    trie.bulkInsert(items.map((item) => ({ word: item.name, payload: item })));
    return trie;
  }

  async getScenicAreaDetails(id: string): Promise<{
    scenicArea: ScenicArea;
    attractions: Attraction[];
    facilities: Facility[];
  }> {
    if (AppDataSource && AppDataSource.isInitialized) {
      const scenicAreaRepository = AppDataSource.getRepository(ScenicAreaEntity);
      const attractionRepository = AppDataSource.getRepository(AttractionEntity);
      const facilityRepository = AppDataSource.getRepository(FacilityEntity);

      const scenicAreaEntity = await scenicAreaRepository.findOne({ where: { id } });
      if (scenicAreaEntity) {
        const attractions = await attractionRepository.find({ where: { scenicAreaId: id } });
        const facilities = await facilityRepository.find({ where: { scenicAreaId: id } });
        return {
          scenicArea: this.mapScenicArea(scenicAreaEntity),
          attractions: attractions.map((item) => this.mapAttraction(item)),
          facilities: facilities.map((item) => this.mapFacility(item)),
        };
      }
    }

    return {
      scenicArea: {
        id,
        name: '示例景区',
        description: '当前未查询到该景区，返回示例数据',
        category: '综合',
        rating: 4.5,
        tags: '示例,景区',
        createdAt: new Date(),
        updatedAt: new Date(),
        latitude: 39.9042,
        longitude: 116.4074,
        ticketPrice: 60,
        popularity: 1000,
        averageRating: 4.6,
        reviewCount: 120,
        ...resolveScenicPresentation({ name: '示例景区', category: '景区' }),
      },
      attractions: [],
      facilities: [],
    };
  }

  async queryScenicAreas(options: ScenicAreaQueryOptions): Promise<ScenicArea[]> {
    const normalizedName = String(options.name || '').trim();
    const categories = this.normalizeCategories(options.categories);
    const minRating =
      typeof options.minRating === 'number' && Number.isFinite(options.minRating) ? options.minRating : undefined;
    const limit = Math.max(1, Math.floor(options.limit || 10));

    if (!AppDataSource || !AppDataSource.isInitialized) {
      return [];
    }

    await this.ensureScenicTrieReady();

    if (!this.scenicSnapshot.length) {
      return [];
    }

    let candidates = [...this.scenicSnapshot];

    if (normalizedName) {
      const prefixMatches = this.scenicTrie
        ? this.deduplicateScenic(this.scenicTrie.searchByPrefix(normalizedName, Math.max(80, limit * 8)))
        : [];

      candidates =
        prefixMatches.length > 0
          ? prefixMatches
          : this.scenicSnapshot.filter((item) => this.matchesScenicKeyword(item, normalizedName));
    }

    const filtered = this.applyScenicAreaFilters(candidates, categories, minRating);
    return this.sortScenicAreas(filtered).slice(0, limit);
  }

  async searchScenicAreas(query: string, limit: number = 10): Promise<ScenicArea[]> {
    return this.queryScenicAreas({ name: query, limit });
  }

  async searchScenicAreaSuggestions(prefix: string, limit: number = 10): Promise<string[]> {
    const normalizedPrefix = prefix.trim();
    if (!normalizedPrefix) {
      return [];
    }

    if (!AppDataSource || !AppDataSource.isInitialized) {
      return [];
    }

    await this.ensureScenicTrieReady();
    if (!this.scenicTrie) {
      return [];
    }

    const suggestionMatches = this.collectScenicSuggestionMatches(normalizedPrefix, Math.max(1, limit * 3));
    return suggestionMatches
      .map((item) => item.name)
      .filter((item, index, array) => array.indexOf(item) === index)
      .slice(0, limit);
  }

  async listScenicAreaCategories(): Promise<string[]> {
    if (!AppDataSource || !AppDataSource.isInitialized) {
      return [];
    }

    await this.ensureScenicTrieReady();
    return Array.from(
      new Set(
        this.scenicSnapshot
          .map((item) => item.category.trim())
          .filter(Boolean),
      ),
    ).sort((left, right) => left.localeCompare(right, 'zh-CN'));
  }

  async searchFacilities(params: {
    type?: string;
    scenicAreaId?: string;
    userLocation?: { latitude: number; longitude: number };
    radiusKm?: number;
    limit?: number;
  }): Promise<Facility[]> {
    const { type, scenicAreaId, userLocation, radiusKm, limit = 10 } = params;
    if (!AppDataSource || !AppDataSource.isInitialized) {
      return [];
    }

    const facilityRepository = AppDataSource.getRepository(FacilityEntity);
    const expandedTypes = type ? this.expandFacilityKeywords(type) : [];
    const whereByType = expandedTypes.length
      ? expandedTypes.flatMap((keyword) => [{ category: Like(`%${keyword}%`) }, { name: Like(`%${keyword}%`) }])
      : undefined;

    const queryTake = Math.max(limit * 6, 30);
    const entities = scenicAreaId
      ? await facilityRepository.find({
          where: whereByType
            ? whereByType.map((item) => ({ scenicAreaId, ...item }))
            : { scenicAreaId },
          take: queryTake,
        })
      : await facilityRepository.find({
          where: whereByType,
          take: queryTake,
        });

    const facilities = entities.map((item) => this.mapFacility(item));
    if (!userLocation || !facilities.length) {
      return facilities.slice(0, limit);
    }

    const scenicAreaKey = scenicAreaId || facilities[0].scenicAreaId;
    const roadGraph = await this.loadRoadGraph(scenicAreaKey);
    if (roadGraph) {
      const userNearestNodeId = this.findNearestRoadNodeId(roadGraph.nodes, userLocation);
      const distanceMap = userNearestNodeId ? this.dijkstraDistances(roadGraph.edges, userNearestNodeId) : new Map<string, number>();

      for (const facility of facilities) {
        const facilityNearestNodeId = this.findNearestRoadNodeId(roadGraph.nodes, {
          latitude: facility.latitude || 0,
          longitude: facility.longitude || 0,
        });
        if (facilityNearestNodeId && distanceMap.has(facilityNearestNodeId)) {
          facility.distanceKm = Number((distanceMap.get(facilityNearestNodeId) || 0).toFixed(3));
          facility.distanceSource = 'road_network';
        } else {
          facility.distanceKm = Number(
            haversineDistanceKm(
              userLocation.latitude,
              userLocation.longitude,
              facility.latitude || 0,
              facility.longitude || 0,
            ).toFixed(3),
          );
          facility.distanceSource = 'haversine';
        }
      }
    } else {
      for (const facility of facilities) {
        facility.distanceKm = Number(
          haversineDistanceKm(
            userLocation.latitude,
            userLocation.longitude,
            facility.latitude || 0,
            facility.longitude || 0,
          ).toFixed(3),
        );
        facility.distanceSource = 'haversine';
      }
    }

    const safeRadiusKm =
      typeof radiusKm === 'number' && Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : undefined;

    const filteredFacilities = safeRadiusKm
      ? facilities.filter((facility) => typeof facility.distanceKm === 'number' && facility.distanceKm <= safeRadiusKm)
      : facilities;

    filteredFacilities.sort(
      (a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY),
    );
    return filteredFacilities.slice(0, limit);
  }

  private expandFacilityKeywords(keyword: string): string[] {
    const normalized = keyword.trim();
    if (!normalized) {
      return [];
    }

    const aliasGroups = Object.entries(this.facilityAliasMap)
      .filter(([key, aliases]) => normalized.includes(key) || aliases.includes(normalized))
      .flatMap(([, aliases]) => aliases);

    return Array.from(new Set([normalized, ...aliasGroups]));
  }

  async searchFood(query: string, limit: number = 10): Promise<Attraction[]> {
    if (AppDataSource && AppDataSource.isInitialized) {
      const foodRepository = AppDataSource.getRepository(FoodEntity);
      const entities = await foodRepository.find({
        where: [{ name: Like(`%${query}%`) }, { cuisine: Like(`%${query}%`) }, { description: Like(`%${query}%`) }],
        take: limit,
      });
      return entities.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description || '',
        category: item.cuisine || '美食',
        scenicAreaId: item.facilityId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        rating: item.averageRating || 0,
      }));
    }
    return [];
  }

  async search(query: string, limit: number = 15): Promise<{
    scenicAreas: ScenicArea[];
    attractions: Attraction[];
    facilities: Facility[];
  }> {
    const scenicAreas = await this.searchScenicAreas(query, Math.max(1, Math.floor(limit * 0.4)));
    const attractions = await this.searchFood(query, Math.max(1, Math.floor(limit * 0.4)));
    const facilities = await this.searchFacilities({ type: query, limit: Math.max(1, Math.floor(limit * 0.2)) });
    return { scenicAreas, attractions, facilities };
  }

  async searchScenicAreasByCategory(category: string, limit: number = 10): Promise<ScenicArea[]> {
    if (AppDataSource && AppDataSource.isInitialized) {
      const scenicAreaRepository = AppDataSource.getRepository(ScenicAreaEntity);
      const entities = await scenicAreaRepository.find({
        where: { category: Like(`%${category}%`) },
        order: { averageRating: 'DESC' },
        take: limit,
      });
      return entities.map((item) => this.mapScenicArea(item));
    }
    return [];
  }

  async searchScenicAreasByTag(tag: string, limit: number = 10): Promise<ScenicArea[]> {
    if (AppDataSource && AppDataSource.isInitialized) {
      const scenicAreaRepository = AppDataSource.getRepository(ScenicAreaEntity);
      const entities = await scenicAreaRepository.find({
        where: { tags: Like(`%${tag}%`) },
        order: { averageRating: 'DESC' },
        take: limit,
      });
      return entities.map((item) => this.mapScenicArea(item));
    }
    return [];
  }

  async searchDiaries(query: string, limit: number = 10): Promise<Diary[]> {
    if (AppDataSource && AppDataSource.isInitialized) {
      const diaryRepository = AppDataSource.getRepository(DiaryEntity);
      const entities = await diaryRepository.find({
        where: [{ title: Like(`%${query}%`) }, { content: Like(`%${query}%`) }, { destination: Like(`%${query}%`) }],
        order: { createdAt: 'DESC' },
        take: limit,
      });
      return entities.map((item) => this.mapDiary(item));
    }
    return [];
  }

  async searchDiariesByDestination(destination: string, limit: number = 10): Promise<Diary[]> {
    if (AppDataSource && AppDataSource.isInitialized) {
      const diaryRepository = AppDataSource.getRepository(DiaryEntity);
      const entities = await diaryRepository.find({
        where: { destination: Like(`%${destination}%`) },
        order: { popularity: 'DESC' },
        take: limit,
      });
      return entities.map((item) => this.mapDiary(item));
    }
    return [];
  }

  async exportScenicAreaData(): Promise<string> {
    const exportData: {
      scenicAreas: ScenicAreaEntity[];
      attractions: AttractionEntity[];
      facilities: FacilityEntity[];
    } = {
      scenicAreas: [],
      attractions: [],
      facilities: [],
    };

    if (AppDataSource && AppDataSource.isInitialized) {
      const scenicAreaRepository = AppDataSource.getRepository(ScenicAreaEntity);
      const attractionRepository = AppDataSource.getRepository(AttractionEntity);
      const facilityRepository = AppDataSource.getRepository(FacilityEntity);
      exportData.scenicAreas = await scenicAreaRepository.find();
      exportData.attractions = await attractionRepository.find();
      exportData.facilities = await facilityRepository.find();
    }

    return JSON.stringify(exportData, null, 2);
  }

  async importScenicAreaData(payload: {
    scenicAreas?: Partial<ScenicAreaEntity>[];
    attractions?: Partial<AttractionEntity>[];
    facilities?: Partial<FacilityEntity>[];
  }): Promise<{ scenicAreas: number; attractions: number; facilities: number }> {
    if (!AppDataSource || !AppDataSource.isInitialized) {
      throw new Error('数据库尚未初始化，无法导入数据');
    }

    const scenicAreas = Array.isArray(payload?.scenicAreas) ? payload.scenicAreas : [];
    const attractions = Array.isArray(payload?.attractions) ? payload.attractions : [];
    const facilities = Array.isArray(payload?.facilities) ? payload.facilities : [];

    await AppDataSource.transaction(async (manager) => {
      if (scenicAreas.length > 0) {
        await manager
          .getRepository(ScenicAreaEntity)
          .save(scenicAreas.map((item) => manager.getRepository(ScenicAreaEntity).create(item as ScenicAreaEntity)));
      }

      if (attractions.length > 0) {
        await manager
          .getRepository(AttractionEntity)
          .save(attractions.map((item) => manager.getRepository(AttractionEntity).create(item as AttractionEntity)));
      }

      if (facilities.length > 0) {
        await manager
          .getRepository(FacilityEntity)
          .save(facilities.map((item) => manager.getRepository(FacilityEntity).create(item as FacilityEntity)));
      }
    });

    this.scenicTrie = null;
    this.scenicSnapshot = [];
    this.scenicTrieExpireAt = 0;

    return {
      scenicAreas: scenicAreas.length,
      attractions: attractions.length,
      facilities: facilities.length,
    };
  }

  private async loadRoadGraph(scenicAreaId: string): Promise<{ nodes: RoadNode[]; edges: RoadEdge[] } | null> {
    if (!AppDataSource || !AppDataSource.isInitialized || !scenicAreaId) {
      return null;
    }
    const now = Date.now();
    const cached = this.roadGraphCache.get(scenicAreaId);
    if (cached && now < cached.expiresAt) {
      return { nodes: cached.nodes, edges: cached.edges };
    }

    const nodeRepo = AppDataSource.getRepository(RoadGraphNodeEntity);
    const edgeRepo = AppDataSource.getRepository(RoadGraphEdgeEntity);
    const [nodes, edges] = await Promise.all([
      nodeRepo.find({ where: { scenicAreaId } }),
      edgeRepo.find({ where: { scenicAreaId } }),
    ]);

    if (!nodes.length || !edges.length) {
      return null;
    }

    const graph = {
      nodes: nodes.map((item) => ({
        id: item.id,
        scenicAreaId: item.scenicAreaId,
        latitude: Number(item.latitude ?? 0),
        longitude: Number(item.longitude ?? 0),
      })),
      edges: edges.map((item) => ({
        fromNodeId: item.fromNodeId,
        toNodeId: item.toNodeId,
        scenicAreaId: item.scenicAreaId,
        distance: Number(item.distance ?? 0),
      })),
    };
    this.roadGraphCache.set(scenicAreaId, {
      ...graph,
      expiresAt: now + this.roadGraphCacheTTL,
    });
    return graph;
  }

  private findNearestRoadNodeId(nodes: RoadNode[], location: { latitude: number; longitude: number }): string | null {
    if (!nodes.length) {
      return null;
    }
    let nearest: string | null = null;
    let minDistance = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
      const distance = haversineDistanceKm(
        location.latitude,
        location.longitude,
        node.latitude,
        node.longitude,
      );
      if (distance < minDistance) {
        minDistance = distance;
        nearest = node.id;
      }
    }
    return nearest;
  }

  private dijkstraDistances(edges: RoadEdge[], startNodeId: string): Map<string, number> {
    const adjacency = new Map<string, Array<{ to: string; distance: number }>>();
    for (const edge of edges) {
      if (!adjacency.has(edge.fromNodeId)) {
        adjacency.set(edge.fromNodeId, []);
      }
      if (!adjacency.has(edge.toNodeId)) {
        adjacency.set(edge.toNodeId, []);
      }
      adjacency.get(edge.fromNodeId)?.push({ to: edge.toNodeId, distance: edge.distance });
      adjacency.get(edge.toNodeId)?.push({ to: edge.fromNodeId, distance: edge.distance });
    }

    const distances = new Map<string, number>();
    const visited = new Set<string>();
    for (const nodeId of adjacency.keys()) {
      distances.set(nodeId, Number.POSITIVE_INFINITY);
    }
    distances.set(startNodeId, 0);

    while (visited.size < adjacency.size) {
      let currentNodeId: string | null = null;
      let minDistance = Number.POSITIVE_INFINITY;
      for (const [nodeId, distance] of distances) {
        if (!visited.has(nodeId) && distance < minDistance) {
          minDistance = distance;
          currentNodeId = nodeId;
        }
      }
      if (!currentNodeId) {
        break;
      }
      visited.add(currentNodeId);
      for (const next of adjacency.get(currentNodeId) || []) {
        const candidate = (distances.get(currentNodeId) ?? Number.POSITIVE_INFINITY) + next.distance;
        if (candidate < (distances.get(next.to) ?? Number.POSITIVE_INFINITY)) {
          distances.set(next.to, candidate);
        }
      }
    }

    const result = new Map<string, number>();
    for (const [nodeId, distanceMeter] of distances) {
      result.set(nodeId, distanceMeter / 1000);
    }
    return result;
  }



  private deduplicateScenic(items: ScenicArea[]): ScenicArea[] {
    const map = new Map<string, ScenicArea>();
    for (const item of items) {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  }

  private async ensureScenicTrieReady(): Promise<void> {
    if (!AppDataSource || !AppDataSource.isInitialized) {
      return;
    }
    const now = Date.now();
    if (this.scenicTrie && now < this.scenicTrieExpireAt) {
      return;
    }

    const scenicAreaRepository = AppDataSource.getRepository(ScenicAreaEntity);
    const entities = await scenicAreaRepository.find({
      take: 5000,
      order: { popularity: 'DESC' },
    });
    const mapped = entities.map((item) => this.mapScenicArea(item));
    this.scenicTrie = this.initializeScenicTrie(mapped);
    this.scenicSnapshot = mapped;
    this.scenicTrieExpireAt = now + 2 * 60 * 1000;
  }
}
