import { AppDataSource } from '../config/database';
import { buildDefaultRuntimeTemplatePayloads, RuntimeTemplatePayload, TemplateKind } from '../data/mapTemplateDefinitions';
import { Attraction } from '../entities/Attraction';
import { Facility } from '../entities/Facility';
import { Food } from '../entities/Food';
import { MapTemplate } from '../entities/MapTemplate';
import { PhotoSpot } from '../entities/PhotoSpot';
import { RoadGraphEdge } from '../entities/RoadGraphEdge';
import { RoadGraphNode } from '../entities/RoadGraphNode';
import { ScenicArea } from '../entities/ScenicArea';

type ScenicAreaLike = Pick<
  ScenicArea,
  'id' | 'name' | 'category' | 'city' | 'latitude' | 'longitude' | 'createdAt' | 'updatedAt'
>;

export interface RuntimeScenicInternalMap {
  templateKey: TemplateKind;
  scenicArea: ScenicAreaLike;
  attractions: Attraction[];
  facilities: Facility[];
  foods: Food[];
  photoSpots: PhotoSpot[];
  roadNodes: RoadGraphNode[];
  roadEdges: RoadGraphEdge[];
}

const TEMPLATE_SEED_VERSION = 1;
const CACHE_TTL_MS = 5 * 60 * 1000;

const roundCoord = (value: number) => Number(value.toFixed(8));

const createStableId = (...parts: string[]) => ['rt', ...parts].join('|');

const resolveTemplateKey = (category?: string | null): TemplateKind | null => {
  const normalized = String(category || '').trim();
  if (normalized.includes('校园')) {
    return 'campus';
  }
  if (normalized.includes('景区')) {
    return 'scenic';
  }
  return null;
};

export class MapTemplateRuntimeService {
  private readonly payloadCache = new Map<TemplateKind, RuntimeTemplatePayload>();
  private readonly scenicCache = new Map<string, { expiresAt: number; data: RuntimeScenicInternalMap }>();
  private seedPromise: Promise<void> | null = null;

  async ensureTemplatesPersisted(): Promise<void> {
    if (!AppDataSource?.isInitialized) {
      return;
    }
    if (this.seedPromise) {
      return this.seedPromise;
    }
    this.seedPromise = this.seedTemplatesInternal();
    try {
      await this.seedPromise;
    } finally {
      this.seedPromise = null;
    }
  }

  private async seedTemplatesInternal(): Promise<void> {
    const repo = AppDataSource!.getRepository(MapTemplate);
    const defaults = buildDefaultRuntimeTemplatePayloads();

    for (const payload of defaults) {
      const existing = await repo.findOne({ where: { templateKey: payload.templateKey } });
      const serialized = JSON.stringify(payload);
      if (!existing) {
        await repo.save(
          repo.create({
            templateKey: payload.templateKey,
            category: payload.templateKey === 'campus' ? '校园' : '景区',
            name: payload.name,
            version: TEMPLATE_SEED_VERSION,
            payload: serialized,
          }),
        );
        this.payloadCache.set(payload.templateKey, payload);
        continue;
      }

      if (existing.version !== TEMPLATE_SEED_VERSION || existing.payload !== serialized || existing.name !== payload.name) {
        existing.category = payload.templateKey === 'campus' ? '校园' : '景区';
        existing.name = payload.name;
        existing.version = TEMPLATE_SEED_VERSION;
        existing.payload = serialized;
        await repo.save(existing);
      }
      this.payloadCache.set(payload.templateKey, payload);
    }
  }

  async getTemplatePayload(templateKey: TemplateKind): Promise<RuntimeTemplatePayload | null> {
    await this.ensureTemplatesPersisted();
    const cached = this.payloadCache.get(templateKey);
    if (cached) {
      return cached;
    }
    if (!AppDataSource?.isInitialized) {
      return null;
    }
    const repo = AppDataSource.getRepository(MapTemplate);
    const record = await repo.findOne({ where: { templateKey } });
    if (!record) {
      return null;
    }
    const payload = JSON.parse(record.payload) as RuntimeTemplatePayload;
    this.payloadCache.set(templateKey, payload);
    return payload;
  }

  async getRuntimeMapForScenicArea(scenicArea: ScenicAreaLike): Promise<RuntimeScenicInternalMap | null> {
    const templateKey = resolveTemplateKey(scenicArea.category);
    if (!templateKey) {
      return null;
    }

    const cacheKey = scenicArea.id;
    const cached = this.scenicCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const payload = await this.getTemplatePayload(templateKey);
    if (!payload) {
      return null;
    }

    const data = this.instantiateTemplate(payload, scenicArea);
    this.scenicCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, data });
    return data;
  }

  async getRuntimeMapForScenicAreaId(scenicAreaId: string): Promise<RuntimeScenicInternalMap | null> {
    if (!AppDataSource?.isInitialized || !scenicAreaId) {
      return null;
    }
    const scenicAreaRepo = AppDataSource.getRepository(ScenicArea);
    const scenicArea = await scenicAreaRepo.findOne({
      where: { id: scenicAreaId },
      select: ['id', 'name', 'category', 'city', 'latitude', 'longitude', 'createdAt', 'updatedAt'],
    });
    if (!scenicArea) {
      return null;
    }
    return this.getRuntimeMapForScenicArea(scenicArea);
  }

  async getRuntimeMapForScenicAreaIds(scenicAreaIds: string[]): Promise<Map<string, RuntimeScenicInternalMap>> {
    const result = new Map<string, RuntimeScenicInternalMap>();
    for (const scenicAreaId of scenicAreaIds) {
      const map = await this.getRuntimeMapForScenicAreaId(scenicAreaId);
      if (map) {
        result.set(scenicAreaId, map);
      }
    }
    return result;
  }

  private instantiateTemplate(payload: RuntimeTemplatePayload, scenicArea: ScenicAreaLike): RuntimeScenicInternalMap {
    const targetLatitude = Number(scenicArea.latitude ?? payload.center.latitude);
    const targetLongitude = Number(scenicArea.longitude ?? payload.center.longitude);

    const transform = (latitude: number, longitude: number) => ({
      latitude: roundCoord(targetLatitude + (Number(latitude) - payload.center.latitude)),
      longitude: roundCoord(targetLongitude + (Number(longitude) - payload.center.longitude)),
    });

    const roadNodeIdMap = new Map<string, string>();
    const attractionIdMap = new Map<string, string>();
    const facilityIdMap = new Map<string, string>();

    const attractions = payload.attractions.map((item) => {
      const coords = transform(item.latitude, item.longitude);
      const id = createStableId(payload.templateKey, 'attraction', scenicArea.id, item.templateId);
      attractionIdMap.set(item.templateId, id);

      const attraction = new Attraction();
      attraction.id = id;
      attraction.scenicAreaId = scenicArea.id;
      attraction.name = payload.templateKey === 'campus' ? `${scenicArea.name}-${item.name}` : item.name;
      attraction.type = item.type;
      attraction.category = item.category;
      attraction.city = scenicArea.city ?? null;
      attraction.description =
        payload.templateKey === 'campus'
          ? `${scenicArea.name}内部导航点位，类别为${item.category}。`
          : item.description;
      attraction.latitude = coords.latitude;
      attraction.longitude = coords.longitude;
      attraction.openingHours = '{}';
      attraction.averageRating = item.averageRating;
      attraction.reviewCount = item.reviewCount;
      attraction.estimatedVisitDuration = item.estimatedVisitDuration;
      attraction.congestionFactor = item.congestionFactor;
      attraction.tags = payload.templateKey === 'campus' ? ['校园', item.category, scenicArea.name] : item.tags;
      attraction.indoorStructure = item.indoorStructure || '{}';
      attraction.createdAt = scenicArea.createdAt || new Date();
      attraction.updatedAt = scenicArea.updatedAt || new Date();
      return attraction;
    });

    const facilities = payload.facilities.map((item) => {
      const coords = transform(item.latitude, item.longitude);
      const id = createStableId(payload.templateKey, 'facility', scenicArea.id, item.templateId);
      facilityIdMap.set(item.templateId, id);

      const facility = new Facility();
      facility.id = id;
      facility.scenicAreaId = scenicArea.id;
      facility.name = payload.templateKey === 'campus' ? `${scenicArea.name}-${item.name}` : item.name;
      facility.category = item.category;
      facility.latitude = coords.latitude;
      facility.longitude = coords.longitude;
      facility.openingHours = item.openingHours || '{}';
      facility.description =
        payload.templateKey === 'campus'
          ? `${scenicArea.name}内部服务设施，类别为${item.category}。`
          : item.description;
      facility.createdAt = scenicArea.createdAt || new Date();
      facility.updatedAt = scenicArea.updatedAt || new Date();
      return facility;
    });

    const foods = payload.foods.map((item) => {
      const food = new Food();
      food.id = createStableId(payload.templateKey, 'food', scenicArea.id, item.templateId);
      food.facilityId = facilityIdMap.get(item.facilityTemplateId) || item.facilityTemplateId;
      food.name = item.name;
      food.cuisine = item.cuisine;
      food.price = item.price;
      food.description =
        payload.templateKey === 'campus'
          ? `${scenicArea.name}内部餐饮点，依附于${facilities.find((facility) => facility.id === food.facilityId)?.name || '服务设施'}。`
          : item.description;
      food.popularity = item.popularity;
      food.averageRating = item.averageRating;
      food.reviewCount = item.reviewCount;
      food.tags = item.tags;
      food.isSeasonalSpecial = item.isSeasonalSpecial;
      food.createdAt = scenicArea.createdAt || new Date();
      food.updatedAt = scenicArea.updatedAt || new Date();
      return food;
    });

    const photoSpots = payload.photoSpots.map((item) => {
      const coords = transform(item.latitude, item.longitude);
      const photoSpot = new PhotoSpot();
      photoSpot.id = createStableId(payload.templateKey, 'photo', scenicArea.id, item.templateId);
      photoSpot.scenicAreaId = scenicArea.id;
      photoSpot.attractionId = item.attractionTemplateId ? attractionIdMap.get(item.attractionTemplateId) || null : null;
      photoSpot.name = payload.templateKey === 'campus' ? `${scenicArea.name}-${item.name}` : item.name;
      photoSpot.description = item.description;
      photoSpot.latitude = coords.latitude;
      photoSpot.longitude = coords.longitude;
      photoSpot.bestTime = item.bestTime;
      photoSpot.popularity = item.popularity;
      photoSpot.crowdLevel = item.crowdLevel;
      photoSpot.lightingCondition = item.lightingCondition;
      photoSpot.examplePhotos = JSON.stringify(item.examplePhotos);
      photoSpot.createdAt = scenicArea.createdAt || new Date();
      photoSpot.updatedAt = scenicArea.updatedAt || new Date();
      return photoSpot;
    });

    const roadNodes = payload.roadNodes.map((item) => {
      const coords = transform(item.latitude, item.longitude);
      const id = createStableId(payload.templateKey, 'road-node', scenicArea.id, item.templateId);
      roadNodeIdMap.set(item.templateId, id);

      const roadNode = new RoadGraphNode();
      roadNode.id = id;
      roadNode.scenicAreaId = scenicArea.id;
      roadNode.type = item.type;
      roadNode.name = `${scenicArea.name}-${item.name}`;
      roadNode.latitude = coords.latitude;
      roadNode.longitude = coords.longitude;
      roadNode.createdAt = scenicArea.createdAt || new Date();
      roadNode.updatedAt = scenicArea.updatedAt || new Date();
      return roadNode;
    });

    const roadEdges = payload.roadEdges.map((item) => {
      const roadEdge = new RoadGraphEdge();
      roadEdge.id = createStableId(payload.templateKey, 'road-edge', scenicArea.id, item.templateId);
      roadEdge.scenicAreaId = scenicArea.id;
      roadEdge.fromNodeId = roadNodeIdMap.get(item.fromTemplateId) || item.fromTemplateId;
      roadEdge.toNodeId = roadNodeIdMap.get(item.toTemplateId) || item.toTemplateId;
      roadEdge.distance = item.distance;
      roadEdge.roadType = item.roadType;
      roadEdge.congestionFactor = item.congestionFactor;
      roadEdge.allowedTransportation = JSON.stringify(item.allowedTransportation);
      roadEdge.isElectricCartRoute = item.isElectricCartRoute;
      roadEdge.isBicyclePath = item.isBicyclePath;
      roadEdge.transportation = item.transportation;
      roadEdge.createdAt = scenicArea.createdAt || new Date();
      roadEdge.updatedAt = scenicArea.updatedAt || new Date();
      return roadEdge;
    });

    return {
      templateKey: payload.templateKey,
      scenicArea,
      attractions,
      facilities,
      foods,
      photoSpots,
      roadNodes,
      roadEdges,
    };
  }
}

export const mapTemplateRuntimeService = new MapTemplateRuntimeService();
