import cache from '../config/cache';
import { PathPlanningService } from './PathPlanningService';

class FakeRoadGraph {
  private readonly nodes = new Map<string, any>();
  private readonly outgoingEdges = new Map<string, any[]>();

  constructor(nodes: any[], edges: any[]) {
    nodes.forEach((node) => {
      this.nodes.set(node.id, node);
      this.outgoingEdges.set(node.id, []);
    });

    edges.forEach((edge) => {
      const bucket = this.outgoingEdges.get(edge.from) || [];
      bucket.push(edge);
      this.outgoingEdges.set(edge.from, bucket);
    });
  }

  getAllNodes() {
    return Array.from(this.nodes.values());
  }

  getNode(nodeId: string) {
    return this.nodes.get(nodeId);
  }

  getEdges(fromNodeId: string) {
    return this.outgoingEdges.get(fromNodeId) ?? [];
  }

  getAllEdges() {
    return Array.from(this.outgoingEdges.values()).flat();
  }

  hasDirectedEdge(from: string, to: string) {
    return this.getEdges(from).some((edge) => edge.to === to);
  }
}

const buildService = () => {
  const nodes = [
    {
      id: 'A',
      scenicAreaId: 'campus-1',
      type: 'attraction',
      name: 'Start Building',
      location: { latitude: 39.9, longitude: 116.3 },
    },
    {
      id: 'J1',
      scenicAreaId: 'campus-1',
      type: 'junction',
      name: 'West Junction',
      location: { latitude: 39.9001, longitude: 116.3001 },
    },
    {
      id: 'J2',
      scenicAreaId: 'campus-1',
      type: 'junction',
      name: 'East Junction',
      location: { latitude: 39.9002, longitude: 116.3006 },
    },
    {
      id: 'K1',
      scenicAreaId: 'campus-1',
      type: 'junction',
      name: 'Library Junction',
      location: { latitude: 39.9004, longitude: 116.3003 },
    },
    {
      id: 'B',
      scenicAreaId: 'campus-1',
      type: 'facility',
      name: 'Dormitory',
      location: { latitude: 39.9005, longitude: 116.3008 },
    },
  ];

  const edges = [
    {
      id: 'A-J1',
      scenicAreaId: 'campus-1',
      from: 'A',
      to: 'J1',
      distance: 20,
      roadType: 'footpath',
      congestionFactor: 1,
      allowedTransportation: ['walk'],
      isElectricCartRoute: false,
      isBicyclePath: false,
    },
    {
      id: 'J1-J2-direct',
      scenicAreaId: 'campus-1',
      from: 'J1',
      to: 'J2',
      distance: 120,
      roadType: 'side_road',
      congestionFactor: 0.2,
      allowedTransportation: ['walk', 'bicycle'],
      isElectricCartRoute: false,
      isBicyclePath: false,
    },
    {
      id: 'J1-K1',
      scenicAreaId: 'campus-1',
      from: 'J1',
      to: 'K1',
      distance: 120,
      roadType: 'side_road',
      congestionFactor: 1,
      allowedTransportation: ['walk', 'bicycle'],
      isElectricCartRoute: false,
      isBicyclePath: false,
    },
    {
      id: 'K1-J2',
      scenicAreaId: 'campus-1',
      from: 'K1',
      to: 'J2',
      distance: 120,
      roadType: 'side_road',
      congestionFactor: 1,
      allowedTransportation: ['walk', 'bicycle'],
      isElectricCartRoute: false,
      isBicyclePath: false,
    },
    {
      id: 'J2-B',
      scenicAreaId: 'campus-1',
      from: 'J2',
      to: 'B',
      distance: 20,
      roadType: 'footpath',
      congestionFactor: 1,
      allowedTransportation: ['walk'],
      isElectricCartRoute: false,
      isBicyclePath: false,
    },
  ];

  const service = new PathPlanningService() as any;
  service.roadGraph = new FakeRoadGraph(nodes, edges);
  service.roadGraphVersion = 1;
  service.graphInitializationPromise = null;
  service.scenicAreaCategoryCache.set('campus-1', '校园');
  return service as any;
};

describe('PathPlanningService mixed transportation planning', () => {
  beforeEach(() => {
    cache.clear();
  });

  test('shortest_time chooses the less congested mixed-mode route', async () => {
    const service = buildService();

    const result = await service.planAdvancedRoute('A', 'B', 'shortest_time', ['walk', 'bicycle']);

    expect(result.path).toEqual(['A', 'J1', 'K1', 'J2', 'B']);
    expect(result.distance).toBeCloseTo(280, 2);
    expect(result.time).toBeCloseTo(1.5, 2);
    expect(result.transportationModes).toEqual(['walk', 'bicycle']);
    expect(result.isMixedTransportation).toBe(true);
    expect(result.segments.map((segment: any) => segment.transportation)).toEqual([
      'walk',
      'bicycle',
      'bicycle',
      'walk',
    ]);
  });

  test('shortest_distance still chooses the physically shortest route', async () => {
    const service = buildService();

    const result = await service.planAdvancedRoute('A', 'B', 'shortest_distance', ['walk', 'bicycle']);

    expect(result.path).toEqual(['A', 'J1', 'J2', 'B']);
    expect(result.distance).toBeCloseTo(160, 2);
    expect(result.transportationModes).toEqual(['walk', 'bicycle']);
    expect(result.isMixedTransportation).toBe(true);
  });

  test('multi-point planning reports the actual transportation modes used', async () => {
    const service = buildService();

    const result = await service.optimizeMultiPointPath(['A', 'B'], 'shortest_time', ['walk', 'bicycle']);

    expect(result.order).toEqual(['A', 'B']);
    expect(result.path).toEqual(['A', 'J1', 'K1', 'J2', 'B']);
    expect(result.transportationModes).toEqual(['walk', 'bicycle']);
    expect(result.isMixedTransportation).toBe(true);
  });

  test('campus profile rejects electric cart requests', async () => {
    const service = buildService();

    await expect(
      service.planAdvancedRoute('A', 'B', 'shortest_time', ['electric_cart']),
    ).rejects.toThrow('校园场景仅支持 步行 / 自行车');
  });

  test('repairs suspicious poi-to-junction connectors to the nearest junction', () => {
    const service = buildService();
    const graph = new FakeRoadGraph(
      [
        {
          id: 'POI',
          scenicAreaId: 'campus-1',
          type: 'facility',
          name: 'POI',
          location: { latitude: 39.9005, longitude: 116.3008 },
        },
        {
          id: 'NEAR',
          scenicAreaId: 'campus-1',
          type: 'junction',
          name: 'Near Junction',
          location: { latitude: 39.9002, longitude: 116.3006 },
        },
        {
          id: 'FAR',
          scenicAreaId: 'campus-1',
          type: 'junction',
          name: 'Far Junction',
          location: { latitude: 39.905, longitude: 116.305 },
        },
      ],
      [],
    );

    const mapped = service.mapEdgeEntity(
      {
        id: 'bad-B',
        scenicAreaId: 'campus-1',
        fromNodeId: 'POI',
        toNodeId: 'FAR',
        distance: 8,
        roadType: 'footpath',
        congestionFactor: 1,
        allowedTransportation: '["walk"]',
        transportation: 'walk',
        isElectricCartRoute: false,
        isBicyclePath: false,
      },
      graph,
      '校园',
    );

    expect(mapped.to).toBe('NEAR');
    expect(mapped.distance).toBeGreaterThan(10);
    expect(mapped.distance).toBeLessThan(60);
    expect(mapped.roadType).toBe('connector');
  });

  test('repairs shorter but still obviously wrong poi-to-junction connectors', () => {
    const service = buildService();
    const graph = new FakeRoadGraph(
      [
        {
          id: 'POI',
          scenicAreaId: 'campus-1',
          type: 'attraction',
          name: 'Lab',
          location: { latitude: 39.95765142, longitude: 116.34977726 },
        },
        {
          id: 'WRONG',
          scenicAreaId: 'campus-1',
          type: 'junction',
          name: 'Wrong Junction',
          location: { latitude: 39.9583829, longitude: 116.3497623 },
        },
        {
          id: 'NEAREST',
          scenicAreaId: 'campus-1',
          type: 'junction',
          name: 'Nearest Junction',
          location: { latitude: 39.957828, longitude: 116.3498345 },
        },
      ],
      [],
    );

    const mapped = service.mapEdgeEntity(
      {
        id: 'short-bad-connector',
        scenicAreaId: 'campus-1',
        fromNodeId: 'WRONG',
        toNodeId: 'POI',
        distance: 19.69,
        roadType: 'footpath',
        congestionFactor: 1,
        allowedTransportation: '["walk"]',
        transportation: 'walk',
        isElectricCartRoute: false,
        isBicyclePath: false,
      },
      graph,
      '校园',
    );

    expect(mapped.from).toBe('NEAREST');
    expect(mapped.to).toBe('POI');
    expect(mapped.distance).toBeGreaterThan(19);
    expect(mapped.distance).toBeLessThan(25);
    expect(mapped.roadType).toBe('connector');
  });

  test('scenic area endpoint candidates stay anchored to the scenic center', () => {
    const service = buildService();

    const candidates = service.getPlanningEndpointCandidates(
      {
        id: 'campus-1',
        scenicAreaId: 'campus-1',
        type: 'scenic_area',
        name: 'Campus',
        location: { latitude: 39.9, longitude: 116.3 },
      },
      service.roadGraph,
    );

    expect(candidates[0].id).toBe('J1');
  });

  test('adds a visible connector when the requested start is a scenic area', async () => {
    const service = buildService();
    service.resolvePlanningNodeById = jest.fn(async (nodeId: string, graph: any) => {
      if (nodeId === 'campus-1') {
        return {
          id: 'campus-1',
          scenicAreaId: 'campus-1',
          type: 'scenic_area',
          name: 'Campus',
          location: { latitude: 39.9, longitude: 116.3 },
        };
      }
      return graph.getNode(nodeId) || null;
    });

    const result = await service.planAdvancedRoute('campus-1', 'B', 'shortest_time', ['walk']);

    expect(result.segments[0].isConnector).toBe(true);
    expect(result.segments[0].from).toBe('campus-1');
    expect(result.segments[0].to).toMatch(/^J/);
    expect(result.segments[0].fromLocation).toEqual({ latitude: 39.9, longitude: 116.3 });
    expect(result.path[0]).toBe('campus-1');
    expect(result.path[1]).toBe(result.segments[0].to);
  });
});
