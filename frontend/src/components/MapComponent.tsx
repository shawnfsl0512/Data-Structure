import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RoadNetworkEdge, RoadNetworkNode } from '../services/pathPlanningService';
import { haversineDistanceArray } from '../utils/geoUtils';

interface MapMarker {
  id: string;
  position: [number, number];
  title: string;
  disablePopup?: boolean;
  type?: string;
  label?: string;
  imageUrl?: string;
  badgeLabel?: string;
  tooltipHtml?: string;
  tooltipPermanent?: boolean;
  tooltipDirection?: 'top' | 'right' | 'bottom' | 'left' | 'center' | 'auto';
  tooltipOffset?: [number, number];
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  size?: number;
  opacity?: number;
  zIndexOffset?: number;
  dimmed?: boolean;
  shadowColor?: string;
}

interface RouteLeg {
  id: string;
  points: [number, number][];
  color?: string;
  dashArray?: string;
  title?: string;
}

interface CongestionSegment {
  id: string;
  points: [number, number][];
  color: string;
  isActive?: boolean;
  title?: string;
  dashArray?: string;
  opacity?: number;
  weight?: number;
  isConnector?: boolean;
}

interface PathLegendItem {
  id: string;
  label: string;
  color: string;
  dashArray?: string;
}

interface MapComponentProps {
  center?: [number, number];
  zoom?: number;
  focusZoom?: number;
  preferFocusPoints?: boolean;
  markers?: MapMarker[];
  activeMarkerId?: string | null;
  onMarkerSelect?: (marker: {
    id: string;
    position: [number, number];
    title: string;
    type?: string;
    label?: string;
  }) => void;
  path?: [number, number][];
  routeLegs?: RouteLeg[];
  congestionSegments?: CongestionSegment[];
  activeRouteLegId?: string | null;
  focusPoints?: [number, number][];
  roadNetwork?: {
    nodes: RoadNetworkNode[];
    edges: RoadNetworkEdge[];
  };
  showRoadNetwork?: boolean;
  baseMapMode?: 'street' | 'scenic';
  scenicAreaName?: string | null;
  routeSource?: 'graph' | 'osrm';
  showDirectionArrows?: boolean;
  pathLegendItems?: PathLegendItem[];
}

const ROAD_TYPE_STYLE: Record<string, { color: string; weight: number; opacity: number; dashArray?: string }> = {
  main_road: { color: '#64748b', weight: 3, opacity: 0.45, dashArray: '6,6' },
  bicycle_path: { color: '#0f766e', weight: 2.5, opacity: 0.5, dashArray: '5,5' },
  electric_cart_route: { color: '#b45309', weight: 2.5, opacity: 0.5, dashArray: '5,5' },
  connector: { color: '#f59e0b', weight: 2, opacity: 0.3, dashArray: '4,8' },
  footpath: { color: '#94a3b8', weight: 2, opacity: 0.42, dashArray: '4,6' },
  side_road: { color: '#cbd5e1', weight: 1.5, opacity: 0.36, dashArray: '4,6' },
};

const MARKER_STYLE: Record<string, { bg: string; border?: string; text: string; ring?: string }> = {
  start: { bg: '#16a34a', text: 'S' },
  end: { bg: '#dc2626', text: 'E' },
  return: { bg: '#7c3aed', text: 'R', ring: '0 0 0 4px rgba(124,58,237,0.18)' },
  attraction: { bg: '#7c3aed', text: '景' },
  facility: { bg: '#f59e0b', text: '设' },
  cluster: { bg: '#2563eb', text: '' },
  waypoint: { bg: '#2563eb', text: '' },
  default: { bg: '#2563eb', text: '' },
};

const EDGE_RENDER_LIMIT = 2200;
const MARKER_CLUSTER_THRESHOLD = 45;
const DUPLICATE_MARKER_OFFSET = 0.00012;
const VIEWPORT_PADDING = 0.0035;
const DEFAULT_TOOLTIP_SIZE = { width: 200, height: 92 };
const COMPACT_TOOLTIP_SIZE = { width: 148, height: 54 };
const IMPORTANT_MARKER_TYPES = new Set(['start', 'end', 'return', 'waypoint']);
const BLANK_TILE_DATA_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

const TILE_SOURCES = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: 'Leaflet | OpenStreetMap contributors',
  },
  scenic: {
    url: BLANK_TILE_DATA_URL,
    attribution: 'Leaflet',
  },
};

type TooltipPlacement = {
  direction: 'top' | 'right' | 'bottom' | 'left' | 'center' | 'auto';
  offset: [number, number];
};

type TooltipRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const TOOLTIP_PLACEMENT_CANDIDATES: TooltipPlacement[] = [
  { direction: 'top', offset: [0, -98] },
  { direction: 'right', offset: [138, -26] },
  { direction: 'left', offset: [-138, -26] },
  { direction: 'bottom', offset: [0, 76] },
  { direction: 'right', offset: [146, 54] },
  { direction: 'left', offset: [-146, 54] },
  { direction: 'top', offset: [96, -104] },
  { direction: 'top', offset: [-96, -104] },
  { direction: 'right', offset: [168, -82] },
  { direction: 'left', offset: [-168, -82] },
];

const buildMarkerKey = (position: [number, number]) => `${position[0].toFixed(6)}:${position[1].toFixed(6)}`;

const escapeHtml = (value: string) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const stripCurrentAreaPrefix = (name: string, scenicAreaName?: string | null) => {
  const trimmed = String(name || '').trim();
  const areaName = String(scenicAreaName || '').trim();
  if (!trimmed || !areaName) return trimmed;
  const separators = ['-', '－', '—', '——', '_', ' '];
  for (const separator of separators) {
    const prefix = `${areaName}${separator}`;
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return trimmed;
};

const shortPlaceName = (name: string, maxLength = 8) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
};

const buildClusterTooltipHtml = (bucket: MapMarker[], scenicAreaName?: string | null) => {
  const names = bucket
    .slice(0, 8)
    .map((marker) => stripCurrentAreaPrefix(marker.title, scenicAreaName))
    .filter(Boolean);
  const remaining = Math.max(0, bucket.length - names.length);
  return `
    <div style="
      min-width:176px;
      max-width:220px;
      color:#0f172a;
      font-size:12px;
      line-height:1.45;
    ">
      <div style="font-weight:800;margin-bottom:6px;">共 ${bucket.length} 个地点</div>
      ${names.map((name) => `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)}</div>`).join('')}
      ${remaining ? `<div style="margin-top:4px;color:#64748b;">还有 ${remaining} 个，放大后查看</div>` : ''}
    </div>
  `;
};

const resolveClusterGridSize = (zoomLevel: number) => {
  if (zoomLevel >= 17) return 0;
  if (zoomLevel >= 16) return 0.00035;
  if (zoomLevel >= 15) return 0.0007;
  if (zoomLevel >= 14) return 0.0012;
  return 0.0022;
};

const buildClusteredMarkers = (
  sourceMarkers: MapMarker[],
  zoomLevel: number,
  activeMarkerId: string | null,
  shouldCluster: boolean,
  scenicAreaName?: string | null,
): MapMarker[] => {
  const gridSize = shouldCluster ? resolveClusterGridSize(zoomLevel) : 0;
  if (!gridSize || sourceMarkers.length <= MARKER_CLUSTER_THRESHOLD) {
    return sourceMarkers;
  }

  const fixedMarkers: MapMarker[] = [];
  const grid = new Map<string, MapMarker[]>();

  sourceMarkers.forEach((marker) => {
    if (
      marker.id === activeMarkerId ||
      IMPORTANT_MARKER_TYPES.has(marker.type || '') ||
      marker.tooltipPermanent ||
      marker.imageUrl
    ) {
      fixedMarkers.push(marker);
      return;
    }

    const key = `${Math.floor(marker.position[0] / gridSize)}:${Math.floor(marker.position[1] / gridSize)}`;
    const bucket = grid.get(key) || [];
    bucket.push(marker);
    grid.set(key, bucket);
  });

  const clusteredMarkers = Array.from(grid.values()).flatMap((bucket) => {
    if (bucket.length === 1) {
      return bucket;
    }

    const latitude = bucket.reduce((sum, marker) => sum + marker.position[0], 0) / bucket.length;
    const longitude = bucket.reduce((sum, marker) => sum + marker.position[1], 0) / bucket.length;
    const hasFacility = bucket.some((marker) => marker.type === 'facility');
    const hasAttraction = bucket.some((marker) => marker.type === 'attraction');
    const backgroundColor = hasFacility && !hasAttraction ? '#f59e0b' : hasAttraction && !hasFacility ? '#7c3aed' : '#2563eb';
    const size = Math.min(48, 30 + Math.log(bucket.length + 1) * 7);

    return [
      {
        id: `cluster-${bucket.map((marker) => marker.id).join('|')}`,
        position: [latitude, longitude] as [number, number],
        title: `${bucket.length} 个地点`,
        type: 'cluster',
        label: String(bucket.length),
        disablePopup: true,
        tooltipHtml: buildClusterTooltipHtml(bucket, scenicAreaName),
        backgroundColor,
        borderColor: '#ffffff',
        textColor: '#ffffff',
        size,
        zIndexOffset: 260,
        shadowColor: backgroundColor,
      },
    ];
  });

  return [...fixedMarkers, ...clusteredMarkers];
};

const isCompactTooltip = (tooltipHtml?: string) =>
  typeof tooltipHtml === 'string' && tooltipHtml.includes('data-compact-tooltip="1"');

const buildTooltipRect = (
  anchorX: number,
  anchorY: number,
  placement: TooltipPlacement,
  size: { width: number; height: number },
): TooltipRect => {
  if (placement.direction === 'right') {
    const left = anchorX + placement.offset[0];
    const top = anchorY + placement.offset[1] - size.height / 2;
    return { left, top, right: left + size.width, bottom: top + size.height };
  }

  if (placement.direction === 'left') {
    const right = anchorX + placement.offset[0];
    const left = right - size.width;
    const top = anchorY + placement.offset[1] - size.height / 2;
    return { left, top, right, bottom: top + size.height };
  }

  if (placement.direction === 'bottom') {
    const left = anchorX + placement.offset[0] - size.width / 2;
    const top = anchorY + placement.offset[1];
    return { left, top, right: left + size.width, bottom: top + size.height };
  }

  const left = anchorX + placement.offset[0] - size.width / 2;
  const bottom = anchorY + placement.offset[1];
  const top = bottom - size.height;
  return { left, top, right: left + size.width, bottom };
};

const computeRectIntersectionArea = (left: TooltipRect, right: TooltipRect) => {
  const overlapWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const overlapHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return overlapWidth * overlapHeight;
};

const resolveTooltipPlacements = (
  map: L.Map,
  markers: Array<MapMarker & { adjustedPosition: [number, number]; duplicateIndex: number }>,
  activeMarkerId: string | null,
) => {
  const markersWithPermanentTooltip = markers.filter((marker) => marker.tooltipHtml && marker.tooltipPermanent);
  const placementMap = new Map<string, TooltipPlacement>();
  if (!markersWithPermanentTooltip.length) {
    return placementMap;
  }

  const viewportSize = map.getSize();
  const occupiedRects: TooltipRect[] = [];
  const orderedMarkers = [...markersWithPermanentTooltip].sort((left, right) => {
    const leftPriority = left.id === activeMarkerId ? 3 : left.zIndexOffset ?? 0;
    const rightPriority = right.id === activeMarkerId ? 3 : right.zIndexOffset ?? 0;
    return rightPriority - leftPriority;
  });

  orderedMarkers.forEach((marker) => {
    const anchorPoint = map.latLngToContainerPoint(marker.adjustedPosition);
    const tooltipSize = isCompactTooltip(marker.tooltipHtml) ? COMPACT_TOOLTIP_SIZE : DEFAULT_TOOLTIP_SIZE;
    let bestPlacement = TOOLTIP_PLACEMENT_CANDIDATES[0];
    let bestScore = Number.POSITIVE_INFINITY;

    for (const placement of TOOLTIP_PLACEMENT_CANDIDATES) {
      const rect = buildTooltipRect(anchorPoint.x, anchorPoint.y, placement, tooltipSize);
      const overlapPenalty = occupiedRects.reduce(
        (sum, occupiedRect) => sum + computeRectIntersectionArea(rect, occupiedRect),
        0,
      );
      const viewportPenalty =
        Math.max(0, -rect.left) +
        Math.max(0, -rect.top) +
        Math.max(0, rect.right - viewportSize.x) +
        Math.max(0, rect.bottom - viewportSize.y);
      const markerPenalty = computeRectIntersectionArea(rect, {
        left: anchorPoint.x - 18,
        top: anchorPoint.y - 18,
        right: anchorPoint.x + 18,
        bottom: anchorPoint.y + 18,
      });
      const directionPenalty = placement.direction === 'top' ? 0 : placement.direction === 'right' || placement.direction === 'left' ? 24 : 38;
      const score = overlapPenalty * 10 + viewportPenalty * 6 + markerPenalty * 3 + directionPenalty;

      if (score < bestScore) {
        bestScore = score;
        bestPlacement = placement;
      }
    }

    placementMap.set(marker.id, bestPlacement);
    occupiedRects.push(buildTooltipRect(anchorPoint.x, anchorPoint.y, bestPlacement, tooltipSize));
  });

  return placementMap;
};

const buildBounds = (points: [number, number][]) => {
  if (!points.length) return null;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  for (const [lat, lng] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }

  return { minLat, maxLat, minLng, maxLng };
};

const expandBounds = (
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  padding: number,
) => ({
  minLat: bounds.minLat - padding,
  maxLat: bounds.maxLat + padding,
  minLng: bounds.minLng - padding,
  maxLng: bounds.maxLng + padding,
});

const isInBounds = (
  point: [number, number],
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
) =>
  point[0] >= bounds.minLat &&
  point[0] <= bounds.maxLat &&
  point[1] >= bounds.minLng &&
  point[1] <= bounds.maxLng;

const computeBearing = (from: [number, number], to: [number, number]) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const toDeg = (value: number) => (value * 180) / Math.PI;
  const lat1 = toRad(from[0]);
  const lat2 = toRad(to[0]);
  const dLng = toRad(to[1] - from[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

const interpolatePoint = (from: [number, number], to: [number, number], ratio: number): [number, number] => [
  from[0] + (to[0] - from[0]) * ratio,
  from[1] + (to[1] - from[1]) * ratio,
];

const buildArrowPoints = (points: [number, number][]) => {
  if (points.length < 2) return [] as Array<{ position: [number, number]; bearing: number }>;

  const segments: Array<{ from: [number, number]; to: [number, number]; distance: number }> = [];
  let totalDistance = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const distance = haversineDistanceArray(from, to);
    if (distance < 2) continue;
    segments.push({ from, to, distance });
    totalDistance += distance;
  }

  if (!segments.length || totalDistance < 15) return [];

  const arrowCount = Math.min(5, Math.max(1, Math.round(totalDistance / 180)));
  const stepDistance = totalDistance / (arrowCount + 1);
  const arrows: Array<{ position: [number, number]; bearing: number }> = [];
  let nextTarget = stepDistance;
  let travelled = 0;

  for (const segment of segments) {
    while (travelled + segment.distance >= nextTarget && arrows.length < arrowCount) {
      const ratio = (nextTarget - travelled) / segment.distance;
      arrows.push({
        position: interpolatePoint(segment.from, segment.to, ratio),
        bearing: computeBearing(segment.from, segment.to),
      });
      nextTarget += stepDistance;
    }
    travelled += segment.distance;
  }

  if (!arrows.length) {
    const middle = segments[Math.floor(segments.length / 2)];
    arrows.push({
      position: interpolatePoint(middle.from, middle.to, 0.5),
      bearing: computeBearing(middle.from, middle.to),
    });
  }

  return arrows;
};

const renderLegendHtml = (
  markers: MapMarker[],
  showRoadNetwork: boolean,
  pathLegendItems: PathLegendItem[],
  collapsed: boolean,
) => {
  const hasWaypoint = markers.some((marker) => marker.type === 'waypoint');
  const hasReturn = markers.some((marker) => marker.type === 'return');
  const transportLegend = pathLegendItems.map((item) => {
    const dashStyle = item.dashArray ? `border-top:3px dashed ${item.color};` : `background:${item.color};`;
    return `<div><span style="display:inline-block;width:18px;height:3px;margin-right:6px;vertical-align:middle;${dashStyle}"></span>${item.label}</div>`;
  });

  const legendRows = [
    '<div><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#16a34a;color:#fff;text-align:center;line-height:14px;font-size:10px;margin-right:6px;">S</span>导航起点</div>',
    '<div><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#dc2626;color:#fff;text-align:center;line-height:14px;font-size:10px;margin-right:6px;">E</span>导航终点</div>',
    hasWaypoint
      ? '<div><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#2563eb;color:#fff;text-align:center;line-height:14px;font-size:10px;margin-right:6px;">1</span>途经点</div>'
      : '',
    hasReturn
      ? '<div><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#7c3aed;color:#fff;text-align:center;line-height:14px;font-size:10px;margin-right:6px;">R</span>返回起点</div>'
      : '',
    ...transportLegend,
    '<div><span style="display:inline-block;width:18px;height:3px;background:#2563eb;margin-right:6px;vertical-align:middle;"></span>规划路径</div>',
    showRoadNetwork
      ? '<div><span style="display:inline-block;width:18px;height:3px;background:#64748b;margin-right:6px;vertical-align:middle;"></span>路网参考线</div>'
      : '',
  ]
    .filter(Boolean)
    .join('');

  return `
    <div style="display:flex;flex-direction:column;gap:8px;min-width:${collapsed ? '92px' : '160px'};">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-weight:600;white-space:nowrap;">地图图例</div>
        <button
          type="button"
          data-legend-toggle="1"
          aria-label="${collapsed ? '展开地图图例' : '收起地图图例'}"
          style="
            border:none;
            background:rgba(99,102,241,0.10);
            color:#4f46e5;
            width:26px;
            height:26px;
            border-radius:999px;
            cursor:pointer;
            font-size:14px;
            line-height:26px;
            text-align:center;
            padding:0;
            flex:0 0 auto;
          "
        >${collapsed ? '▴' : '▾'}</button>
      </div>
      ${collapsed ? '' : `<div style="display:flex;flex-direction:column;gap:4px;">${legendRows}</div>`}
    </div>
  `;
};

const MapComponent: React.FC<MapComponentProps> = ({
  center = [39.9042, 116.4074],
  zoom = 15,
  focusZoom,
  preferFocusPoints = false,
  markers = [],
  activeMarkerId = null,
  onMarkerSelect,
  path = [],
  routeLegs = [],
  congestionSegments = [],
  activeRouteLegId = null,
  focusPoints = [],
  roadNetwork,
  showRoadNetwork = false,
  baseMapMode = 'street',
  scenicAreaName,
  routeSource,
  showDirectionArrows = true,
  pathLegendItems = [],
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const lastViewportKeyRef = useRef('');
  const lastRenderKeyRef = useRef('');
  const lastDataViewportKeyRef = useRef('');
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const [legendCollapsed, setLegendCollapsed] = useState(false);

  const nodeMap = useMemo(() => {
    const result = new Map<string, RoadNetworkNode>();
    for (const node of roadNetwork?.nodes || []) {
      result.set(node.id, node);
    }
    return result;
  }, [roadNetwork]);

  const clusteredMarkers = useMemo(
    () => buildClusteredMarkers(markers, currentZoom, activeMarkerId, baseMapMode === 'scenic', scenicAreaName),
    [activeMarkerId, baseMapMode, currentZoom, markers, scenicAreaName],
  );
  const shouldRenderRoadNetwork = Boolean(roadNetwork) && (baseMapMode === 'scenic' || showRoadNetwork);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
    }).setView(center, zoom);
    mapInstance.current = map;
    setCurrentZoom(map.getZoom());
    map.on('zoomend', () => setCurrentZoom(map.getZoom()));

    const tileSource = TILE_SOURCES[baseMapMode];
    const tileLayer = L.tileLayer(tileSource.url, {
      attribution: tileSource.attribution,
      opacity: 1,
      maxZoom: 20,
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    const LegendControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'map-legend');
        div.style.background = 'rgba(255,255,255,0.95)';
        div.style.borderRadius = '14px';
        div.style.padding = '10px 12px';
        div.style.boxShadow = '0 10px 24px rgba(0,0,0,0.12)';
        div.style.fontSize = '12px';
        div.style.lineHeight = '1.7';
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        legendRef.current = div;
        return div;
      },
    });

    new LegendControl({ position: 'bottomright' }).addTo(map);

    return () => {
      map.remove();
      mapInstance.current = null;
      tileLayerRef.current = null;
      legendRef.current = null;
    };
  }, [center, zoom]);

  useEffect(() => {
    if (!legendRef.current) return;
    legendRef.current.innerHTML = renderLegendHtml(markers, shouldRenderRoadNetwork, pathLegendItems, legendCollapsed);
  }, [legendCollapsed, markers, pathLegendItems, shouldRenderRoadNetwork]);

  useEffect(() => {
    if (!legendRef.current) return;
    const legendElement = legendRef.current;
    const handleLegendClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-legend-toggle="1"]')) {
        event.preventDefault();
        event.stopPropagation();
        setLegendCollapsed((current) => !current);
      }
    };

    legendElement.addEventListener('click', handleLegendClick);
    return () => {
      legendElement.removeEventListener('click', handleLegendClick);
    };
  }, [legendCollapsed]);

  useEffect(() => {
    const map = mapInstance.current;
    const tileLayer = tileLayerRef.current;
    if (!map || !tileLayer) return;

    const tileSource = TILE_SOURCES[baseMapMode];
    tileLayer.setUrl(tileSource.url);
    tileLayer.options.attribution = tileSource.attribution;
    tileLayer.setOpacity(1);
    const tileContainer = tileLayer.getContainer();
    if (tileContainer) {
      tileContainer.style.filter = baseMapMode === 'street' ? 'saturate(0.95) brightness(1) contrast(1)' : 'none';
      tileContainer.style.opacity = baseMapMode === 'street' ? '1' : '0';
    }

    if (wrapperRef.current) {
      wrapperRef.current.style.background =
        baseMapMode === 'street'
          ? '#f8fafc'
          : 'radial-gradient(circle at top right, rgba(14,165,233,0.16), transparent 30%), radial-gradient(circle at bottom left, rgba(16,185,129,0.14), transparent 28%), linear-gradient(180deg, #f7fbff 0%, #eef6ff 52%, #eefbf7 100%)';
    }
  }, [baseMapMode]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const renderKey = JSON.stringify({
      markers: clusteredMarkers,
      path,
      routeLegs,
      congestionSegments,
      activeRouteLegId,
      focusPoints,
      showRoadNetwork,
      shouldRenderRoadNetwork,
      baseMapMode,
      routeSource,
      currentZoom,
    });

    if (lastRenderKeyRef.current === renderKey) {
      return;
    }
    lastRenderKeyRef.current = renderKey;

    const removable: L.Layer[] = [];
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline || layer instanceof L.CircleMarker) {
        removable.push(layer);
      }
    });
    removable.forEach((layer) => map.removeLayer(layer));

    const routeViewportPoints = [
      ...(focusPoints.length ? focusPoints : []),
      ...path,
      ...routeLegs.flatMap((leg) => leg.points),
      ...congestionSegments.flatMap((segment) => segment.points),
    ];

    const routeBounds = buildBounds(routeViewportPoints);
    const viewportMarkerPoints = routeBounds
      ? clusteredMarkers
          .map((marker) => marker.position)
          .filter((point) => isInBounds(point, expandBounds(routeBounds, VIEWPORT_PADDING)))
      : clusteredMarkers.map((marker) => marker.position);
    const roadNetworkViewportPoints =
      !routeViewportPoints.length && !viewportMarkerPoints.length && roadNetwork?.nodes?.length && roadNetwork.nodes.length <= 5000
        ? roadNetwork.nodes
            .filter((_node, index) => index % Math.max(1, Math.ceil(roadNetwork.nodes.length / 160)) === 0)
            .map((node) => [node.location.latitude, node.location.longitude] as [number, number])
        : [];
    const viewportPoints =
      preferFocusPoints && focusPoints.length
        ? [...focusPoints]
        : [...routeViewportPoints, ...viewportMarkerPoints, ...roadNetworkViewportPoints];
    const allPoints = viewportPoints.map((point) => L.latLng(point[0], point[1]));
    const viewportKey = allPoints.map((point) => `${point.lat.toFixed(5)}:${point.lng.toFixed(5)}`).join('|');
    const dataViewportKey = JSON.stringify({
      center,
      zoom,
      focusPoints,
      path,
      routeLegs,
      congestionSegments,
      roadNodeCount: roadNetwork?.nodes.length || 0,
      markerIds: markers.map((marker) => marker.id),
      preferFocusPoints,
    });
    const shouldAutoFitViewport = lastDataViewportKeyRef.current !== dataViewportKey;

    if (shouldAutoFitViewport && allPoints.length > 1) {
      if (lastViewportKeyRef.current !== viewportKey) {
        map.fitBounds(L.latLngBounds(allPoints), { padding: [32, 32] });
        lastViewportKeyRef.current = viewportKey;
      }
    } else if (shouldAutoFitViewport && allPoints.length === 1) {
      if (lastViewportKeyRef.current !== viewportKey) {
        map.setView(allPoints[0], focusZoom ?? zoom);
        lastViewportKeyRef.current = viewportKey;
      }
    } else if (shouldAutoFitViewport) {
      const fallbackKey = `${center[0].toFixed(5)}:${center[1].toFixed(5)}:${zoom}`;
      if (lastViewportKeyRef.current !== fallbackKey) {
        map.setView(center, zoom);
        lastViewportKeyRef.current = fallbackKey;
      }
    }
    if (shouldAutoFitViewport) {
      lastDataViewportKeyRef.current = dataViewportKey;
    }

    if (shouldRenderRoadNetwork && roadNetwork) {
      const renderBounds = buildBounds(viewportPoints);
      let renderedCount = 0;

      for (const edge of roadNetwork.edges) {
        if (renderedCount >= EDGE_RENDER_LIMIT) break;

        const fromNode = nodeMap.get(edge.from);
        const toNode = nodeMap.get(edge.to);
        if (!fromNode || !toNode) continue;

        if (
          renderBounds &&
          !(
            isInBounds([fromNode.location.latitude, fromNode.location.longitude], expandBounds(renderBounds, 0.001)) ||
            isInBounds([toNode.location.latitude, toNode.location.longitude], expandBounds(renderBounds, 0.001))
          )
        ) {
          continue;
        }

        const style = ROAD_TYPE_STYLE[edge.roadType] || ROAD_TYPE_STYLE.side_road;
        L.polyline(
          [
            [fromNode.location.latitude, fromNode.location.longitude],
            [toNode.location.latitude, toNode.location.longitude],
          ],
          {
            color: style.color,
            weight: style.weight,
            opacity: style.opacity,
            dashArray: style.dashArray,
            lineCap: 'round',
          },
        ).addTo(map);

        renderedCount += 1;
      }
    }

    const visibleRouteLegs = routeLegs.length
      ? routeLegs.filter((leg) => !activeRouteLegId || leg.id === activeRouteLegId)
      : [];

    if (congestionSegments.length) {
      const orderedSegments = [...congestionSegments].sort((left, right) => {
        const leftPriority = left.isActive ? 1 : 0;
        const rightPriority = right.isActive ? 1 : 0;
        return leftPriority - rightPriority;
      });

      orderedSegments.forEach((segment) => {
        if (segment.points.length < 2) return;
        const polyline = L.polyline(segment.points, {
          color: segment.color,
          weight: segment.weight ?? (segment.isActive ? 7 : 2.5),
          opacity: segment.opacity ?? (segment.isActive ? 0.98 : 0.16),
          dashArray: segment.dashArray,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
        if (segment.title) {
          polyline.bindTooltip(segment.title, {
            sticky: true,
            direction: 'top',
          });
        }
      });
    } else if (visibleRouteLegs.length) {
      visibleRouteLegs.forEach((leg) => {
        if (leg.points.length < 2) return;
        L.polyline(leg.points, {
          color: leg.color || (routeSource === 'osrm' ? '#2563eb' : '#4338ca'),
          weight: 6,
          opacity: 0.96,
          lineCap: 'round',
          lineJoin: 'round',
          dashArray: leg.dashArray,
        }).addTo(map);
      });
    } else if (path.length > 1) {
      L.polyline(path, {
        color: routeSource === 'osrm' ? '#2563eb' : '#4338ca',
        weight: 5,
        opacity: 0.92,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
    }

    if (showDirectionArrows) {
      const arrowLines = congestionSegments.length
        ? congestionSegments
            .filter((segment) => segment.isActive !== false && !segment.isConnector)
            .map((segment) => ({ points: segment.points, color: segment.color }))
        : visibleRouteLegs.length
        ? visibleRouteLegs.map((leg) => ({ points: leg.points, color: leg.color || '#2563eb' }))
        : path.length > 1
        ? [{ points: path, color: routeSource === 'osrm' ? '#2563eb' : '#4338ca' }]
        : [];

      arrowLines.forEach((line) => {
        buildArrowPoints(line.points).forEach((arrow) => {
          const arrowIcon = L.divIcon({
            className: 'route-direction-arrow',
            html: `
              <div style="
                width:16px;
                height:16px;
                display:flex;
                align-items:center;
                justify-content:center;
                transform: rotate(${arrow.bearing}deg);
                filter: drop-shadow(0 0 6px rgba(255,255,255,0.96));
              ">
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 2 L18 12 H14 V22 H10 V12 H6 Z"
                    fill="${line.color}"
                    stroke="rgba(255,255,255,0.92)"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                  />
                </svg>
              </div>
            `,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          });

          L.marker(arrow.position, {
            icon: arrowIcon,
            interactive: false,
            keyboard: false,
            zIndexOffset: 220,
          }).addTo(map);
        });
      });
    }

    const markerCountByPosition = new Map<string, number>();
    const markerRenderEntries = clusteredMarkers.map((marker) => {
      const key = buildMarkerKey(marker.position);
      const duplicateIndex = markerCountByPosition.get(key) || 0;
      markerCountByPosition.set(key, duplicateIndex + 1);

      const adjustedPosition: [number, number] = [
        marker.position[0] + duplicateIndex * DUPLICATE_MARKER_OFFSET,
        marker.position[1] + duplicateIndex * DUPLICATE_MARKER_OFFSET,
      ];
      return { ...marker, adjustedPosition, duplicateIndex };
    });

    const tooltipPlacementMap = resolveTooltipPlacements(map, markerRenderEntries, activeMarkerId);

    for (const marker of markerRenderEntries) {
      const style = MARKER_STYLE[marker.type || 'default'] || MARKER_STYLE.default;

      const isPlaceMarker = marker.type === 'attraction' || marker.type === 'facility';
      const displayTitle = isPlaceMarker ? stripCurrentAreaPrefix(marker.title, scenicAreaName) : marker.title;
      const label = marker.label ?? (isPlaceMarker ? shortPlaceName(displayTitle) : style.text);
      const isActiveMarker = activeMarkerId === marker.id;
      const markerSize = marker.size ?? (isActiveMarker ? 36 : isPlaceMarker ? 32 : 30);
      const backgroundColor = marker.backgroundColor || style.bg;
      const borderColor = marker.borderColor || style.border || '#fff';
      const textColor = marker.textColor || (style.border ? style.border : '#fff');
      const markerOpacity = marker.opacity ?? 1;
      const isWideLabel = String(label || '').length > 1;
      const markerWidth = isWideLabel
        ? Math.max(markerSize + 18, Math.min(116, String(label).length * 13 + 24))
        : markerSize;
      const markerHeight = markerSize;
      const markerShadowColor = marker.shadowColor || backgroundColor;
      const safeImageUrl = marker.imageUrl?.replace(/'/g, '&#39;');
      const badgeLabel = marker.badgeLabel || label;
      const shouldUseCoverMarker = Boolean(marker.imageUrl);

      const iconHtml = shouldUseCoverMarker
        ? `
          <div style="
            width:${markerSize}px;
            height:${markerSize}px;
            border-radius:${Math.round(markerSize * 0.28)}px;
            border:${isActiveMarker ? 3 : 2}px solid ${borderColor};
            background-image:linear-gradient(180deg, rgba(15,23,42,0.08), rgba(15,23,42,0.34)), url('${safeImageUrl}');
            background-size:cover;
            background-position:center;
            position:relative;
            overflow:hidden;
            opacity:${markerOpacity};
            filter:${marker.dimmed ? 'saturate(0.7) brightness(0.94)' : 'none'};
            box-shadow:${isActiveMarker ? `0 0 0 5px rgba(37,99,235,0.18), 0 18px 34px ${markerShadowColor}44` : `0 14px 28px ${markerShadowColor}33`};
            transform:${isActiveMarker ? 'scale(1.07)' : 'scale(1)'};
            transition:all 0.18s ease;
          ">
            <div style="
              position:absolute;
              inset:0;
              background:linear-gradient(180deg, rgba(255,255,255,0.12), transparent 35%, rgba(15,23,42,0.16) 100%);
            "></div>
            <div style="
              position:absolute;
              left:8px;
              top:8px;
              padding:3px 7px;
              border-radius:999px;
              background:rgba(15,23,42,0.76);
              color:#ffffff;
              font-size:${isActiveMarker ? 11 : 10}px;
              font-weight:800;
              letter-spacing:0.2px;
              backdrop-filter:blur(8px);
            ">${badgeLabel}</div>
          </div>
        `
        : `
          <div style="
            background:${backgroundColor};
            width:${markerWidth}px;
            height:${markerHeight}px;
            border-radius:${isWideLabel ? 999 : 50}%;
            border:${isActiveMarker ? 3 : 2}px solid ${borderColor};
            color:${textColor};
            font-size:${isActiveMarker ? 13 : 12}px;
            font-weight:700;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:${isWideLabel ? '0 10px' : '0'};
            letter-spacing:0;
            white-space:nowrap;
            overflow:hidden;
            text-overflow:ellipsis;
            opacity:${markerOpacity};
            box-shadow:${isActiveMarker ? '0 0 0 5px rgba(37,99,235,0.18), 0 12px 28px rgba(15,23,42,0.28)' : style.ring || '0 6px 16px rgba(15,23,42,0.24)'};
            transform:${isActiveMarker ? 'scale(1.05)' : 'scale(1)'};
            transition:all 0.18s ease;
            filter:${marker.dimmed ? 'saturate(0.78)' : 'none'};
          ">${label}</div>
        `;

      const icon = L.divIcon({
        className: 'custom-marker',
        html: iconHtml,
        iconSize: shouldUseCoverMarker ? [markerSize, markerSize] : [markerWidth, markerHeight],
        iconAnchor: shouldUseCoverMarker ? [markerSize / 2, markerSize / 2] : [markerWidth / 2, markerHeight / 2],
      });

      const dynamicTooltipPlacement = tooltipPlacementMap.get(marker.id);

      const markerLayer = L.marker(marker.adjustedPosition, {
        icon,
        zIndexOffset: marker.zIndexOffset ?? (isActiveMarker ? 320 : 120),
      }).addTo(map);

      if (marker.title && !marker.disablePopup) {
        markerLayer.bindPopup(displayTitle || marker.title);
      }

      const tooltipHtml = marker.tooltipHtml || '';
      if (tooltipHtml) {
        markerLayer.bindTooltip(tooltipHtml, {
          permanent: marker.tooltipPermanent ?? false,
          direction: dynamicTooltipPlacement?.direction || marker.tooltipDirection || 'top',
          offset: dynamicTooltipPlacement
            ? L.point(dynamicTooltipPlacement.offset[0], dynamicTooltipPlacement.offset[1])
            : marker.tooltipOffset
            ? L.point(marker.tooltipOffset[0], marker.tooltipOffset[1])
            : L.point(0, -18),
          opacity: 1,
          className: 'journey-map-tooltip',
        });
      }

      if (marker.type === 'cluster') {
        markerLayer.on('click', () => {
          map.setView(marker.adjustedPosition, Math.min(map.getZoom() + 2, 19), { animate: true });
        });
      } else if (onMarkerSelect) {
        markerLayer.on('click', () => onMarkerSelect(marker));
      }

    }

  }, [
    activeRouteLegId,
    center,
    congestionSegments,
    focusPoints,
    activeMarkerId,
    clusteredMarkers,
    baseMapMode,
    nodeMap,
    onMarkerSelect,
    path,
    roadNetwork,
    routeLegs,
    routeSource,
    showDirectionArrows,
    showRoadNetwork,
    shouldRenderRoadNetwork,
    scenicAreaName,
    focusZoom,
    preferFocusPoints,
    zoom,
  ]);

  return (
    <div
      ref={wrapperRef}
      style={{
        minHeight: 420,
        borderRadius: 22,
        overflow: 'hidden',
        position: 'relative',
        background: '#f8fafc',
      }}
    >
      <div ref={mapRef} style={{ minHeight: 420 }} />
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {scenicAreaName ? (
          <div
            style={{
              background: 'rgba(15,23,42,0.72)',
              color: '#fff',
              borderRadius: 999,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {scenicAreaName}
          </div>
        ) : null}
        {routeSource ? (
          <div
            style={{
              background: routeSource === 'osrm' ? 'rgba(34,197,94,0.92)' : 'rgba(79,70,229,0.92)',
              color: '#fff',
              borderRadius: 999,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {routeSource === 'osrm' ? '真实街道路由' : '景区路网路由'}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default React.memo(MapComponent);

