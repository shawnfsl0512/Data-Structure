﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿import { AppDataSource } from '../config/database';
import { Attraction as AttractionEntity } from '../entities/Attraction';
import { Facility as FacilityEntity } from '../entities/Facility';
import { RoadGraphEdge as RoadGraphEdgeEntity } from '../entities/RoadGraphEdge';
import { RoadGraphNode as RoadGraphNodeEntity } from '../entities/RoadGraphNode';
import { ScenicArea as ScenicAreaEntity } from '../entities/ScenicArea';
import { User as UserEntity } from '../entities/User';
import cache from '../config/cache';
import { haversineDistanceKm, haversineDistanceMeters } from '../utils/geoUtils';
import { mapTemplateRuntimeService } from './MapTemplateRuntimeService';

enum Transportation {
  WALK = 'walk',
  BICYCLE = 'bicycle',
  ELECTRIC_CART = 'electric_cart',
}

enum PathStrategy {
  SHORTEST_DISTANCE = 'shortest_distance',
  SHORTEST_TIME = 'shortest_time',
}

interface GraphNode {
  id: string;
  scenicAreaId?: string;
  type: string;
  name: string;
  location: {
    latitude: number;
    longitude: number;
  };
}

interface NodeSearchResult {
  id: string;
  name: string;
  type: string;
  scenicAreaId: string | null;
  latitude: number;
  longitude: number;
}

interface GraphEdge {
  id: string;
  scenicAreaId?: string;
  from: string;
  to: string;
  distance: number;
  roadType: string;
  congestionFactor: number;
  allowedTransportation: Transportation[];
  isElectricCartRoute: boolean;
  isBicyclePath: boolean;
}

interface PathSegment extends GraphEdge {
  usedTransportation: Transportation;
  edgeTimeMinutes: number;
}

interface PathResult {
  path: PathSegment[];
  totalDistance: number;
  totalTime: number;
}

interface RoutePoint {
  latitude: number;
  longitude: number;
}

interface RouteBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

type PlanningProfileKind = 'campus' | 'scenic' | 'generic';

interface PlanningProfile {
  kind: PlanningProfileKind;
  label: string;
  category: string | null;
  allowedTransportations: Transportation[];
  defaultTransportations: Transportation[];
  vehicleTransportation: Transportation | null;
  description: string;
}

interface RouteContext {
  scenicAreaId: string | null;
  scenicAreaName: string | null;
  center: RoutePoint | null;
  bounds: RouteBounds | null;
  mapMode: 'street' | 'scenic';
  isVirtualScenic: boolean;
  planningProfile: PlanningProfile;
}

interface RouteResponseSegment {
  from: string;
  to: string;
  transportation: Transportation;
  distance: number;
  time: number;
  roadType: string;
  roadName?: string;
  instruction?: string;
  congestionFactor?: number;
  fromLocation: RoutePoint;
  toLocation: RoutePoint;
  pathPoints: RoutePoint[];
  isConnector?: boolean;
}

interface PathResponse {
  path: string[];
  distance: number;
  time: number;
  segments: RouteResponseSegment[];
  routeGeometry: RoutePoint[];
  routeSource: 'graph' | 'osrm';
  routeContext: RouteContext;
  strategy?: PathStrategy;
  transportationModes?: Transportation[];
  isMixedTransportation?: boolean;
}

interface OsrmRouteStep {
  distance?: number;
  duration?: number;
  name?: string;
  ref?: string;
  mode?: string;
  geometry?: {
    type?: string;
    coordinates?: Array<[number, number]>;
  };
  maneuver?: {
    type?: string;
    modifier?: string;
    location?: [number, number];
  };
}

interface OsrmRouteLeg {
  steps?: OsrmRouteStep[];
}

interface OsrmRoutePayload {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: {
      type?: string;
      coordinates?: Array<[number, number]>;
    };
    legs?: OsrmRouteLeg[];
  }>;
}

const TRANSPORTATION_SPEED_KMH: Record<Transportation, number> = {
  [Transportation.WALK]: 4.5,
  [Transportation.BICYCLE]: 15,
  [Transportation.ELECTRIC_CART]: 20,
};

const DEFAULT_NODE_LABEL_PREFIX = '节点';
const DEFAULT_SCENIC_NAME = '景区';
const DEFAULT_NEXT_DESTINATION = '下一站';

const STEP_ACTION_LABELS: Record<string, string> = {
  left: '左转进入',
  right: '右转进入',
  straight: '沿',
  'slight left': '向左前方进入',
  'slight right': '向右前方进入',
  'sharp left': '向左急转进入',
  'sharp right': '向右急转进入',
  uturn: '掉头进入',
};

const collectTransportationModes = (
  modes: Array<Transportation | null | undefined>,
): Transportation[] => {
  const ordered: Transportation[] = [];
  for (const mode of modes) {
    if (mode && !ordered.includes(mode)) {
      ordered.push(mode);
    }
  }
  return ordered;
};

const normalizeCongestionFactor = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  if (value <= 1) {
    return value;
  }
  // 兼容旧实现里“数值越大越堵”的历史数据，将其折算为速度系数。
  return Number((1 / value).toFixed(4));
};

class RoadGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly outgoingEdges = new Map<string, GraphEdge[]>();

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.outgoingEdges.has(node.id)) {
      this.outgoingEdges.set(node.id, []);
    }
  }

  addEdge(edge: GraphEdge): void {
    if (!this.outgoingEdges.has(edge.from)) {
      this.outgoingEdges.set(edge.from, []);
    }
    this.outgoingEdges.get(edge.from)?.push(edge);
  }

  hasDirectedEdge(from: string, to: string): boolean {
    return this.getEdges(from).some((edge) => edge.to === to);
  }

  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  getNode(nodeId: string): GraphNode | undefined {
    return this.nodes.get(nodeId);
  }

  getEdges(fromNodeId: string): GraphEdge[] {
    return this.outgoingEdges.get(fromNodeId) ?? [];
  }

  getAllEdges(): GraphEdge[] {
    const edges: GraphEdge[] = [];
    for (const node of this.getAllNodes()) {
      edges.push(...this.getEdges(node.id));
    }
    return edges;
  }
}

class MinPriorityQueue {
  private readonly heap: Array<{ nodeId: string; distance: number }> = [];

  push(item: { nodeId: string; distance: number }) {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (!this.heap.length) {
      return undefined;
    }
    const root = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length && last) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return root;
  }

  get size() {
    return this.heap.length;
  }

  private bubbleUp(index: number) {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.heap[parent].distance <= this.heap[current].distance) {
        break;
      }
      this.swap(parent, current);
      current = parent;
    }
  }

  private bubbleDown(index: number) {
    let current = index;
    while (true) {
      const left = current * 2 + 1;
      const right = current * 2 + 2;
      let smallest = current;

      if (left < this.heap.length && this.heap[left].distance < this.heap[smallest].distance) {
        smallest = left;
      }
      if (right < this.heap.length && this.heap[right].distance < this.heap[smallest].distance) {
        smallest = right;
      }
      if (smallest === current) {
        break;
      }
      this.swap(current, smallest);
      current = smallest;
    }
  }

  private swap(i: number, j: number) {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
  }
}

class PathPlanner {
  private readonly graph: RoadGraph;

  constructor(graph: RoadGraph) {
    this.graph = graph;
  }

  findPath(
    startNodeId: string,
    endNodeId: string,
    strategy: PathStrategy,
    allowedTransportation: Transportation[],
  ): PathResult {
    const nodes = this.graph.getAllNodes();
    if (!nodes.length || !this.graph.getNode(startNodeId) || !this.graph.getNode(endNodeId)) {
      return { path: [], totalDistance: 0, totalTime: 0 };
    }

    const weights = new Map<string, number>();
    const totalDistances = new Map<string, number>();
    const totalTimes = new Map<string, number>();
    const previous = new Map<
      string,
      {
        edge: GraphEdge;
        mode: Transportation;
        edgeTimeMinutes: number;
      } | null
    >();

    for (const node of nodes) {
      weights.set(node.id, Number.POSITIVE_INFINITY);
      totalDistances.set(node.id, Number.POSITIVE_INFINITY);
      totalTimes.set(node.id, Number.POSITIVE_INFINITY);
      previous.set(node.id, null);
    }
    weights.set(startNodeId, 0);
    totalDistances.set(startNodeId, 0);
    totalTimes.set(startNodeId, 0);

    const queue = new MinPriorityQueue();
    queue.push({ nodeId: startNodeId, distance: 0 });

    while (queue.size > 0) {
      const current = queue.pop();
      if (!current) {
        break;
      }
      const currentNodeId = current.nodeId;
      if (current.distance > (weights.get(currentNodeId) ?? Number.POSITIVE_INFINITY) + 1e-9) {
        continue;
      }

      if (currentNodeId === endNodeId) {
        break;
      }

      for (const edge of this.graph.getEdges(currentNodeId)) {
        const traversal = this.resolveEdgeTraversal(edge, allowedTransportation, strategy);
        if (!traversal) {
          continue;
        }

        const edgeWeight =
          strategy === PathStrategy.SHORTEST_DISTANCE
            ? edge.distance
            : traversal.edgeTimeMinutes;
        const candidateWeight = (weights.get(currentNodeId) ?? Number.POSITIVE_INFINITY) + edgeWeight;

        if (candidateWeight + 1e-9 < (weights.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
          weights.set(edge.to, candidateWeight);
          totalDistances.set(
            edge.to,
            (totalDistances.get(currentNodeId) ?? Number.POSITIVE_INFINITY) + edge.distance,
          );
          totalTimes.set(
            edge.to,
            (totalTimes.get(currentNodeId) ?? Number.POSITIVE_INFINITY) + traversal.edgeTimeMinutes,
          );
          previous.set(edge.to, {
            edge,
            mode: traversal.mode,
            edgeTimeMinutes: traversal.edgeTimeMinutes,
          });
          queue.push({ nodeId: edge.to, distance: candidateWeight });
        }
      }
    }

    const path: PathSegment[] = [];
    let totalDistance = 0;
    let totalTime = 0;
    let current = endNodeId;

    while (previous.get(current)) {
      const prev = previous.get(current);
      if (!prev) {
        break;
      }
      path.unshift({
        ...prev.edge,
        usedTransportation: prev.mode,
        edgeTimeMinutes: prev.edgeTimeMinutes,
      });
      totalDistance += prev.edge.distance;
      totalTime += prev.edgeTimeMinutes;
      current = prev.edge.from;
    }

    if (!path.length || current !== startNodeId) {
      return { path: [], totalDistance: 0, totalTime: 0 };
    }

    return {
      path,
      totalDistance: Number((totalDistances.get(endNodeId) ?? totalDistance).toFixed(6)),
      totalTime: Number((totalTimes.get(endNodeId) ?? totalTime).toFixed(6)),
    };
  }

  private resolveEdgeTraversal(
    edge: GraphEdge,
    allowedTransportation: Transportation[],
    strategy: PathStrategy,
  ): { mode: Transportation; edgeTimeMinutes: number } | null {
    const isConnector = edge.roadType === 'connector';

    if (isConnector) {
      if (
        allowedTransportation.includes(Transportation.WALK) &&
        edge.allowedTransportation.includes(Transportation.WALK)
      ) {
        return {
          mode: Transportation.WALK,
          edgeTimeMinutes: this.calculateEdgeTimeMinutes(edge, Transportation.WALK),
        };
      }
      return null;
    }

    const candidates = edge.allowedTransportation.filter((mode) => allowedTransportation.includes(mode));
    if (!candidates.length) {
      return null;
    }

    const bestMode =
      strategy === PathStrategy.SHORTEST_DISTANCE
        ? this.pickPreferredModeByDistance(edge, candidates)
        : this.pickFastestMode(edge, candidates);

    return {
      mode: bestMode,
      edgeTimeMinutes: this.calculateEdgeTimeMinutes(edge, bestMode),
    };
  }

  private pickFastestMode(edge: GraphEdge, candidates: Transportation[]): Transportation {
    let best = candidates[0];
    let bestTime = this.calculateEdgeTimeMinutes(edge, best);
    for (let i = 1; i < candidates.length; i += 1) {
      const time = this.calculateEdgeTimeMinutes(edge, candidates[i]);
      if (time < bestTime) {
        best = candidates[i];
        bestTime = time;
      }
    }
    return best;
  }

  private pickPreferredModeByDistance(edge: GraphEdge, candidates: Transportation[]): Transportation {
    const prioritized = [...candidates].sort((left, right) => {
      const leftPenalty = this.getDistanceModePenalty(edge, left);
      const rightPenalty = this.getDistanceModePenalty(edge, right);
      if (leftPenalty !== rightPenalty) {
        return leftPenalty - rightPenalty;
      }
      return this.calculateEdgeTimeMinutes(edge, left) - this.calculateEdgeTimeMinutes(edge, right);
    });
    return prioritized[0];
  }

  private getDistanceModePenalty(edge: GraphEdge, transportation: Transportation): number {
    if (transportation === Transportation.WALK) {
      return edge.roadType === 'footpath' ? 0 : 2;
    }
    if (transportation === Transportation.BICYCLE) {
      return edge.isBicyclePath ? 0 : 1;
    }
    if (transportation === Transportation.ELECTRIC_CART) {
      return edge.isElectricCartRoute ? 0 : 1;
    }
    return 3;
  }

  private calculateEdgeTimeMinutes(edge: GraphEdge, transportation: Transportation): number {
    const speedKmH = TRANSPORTATION_SPEED_KMH[transportation];
    const speedMeterPerMinute = (speedKmH * 1000) / 60;
    const baseMinutes = edge.distance / speedMeterPerMinute;
    const congestion = normalizeCongestionFactor(Number(edge.congestionFactor ?? 1));
    return baseMinutes / Math.max(congestion, 0.05);
  }
}

export class PathPlanningService {
  private readonly scenicAreaCategoryCache = new Map<string, string>();

  private normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || trimmed === '[object Object]') {
        return [];
      }

      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {
        // ignore parse failure and continue with delimiter splitting
      }

      return trimmed
        .replace(/^\[|\]$/g, '')
        .split(/[,\uFF0C|]/)
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }

    return [];
  }

  private roadGraph: RoadGraph | null = null;
  private roadGraphVersion = 0;
  private graphInitializationPromise: Promise<void> | null = null;

  async initializeRoadGraph(): Promise<void> {
    const dbGraph = await this.tryBuildGraphFromDatabase();
    this.roadGraph = dbGraph ?? this.buildFallbackGraph();
    this.roadGraphVersion += 1;
    cache.deleteByPrefix('path_planning:route:');
    cache.deleteByPrefix('path_planning:nearest:');
    cache.deleteByPrefix('path_planning:road_network:');
  }

  private resolvePlanningProfile(category?: string | null): PlanningProfile {
    const normalizedCategory = (category || '').trim();
    if (normalizedCategory.includes('校园')) {
      return {
        kind: 'campus',
        label: '校园',
        category: normalizedCategory || '校园',
        allowedTransportations: [Transportation.WALK, Transportation.BICYCLE],
        defaultTransportations: [Transportation.WALK, Transportation.BICYCLE],
        vehicleTransportation: Transportation.BICYCLE,
        description: '校园模式下支持步行与自行车，骑行仅沿校园自行车通行路网规划。',
      };
    }

    if (normalizedCategory.includes('景区')) {
      return {
        kind: 'scenic',
        label: '景区',
        category: normalizedCategory || '景区',
        allowedTransportations: [Transportation.WALK, Transportation.ELECTRIC_CART],
        defaultTransportations: [Transportation.WALK, Transportation.ELECTRIC_CART],
        vehicleTransportation: Transportation.ELECTRIC_CART,
        description: '景区模式下支持步行与电瓶车，电瓶车仅沿景区电瓶车路线规划。',
      };
    }

    return {
      kind: 'generic',
      label: '通用',
      category: normalizedCategory || null,
      allowedTransportations: [Transportation.WALK, Transportation.BICYCLE, Transportation.ELECTRIC_CART],
      defaultTransportations: [Transportation.WALK],
      vehicleTransportation: null,
      description: '当前场景未识别为校园或景区，默认保留通用交通方式。',
    };
  }

  private inferCategoryFromName(name?: string | null): string | null {
    const normalized = String(name || '').trim();
    if (!normalized) {
      return null;
    }
    if (/(大学|学院|校园|校区|中学|附中)/.test(normalized)) {
      return '校园';
    }
    return '景区';
  }

  private async getScenicAreaCategory(scenicAreaId?: string | null): Promise<string | null> {
    const normalizedId = String(scenicAreaId || '').trim();
    if (!normalizedId) {
      return null;
    }

    const cached = this.scenicAreaCategoryCache.get(normalizedId);
    if (cached) {
      return cached;
    }

    if (!AppDataSource?.isInitialized) {
      return null;
    }

    const scenicAreaRepo = AppDataSource.getRepository(ScenicAreaEntity);
    const scenicArea = await scenicAreaRepo.findOne({
      where: { id: normalizedId },
      select: ['id', 'category', 'name'],
    });

    if (!scenicArea) {
      return null;
    }

    const resolvedCategory = scenicArea.category || this.inferCategoryFromName(scenicArea.name) || '景区';
    this.scenicAreaCategoryCache.set(normalizedId, resolvedCategory);
    return resolvedCategory;
  }

  private async resolvePlanningProfileForScenicAreaId(scenicAreaId?: string | null): Promise<PlanningProfile> {
    return this.resolvePlanningProfile(await this.getScenicAreaCategory(scenicAreaId));
  }

  private async resolvePlanningProfileForNodes(...nodes: Array<GraphNode | null | undefined>): Promise<PlanningProfile> {
    const scenicAreaIds = Array.from(
      new Set(
        nodes
          .map((node) => String(node?.scenicAreaId || '').trim())
          .filter(Boolean),
      ),
    );

    if (scenicAreaIds.length === 1) {
      return this.resolvePlanningProfileForScenicAreaId(scenicAreaIds[0]);
    }

    const inferredCategories = Array.from(
      new Set(
        nodes
          .map((node) => this.inferCategoryFromName(node?.name))
          .filter(Boolean),
      ),
    );

    if (inferredCategories.length === 1) {
      return this.resolvePlanningProfile(inferredCategories[0]);
    }

    return this.resolvePlanningProfile(null);
  }

  private applyPlanningProfileToTransportations(
    transportations: Transportation[],
    profile: PlanningProfile,
    sourceLabel: 'auto' | 'explicit' = 'explicit',
  ): Transportation[] {
    const allowedSet = new Set(profile.allowedTransportations);
    const filtered = transportations.filter((item) => allowedSet.has(item));

    if (filtered.length) {
      return Array.from(new Set(filtered));
    }

    if (sourceLabel === 'auto' || !transportations.length) {
      return [...profile.defaultTransportations];
    }

    const supportedLabel = profile.allowedTransportations
      .map((item) =>
        item === Transportation.WALK
          ? '步行'
          : item === Transportation.BICYCLE
            ? '自行车'
            : '电瓶车',
      )
      .join(' / ');
    throw new Error(`${profile.label}场景仅支持 ${supportedLabel}`);
  }

  async getShortestDistancePath(startNodeId: string, endNodeId: string) {
    return this.planAdvancedRoute(
      startNodeId,
      endNodeId,
      PathStrategy.SHORTEST_DISTANCE,
      [Transportation.WALK, Transportation.BICYCLE, Transportation.ELECTRIC_CART],
    );
  }

  async getShortestTimePath(startNodeId: string, endNodeId: string) {
    return this.planAdvancedRoute(
      startNodeId,
      endNodeId,
      PathStrategy.SHORTEST_TIME,
      [Transportation.WALK, Transportation.BICYCLE, Transportation.ELECTRIC_CART],
    );
  }

  async getPathByTransportation(startNodeId: string, endNodeId: string, transportation: string) {
    return this.planAdvancedRoute(
      startNodeId,
      endNodeId,
      PathStrategy.SHORTEST_TIME,
      [this.parseTransportation(transportation)],
    );
  }

  async getMultiTransportationPath(startNodeId: string, endNodeId: string) {
    return this.planAdvancedRoute(
      startNodeId,
      endNodeId,
      PathStrategy.SHORTEST_TIME,
      [Transportation.WALK, Transportation.BICYCLE, Transportation.ELECTRIC_CART],
    );
  }

  async getAvailableTransportationTypes(): Promise<string[]> {
    return [Transportation.WALK, Transportation.BICYCLE, Transportation.ELECTRIC_CART];
  }

  private async attachRequestedEndpointConnectors(
    originalStartNodeId: string,
    originalEndNodeId: string,
    resolvedStartNodeId: string,
    resolvedEndNodeId: string,
    response: PathResponse,
  ): Promise<PathResponse> {
    await this.ensureRoadGraphInitialized();
    const graph = this.requireRoadGraph();
    const [originalStartNode, originalEndNode] = await Promise.all([
      this.resolvePlanningNodeById(originalStartNodeId, graph),
      this.resolvePlanningNodeById(originalEndNodeId, graph),
    ]);
    const resolvedStartNode = graph.getNode(resolvedStartNodeId);
    const resolvedEndNode = graph.getNode(resolvedEndNodeId);

    const segments = [...(response.segments || [])];
    const path = [...(response.path || [])];

    const startConnector = this.buildRequestedEndpointConnector(
      originalStartNode,
      resolvedStartNode,
      originalStartNodeId,
      resolvedStartNodeId,
      'start',
    );
    if (startConnector) {
      segments.unshift(startConnector);
      path.unshift(originalStartNodeId);
    }

    const endConnector = this.buildRequestedEndpointConnector(
      originalEndNode,
      resolvedEndNode,
      resolvedEndNodeId,
      originalEndNodeId,
      'end',
    );
    if (endConnector) {
      segments.push(endConnector);
      path.push(originalEndNodeId);
    }

    if (!startConnector && !endConnector) {
      return response;
    }

    const visibleSegments = segments.filter((segment) => !segment.isConnector);
    const totalDistance = segments.reduce((sum, item) => sum + Number(item.distance || 0), 0);
    const totalTime = segments.reduce((sum, item) => sum + Number(item.time || 0), 0);

    return {
      ...response,
      path,
      distance: Number(totalDistance.toFixed(2)),
      time: Number(totalTime.toFixed(2)),
      segments,
      routeGeometry: this.mergePathPoints((visibleSegments.length ? visibleSegments : segments).map((item) => item.pathPoints)),
    };
  }

  private buildRequestedEndpointConnector(
    originalNode: GraphNode | null,
    anchorNode: GraphNode | undefined,
    fromId: string,
    toId: string,
    role: 'start' | 'end',
  ): RouteResponseSegment | null {
    if (!originalNode || originalNode.type !== 'scenic_area' || !anchorNode || originalNode.id === anchorNode.id) {
      return null;
    }

    const distance = haversineDistanceMeters(
      Number(originalNode.location.latitude || 0),
      Number(originalNode.location.longitude || 0),
      Number(anchorNode.location.latitude || 0),
      Number(anchorNode.location.longitude || 0),
    );
    if (!Number.isFinite(distance) || distance <= 0) {
      return null;
    }

    const fromLocation = role === 'start' ? originalNode.location : anchorNode.location;
    const toLocation = role === 'start' ? anchorNode.location : originalNode.location;
    const fromLabel = this.normalizePlaceLabel(originalNode.name || DEFAULT_SCENIC_NAME);
    const toLabel = this.normalizePlaceLabel(anchorNode.name || DEFAULT_NEXT_DESTINATION);

    return {
      from: fromId,
      to: toId,
      transportation: Transportation.WALK,
      distance: Number(distance.toFixed(2)),
      time: Number(this.estimateTransportationTimeMinutes(distance, Transportation.WALK).toFixed(2)),
      roadType: 'connector',
      roadName: '步行接驳',
      instruction:
        role === 'start'
          ? `从${fromLabel}步行接驳至路网入口 ${toLabel}`
          : `从路网入口 ${toLabel}步行接驳至${fromLabel}`,
      congestionFactor: 1,
      fromLocation,
      toLocation,
      pathPoints: [fromLocation, toLocation],
      isConnector: true,
    };
  }

  private async resolveEndpointNodePairForPlanning(
    startNodeId: string,
    endNodeId: string,
    strategy: PathStrategy,
    allowedTransportation: Transportation[],
  ): Promise<{ startNodeId: string; endNodeId: string }> {
    await this.ensureRoadGraphInitialized();
    const graph = this.requireRoadGraph();
    const startNode = await this.resolvePlanningNodeById(startNodeId, graph);
    const endNode = await this.resolvePlanningNodeById(endNodeId, graph);

    if (!startNode || !endNode) {
      return { startNodeId, endNodeId };
    }

    const startCandidates = this.getPlanningEndpointCandidates(startNode, graph);
    const endCandidates = this.getPlanningEndpointCandidates(endNode, graph);

    if (startCandidates.length === 1 && endCandidates.length === 1) {
      return { startNodeId: startCandidates[0].id, endNodeId: endCandidates[0].id };
    }

    const planner = new PathPlanner(graph);
    let bestPair: { startNodeId: string; endNodeId: string; weight: number } | null = null;

    for (const startCandidate of startCandidates) {
      for (const endCandidate of endCandidates) {
        if (startCandidate.id === endCandidate.id) {
          continue;
        }

        const result = planner.findPath(startCandidate.id, endCandidate.id, strategy, allowedTransportation);
        if (!result.path.length) {
          continue;
        }

        const weight =
          (strategy === PathStrategy.SHORTEST_DISTANCE ? result.totalDistance : result.totalTime) +
          this.calculateEndpointAnchorPenalty(startNode, startCandidate, strategy) +
          this.calculateEndpointAnchorPenalty(endNode, endCandidate, strategy);

        if (!bestPair || weight < bestPair.weight) {
          bestPair = {
            startNodeId: startCandidate.id,
            endNodeId: endCandidate.id,
            weight,
          };
        }
      }
    }

    return bestPair || { startNodeId: startCandidates[0].id, endNodeId: endCandidates[0].id };
  }

  private async resolvePlanningNodeById(nodeId: string, graph: RoadGraph): Promise<GraphNode | null> {
    const graphNode = graph.getNode(nodeId);
    if (graphNode) {
      return graphNode;
    }

    if (!AppDataSource?.isInitialized) {
      return null;
    }

    const scenicAreaRepo = AppDataSource.getRepository(ScenicAreaEntity);
    const scenicArea = await scenicAreaRepo.findOne({
      where: { id: nodeId },
      select: ['id', 'name', 'latitude', 'longitude'],
    });

    if (!scenicArea) {
      return null;
    }

    return {
      id: scenicArea.id,
      scenicAreaId: scenicArea.id,
      type: 'scenic_area',
      name: scenicArea.name,
      location: {
        latitude: Number(scenicArea.latitude ?? 0),
        longitude: Number(scenicArea.longitude ?? 0),
      },
    };
  }

  private getPlanningEndpointCandidates(
    node: GraphNode,
    graph: RoadGraph,
  ): GraphNode[] {
    if (node.type !== 'scenic_area') {
      return [node];
    }

    const anchorLat = Number(node.location.latitude || 0);
    const anchorLng = Number(node.location.longitude || 0);

    const candidates = graph
      .getAllNodes()
      .filter((item) => item.scenicAreaId === node.scenicAreaId && item.type === 'junction')
      .map((item) => ({
        node: item,
        distance: haversineDistanceKm(
          anchorLat,
          anchorLng,
          Number(item.location.latitude || 0),
          Number(item.location.longitude || 0),
        ),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 20)
      .map((item) => item.node);

    return candidates.length ? candidates : [node];
  }

  private calculateEndpointAnchorPenalty(
    originalNode: GraphNode,
    candidateNode: GraphNode,
    strategy: PathStrategy,
  ): number {
    if (originalNode.id === candidateNode.id) {
      return 0;
    }

    const distance = haversineDistanceMeters(
      Number(originalNode.location.latitude || 0),
      Number(originalNode.location.longitude || 0),
      Number(candidateNode.location.latitude || 0),
      Number(candidateNode.location.longitude || 0),
    );

    return strategy === PathStrategy.SHORTEST_DISTANCE
      ? distance
      : this.estimateTransportationTimeMinutes(distance, Transportation.WALK);
  }

  async planAdvancedRoute(
    startNodeId: string,
    endNodeId: string,
    strategy: string,
    transportations: string[],
  ) {
    const parsedStrategy =
      strategy === PathStrategy.SHORTEST_DISTANCE ? PathStrategy.SHORTEST_DISTANCE : PathStrategy.SHORTEST_TIME;
    const parsedTransportations = this.parseTransportationList(transportations);

    if (!parsedTransportations.length) {
      throw new Error('At least one transportation mode is required');
    }

    const resolvedEndpoints = await this.resolveEndpointNodePairForPlanning(
      startNodeId,
      endNodeId,
      parsedStrategy,
      parsedTransportations,
    );
    const resolvedStartNodeId = resolvedEndpoints.startNodeId;
    const resolvedEndNodeId = resolvedEndpoints.endNodeId;
    const graph = this.requireRoadGraph();
    const profile = await this.resolvePlanningProfileForNodes(
      graph.getNode(resolvedStartNodeId),
      graph.getNode(resolvedEndNodeId),
    );
    const scopedTransportations = this.applyPlanningProfileToTransportations(
      parsedTransportations,
      profile,
      transportations?.length ? 'explicit' : 'auto',
    );
    const finalizeResponse = async (response: PathResponse) =>
      this.decoratePathResponse(
        await this.attachRequestedEndpointConnectors(
          startNodeId,
          endNodeId,
          resolvedStartNodeId,
          resolvedEndNodeId,
          response,
        ),
        parsedStrategy,
        scopedTransportations,
      );

    const vehicleTransportations = scopedTransportations.filter(
      (item) => item === Transportation.BICYCLE || item === Transportation.ELECTRIC_CART,
    );
    const shouldPreferDirectRoad = vehicleTransportations.length > 0;

    if (shouldPreferDirectRoad) {
      const candidates: PathResponse[] = [];

      const hybridRoute = await this.tryBuildBestHybridRoute(
        resolvedStartNodeId,
        resolvedEndNodeId,
        scopedTransportations,
        parsedStrategy,
      );
      if (hybridRoute?.segments?.length) {
        candidates.push(hybridRoute);
      }

      const directRoadRoute = await this.tryBuildBestDirectRoadRoute(
        resolvedStartNodeId,
        resolvedEndNodeId,
        vehicleTransportations,
        parsedStrategy,
      );
      if (directRoadRoute?.segments?.length) {
        candidates.push(directRoadRoute);
      }

      if (scopedTransportations.includes(Transportation.WALK)) {
        try {
          const pureWalkRoute = await this.buildPathResponse(
            resolvedStartNodeId,
            resolvedEndNodeId,
            parsedStrategy,
            [Transportation.WALK],
          );
          if (pureWalkRoute.segments?.length) {
            candidates.push(pureWalkRoute);
          }
        } catch {
          // ignore pure-walk fallback failures and keep evaluating other candidates
        }
      }

      if (candidates.length) {
        candidates.sort((left, right) =>
          parsedStrategy === PathStrategy.SHORTEST_DISTANCE
            ? Number(left.distance || 0) - Number(right.distance || 0)
            : Number(left.time || 0) - Number(right.time || 0),
        );
        return finalizeResponse(candidates[0]);
      }
    }

    try {
      return finalizeResponse(
        await this.buildPathResponse(
          resolvedStartNodeId,
          resolvedEndNodeId,
          parsedStrategy,
          scopedTransportations,
        ),
      );
    } catch (error) {
      const pureVehicleSelection =
        scopedTransportations.length === 1 &&
        (scopedTransportations[0] === Transportation.BICYCLE ||
          scopedTransportations[0] === Transportation.ELECTRIC_CART);

      if (pureVehicleSelection) {
        const fallbackModes = this.applyPlanningProfileToTransportations(
          [scopedTransportations[0], Transportation.WALK],
          profile,
          'auto',
        );
        return this.decoratePathResponse(
          await this.attachRequestedEndpointConnectors(
            startNodeId,
            endNodeId,
            resolvedStartNodeId,
            resolvedEndNodeId,
            await this.buildPathResponse(
              resolvedStartNodeId,
              resolvedEndNodeId,
              parsedStrategy,
              fallbackModes,
            ),
          ),
          parsedStrategy,
          fallbackModes,
        );
      }

      throw error;
    }
  }

  private async tryBuildBestHybridRoute(
    startNodeId: string,
    endNodeId: string,
    transportations: Transportation[],
    strategy: PathStrategy,
  ): Promise<PathResponse | null> {
    const vehicleModes = transportations.filter(
      (item) => item === Transportation.BICYCLE || item === Transportation.ELECTRIC_CART,
    );
    if (!vehicleModes.length) {
      return null;
    }

    const candidates = await Promise.all(
      vehicleModes.map((transportation) => this.tryBuildHybridVehicleRoute(startNodeId, endNodeId, transportation, strategy)),
    );

    const available = candidates.filter((item): item is PathResponse => Boolean(item));
    if (!available.length) {
      return null;
    }

    available.sort((left, right) =>
      strategy === PathStrategy.SHORTEST_DISTANCE
        ? Number(left.distance || 0) - Number(right.distance || 0)
        : Number(left.time || 0) - Number(right.time || 0),
    );

    return available[0];
  }

  private async tryBuildHybridVehicleRoute(
    startNodeId: string,
    endNodeId: string,
    transportation: Transportation.BICYCLE | Transportation.ELECTRIC_CART,
    strategy: PathStrategy,
  ): Promise<PathResponse | null> {
    await this.ensureRoadGraphInitialized();
    const graph = this.requireRoadGraph();
    const startNode = graph.getNode(startNodeId);
    const endNode = graph.getNode(endNodeId);
    if (!startNode || !endNode) {
      return null;
    }

    const startAnchors = this.findAccessibleJunctionCandidates(startNode, transportation, graph);
    const endAnchors = this.findAccessibleJunctionCandidates(endNode, transportation, graph);
    if (!startAnchors.length || !endAnchors.length) {
      return null;
    }

    let bestRoute: PathResponse | null = null;

    for (const startAnchor of startAnchors) {
      for (const endAnchor of endAnchors) {
        if (startAnchor.id === endAnchor.id) {
          continue;
        }

        const startConnector =
          startNode.id === startAnchor.id
            ? null
            : await this.tryBuildWalkConnectorPath(startNode.id, startAnchor.id);
        const endConnector =
          endNode.id === endAnchor.id
            ? null
            : await this.tryBuildWalkConnectorPath(endAnchor.id, endNode.id);

        const mainRoute = await this.tryBuildDirectRoadRoute(startAnchor.id, endAnchor.id, transportation);
        if (!mainRoute) {
          continue;
        }

        const segmentBundles = [startConnector, mainRoute, endConnector].filter(
          (item): item is PathResponse => Boolean(item && item.segments?.length),
        );
        if (!segmentBundles.length) {
          continue;
        }

        const mergedSegments = this.mergeAdjacentRouteSegments(
          segmentBundles.flatMap((item) => item.segments || []),
          startNodeId,
          endNodeId,
        );
        const usedTransportation = Array.from(
          new Set(mergedSegments.map((segment) => segment.transportation).filter(Boolean)),
        ) as Transportation[];

        if (!usedTransportation.includes(transportation)) {
          continue;
        }

        const totalDistance = mergedSegments.reduce((sum, item) => sum + Number(item.distance || 0), 0);
        const totalTime = mergedSegments.reduce((sum, item) => sum + Number(item.time || 0), 0);
        const visibleSegments = mergedSegments.filter((segment) => !segment.isConnector);
        const routeContext = await this.buildRouteContext(startNode, endNode);
        const candidateRoute: PathResponse = {
          path: [startNodeId, ...mergedSegments.map((segment) => segment.to)],
          distance: Number(totalDistance.toFixed(2)),
          time: Number(totalTime.toFixed(2)),
          segments: mergedSegments,
          routeGeometry: this.mergePathPoints((visibleSegments.length ? visibleSegments : mergedSegments).map((item) => item.pathPoints)),
          routeSource: 'osrm',
          routeContext,
          transportationModes: usedTransportation,
          isMixedTransportation: usedTransportation.length > 1,
        };

        const candidateWeight =
          strategy === PathStrategy.SHORTEST_DISTANCE
            ? Number(candidateRoute.distance || 0)
            : Number(candidateRoute.time || 0);
        const currentBestWeight =
          strategy === PathStrategy.SHORTEST_DISTANCE
            ? Number(bestRoute?.distance || 0)
            : Number(bestRoute?.time || 0);

        if (!bestRoute || candidateWeight < currentBestWeight) {
          bestRoute = candidateRoute;
        }
      }
    }

    return bestRoute;
  }

  private async tryBuildWalkConnectorPath(startNodeId: string, endNodeId: string): Promise<PathResponse | null> {
    try {
      return await this.buildPathResponse(
        startNodeId,
        endNodeId,
        PathStrategy.SHORTEST_DISTANCE,
        [Transportation.WALK],
      );
    } catch {
      return null;
    }
  }

  private findAccessibleJunctionCandidates(
    sourceNode: GraphNode,
    transportation: Transportation.BICYCLE | Transportation.ELECTRIC_CART,
    graph: RoadGraph,
  ): GraphNode[] {
    if (sourceNode.type === 'junction' && this.nodeSupportsTransportationOnRoad(sourceNode.id, transportation, graph)) {
      return [sourceNode];
    }

    return graph
      .getAllNodes()
      .filter(
        (item) =>
          item.type === 'junction' &&
          item.scenicAreaId === sourceNode.scenicAreaId &&
          this.nodeSupportsTransportationOnRoad(item.id, transportation, graph),
      )
      .map((node) => ({
        node,
        distance: haversineDistanceKm(
          Number(sourceNode.location.latitude || 0),
          Number(sourceNode.location.longitude || 0),
          Number(node.location.latitude || 0),
          Number(node.location.longitude || 0),
        ),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 8)
      .map((item) => item.node);
  }

  private nodeSupportsTransportationOnRoad(
    nodeId: string,
    transportation: Transportation.BICYCLE | Transportation.ELECTRIC_CART,
    graph: RoadGraph,
  ): boolean {
    return graph.getEdges(nodeId).some((edge) => {
      if (edge.roadType === 'connector' || edge.roadType === 'footpath') {
        return false;
      }
      if (!edge.allowedTransportation.includes(transportation)) {
        return false;
      }
      if (transportation === Transportation.BICYCLE) {
        return edge.isBicyclePath || edge.roadType === 'main_road' || edge.roadType === 'side_road';
      }
      return edge.isElectricCartRoute || edge.roadType === 'main_road' || edge.roadType === 'side_road';
    });
  }

  private async tryBuildBestDirectRoadRoute(
    startNodeId: string,
    endNodeId: string,
    transportations: Transportation[],
    strategy: PathStrategy,
  ): Promise<PathResponse | null> {
    const directCandidates = await Promise.all(
      transportations.map(async (transportation) => ({
        transportation,
        route: await this.tryBuildDirectRoadRoute(startNodeId, endNodeId, transportation),
      })),
    );

    const available = directCandidates
      .filter((item): item is { transportation: Transportation; route: PathResponse } => Boolean(item.route))
      .sort((left, right) =>
        strategy === PathStrategy.SHORTEST_DISTANCE
          ? Number(left.route.distance || 0) - Number(right.route.distance || 0)
          : Number(left.route.time || 0) - Number(right.route.time || 0),
      );

    return available[0]?.route || null;
  }

  async getRoadNetwork(
    scenicAreaId?: string,
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; planningProfile: PlanningProfile }> {
    await this.ensureRoadGraphInitialized();
    const normalizedScenicAreaId = (scenicAreaId || '').trim();
    const cacheKey = normalizedScenicAreaId
      ? `path_planning:road_network:${this.roadGraphVersion}:${normalizedScenicAreaId}`
      : `path_planning:road_network:${this.roadGraphVersion}:all`;
    return cache.getOrSet(
      cacheKey,
      async () => {
        const graph = this.requireRoadGraph();
        const planningProfile = await this.resolvePlanningProfileForScenicAreaId(normalizedScenicAreaId || null);
        if (!normalizedScenicAreaId) {
          return { nodes: graph.getAllNodes(), edges: graph.getAllEdges(), planningProfile };
        }

        const nodes = graph.getAllNodes().filter((node) => node.scenicAreaId === normalizedScenicAreaId);
        const nodeIds = new Set(nodes.map((node) => node.id));
        const edges = graph.getAllEdges().filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
        return { nodes, edges, planningProfile };
      },
      5 * 60 * 1000,
    );
  }

  async searchNodesByName(keyword: string, limit: number = 12, scenicAreaId?: string): Promise<NodeSearchResult[]> {
    await this.ensureRoadGraphInitialized();
    const graph = this.requireRoadGraph();
    const normalized = keyword.trim().toLowerCase();
    const normalizedScenicAreaId = typeof scenicAreaId === 'string' && scenicAreaId.trim() ? scenicAreaId.trim() : '';
    const allNodes = normalizedScenicAreaId
      ? graph.getAllNodes().filter((node) => node.scenicAreaId === normalizedScenicAreaId)
      : graph.getAllNodes();
    if (!allNodes.length) {
      return [];
    }

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 50)) : 12;
    const scenicAreaNameMap = await this.buildScenicAreaNameMap();
    const indexedNodes = this.buildIndexedRoadNodes(allNodes, scenicAreaNameMap);
    const candidateMap = new Map<string, NodeSearchResult & { score: number }>();

    const pushCandidate = (candidate: NodeSearchResult & { score: number }) => {
      const existing = candidateMap.get(candidate.id);
      if (!existing || candidate.score > existing.score) {
        candidateMap.set(candidate.id, candidate);
      }
    };

    for (const item of indexedNodes) {
      if (item.type === 'scenic_area') {
        continue;
      }
      const score = this.scoreSearchTerms(normalized, item.searchTerms, item.type);
      if (score <= 0) {
        continue;
      }
      pushCandidate({
        id: item.id,
        name: item.displayName,
        type: item.type,
        scenicAreaId: item.scenicAreaId ?? null,
        latitude: Number(item.location.latitude || 0),
        longitude: Number(item.location.longitude || 0),
        score,
      });
    }

    const databaseCandidates = await this.searchDatabasePlaces(
      normalized,
      safeLimit,
      graph,
      scenicAreaNameMap,
      normalizedScenicAreaId || undefined,
    );
    for (const candidate of databaseCandidates) {
      pushCandidate(candidate);
    }

    const sorted = Array.from(candidateMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, safeLimit);

    if (normalized && !sorted.length) {
      return [];
    }

    const preferredSorted =
      normalized && sorted.some((item) => item.type !== 'junction')
        ? sorted.filter((item) => item.type !== 'junction')
        : sorted;

    return preferredSorted.slice(0, safeLimit).map(({ score: _score, ...item }) => item);
  }

  private async buildScenicAreaNameMap(): Promise<Map<string, string>> {
    const nameMap = new Map<string, string>();
    if (!AppDataSource?.isInitialized) {
      return nameMap;
    }
    const scenicAreaRepo = AppDataSource.getRepository(ScenicAreaEntity);
    const scenicAreas = await scenicAreaRepo.find({ select: ['id', 'name'] });
    for (const scenicArea of scenicAreas) {
      nameMap.set(scenicArea.id, scenicArea.name || '');
    }
    return nameMap;
  }

  private buildIndexedRoadNodes(
    nodes: GraphNode[],
    scenicAreaNameMap: Map<string, string>,
  ): Array<
    GraphNode & {
      displayName: string;
      searchTerms: string[];
    }
  > {
    const junctionBounds = new Map<string, { maxRow: number; maxCol: number }>();
    for (const node of nodes) {
      const parsed = this.parseGeneratedJunctionName(node.name || '');
      if (!parsed || !node.scenicAreaId) {
        continue;
      }
      const current = junctionBounds.get(node.scenicAreaId) ?? { maxRow: 0, maxCol: 0 };
      current.maxRow = Math.max(current.maxRow, parsed.row);
      current.maxCol = Math.max(current.maxCol, parsed.col);
      junctionBounds.set(node.scenicAreaId, current);
    }

    return nodes.map((node) => {
      const scenicName = scenicAreaNameMap.get(node.scenicAreaId || '') || '';
      const aliases = this.buildNodeAliases(node, scenicName, junctionBounds.get(node.scenicAreaId || ''));
      const primaryAlias = aliases[0] || node.name || `${DEFAULT_NODE_LABEL_PREFIX} ${node.id}`;
      return {
        ...node,
        displayName:
          scenicName && primaryAlias !== node.name
            ? `${scenicName} · ${primaryAlias}`
            : primaryAlias,
        searchTerms: [node.name || '', node.id, scenicName, ...aliases].filter(Boolean),
      };
    });
  }

  private buildNodeAliases(
    node: GraphNode,
    scenicName: string,
    junctionBound?: { maxRow: number; maxCol: number },
  ): string[] {
    const aliases = new Set<string>();

    const parsed = this.parseGeneratedJunctionName(node.name || '');
    if (parsed && junctionBound) {
      const { row, col } = parsed;
      const { maxRow, maxCol } = junctionBound;
      const centerRow = Math.floor(maxRow / 2);
      const centerCol = Math.floor(maxCol / 2);
      if (row === 0 && col === 0) {
        aliases.add('主入口');
        aliases.add('景区主入口');
        aliases.add('西北入口');
      }
      if (row === centerRow && col === 0) {
        aliases.add('西入口');
        aliases.add('西门');
      }
      if (row === centerRow && col === maxCol) {
        aliases.add('东入口');
        aliases.add('东门');
        aliases.add('东出口');
      }
      if (row === 0 && col === centerCol) {
        aliases.add('北入口');
        aliases.add('北门');
      }
      if (row === maxRow && col === centerCol) {
        aliases.add('南入口');
        aliases.add('南门');
      }
      if (row === centerRow && col === centerCol) {
        aliases.add('中心广场');
        aliases.add('中心点');
      }
      aliases.add(`路网节点 ${row + 1}-${col + 1}`);
      aliases.add(`路口 ${row + 1}-${col + 1}`);
    }

    if (scenicName) {
      for (const alias of Array.from(aliases)) {
        aliases.add(`${scenicName}${alias}`);
        aliases.add(`${scenicName}-${alias}`);
      }
    }

    if (node.name) {
      aliases.add(node.name);
    }

    return Array.from(aliases);
  }

  private parseGeneratedJunctionName(name: string): { row: number; col: number } | null {
    const matched = name.match(/-路口-(\d+)-(\d+)$/);
    if (!matched) {
      return null;
    }
    return {
      row: Number.parseInt(matched[1], 10),
      col: Number.parseInt(matched[2], 10),
    };
  }

  private scoreSearchTerms(keyword: string, terms: string[], type: string): number {
    const normalizedTerms = terms
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
    if (!normalizedTerms.length) {
      return 0;
    }

    let score = 0;
    if (!keyword) {
      score += type === 'attraction' ? 42 : type === 'facility' ? 34 : type === 'entrance' ? 38 : 24;
      return score;
    }

    for (const term of normalizedTerms) {
      if (term === keyword) {
        score = Math.max(score, 180);
      } else if (term.startsWith(keyword)) {
        score = Math.max(score, 120);
      } else if (term.includes(keyword)) {
        score = Math.max(score, 80);
      }
    }

    if (type === 'attraction') {
      score += 18;
    } else if (type === 'facility') {
      score += 14;
    } else if (type === 'entrance') {
      score += 16;
    } else if (type === 'junction') {
      score += 10;
    } else {
      score += 8;
    }

    return score;
  }

  private async searchDatabasePlaces(
    keyword: string,
    limit: number,
    graph: RoadGraph,
    scenicAreaNameMap: Map<string, string>,
    scenicAreaId?: string,
  ): Promise<Array<NodeSearchResult & { score: number }>> {
    if (!AppDataSource?.isInitialized) {
      return [];
    }

    const attractionRepo = AppDataSource.getRepository(AttractionEntity);
    const facilityRepo = AppDataSource.getRepository(FacilityEntity);
    const scenicAreaRepo = AppDataSource.getRepository(ScenicAreaEntity);
    const likeKeyword = `%${keyword}%`;
    const queryLimit = Math.max(limit, 8);

    const attractionQuery = attractionRepo.createQueryBuilder('attraction');
    const facilityQuery = facilityRepo.createQueryBuilder('facility');
    const scenicQuery = scenicAreaRepo.createQueryBuilder('scenic');

    if (scenicAreaId) {
      attractionQuery.andWhere('attraction.scenicAreaId = :scenicAreaId', { scenicAreaId });
      facilityQuery.andWhere('facility.scenicAreaId = :scenicAreaId', { scenicAreaId });
      scenicQuery.andWhere('scenic.id = :scenicAreaId', { scenicAreaId });
    }

    const [attractions, facilities, scenicAreas] = await Promise.all([
      keyword
        ? attractionQuery
            .andWhere(
              '(attraction.name LIKE :keyword OR attraction.category LIKE :keyword OR attraction.description LIKE :keyword)',
              { keyword: likeKeyword },
            )
            .orderBy('attraction.reviewCount', 'DESC')
            .addOrderBy('attraction.averageRating', 'DESC')
            .limit(queryLimit)
            .getMany()
        : attractionQuery
            .orderBy('attraction.reviewCount', 'DESC')
            .addOrderBy('attraction.averageRating', 'DESC')
            .limit(queryLimit)
            .getMany(),
      keyword
        ? facilityQuery
            .andWhere(
              '(facility.name LIKE :keyword OR facility.category LIKE :keyword OR facility.description LIKE :keyword)',
              { keyword: likeKeyword },
            )
            .orderBy('facility.name', 'ASC')
            .limit(queryLimit)
            .getMany()
        : facilityQuery
            .orderBy('facility.name', 'ASC')
            .limit(queryLimit)
            .getMany(),
      keyword
        ? scenicQuery
            .andWhere('(scenic.name LIKE :keyword OR scenic.category LIKE :keyword OR scenic.description LIKE :keyword)', {
              keyword: likeKeyword,
            })
            .orderBy('scenic.popularity', 'DESC')
            .limit(Math.max(4, Math.floor(queryLimit / 2)))
            .getMany()
        : scenicQuery
            .orderBy('scenic.popularity', 'DESC')
            .addOrderBy('scenic.averageRating', 'DESC')
            .limit(Math.max(4, Math.floor(queryLimit / 2)))
            .getMany(),
    ]);

    const targetScenicAreaIds = scenicAreaId ? [scenicAreaId] : scenicAreas.map((item) => item.id);
    const runtimeMaps = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaIds(targetScenicAreaIds);
    const mergedAttractions = attractions.length
      ? attractions
      : Array.from(runtimeMaps.values()).flatMap((item) => item.attractions);
    const mergedFacilities = facilities.length
      ? facilities
      : Array.from(runtimeMaps.values()).flatMap((item) => item.facilities);

    const candidates: Array<NodeSearchResult & { score: number }> = [];

    for (const attraction of mergedAttractions) {
      const poiNode =
        this.findDirectPoiNode(
          graph,
          attraction.scenicAreaId ?? null,
          'attraction',
          attraction.name,
          Number(attraction.latitude ?? 0),
          Number(attraction.longitude ?? 0),
        ) ||
        this.findNearestNodeForLocation(
        Number(attraction.latitude ?? 0),
        Number(attraction.longitude ?? 0),
        attraction.scenicAreaId,
        graph,
      );
      if (!poiNode) {
        continue;
      }
      candidates.push({
        id: poiNode.id,
        name: attraction.name,
        type: 'attraction',
        scenicAreaId: attraction.scenicAreaId ?? null,
        latitude: Number(poiNode.location.latitude || 0),
        longitude: Number(poiNode.location.longitude || 0),
        score:
          this.scoreSearchTerms(keyword, [attraction.name, attraction.category || '', attraction.description || ''], 'attraction') +
          Number(attraction.reviewCount ?? 0) * 0.01,
      });
    }

    for (const facility of mergedFacilities) {
      const poiNode =
        this.findDirectPoiNode(
          graph,
          facility.scenicAreaId ?? null,
          'facility',
          facility.name,
          Number(facility.latitude ?? 0),
          Number(facility.longitude ?? 0),
        ) ||
        this.findNearestNodeForLocation(
        Number(facility.latitude ?? 0),
        Number(facility.longitude ?? 0),
        facility.scenicAreaId,
        graph,
      );
      if (!poiNode) {
        continue;
      }
      candidates.push({
        id: poiNode.id,
        name: facility.name,
        type: 'facility',
        scenicAreaId: facility.scenicAreaId ?? null,
        latitude: Number(poiNode.location.latitude || 0),
        longitude: Number(poiNode.location.longitude || 0),
        score: this.scoreSearchTerms(keyword, [facility.name, facility.category || '', facility.description || ''], 'facility'),
      });
    }

    for (const scenicArea of scenicAreas) {
      candidates.push({
        id: scenicArea.id,
        name: scenicArea.name,
        type: 'scenic_area',
        scenicAreaId: scenicArea.id,
        latitude: Number(scenicArea.latitude ?? 0),
        longitude: Number(scenicArea.longitude ?? 0),
        score:
          this.scoreSearchTerms(keyword, [scenicArea.name, scenicArea.category || '', scenicArea.description || ''], 'scenic_area') +
          Number(scenicArea.popularity ?? 0) * 0.0005,
      });
    }

    return candidates.map((candidate) => ({
      ...candidate,
      name: scenicAreaNameMap.get(candidate.scenicAreaId || '') && candidate.type === 'scenic_area'
        ? candidate.name
        : candidate.name,
    }));
  }

  private findNearestNodeForLocation(
    latitude: number,
    longitude: number,
    scenicAreaId: string | undefined,
    graph: RoadGraph,
  ): GraphNode | undefined {
    const scopedNodes = scenicAreaId
      ? graph.getAllNodes().filter((item) => item.scenicAreaId === scenicAreaId)
      : graph.getAllNodes();
    if (!scopedNodes.length) {
      return undefined;
    }

    const candidateNodes = this.getPreferredLocationCandidates(scopedNodes);
    if (!candidateNodes.length) {
      return undefined;
    }

    let nearestNode = candidateNodes[0];
    let minDistance = Number.POSITIVE_INFINITY;
    for (const node of candidateNodes) {
      const distance = haversineDistanceKm(
        latitude,
        longitude,
        Number(node.location.latitude || 0),
        Number(node.location.longitude || 0),
      );
      if (distance < minDistance) {
        minDistance = distance;
        nearestNode = node;
      }
    }
    return nearestNode;
  }

  private getPreferredLocationCandidates(nodes: GraphNode[]): GraphNode[] {
    const junctionNodes = nodes.filter((item) => item.type === 'junction');
    if (junctionNodes.length) {
      return junctionNodes;
    }

    const poiNodes = nodes.filter((item) => item.type !== 'scenic_area');
    if (poiNodes.length) {
      return poiNodes;
    }

    return nodes;
  }

  private findNearestNonScenicNode(
    latitude: number,
    longitude: number,
    nodes: GraphNode[],
  ): GraphNode | undefined {
    const candidates = nodes.filter((item) => item.type !== 'scenic_area');
    if (!candidates.length) {
      return undefined;
    }

    let nearestNode = candidates[0];
    let minDistance = Number.POSITIVE_INFINITY;
    for (const node of candidates) {
      const distance = haversineDistanceKm(
        latitude,
        longitude,
        Number(node.location.latitude || 0),
        Number(node.location.longitude || 0),
      );
      if (distance < minDistance) {
        minDistance = distance;
        nearestNode = node;
      }
    }
    return nearestNode;
  }

  private findDirectPoiNode(
    graph: RoadGraph,
    scenicAreaId: string | null | undefined,
    type: 'attraction' | 'facility',
    name: string,
    latitude?: number | null,
    longitude?: number | null,
  ): GraphNode | undefined {
    const scopedNodes = graph
      .getAllNodes()
      .filter((item) => item.type === type && (!scenicAreaId || item.scenicAreaId === scenicAreaId) && item.name === name);

    if (!scopedNodes.length) {
      return undefined;
    }

    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      return scopedNodes[0];
    }

    let best = scopedNodes[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const node of scopedNodes) {
      const distance = haversineDistanceKm(
        Number(latitude),
        Number(longitude),
        Number(node.location.latitude || 0),
        Number(node.location.longitude || 0),
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    return best;
  }

  async findNearestNode(latitude: number, longitude: number, scenicAreaId?: string): Promise<string> {
    await this.ensureRoadGraphInitialized();
    const latKey = latitude.toFixed(5);
    const lngKey = longitude.toFixed(5);
    const scopedScenicAreaId = typeof scenicAreaId === 'string' && scenicAreaId.trim() ? scenicAreaId.trim() : 'all';
    const cacheKey = `path_planning:nearest:${this.roadGraphVersion}:${scopedScenicAreaId}:${latKey}:${lngKey}`;
    return cache.getOrSet(
      cacheKey,
      async () => {
        const graph = this.requireRoadGraph();
        let nearestNode = this.findNearestNodeForLocation(
          latitude,
          longitude,
          scopedScenicAreaId === 'all' ? undefined : scopedScenicAreaId,
          graph,
        );

        if (nearestNode?.type === 'scenic_area') {
          const scopedNodes =
            scopedScenicAreaId === 'all'
              ? graph.getAllNodes()
              : graph.getAllNodes().filter((item) => item.scenicAreaId === scopedScenicAreaId);
          nearestNode = this.findNearestNonScenicNode(latitude, longitude, scopedNodes) || nearestNode;
        }

        if (!nearestNode) {
          throw new Error('No nodes found in the road graph');
        }
        return nearestNode.id;
      },
      2 * 60 * 1000,
    );
  }

  async findNearestNodeByAttraction(
    attractionId: string,
  ): Promise<{ attractionId: string; nodeId: string; scenicAreaId: string | null }> {
    await this.ensureRoadGraphInitialized();
    const graph = this.requireRoadGraph();
    const directNode = graph.getNode(attractionId);
    if (directNode) {
      return {
        attractionId,
        nodeId: directNode.id,
        scenicAreaId: directNode.scenicAreaId ?? null,
      };
    }

    const cacheKey = `path_planning:nearest_attraction:${this.roadGraphVersion}:${attractionId}`;
    return cache.getOrSet(
      cacheKey,
      async () => {
        if (!AppDataSource || !AppDataSource.isInitialized) {
          const fallbackAttractionNode = graph.getAllNodes().find((item) => item.type === 'attraction');
          const fallbackNode = fallbackAttractionNode ?? graph.getAllNodes()[0];
          if (!fallbackNode) {
            throw new Error('No nodes found in the road graph');
          }
          return {
            attractionId,
            nodeId: fallbackNode.id,
            scenicAreaId: fallbackNode.scenicAreaId ?? null,
          };
        }

        const attractionRepo = AppDataSource.getRepository(AttractionEntity);
        const roadNodeRepo = AppDataSource.getRepository(RoadGraphNodeEntity);
        const attraction = await attractionRepo.findOne({ where: { id: attractionId } });
        if (!attraction) {
          const runtimeAttraction = await this.findRuntimeAttractionById(attractionId);
          if (!runtimeAttraction) {
            throw new Error('Attraction not found');
          }
          const candidateNodes = graph
            .getAllNodes()
            .filter((item) => !runtimeAttraction.scenicAreaId || item.scenicAreaId === runtimeAttraction.scenicAreaId);
          const nearestNode = this.findNearestNodeForLocation(
            Number(runtimeAttraction.latitude ?? 0),
            Number(runtimeAttraction.longitude ?? 0),
            runtimeAttraction.scenicAreaId,
            graph,
          ) ?? candidateNodes[0];
          if (!nearestNode) {
            throw new Error('No nodes found in the road graph');
          }
          return {
            attractionId,
            nodeId: nearestNode.id,
            scenicAreaId: nearestNode.scenicAreaId ?? null,
          };
        }

        const attractionLat = Number(attraction.latitude ?? 0);
        const attractionLng = Number(attraction.longitude ?? 0);
        const scopedNodes = attraction.scenicAreaId
          ? await roadNodeRepo.find({ where: { scenicAreaId: attraction.scenicAreaId } })
          : [];
        const candidateNodes = scopedNodes.length
          ? scopedNodes.map((item) => ({
              id: item.id,
              scenicAreaId: item.scenicAreaId,
              location: {
                latitude: Number(item.latitude ?? 0),
                longitude: Number(item.longitude ?? 0),
              },
            }))
          : graph.getAllNodes().map((item) => ({
              id: item.id,
              scenicAreaId: item.scenicAreaId,
              location: item.location,
            }));

        if (!candidateNodes.length) {
          throw new Error('No nodes found in the road graph');
        }

        let nearestNodeId = candidateNodes[0].id;
        let minDistance = Number.POSITIVE_INFINITY;
        for (const node of candidateNodes) {
          const distance = haversineDistanceKm(
            attractionLat,
            attractionLng,
            node.location.latitude,
            node.location.longitude,
          );
          if (distance < minDistance) {
            minDistance = distance;
            nearestNodeId = node.id;
          }
        }

        return {
          attractionId,
          nodeId: nearestNodeId,
          scenicAreaId: attraction.scenicAreaId || null,
        };
      },
      2 * 60 * 1000,
    );
  }

  private async findRuntimeAttractionById(attractionId: string): Promise<AttractionEntity | null> {
    const parts = String(attractionId || '').split('|');
    if (parts.length < 5 || parts[0] !== 'rt') {
      return null;
    }
    const scenicAreaId = parts[3];
    if (!scenicAreaId) {
      return null;
    }
    const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId);
    return runtimeMap?.attractions.find((item) => item.id === attractionId) || null;
  }

  async optimizeMultiPointPath(nodeIds: string[], strategy: string, transportations?: string[]) {
    await this.ensureRoadGraphInitialized();
    if (nodeIds.length < 2) {
      return { order: nodeIds, path: nodeIds, totalDistance: 0, totalTime: 0 };
    }

    const targetStrategy =
      strategy === PathStrategy.SHORTEST_DISTANCE ? PathStrategy.SHORTEST_DISTANCE : PathStrategy.SHORTEST_TIME;
    const graph = this.requireRoadGraph();
    const planner = new PathPlanner(graph);
    const profile = await this.resolvePlanningProfileForNodes(
      ...nodeIds.map((nodeId) => graph.getNode(nodeId)),
    );
    const allowedTransportation = this.applyPlanningProfileToTransportations(
      this.parseTransportationList(transportations),
      profile,
      transportations?.length ? 'explicit' : 'auto',
    );
    const metrics = this.buildMultiPointMetricMatrix(nodeIds, planner, targetStrategy, allowedTransportation);
    const nearestOrder = this.nearestNeighborOrderByMatrix(nodeIds, metrics, targetStrategy);
    const order = this.improveOrderWithTwoOpt(nearestOrder, metrics, targetStrategy);
    const fullPath: string[] = [order[0]];
    let totalDistance = 0;
    let totalTime = 0;
    const actualTransportations: Transportation[] = [];

    for (let i = 0; i < order.length - 1; i += 1) {
      const key = this.buildMatrixKey(order[i], order[i + 1]);
      const metric = metrics.get(key);
      if (!metric) {
        continue;
      }
      totalDistance += metric.distance;
      totalTime += metric.time;
      for (const mode of metric.transportationModes) {
        if (!actualTransportations.includes(mode)) {
          actualTransportations.push(mode);
        }
      }
      for (let j = 1; j < metric.path.length; j += 1) {
        fullPath.push(metric.path[j]);
      }
    }

    return {
      order,
      path: fullPath,
      totalDistance: Number(totalDistance.toFixed(2)),
      totalTime: Number(totalTime.toFixed(2)),
      strategy: targetStrategy,
      transportationModes: actualTransportations.length ? actualTransportations : allowedTransportation,
      isMixedTransportation: actualTransportations.length > 1,
    };
  }

  async generateDayPlan(
    scenicAreaId: string,
    userId: string,
    intensity: 'low' | 'medium' | 'high',
  ): Promise<{
    plan: Array<{
      attractionId: string;
      name: string;
      arrivalTime: string;
      stayDuration: number;
      isMustVisit: boolean;
    }>;
    totalDistance: number;
    totalTime: number;
  }> {
    await this.ensureRoadGraphInitialized();
    const dbAvailable = Boolean(AppDataSource?.isInitialized);
    if (!dbAvailable) {
      return this.generateFallbackDayPlan(intensity);
    }

    const attractionRepo = AppDataSource!.getRepository(AttractionEntity);
    const userRepo = AppDataSource!.getRepository(UserEntity);
    const [user, scenicAttractions] = await Promise.all([
      userRepo.findOne({ where: { id: userId } }),
      attractionRepo.find({ where: { scenicAreaId } }),
    ]);

    const effectiveAttractions =
      scenicAttractions.length
        ? scenicAttractions
        : (await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId))?.attractions ?? [];

    if (!effectiveAttractions.length) {
      return this.generateFallbackDayPlan(intensity);
    }

    const targetCount = Math.min(
      effectiveAttractions.length,
      intensity === 'high' ? 8 : intensity === 'medium' ? 6 : 4,
    );
    const interestSet = new Set(this.normalizeStringArray(user?.interests));

    const scored = effectiveAttractions
      .map((item) => ({
        attraction: item,
        score: this.calculateAttractionScore(item, interestSet),
      }))
      .sort((a, b) => b.score - a.score);

    const mustVisitSet = new Set(scored.slice(0, Math.min(2, scored.length)).map((item) => item.attraction.id));
    const selected = scored.slice(0, targetCount).map((item) => item.attraction);
    const ordered = this.nearestNeighborAttractions(selected);

    const startAt = new Date();
    startAt.setHours(9, 0, 0, 0);
    let currentTime = new Date(startAt);
    let totalDistance = 0;
    let totalTime = 0;
    let lunchAdded = false;

    const plan: Array<{
      attractionId: string;
      name: string;
      arrivalTime: string;
      stayDuration: number;
      isMustVisit: boolean;
    }> = [];

    for (let i = 0; i < ordered.length; i += 1) {
      const current = ordered[i];
      if (i > 0) {
        const previous = ordered[i - 1];
        const travel = await this.estimateAttractionTravel(previous.id, current.id, intensity);
        totalDistance += travel.distance;
        totalTime += travel.time;
        currentTime = new Date(currentTime.getTime() + travel.time * 60 * 1000);
      }

      if (!lunchAdded && currentTime.getHours() >= 12 && currentTime.getHours() < 14) {
        currentTime = new Date(currentTime.getTime() + 40 * 60 * 1000);
        totalTime += 40;
        lunchAdded = true;
      }

      const stayDuration = this.resolveStayDuration(current, intensity);
      plan.push({
        attractionId: current.id,
        name: current.name,
        arrivalTime: currentTime.toISOString(),
        stayDuration,
        isMustVisit: mustVisitSet.has(current.id),
      });

      currentTime = new Date(currentTime.getTime() + stayDuration * 60 * 1000);
      totalTime += stayDuration;

      const rest = this.resolveRestMinutes(intensity, i + 1, ordered.length);
      if (rest > 0) {
        currentTime = new Date(currentTime.getTime() + rest * 60 * 1000);
        totalTime += rest;
      }
    }

    return {
      plan,
      totalDistance: Number(totalDistance.toFixed(2)),
      totalTime: Number(totalTime.toFixed(2)),
    };
  }

  async adjustPlan(
    plan: Array<{
      attractionId: string;
      name: string;
      arrivalTime: string;
      stayDuration: number;
      isMustVisit: boolean;
    }>,
    currentAttractionId: string,
    currentTime: string,
  ) {
    const currentIndex = plan.findIndex((item) => item.attractionId === currentAttractionId);
    if (currentIndex === -1) {
      throw new Error('Current attraction not found in plan');
    }

    const actual = new Date(currentTime);
    const expected = new Date(plan[currentIndex].arrivalTime);
    const delayMinutes = Math.max(0, Math.round((actual.getTime() - expected.getTime()) / 60000));
    if (delayMinutes < 15) {
      return { adjustedPlan: plan, totalDistance: 0, totalTime: 0, removedAttractions: [] };
    }

    const completed = plan.slice(0, currentIndex + 1);
    const remaining = plan.slice(currentIndex + 1);
    const mustVisit = remaining.filter((item) => item.isMustVisit);
    const optional = remaining.filter((item) => !item.isMustVisit);
    const removeCount = Math.min(Math.ceil(delayMinutes / 30), optional.length);
    const removedAttractions = optional.slice(-removeCount).map((item) => item.attractionId);
    const adjustedRemaining = [...mustVisit, ...optional.slice(0, optional.length - removeCount)];

    const adjustedPlan = [...completed];
    let movingTime = new Date(currentTime);
    let totalDistance = 0;
    let totalTime = 0;
    let fromAttractionId = currentAttractionId;

    for (const item of adjustedRemaining) {
      let travelDistance = 0;
      let travelMinutes = 0;
      try {
        const travel = await this.getShortestTimePath(fromAttractionId, item.attractionId);
        travelDistance = Number(travel.distance || 0);
        travelMinutes = Number(travel.time || 0);
      } catch {
        const estimated = await this.estimateAttractionTravel(fromAttractionId, item.attractionId, 'medium');
        travelDistance = estimated.distance;
        travelMinutes = estimated.time;
      }

      totalDistance += travelDistance;
      totalTime += travelMinutes;
      movingTime = new Date(movingTime.getTime() + travelMinutes * 60 * 1000);
      adjustedPlan.push({ ...item, arrivalTime: movingTime.toISOString() });
      movingTime = new Date(movingTime.getTime() + item.stayDuration * 60 * 1000);
      totalTime += item.stayDuration;
      fromAttractionId = item.attractionId;
    }

    return {
      adjustedPlan,
      totalDistance: Number(totalDistance.toFixed(2)),
      totalTime: Number(totalTime.toFixed(2)),
      removedAttractions,
    };
  }

  private async buildPathResponse(
    startNodeId: string,
    endNodeId: string,
    strategy: PathStrategy,
    allowedTransportation: Transportation[],
  ): Promise<PathResponse> {
    await this.ensureRoadGraphInitialized();
    const modeKey = allowedTransportation.join(',');
    const cacheKey = `path_planning:route:${this.roadGraphVersion}:${strategy}:${modeKey}:${startNodeId}:${endNodeId}`;
    return cache.getOrSet(
      cacheKey,
      async () => {
        const graph = this.requireRoadGraph();
        const startNode = graph.getNode(startNodeId);
        const endNode = graph.getNode(endNodeId);
        if (!startNode || !endNode) {
          throw new Error('Start or end node was not found');
        }
        const planner = new PathPlanner(graph);
        const result = planner.findPath(startNodeId, endNodeId, strategy, allowedTransportation);
        if (!result.path.length) {
          throw new Error('No path found between the given nodes');
        }
        const routeContext = await this.buildRouteContext(startNode, endNode);

        const mappedSegments = result.path.map((segment) => {
          const fromNode = graph.getNode(segment.from);
          const toNode = graph.getNode(segment.to);
          const isConnector = this.isSyntheticConnectorSegment(segment, fromNode, toNode);
          const hideConnectorGuideLine = isConnector && this.shouldHideConnectorGuideLine(segment, fromNode, toNode);
          const pathPoints = hideConnectorGuideLine
            ? [fromNode?.location ?? { latitude: 0, longitude: 0 }]
            : [
                fromNode?.location ?? { latitude: 0, longitude: 0 },
                toNode?.location ?? { latitude: 0, longitude: 0 },
              ];
          return {
            from: segment.from,
            to: segment.to,
            transportation: segment.usedTransportation,
            distance: Number(segment.distance.toFixed(2)),
            time: Number(segment.edgeTimeMinutes.toFixed(2)),
            roadType: isConnector ? 'connector' : segment.roadType,
            roadName: isConnector ? '步行接驳' : this.resolveGraphRoadName(segment, fromNode, toNode),
            instruction: this.buildGraphInstruction(segment, fromNode, toNode),
            congestionFactor: Number(normalizeCongestionFactor(segment.congestionFactor).toFixed(2)),
            fromLocation: fromNode?.location ?? { latitude: 0, longitude: 0 },
            toLocation: toNode?.location ?? { latitude: 0, longitude: 0 },
            pathPoints,
            isConnector,
          };
        });

        const visibleGeometrySegments = mappedSegments.filter((segment) => !segment.isConnector);
        const routeGeometrySource = visibleGeometrySegments.length ? visibleGeometrySegments : mappedSegments;

        return this.decoratePathResponse(
          {
            path: [startNodeId, ...result.path.map((segment) => segment.to)],
            distance: Number(result.totalDistance.toFixed(2)),
            time: Number(result.totalTime.toFixed(2)),
            segments: mappedSegments,
            routeGeometry: this.mergePathPoints(routeGeometrySource.map((item) => item.pathPoints)),
            routeSource: 'graph',
            routeContext,
          },
          strategy,
          allowedTransportation,
        );
      },
      2 * 60 * 1000,
    );
  }

  private decoratePathResponse(
    response: PathResponse,
    strategy: PathStrategy,
    fallbackModes: Transportation[],
  ): PathResponse {
    const actualModes = collectTransportationModes(
      (response.segments || []).map((segment) => segment.transportation),
    );
    const transportationModes = actualModes.length ? actualModes : fallbackModes;

    return {
      ...response,
      strategy,
      transportationModes,
      isMixedTransportation: transportationModes.length > 1,
    };
  }

  private async ensureRoadGraphInitialized() {
    if (this.roadGraph) {
      return;
    }
    if (!this.graphInitializationPromise) {
      this.graphInitializationPromise = this.initializeRoadGraph().finally(() => {
        this.graphInitializationPromise = null;
      });
    }
    await this.graphInitializationPromise;
  }

  private requireRoadGraph(): RoadGraph {
    if (!this.roadGraph) {
      throw new Error('Road graph has not been initialized');
    }
    return this.roadGraph;
  }

  private parseTransportation(transportation: string): Transportation {
    if (transportation === Transportation.WALK) return Transportation.WALK;
    if (transportation === Transportation.BICYCLE) return Transportation.BICYCLE;
    if (transportation === Transportation.ELECTRIC_CART) return Transportation.ELECTRIC_CART;
    throw new Error(`Invalid transportation type: ${transportation}`);
  }

  private parseTransportationList(transportations?: string[]): Transportation[] {
    const source = Array.isArray(transportations) ? transportations : [];
    const parsed = source
      .map((item) => {
        try {
          return this.parseTransportation(String(item));
        } catch {
          return null;
        }
      })
      .filter((item): item is Transportation => Boolean(item));

    return parsed.length ? Array.from(new Set(parsed)) : [Transportation.WALK];
  }

  private async tryBuildDirectRoadRoute(
    startNodeId: string,
    endNodeId: string,
    transportation: Transportation,
  ): Promise<PathResponse | null> {
    await this.ensureRoadGraphInitialized();
    const graph = this.requireRoadGraph();
    const startNode = graph.getNode(startNodeId);
    const endNode = graph.getNode(endNodeId);
    if (!startNode || !endNode) {
      return null;
    }

    const cacheKey = `path_planning:osrm_direct:${this.roadGraphVersion}:${transportation}:${startNodeId}:${endNodeId}`;
    return cache.getOrSet(
      cacheKey,
      async () => {
        const routeContext = await this.buildRouteContext(startNode, endNode);
        const profile = this.toOsrmProfile(transportation);
        const coordinatePair = `${startNode.location.longitude},${startNode.location.latitude};${endNode.location.longitude},${endNode.location.latitude}`;
        const url =
          `https://router.project-osrm.org/route/v1/${profile}/${coordinatePair}` +
          '?overview=full&geometries=geojson&alternatives=false&steps=true&annotations=false';
        const payload = await this.fetchOsrmRoute(url);
        const route = payload?.routes?.[0];
        const coordinates = route?.geometry?.coordinates;
        if (!route || !Array.isArray(coordinates) || coordinates.length < 2) {
          throw new Error('No valid OSRM route');
        }

        const pathPoints = this.normalizeRoutePoints(coordinates);
        if (pathPoints.length < 2) {
          throw new Error('No valid OSRM geometry');
        }

        const totalDistance = Number(route.distance ?? 0);
        if (!Number.isFinite(totalDistance) || totalDistance <= 0) {
          throw new Error('No valid OSRM distance');
        }
        const segments = this.buildOsrmRouteSegments(
          startNodeId,
          endNodeId,
          startNode,
          endNode,
          transportation,
          route,
          pathPoints,
        );
        const totalTime = segments.length
          ? Number(segments.reduce((sum, item) => sum + Number(item.time || 0), 0).toFixed(2))
          : this.estimateTransportationTimeMinutes(totalDistance, transportation);

        return {
          path: [startNodeId, endNodeId],
          distance: Number(totalDistance.toFixed(2)),
          time: Number(totalTime.toFixed(2)),
          segments,
          routeGeometry: this.mergePathPoints(segments.map((segment) => segment.pathPoints)),
          routeSource: 'osrm' as const,
          routeContext,
        };
      },
      2 * 60 * 1000,
    ).catch(() => null);
  }

  private async buildRouteContext(startNode: GraphNode, endNode: GraphNode): Promise<RouteContext> {
    const graph = this.requireRoadGraph();
    const planningProfile = await this.resolvePlanningProfileForNodes(startNode, endNode);
    const scenicAreaId =
      startNode.scenicAreaId && endNode.scenicAreaId && startNode.scenicAreaId === endNode.scenicAreaId
        ? startNode.scenicAreaId
        : startNode.scenicAreaId || endNode.scenicAreaId || null;

    const candidateNodes = scenicAreaId
      ? graph.getAllNodes().filter((item) => item.scenicAreaId === scenicAreaId)
      : [startNode, endNode];
    const bounds = this.calculateRouteBounds(candidateNodes.map((item) => item.location));

    let scenicAreaName: string | null = null;
    let center: RoutePoint | null = null;
    if (scenicAreaId && AppDataSource?.isInitialized) {
      const scenicAreaRepo = AppDataSource.getRepository(ScenicAreaEntity);
      const scenicArea = await scenicAreaRepo.findOne({
        where: { id: scenicAreaId },
        select: ['id', 'name', 'latitude', 'longitude'],
      });
      if (scenicArea) {
        scenicAreaName = scenicArea.name || null;
        if (Number.isFinite(Number(scenicArea.latitude)) && Number.isFinite(Number(scenicArea.longitude))) {
          center = {
            latitude: Number(scenicArea.latitude),
            longitude: Number(scenicArea.longitude),
          };
        }
      }
    }

    if (!scenicAreaName) {
      scenicAreaName =
        this.extractScenicAreaName(startNode.name) ||
        this.extractScenicAreaName(endNode.name) ||
        null;
    }

    if (!center && bounds) {
      center = {
        latitude: Number(((bounds.minLat + bounds.maxLat) / 2).toFixed(8)),
        longitude: Number(((bounds.minLng + bounds.maxLng) / 2).toFixed(8)),
      };
    }

    const isVirtualScenic = Boolean(scenicAreaName && /示范(?:校园|景区)/.test(scenicAreaName));
    return {
      scenicAreaId,
      scenicAreaName,
      center,
      bounds,
      mapMode: isVirtualScenic ? 'scenic' : 'street',
      isVirtualScenic,
      planningProfile,
    };
  }

  private buildOsrmRouteSegments(
    startNodeId: string,
    endNodeId: string,
    startNode: GraphNode,
    endNode: GraphNode,
    transportation: Transportation,
    route: NonNullable<OsrmRoutePayload['routes']>[number],
    fallbackPathPoints: RoutePoint[],
  ): RouteResponseSegment[] {
    const rawSteps = (route.legs || []).flatMap((leg) => leg.steps || []);
    if (!rawSteps.length) {
      const congestionFactor = this.estimateDynamicCongestionFactor(transportation, 'main_road');
      const totalDistance = this.calculatePolylineDistanceMeters(fallbackPathPoints);
      return [
        {
          from: startNodeId,
          to: endNodeId,
          transportation,
          distance: Number(totalDistance.toFixed(2)),
          time: Number(this.estimateTransportationTimeMinutes(totalDistance, transportation, congestionFactor).toFixed(2)),
          roadType: 'main_road',
          roadName: this.resolveStepRoadName(undefined, transportation),
          instruction: this.buildSegmentInstruction(this.resolveStepRoadName(undefined, transportation), totalDistance),
          congestionFactor: Number(congestionFactor.toFixed(2)),
          fromLocation: startNode.location,
          toLocation: endNode.location,
          pathPoints: fallbackPathPoints,
        },
      ];
    }

    const segments: RouteResponseSegment[] = [];
    let lastPoint = startNode.location;

    rawSteps.forEach((step, index) => {
      const normalizedPoints = this.normalizeRoutePoints(step.geometry?.coordinates || []);
      const points = normalizedPoints.length > 1 ? [...normalizedPoints] : [lastPoint];
      if (index === 0) {
        this.prependRoutePoint(points, startNode.location);
      }
      if (index === rawSteps.length - 1) {
        this.appendRoutePoint(points, endNode.location);
      } else if (normalizedPoints.length > 0) {
        this.appendRoutePoint(points, normalizedPoints[normalizedPoints.length - 1]);
      } else {
        this.appendRoutePoint(points, lastPoint);
      }

      const fromLocation = points[0];
      const toLocation = points[points.length - 1];
      const distance = Number(step.distance ?? this.calculatePolylineDistanceMeters(points));
      if (!Number.isFinite(distance) || distance <= 0) {
        lastPoint = toLocation;
        return;
      }

      const roadName = this.resolveStepRoadName(step, transportation);
      const roadType = this.inferRoadTypeFromStep(step, transportation);
      const congestionFactor = this.estimateDynamicCongestionFactor(transportation, roadType);
      const time = this.estimateTransportationTimeMinutes(distance, transportation, congestionFactor);

      segments.push({
        from: index === 0 ? startNodeId : `${startNodeId}:osrm:${index}`,
        to: index === rawSteps.length - 1 ? endNodeId : `${startNodeId}:osrm:${index + 1}`,
        transportation,
        distance: Number(distance.toFixed(2)),
        time: Number(time.toFixed(2)),
        roadType,
        roadName,
        instruction: this.buildStepInstruction(step, roadName, distance),
        congestionFactor: Number(congestionFactor.toFixed(2)),
        fromLocation,
        toLocation,
        pathPoints: points,
      });

      lastPoint = toLocation;
    });

    return this.mergeAdjacentRouteSegments(segments, startNodeId, endNodeId);
  }

  private mergeAdjacentRouteSegments(
    segments: RouteResponseSegment[],
    startNodeId: string,
    endNodeId: string,
  ): RouteResponseSegment[] {
    if (!segments.length) {
      return [];
    }

    const merged: RouteResponseSegment[] = [];
    for (const segment of segments) {
      const previous = merged[merged.length - 1];
      if (
        previous &&
        previous.transportation === segment.transportation &&
        previous.roadType === segment.roadType &&
        (previous.roadName || '') === (segment.roadName || '')
      ) {
        previous.to = segment.to;
        previous.distance = Number((previous.distance + segment.distance).toFixed(2));
        previous.time = Number((previous.time + segment.time).toFixed(2));
        previous.toLocation = segment.toLocation;
        previous.pathPoints = this.mergePathPoints([previous.pathPoints, segment.pathPoints]);
        previous.congestionFactor = Number(
          ((((previous.congestionFactor || 1) + (segment.congestionFactor || 1)) / 2)).toFixed(2),
        );
        previous.instruction = this.buildSegmentInstruction(previous.roadName, previous.distance);
      } else {
        merged.push({ ...segment });
      }
    }

    if (merged.length) {
      merged[0].from = startNodeId;
      merged[merged.length - 1].to = endNodeId;
    }

    return merged.map((segment) => ({
      ...segment,
      instruction: segment.instruction || this.buildSegmentInstruction(segment.roadName, segment.distance),
    }));
  }

  private resolveGraphRoadName(
    segment: PathSegment,
    fromNode?: GraphNode,
    toNode?: GraphNode,
  ): string {
    const scenicName =
      this.extractScenicAreaName(fromNode?.name || '') ||
      this.extractScenicAreaName(toNode?.name || '') ||
      DEFAULT_SCENIC_NAME;

    if (segment.roadType === 'main_road') {
      return `${scenicName}主干道`;
    }
    if (segment.roadType === 'bicycle_path') {
      return `${scenicName}骑行道`;
    }
    if (segment.roadType === 'electric_cart_route') {
      return `${scenicName}电瓶车道`;
    }
    if (segment.roadType === 'connector') {
      return '步行接驳';
    }
    return `${scenicName}步行道`;
  }

  private buildGraphInstruction(
    segment: PathSegment,
    fromNode?: GraphNode,
    toNode?: GraphNode,
  ): string {
    if (this.isSyntheticConnectorSegment(segment, fromNode, toNode)) {
      return `从${this.normalizePlaceLabel(fromNode?.name || '当前位置')}步行接驳至路网`;
    }
    const destination = this.normalizePlaceLabel(toNode?.name || DEFAULT_NEXT_DESTINATION);
    const roadName = this.resolveGraphRoadName(segment, fromNode, toNode);
    return `沿${roadName}前往 ${destination}`;
  }

  private isSyntheticConnectorSegment(
    segment: PathSegment | GraphEdge,
    fromNode?: GraphNode,
    toNode?: GraphNode,
  ): boolean {
    if (segment.roadType === 'connector') {
      return true;
    }
    if (segment.roadType !== 'footpath') {
      return false;
    }
    const fromIsJunction = fromNode?.type === 'junction';
    const toIsJunction = toNode?.type === 'junction';
    if (Boolean(fromNode && toNode && fromIsJunction !== toIsJunction)) {
      return true;
    }

    const straightDistance = this.calculateSegmentStraightDistance(fromNode, toNode);
    if (!straightDistance) {
      return false;
    }

    const segmentDistance = Number(segment.distance ?? 0);
    return this.isConnectorDistanceSuspicious(straightDistance, segmentDistance);
  }

  private shouldHideConnectorGuideLine(
    segment: PathSegment | GraphEdge,
    fromNode?: GraphNode,
    toNode?: GraphNode,
  ): boolean {
    const straightDistance = this.calculateSegmentStraightDistance(fromNode, toNode);
    if (!straightDistance) {
      return false;
    }

    const segmentDistance = Number(segment.distance ?? 0);
    return this.isConnectorDistanceSuspicious(straightDistance, segmentDistance);
  }

  private calculateSegmentStraightDistance(fromNode?: GraphNode, toNode?: GraphNode): number {
    if (!fromNode || !toNode) {
      return 0;
    }

    return haversineDistanceMeters(
      Number(fromNode.location.latitude || 0),
      Number(fromNode.location.longitude || 0),
      Number(toNode.location.latitude || 0),
      Number(toNode.location.longitude || 0),
    );
  }

  private resolveStepRoadName(step: OsrmRouteStep | undefined, transportation: Transportation): string {
    const explicitName = String(step?.name || '').trim();
    if (explicitName) {
      return explicitName;
    }

    const referenceName = String(step?.ref || '').trim();
    if (referenceName) {
      return referenceName;
    }

    if (transportation === Transportation.WALK) {
      return '步行通道';
    }
    if (transportation === Transportation.BICYCLE) {
      return '骑行道路';
    }
    return '通行道路';
  }

  private inferRoadTypeFromStep(step: OsrmRouteStep | undefined, transportation: Transportation): string {
    const roadName = String(step?.name || '').trim();
    if (roadName) {
      return transportation === Transportation.ELECTRIC_CART
        ? 'electric_cart_route'
        : transportation === Transportation.BICYCLE
          ? 'bicycle_path'
          : 'main_road';
    }

    if (transportation === Transportation.ELECTRIC_CART) {
      return 'electric_cart_route';
    }
    if (transportation === Transportation.BICYCLE) {
      return 'bicycle_path';
    }
    return 'footpath';
  }

  private estimateDynamicCongestionFactor(
    transportation: Transportation,
    roadType: string,
  ): number {
    const rushHour = this.isRushHour(new Date());
    const transportFactor =
      transportation === Transportation.WALK
        ? rushHour
          ? 0.95
          : 1
        : transportation === Transportation.BICYCLE
          ? rushHour
            ? 0.88
            : 0.97
          : rushHour
            ? 0.82
            : 0.93;

    const roadFactor =
      roadType === 'main_road'
        ? rushHour
          ? 0.9
          : 0.97
        : roadType === 'side_road'
          ? rushHour
            ? 0.95
            : 1
        : roadType === 'bicycle_path'
          ? rushHour
            ? 0.93
            : 1
        : roadType === 'electric_cart_route'
            ? rushHour
              ? 0.9
              : 0.98
            : rushHour
              ? 0.97
              : 1;

    return Number(Math.max(0.2, Math.min(transportFactor * roadFactor, 1)).toFixed(2));
  }

  private buildStepInstruction(step: OsrmRouteStep, roadName: string, distanceMeters: number): string {
    const maneuverType = String(step.maneuver?.type || '').toLowerCase();
    const maneuverModifier = String(step.maneuver?.modifier || '').toLowerCase();
    if (maneuverType === 'depart') {
      return `从起点出发，沿${roadName}前进 ${distanceMeters.toFixed(0)} 米`;
    }
    if (maneuverType === 'arrive') {
      return '到达终点附近';
    }

    const action = STEP_ACTION_LABELS[maneuverModifier] || '沿';
    if (action === '沿') {
      return `沿${roadName}前进 ${distanceMeters.toFixed(0)} 米`;
    }
    return `${action}${roadName}，继续 ${distanceMeters.toFixed(0)} 米`;
  }

  private buildSegmentInstruction(roadName: string | undefined, distanceMeters: number): string {
    if (!roadName) {
      return `前进 ${distanceMeters.toFixed(0)} 米`;
    }
    return `沿${roadName}前进 ${distanceMeters.toFixed(0)} 米`;
  }

  private calculateRouteBounds(points: RoutePoint[]): RouteBounds | null {
    if (!points.length) {
      return null;
    }

    let minLat = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let minLng = Number.POSITIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;

    for (const point of points) {
      minLat = Math.min(minLat, point.latitude);
      maxLat = Math.max(maxLat, point.latitude);
      minLng = Math.min(minLng, point.longitude);
      maxLng = Math.max(maxLng, point.longitude);
    }

    return {
      minLat: Number(minLat.toFixed(8)),
      maxLat: Number(maxLat.toFixed(8)),
      minLng: Number(minLng.toFixed(8)),
      maxLng: Number(maxLng.toFixed(8)),
    };
  }

  private prependRoutePoint(points: RoutePoint[], point: RoutePoint) {
    const first = points[0];
    if (!first || Math.abs(first.latitude - point.latitude) > 1e-7 || Math.abs(first.longitude - point.longitude) > 1e-7) {
      points.unshift(point);
    }
  }

  private appendRoutePoint(points: RoutePoint[], point: RoutePoint) {
    const last = points[points.length - 1];
    if (!last || Math.abs(last.latitude - point.latitude) > 1e-7 || Math.abs(last.longitude - point.longitude) > 1e-7) {
      points.push(point);
    }
  }

  private calculatePolylineDistanceMeters(points: RoutePoint[]): number {
    if (points.length < 2) {
      return 0;
    }

    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += haversineDistanceMeters(
        points[index - 1].latitude,
        points[index - 1].longitude,
        points[index].latitude,
        points[index].longitude,
      );
    }
    return Number(total.toFixed(2));
  }

  private extractScenicAreaName(name: string): string {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      return '';
    }

    const junctionMatch = trimmed.match(/^(.*?)-路口-\d+-\d+$/);
    if (junctionMatch) {
      return junctionMatch[1];
    }

    const placeMatch = trimmed.match(/^(.*?)-(景点|游客中心|餐厅|卫生间|停车场|入口|出口).*/);
    if (placeMatch) {
      return placeMatch[1];
    }

    const genericPlaceMatch = trimmed.match(/^(.*?)-[^-]+$/);
    if (genericPlaceMatch) {
      return genericPlaceMatch[1];
    }

    return trimmed.includes('路') ? trimmed.split('路')[0].trim() : trimmed;
  }

  private normalizePlaceLabel(name: string): string {
    const scenicName = this.extractScenicAreaName(name);
    if (scenicName && scenicName !== name) {
      return name.replace(`${scenicName}-`, '').replace(`${scenicName} 路 `, '').trim();
    }
    return name;
  }

  private async fetchOsrmRoute(url: string): Promise<OsrmRoutePayload | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as OsrmRoutePayload;
      if (payload?.code !== 'Ok') {
        return null;
      }
      return payload;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeRoutePoints(coordinates: Array<[number, number]>): RoutePoint[] {
    const points: RoutePoint[] = [];
    for (const coordinate of coordinates) {
      if (!Array.isArray(coordinate) || coordinate.length < 2) {
        continue;
      }
      const longitude = Number(coordinate[0]);
      const latitude = Number(coordinate[1]);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        continue;
      }
      const last = points[points.length - 1];
      if (last && Math.abs(last.latitude - latitude) < 1e-7 && Math.abs(last.longitude - longitude) < 1e-7) {
        continue;
      }
      points.push({ latitude, longitude });
    }
    return points;
  }

  private mergePathPoints(pathPointGroups: RoutePoint[][]): RoutePoint[] {
    const merged: RoutePoint[] = [];
    for (const group of pathPointGroups) {
      for (const point of group) {
        const last = merged[merged.length - 1];
        if (last && Math.abs(last.latitude - point.latitude) < 1e-7 && Math.abs(last.longitude - point.longitude) < 1e-7) {
          continue;
        }
        merged.push(point);
      }
    }
    return merged;
  }

  private toOsrmProfile(transportation: Transportation): 'walking' | 'cycling' | 'driving' {
    if (transportation === Transportation.WALK) {
      return 'walking';
    }
    if (transportation === Transportation.BICYCLE) {
      return 'cycling';
    }
    return 'driving';
  }

  private estimateTransportationTimeMinutes(
    distanceMeters: number,
    transportation: Transportation,
    extraCongestionFactor: number = 1,
  ): number {
    const speedMetersPerMinute = (TRANSPORTATION_SPEED_KMH[transportation] * 1000) / 60;
    const congestionFactor = normalizeCongestionFactor(extraCongestionFactor);
    return (distanceMeters / speedMetersPerMinute) / Math.max(congestionFactor, 0.05);
  }

  private isRushHour(current: Date): boolean {
    const hour = current.getHours();
    return (hour >= 7 && hour < 10) || (hour >= 17 && hour < 20);
  }

  private nearestNeighborOrder(nodeIds: string[]): string[] {
    const graph = this.requireRoadGraph();
    const unvisited = new Set(nodeIds);
    const order: string[] = [];
    let current = nodeIds[0];
    order.push(current);
    unvisited.delete(current);

    while (unvisited.size > 0) {
      const currentNode = graph.getNode(current);
      if (!currentNode) {
        break;
      }
      let nearestNode = '';
      let minDistance = Number.POSITIVE_INFINITY;
      for (const candidateId of unvisited) {
        const candidateNode = graph.getNode(candidateId);
        if (!candidateNode) continue;
        const distance = haversineDistanceKm(
          currentNode.location.latitude,
          currentNode.location.longitude,
          candidateNode.location.latitude,
          candidateNode.location.longitude,
        );
        if (distance < minDistance) {
          minDistance = distance;
          nearestNode = candidateId;
        }
      }
      if (!nearestNode) {
        const [fallback] = Array.from(unvisited);
        nearestNode = fallback;
      }
      order.push(nearestNode);
      unvisited.delete(nearestNode);
      current = nearestNode;
    }
    return order;
  }

  private buildMultiPointMetricMatrix(
    nodeIds: string[],
    planner: PathPlanner,
    strategy: PathStrategy,
    allowedTransportation: Transportation[],
  ): Map<string, { distance: number; time: number; path: string[]; transportationModes: Transportation[] }> {
    const metrics = new Map<
      string,
      { distance: number; time: number; path: string[]; transportationModes: Transportation[] }
    >();

    for (let i = 0; i < nodeIds.length; i += 1) {
      for (let j = i + 1; j < nodeIds.length; j += 1) {
        const result = planner.findPath(nodeIds[i], nodeIds[j], strategy, allowedTransportation);
        if (!result.path.length) {
          continue;
        }

        const forwardPath = [nodeIds[i], ...result.path.map((segment) => segment.to)];
        const backwardPath = [...forwardPath].reverse();
        const transportationModes = collectTransportationModes(
          result.path.map((segment) => segment.usedTransportation),
        );
        metrics.set(this.buildMatrixKey(nodeIds[i], nodeIds[j]), {
          distance: Number(result.totalDistance.toFixed(2)),
          time: Number(result.totalTime.toFixed(2)),
          path: forwardPath,
          transportationModes,
        });
        metrics.set(this.buildMatrixKey(nodeIds[j], nodeIds[i]), {
          distance: Number(result.totalDistance.toFixed(2)),
          time: Number(result.totalTime.toFixed(2)),
          path: backwardPath,
          transportationModes,
        });
      }
    }

    return metrics;
  }

  private nearestNeighborOrderByMatrix(
    nodeIds: string[],
    metrics: Map<string, { distance: number; time: number; path: string[]; transportationModes: Transportation[] }>,
    strategy: PathStrategy,
  ): string[] {
    const unvisited = new Set(nodeIds);
    const order: string[] = [];
    let current = nodeIds[0];
    order.push(current);
    unvisited.delete(current);

    while (unvisited.size > 0) {
      let nearestNode = '';
      let nearestWeight = Number.POSITIVE_INFINITY;

      for (const candidateId of unvisited) {
        const metric = metrics.get(this.buildMatrixKey(current, candidateId));
        const candidateWeight =
          strategy === PathStrategy.SHORTEST_DISTANCE
            ? Number(metric?.distance ?? Number.POSITIVE_INFINITY)
            : Number(metric?.time ?? Number.POSITIVE_INFINITY);
        if (candidateWeight < nearestWeight) {
          nearestNode = candidateId;
          nearestWeight = candidateWeight;
        }
      }

      if (!nearestNode) {
        const [fallback] = Array.from(unvisited);
        nearestNode = fallback;
      }

      order.push(nearestNode);
      unvisited.delete(nearestNode);
      current = nearestNode;
    }

    return order;
  }

  private improveOrderWithTwoOpt(
    originalOrder: string[],
    metrics: Map<string, { distance: number; time: number; path: string[]; transportationModes: Transportation[] }>,
    strategy: PathStrategy,
  ): string[] {
    if (originalOrder.length < 4) {
      return originalOrder;
    }

    const calculateWeight = (order: string[]) => {
      let weight = 0;
      for (let index = 0; index < order.length - 1; index += 1) {
        const metric = metrics.get(this.buildMatrixKey(order[index], order[index + 1]));
        weight += strategy === PathStrategy.SHORTEST_DISTANCE
          ? Number(metric?.distance ?? Number.POSITIVE_INFINITY)
          : Number(metric?.time ?? Number.POSITIVE_INFINITY);
      }
      return weight;
    };

    let bestOrder = [...originalOrder];
    let bestWeight = calculateWeight(bestOrder);
    let improved = true;

    while (improved) {
      improved = false;
      for (let i = 1; i < bestOrder.length - 2; i += 1) {
        for (let j = i + 1; j < bestOrder.length - 1; j += 1) {
          const candidate = [
            ...bestOrder.slice(0, i),
            ...bestOrder.slice(i, j + 1).reverse(),
            ...bestOrder.slice(j + 1),
          ];
          const candidateWeight = calculateWeight(candidate);
          if (candidateWeight + 1e-6 < bestWeight) {
            bestOrder = candidate;
            bestWeight = candidateWeight;
            improved = true;
          }
        }
      }
    }

    return bestOrder;
  }

  private buildMatrixKey(fromNodeId: string, toNodeId: string): string {
    return `${fromNodeId}->${toNodeId}`;
  }

  private calculateAttractionScore(attraction: AttractionEntity, interests: Set<string>): number {
    const rating = Number(attraction.averageRating ?? 0);
    const reviewCount = Number(attraction.reviewCount ?? 0);
    const congestionFactor = Number(attraction.congestionFactor ?? 1);
    const lowCongestionBonus = congestionFactor > 0 ? 1 / congestionFactor : 1;

    const metaText = [
      attraction.category || '',
      attraction.type || '',
      attraction.name || '',
      attraction.description || '',
      ...(attraction.tags || []),
    ]
      .join(' ')
      .toLowerCase();

    const interestKeywords: Record<string, string[]> = {
      foodie: ['美食', '餐饮', '小吃', 'food', 'cafe'],
      photographer: ['摄影', '拍照', '打卡', 'photo', 'view'],
      cultureEnthusiast: ['历史', '文化', '博物', '古迹', 'museum'],
      natureLover: ['自然', '公园', '湖', '山', '花', 'forest'],
      sportsEnthusiast: ['运动', '徒步', '健身', '骑行', 'trail'],
      relaxationSeeker: ['休闲', '慢游', '安静', '放松', 'garden'],
      socialSharer: ['热门', '活动', '社交', '广场', 'event'],
    };

    let interestBonus = 0;
    for (const interest of interests) {
      const keywords = interestKeywords[interest] || [];
      if (keywords.some((keyword) => metaText.includes(keyword.toLowerCase()))) {
        interestBonus += 1.4;
      }
    }

    return rating * 2.1 + reviewCount * 0.06 + lowCongestionBonus * 1.2 + interestBonus;
  }

  private nearestNeighborAttractions(attractions: AttractionEntity[]): AttractionEntity[] {
    if (attractions.length <= 1) {
      return attractions;
    }

    const remaining = new Map<string, AttractionEntity>();
    for (const item of attractions) {
      remaining.set(item.id, item);
    }

    const ordered: AttractionEntity[] = [];
    let current = attractions[0];
    ordered.push(current);
    remaining.delete(current.id);

    while (remaining.size > 0) {
      let next: AttractionEntity | null = null;
      let minDistance = Number.POSITIVE_INFINITY;
      const currentLat = Number(current.latitude ?? 0);
      const currentLng = Number(current.longitude ?? 0);

      for (const candidate of remaining.values()) {
        const distance = haversineDistanceKm(
          currentLat,
          currentLng,
          Number(candidate.latitude ?? 0),
          Number(candidate.longitude ?? 0),
        );
        if (distance < minDistance) {
          minDistance = distance;
          next = candidate;
        }
      }

      if (!next) {
        break;
      }
      ordered.push(next);
      remaining.delete(next.id);
      current = next;
    }

    return ordered;
  }

  private async estimateAttractionTravel(
    fromAttractionId: string,
    toAttractionId: string,
    intensity: 'low' | 'medium' | 'high',
  ): Promise<{ distance: number; time: number }> {
    const [fromNode, toNode] = await Promise.all([
      this.findNearestNodeByAttraction(fromAttractionId),
      this.findNearestNodeByAttraction(toAttractionId),
    ]);

    const transportation = intensity === 'high'
      ? Transportation.ELECTRIC_CART
      : intensity === 'medium'
        ? Transportation.BICYCLE
        : Transportation.WALK;

    try {
      const path = await this.getPathByTransportation(fromNode.nodeId, toNode.nodeId, transportation);
      return {
        distance: Number(path.distance || 0),
        time: Number(path.time || 0),
      };
    } catch {
      try {
        const fallback = await this.getShortestTimePath(fromNode.nodeId, toNode.nodeId);
        return {
          distance: Number(fallback.distance || 0),
          time: Number(fallback.time || 0),
        };
      } catch {
        const graph = this.requireRoadGraph();
        const from = graph.getNode(fromNode.nodeId);
        const to = graph.getNode(toNode.nodeId);
        if (!from || !to) {
          return { distance: 0, time: 0 };
        }
        const km = haversineDistanceKm(
          from.location.latitude,
          from.location.longitude,
          to.location.latitude,
          to.location.longitude,
        );
        const distance = km * 1000;
        const speedMPerMinute = transportation === Transportation.ELECTRIC_CART
          ? 320
          : transportation === Transportation.BICYCLE
            ? 220
            : 75;
        return {
          distance: Number(distance.toFixed(2)),
          time: Number((distance / speedMPerMinute).toFixed(2)),
        };
      }
    }
  }

  private resolveStayDuration(attraction: AttractionEntity, intensity: 'low' | 'medium' | 'high'): number {
    const base = intensity === 'high' ? 30 : intensity === 'medium' ? 42 : 55;
    const estimated = Number(attraction.estimatedVisitDuration ?? 0);
    if (Number.isFinite(estimated) && estimated > 0) {
      return Math.max(20, Math.min(120, Math.round((estimated + base) / 2)));
    }
    return base;
  }

  private resolveRestMinutes(intensity: 'low' | 'medium' | 'high', index: number, total: number): number {
    if (index >= total) {
      return 0;
    }
    if (intensity === 'low') {
      return index % 2 === 0 ? 18 : 0;
    }
    if (intensity === 'medium') {
      return index % 3 === 0 ? 10 : 0;
    }
    return index % 4 === 0 ? 6 : 0;
  }

  private async generateFallbackDayPlan(intensity: 'low' | 'medium' | 'high'): Promise<{
    plan: Array<{
      attractionId: string;
      name: string;
      arrivalTime: string;
      stayDuration: number;
      isMustVisit: boolean;
    }>;
    totalDistance: number;
    totalTime: number;
  }> {
    const graph = this.requireRoadGraph();
    const attractions = graph.getAllNodes().filter((node) => node.type === 'attraction');
    const attractionCount = intensity === 'high' ? 8 : intensity === 'medium' ? 5 : 3;
    const selected = attractions.slice(0, attractionCount);
    if (!selected.length) {
      return { plan: [], totalDistance: 0, totalTime: 0 };
    }

    const order = this.nearestNeighborOrder(selected.map((item) => item.id));
    const start = new Date();
    start.setHours(9, 0, 0, 0);
    const plan: Array<{
      attractionId: string;
      name: string;
      arrivalTime: string;
      stayDuration: number;
      isMustVisit: boolean;
    }> = [];
    let currentTime = new Date(start);
    let totalDistance = 0;
    let totalTime = 0;

    for (let i = 0; i < order.length; i += 1) {
      const currentNode = selected.find((item) => item.id === order[i]);
      if (!currentNode) {
        continue;
      }
      if (i > 0) {
        const travel = await this.getShortestTimePath(order[i - 1], order[i]);
        totalDistance += travel.distance;
        totalTime += travel.time;
        currentTime = new Date(currentTime.getTime() + travel.time * 60 * 1000);
      }
      const stayDuration = intensity === 'high' ? 30 : intensity === 'medium' ? 45 : 60;
      plan.push({
        attractionId: currentNode.id,
        name: currentNode.name,
        arrivalTime: currentTime.toISOString(),
        stayDuration,
        isMustVisit: i < 2,
      });
      currentTime = new Date(currentTime.getTime() + stayDuration * 60 * 1000);
      totalTime += stayDuration;
    }

    return {
      plan,
      totalDistance: Number(totalDistance.toFixed(2)),
      totalTime: Number(totalTime.toFixed(2)),
    };
  }

  private async tryBuildGraphFromDatabase(): Promise<RoadGraph | null> {
    if (!AppDataSource || !AppDataSource.isInitialized) {
      return null;
    }

    await mapTemplateRuntimeService.ensureTemplatesPersisted();
    const nodeRepo = AppDataSource.getRepository(RoadGraphNodeEntity);
    const edgeRepo = AppDataSource.getRepository(RoadGraphEdgeEntity);
    const scenicAreaRepo = AppDataSource.getRepository(ScenicAreaEntity);
    const [nodes, edges, scenicAreas] = await Promise.all([
      nodeRepo.find(),
      edgeRepo.find(),
      scenicAreaRepo.find({ select: ['id', 'category', 'name'] }),
    ]);
    if (!scenicAreas.length) {
      return null;
    }

    const scenicAreaCategoryMap = new Map<string, string>();
    scenicAreas.forEach((item) => {
      const resolvedCategory = item.category || this.inferCategoryFromName(item.name) || '景区';
      scenicAreaCategoryMap.set(item.id, resolvedCategory);
      this.scenicAreaCategoryCache.set(item.id, resolvedCategory);
    });

    const areaIdsWithDbNodes = new Set(nodes.map((item) => item.scenicAreaId));

    const graph = new RoadGraph();
    for (const node of nodes) {
      graph.addNode({
        id: node.id,
        scenicAreaId: node.scenicAreaId,
        type: node.type || 'junction',
        name: node.name || `${DEFAULT_NODE_LABEL_PREFIX} ${node.id}`,
        location: {
          latitude: Number(node.latitude ?? 0),
          longitude: Number(node.longitude ?? 0),
        },
      });
    }

    for (const edge of edges) {
      const mapped = this.mapEdgeEntity(
        edge,
        graph,
        scenicAreaCategoryMap.get(edge.scenicAreaId) || null,
      );
      if (graph.getNode(mapped.from) && graph.getNode(mapped.to)) {
        this.addBidirectionalEdge(graph, mapped);
      }
    }

    for (const scenicArea of scenicAreas) {
      if (areaIdsWithDbNodes.has(scenicArea.id)) {
        continue;
      }
      const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicArea(scenicArea as ScenicAreaEntity);
      if (!runtimeMap) {
        continue;
      }
      for (const node of runtimeMap.roadNodes) {
        graph.addNode({
          id: node.id,
          scenicAreaId: node.scenicAreaId,
          type: node.type || 'junction',
          name: node.name || `${DEFAULT_NODE_LABEL_PREFIX} ${node.id}`,
          location: {
            latitude: Number(node.latitude ?? 0),
            longitude: Number(node.longitude ?? 0),
          },
        });
      }
      for (const edge of runtimeMap.roadEdges) {
        const mapped = this.mapEdgeEntity(
          edge,
          graph,
          scenicAreaCategoryMap.get(edge.scenicAreaId) || null,
        );
        if (graph.getNode(mapped.from) && graph.getNode(mapped.to)) {
          this.addBidirectionalEdge(graph, mapped);
        }
      }
    }

    if (!graph.getAllNodes().length || !graph.getAllEdges().length) {
      return null;
    }
    return graph;
  }

  private mapEdgeEntity(
    edge: RoadGraphEdgeEntity,
    graph?: RoadGraph,
    scenicAreaCategory?: string | null,
  ): GraphEdge {
    const repairedConnection = this.repairSuspiciousConnectorConnection(edge, graph);
    const fromNode = repairedConnection.fromNode;
    const toNode = repairedConnection.toNode;
    const edgeDistance = repairedConnection.distance;
    const straightDistance =
      fromNode && toNode
        ? haversineDistanceMeters(
            Number(fromNode.location.latitude || 0),
            Number(fromNode.location.longitude || 0),
            Number(toNode.location.latitude || 0),
            Number(toNode.location.longitude || 0),
          )
        : 0;
    const inferredRoadType =
      edge.roadType === 'footpath' &&
      fromNode &&
      toNode &&
      ((fromNode.type === 'junction') !== (toNode.type === 'junction') ||
        this.isConnectorDistanceSuspicious(straightDistance, edgeDistance))
        ? 'connector'
        : edge.roadType || 'main_road';

    const baseEdge: GraphEdge = {
      id: edge.id,
      scenicAreaId: edge.scenicAreaId,
      from: repairedConnection.fromId,
      to: repairedConnection.toId,
      distance: edgeDistance,
      roadType: inferredRoadType,
      congestionFactor: normalizeCongestionFactor(Number(edge.congestionFactor ?? 1)),
      allowedTransportation: this.parseAllowedTransportation(edge, scenicAreaCategory, inferredRoadType),
      isElectricCartRoute: Boolean(edge.isElectricCartRoute),
      isBicyclePath: Boolean(edge.isBicyclePath),
    };

    return this.normalizeEdgeByPlanningProfile(baseEdge, scenicAreaCategory);
  }

  private repairSuspiciousConnectorConnection(
    edge: RoadGraphEdgeEntity,
    graph?: RoadGraph,
  ): {
    fromId: string;
    toId: string;
    fromNode?: GraphNode;
    toNode?: GraphNode;
    distance: number;
  } {
    const originalFromNode = graph?.getNode(edge.fromNodeId);
    const originalToNode = graph?.getNode(edge.toNodeId);
    const originalDistance = Number(edge.distance ?? 0);

    if (!graph || !originalFromNode || !originalToNode) {
      return {
        fromId: edge.fromNodeId,
        toId: edge.toNodeId,
        fromNode: originalFromNode,
        toNode: originalToNode,
        distance: originalDistance,
      };
    }

    const fromIsJunction = originalFromNode.type === 'junction';
    const toIsJunction = originalToNode.type === 'junction';
    if (fromIsJunction === toIsJunction) {
      return {
        fromId: edge.fromNodeId,
        toId: edge.toNodeId,
        fromNode: originalFromNode,
        toNode: originalToNode,
        distance: originalDistance,
      };
    }

    const straightDistance = haversineDistanceMeters(
      Number(originalFromNode.location.latitude || 0),
      Number(originalFromNode.location.longitude || 0),
      Number(originalToNode.location.latitude || 0),
      Number(originalToNode.location.longitude || 0),
    );
    if (!this.isConnectorDistanceSuspicious(straightDistance, originalDistance)) {
      return {
        fromId: edge.fromNodeId,
        toId: edge.toNodeId,
        fromNode: originalFromNode,
        toNode: originalToNode,
        distance: originalDistance,
      };
    }

    const poiNode = fromIsJunction ? originalToNode : originalFromNode;
    const nearestJunction = this.findNearestJunctionNodeForAnchor(poiNode, graph);
    if (!nearestJunction) {
      return {
        fromId: edge.fromNodeId,
        toId: edge.toNodeId,
        fromNode: originalFromNode,
        toNode: originalToNode,
        distance: originalDistance,
      };
    }

    const repairedDistance = haversineDistanceMeters(
      Number(poiNode.location.latitude || 0),
      Number(poiNode.location.longitude || 0),
      Number(nearestJunction.location.latitude || 0),
      Number(nearestJunction.location.longitude || 0),
    );
    if (!Number.isFinite(repairedDistance) || repairedDistance <= 0 || repairedDistance >= straightDistance) {
      return {
        fromId: edge.fromNodeId,
        toId: edge.toNodeId,
        fromNode: originalFromNode,
        toNode: originalToNode,
        distance: originalDistance,
      };
    }

    return fromIsJunction
      ? {
          fromId: nearestJunction.id,
          toId: originalToNode.id,
          fromNode: nearestJunction,
          toNode: originalToNode,
          distance: Number(repairedDistance.toFixed(2)),
        }
      : {
          fromId: originalFromNode.id,
          toId: nearestJunction.id,
          fromNode: originalFromNode,
          toNode: nearestJunction,
          distance: Number(repairedDistance.toFixed(2)),
        };
  }

  private findNearestJunctionNodeForAnchor(anchorNode: GraphNode, graph: RoadGraph): GraphNode | null {
    let nearestNode: GraphNode | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of graph.getAllNodes()) {
      if (candidate.id === anchorNode.id || candidate.type !== 'junction') {
        continue;
      }
      if (anchorNode.scenicAreaId && candidate.scenicAreaId !== anchorNode.scenicAreaId) {
        continue;
      }

      const distance = haversineDistanceKm(
        Number(anchorNode.location.latitude || 0),
        Number(anchorNode.location.longitude || 0),
        Number(candidate.location.latitude || 0),
        Number(candidate.location.longitude || 0),
      );
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestNode = candidate;
      }
    }

    return nearestNode;
  }

  private isConnectorDistanceSuspicious(straightDistanceMeters: number, segmentDistanceMeters: number): boolean {
    if (!Number.isFinite(straightDistanceMeters) || straightDistanceMeters <= 0) {
      return false;
    }
    if (!Number.isFinite(segmentDistanceMeters) || segmentDistanceMeters <= 0) {
      return straightDistanceMeters > 30;
    }

    return straightDistanceMeters > Math.max(segmentDistanceMeters * 2.2, segmentDistanceMeters + 20, 30);
  }

  private parseAllowedTransportation(
    edge: RoadGraphEdgeEntity,
    scenicAreaCategory?: string | null,
    inferredRoadType?: string,
  ): Transportation[] {
    const candidates: string[] = [];
    if (edge.allowedTransportation) {
      const raw = String(edge.allowedTransportation).trim();
      if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) candidates.push(String(item));
          }
        } catch {
          // ignore parse error and fallback
        }
      }
      if (!candidates.length) {
        for (const item of raw.split(',')) {
          candidates.push(item.trim());
        }
      }
    }
    if (edge.transportation) candidates.push(edge.transportation);
    if (edge.isBicyclePath) candidates.push(Transportation.BICYCLE);
    if (edge.isElectricCartRoute) candidates.push(Transportation.ELECTRIC_CART);

    if (!candidates.length) candidates.push(Transportation.WALK);

    const normalized = new Set<Transportation>();
    for (const item of candidates) {
      if (item === Transportation.WALK) normalized.add(Transportation.WALK);
      if (item === Transportation.BICYCLE) normalized.add(Transportation.BICYCLE);
      if (item === Transportation.ELECTRIC_CART) normalized.add(Transportation.ELECTRIC_CART);
    }
    if (!normalized.size) normalized.add(Transportation.WALK);
    return Array.from(normalized);
  }

  private normalizeEdgeByPlanningProfile(edge: GraphEdge, scenicAreaCategory?: string | null): GraphEdge {
    const explicitModes = collectTransportationModes(edge.allowedTransportation);
    if (edge.roadType === 'connector') {
      return {
        ...edge,
        congestionFactor: normalizeCongestionFactor(edge.congestionFactor),
        allowedTransportation: [Transportation.WALK],
        isBicyclePath: false,
        isElectricCartRoute: false,
      };
    }

    const profile = this.resolvePlanningProfile(scenicAreaCategory);
    if (profile.kind === 'campus') {
      if (edge.roadType === 'footpath') {
        return {
          ...edge,
          congestionFactor: normalizeCongestionFactor(edge.congestionFactor),
          allowedTransportation: [Transportation.WALK],
          isBicyclePath: false,
          isElectricCartRoute: false,
        };
      }

      return {
        ...edge,
        congestionFactor: normalizeCongestionFactor(edge.congestionFactor),
        allowedTransportation: explicitModes.length ? explicitModes : [Transportation.WALK, Transportation.BICYCLE],
        isBicyclePath: edge.isBicyclePath || edge.roadType === 'bicycle_path',
        isElectricCartRoute: false,
      };
    }

    if (profile.kind === 'scenic') {
      if (edge.roadType === 'footpath') {
        return {
          ...edge,
          congestionFactor: normalizeCongestionFactor(edge.congestionFactor),
          allowedTransportation: [Transportation.WALK],
          isBicyclePath: false,
          isElectricCartRoute: false,
        };
      }

      return {
        ...edge,
        congestionFactor: normalizeCongestionFactor(edge.congestionFactor),
        allowedTransportation: explicitModes.length ? explicitModes : [Transportation.WALK],
        isBicyclePath: false,
        isElectricCartRoute:
          edge.isElectricCartRoute ||
          explicitModes.includes(Transportation.ELECTRIC_CART) ||
          edge.roadType === 'electric_cart_route',
      };
    }

    return {
      ...edge,
      congestionFactor: normalizeCongestionFactor(edge.congestionFactor),
      allowedTransportation: explicitModes.length ? explicitModes : [Transportation.WALK],
    };
  }

  private addBidirectionalEdge(graph: RoadGraph, edge: GraphEdge) {
    graph.addEdge(edge);
    if (!graph.hasDirectedEdge(edge.to, edge.from)) {
      graph.addEdge({
        ...edge,
        id: `${edge.id}-reverse`,
        from: edge.to,
        to: edge.from,
      });
    }
  }

  private buildFallbackGraph(): RoadGraph {
    const graph = new RoadGraph();
    const nodes: GraphNode[] = [
      { id: '1', type: 'junction', name: '主入口', location: { latitude: 39.9042, longitude: 116.4074 } },
      { id: '2', type: 'junction', name: '中心广场', location: { latitude: 39.9052, longitude: 116.4084 } },
      { id: '3', type: 'attraction', name: '景点A', location: { latitude: 39.9062, longitude: 116.4094 } },
      { id: '4', type: 'attraction', name: '景点B', location: { latitude: 39.9072, longitude: 116.4104 } },
      { id: '5', type: 'junction', name: '东出口', location: { latitude: 39.9082, longitude: 116.4114 } },
    ];
    const edges: GraphEdge[] = [
      {
        id: 'e1',
        from: '1',
        to: '2',
        distance: 100,
        roadType: 'main_road',
        congestionFactor: 1,
        allowedTransportation: [Transportation.WALK, Transportation.BICYCLE, Transportation.ELECTRIC_CART],
        isElectricCartRoute: true,
        isBicyclePath: true,
      },
      {
        id: 'e2',
        from: '2',
        to: '3',
        distance: 150,
        roadType: 'main_road',
        congestionFactor: 1,
        allowedTransportation: [Transportation.WALK, Transportation.BICYCLE, Transportation.ELECTRIC_CART],
        isElectricCartRoute: true,
        isBicyclePath: true,
      },
      {
        id: 'e3',
        from: '3',
        to: '4',
        distance: 180,
        roadType: 'bicycle_path',
        congestionFactor: 0.9,
        allowedTransportation: [Transportation.BICYCLE, Transportation.WALK],
        isElectricCartRoute: false,
        isBicyclePath: true,
      },
      {
        id: 'e4',
        from: '4',
        to: '5',
        distance: 120,
        roadType: 'main_road',
        congestionFactor: 1.05,
        allowedTransportation: [Transportation.WALK, Transportation.BICYCLE, Transportation.ELECTRIC_CART],
        isElectricCartRoute: true,
        isBicyclePath: true,
      },
      {
        id: 'e5',
        from: '2',
        to: '4',
        distance: 220,
        roadType: 'electric_cart_route',
        congestionFactor: 0.95,
        allowedTransportation: [Transportation.ELECTRIC_CART, Transportation.WALK],
        isElectricCartRoute: true,
        isBicyclePath: false,
      },
    ];

    for (const node of nodes) graph.addNode(node);
    for (const edge of edges) this.addBidirectionalEdge(graph, edge);
    return graph;
  }


}

interface IndoorLocation {
  floor: number;
  x: number;
  y: number;
}

interface IndoorPathResult {
  instructions: string[];
  distance: number;
  estimatedTime: number;
}

interface IndoorStructure {
  buildingId: string;
  elevators: Array<{
    id: string;
    location: IndoorLocation;
    floors: number[];
    averageWaitTime: number;
  }>;
}

export class IndoorNavigationService {
  private indoorStructures = new Map<string, IndoorStructure>();

  async initializeIndoorStructures(): Promise<void> {
    this.indoorStructures.set('building1', {
      buildingId: 'building1',
      elevators: [
        {
          id: 'elevator-1',
          location: { floor: 1, x: 10, y: 10 },
          floors: [1, 2, 3, 4, 5],
          averageWaitTime: 25,
        },
      ],
    });
  }

  async navigateIndoor(buildingId: string, start: IndoorLocation, end: IndoorLocation): Promise<IndoorPathResult> {
    if (!this.indoorStructures.has(buildingId)) {
      await this.initializeIndoorStructures();
    }
    const building = this.indoorStructures.get(buildingId);
    if (!building) {
      throw new Error(`Building ${buildingId} not found`);
    }

    if (start.floor === end.floor) {
      const distance = Math.sqrt((start.x - end.x) ** 2 + (start.y - end.y) ** 2);
      return {
        instructions: ['沿当前楼层直行至目标点。'],
        distance: Number(distance.toFixed(2)),
        estimatedTime: Number((distance / 1.2).toFixed(2)),
      };
    }

    const elevator = building.elevators.find(
      (item) => item.floors.includes(start.floor) && item.floors.includes(end.floor),
    );
    if (!elevator) {
      throw new Error('No available elevator for the requested floors');
    }

    const toElevator = Math.sqrt((start.x - elevator.location.x) ** 2 + (start.y - elevator.location.y) ** 2);
    const fromElevator = Math.sqrt((end.x - elevator.location.x) ** 2 + (end.y - elevator.location.y) ** 2);
    const totalDistance = toElevator + fromElevator;
    const estimatedTime = toElevator / 1.2 + elevator.averageWaitTime + fromElevator / 1.2;

    return {
      instructions: [
        `前往电梯 ${elevator.id}。`,
        `乘坐电梯从 ${start.floor} 层到 ${end.floor} 层。`,
        '出电梯后前往目标点。',
      ],
      distance: Number(totalDistance.toFixed(2)),
      estimatedTime: Number(estimatedTime.toFixed(2)),
    };
  }

  async getBuildings(): Promise<string[]> {
    if (!this.indoorStructures.size) {
      await this.initializeIndoorStructures();
    }
    return Array.from(this.indoorStructures.keys());
  }

  async getBuildingDetails(buildingId: string): Promise<IndoorStructure | null> {
    if (!this.indoorStructures.has(buildingId)) {
      await this.initializeIndoorStructures();
    }
    return this.indoorStructures.get(buildingId) ?? null;
  }
}
