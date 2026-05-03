import React, { useEffect, useMemo, useRef, useState } from 'react';
import { App as AntdApp, AutoComplete, Button, Card, Checkbox, Col, Empty, Radio, Row, Space, Spin, Switch, Tag, Typography } from 'antd';
import { AimOutlined, PlusOutlined, ReloadOutlined, SwapOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import MapComponent from '../components/MapComponent';
import useCurrentLocation from '../hooks/useCurrentLocation';
import pathPlanningService, {
  MultiPointPath,
  MultiPointStrategy,
  Path,
  PathSegment,
  PlanningProfile,
  RoadNetworkEdge,
  RoadNetworkNode,
  RouteContext,
} from '../services/pathPlanningService';
import { resolveErrorMessage } from '../utils/errorMessage';
import { haversineDistance } from '../utils/geoUtils';

const { Title, Paragraph, Text } = Typography;

type TransportType = 'walk' | 'bicycle' | 'electric_cart';

interface SearchOption {
  value: string;
  label: string;
  placeName: string;
  placeType: string;
  scenicAreaId?: string | null;
  latitude?: number;
  longitude?: number;
}

interface MultiPreview {
  order: string[];
  totalDistance: number;
  totalTime: number;
  paths: Path[];
  strategy: MultiPointStrategy;
  transportationModes: TransportType[];
}

interface CurrentLocationResolution {
  option: SearchOption;
  warning?: string | null;
}

interface RouteLeg {
  id: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  distance: number;
  time: number;
  color: string;
  points: [number, number][];
  isReturn: boolean;
  isConnector?: boolean;
}

interface CityDayRoutePayloadStop {
  id?: string;
  scenicAreaId?: string | null;
  name: string;
  latitude: number;
  longitude: number;
  day?: number;
  order?: number;
}

interface TransportPlanItem {
  id?: string;
  transportation: TransportType;
  distance: number;
  time: number;
  isConnector?: boolean;
  segmentCount: number;
  startSegmentIndex: number;
  endSegmentIndex: number;
}

const cardStyle: React.CSSProperties = {
  borderRadius: 24,
  boxShadow: '0 18px 40px rgba(15,23,42,0.08)',
  border: '1px solid rgba(148,163,184,0.12)',
};

const routeLegPalette = ['#2563eb', '#0f766e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];
const transportLabelMap: Record<TransportType, string> = { walk: '步行', bicycle: '骑行', electric_cart: '电瓶车' };
const transportColorMap: Record<TransportType, string> = {
  walk: '#16a34a',
  bicycle: '#2563eb',
  electric_cart: '#f59e0b',
};
const strategyLabelMap: Record<MultiPointStrategy, string> = { shortest_distance: '最短距离', shortest_time: '最短时间' };
const roadTypeLabelMap: Record<string, string> = { main_road: '主干道', bicycle_path: '骑行道', electric_cart_route: '电瓶车道', footpath: '步行道', side_road: '支路' };
roadTypeLabelMap.connector = '步行接驳';
const placeTypeLabelMap: Record<string, string> = {
  junction: '导航点',
  attraction: '景点',
  facility: '设施',
  scenic_area: '景区',
  poi: '地点',
};

const hasCoord = (lat?: number, lng?: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
const pretty = (value?: string | null) => (value || '').trim() || '未命名地点';
const formatDistance = (distance: number) => `${Number(distance || 0).toFixed(1)} 米`;
const formatTime = (minutes: number) => `${Number(minutes || 0).toFixed(1)} 分钟`;

const SEARCH_RESULT_LIMIT = 50;
const CURRENT_LOCATION_DISTANCE_WARNING_METERS = 1500;

const nodeToOption = (node: RoadNetworkNode): SearchOption => ({
  value: node.id,
  label: pretty(node.name),
  placeName: pretty(node.name),
  placeType: node.type,
  scenicAreaId: node.scenicAreaId || null,
  latitude: node.location.latitude,
  longitude: node.location.longitude,
});

const searchToOption = (item: { id: string; name: string; type: string; scenicAreaId: string | null; latitude: number; longitude: number }): SearchOption => ({
  value: item.id,
  label: pretty(item.name),
  placeName: pretty(item.name),
  placeType: item.type,
  scenicAreaId: item.scenicAreaId || null,
  latitude: item.latitude,
  longitude: item.longitude,
});

const findBestNamedOption = (options: SearchOption[], keyword: string) => {
  const trimmed = keyword.trim();
  if (!trimmed) return null;
  return (
    options.find((item) => item.placeName === trimmed) ||
    options.find((item) => item.label === trimmed) ||
    options.find((item) => item.placeName.includes(trimmed)) ||
    options[0] ||
    null
  );
};

const isUserSelectablePlace = (item: SearchOption) => item.placeType !== 'junction';

const stripPlaceNamePrefix = (name: string, scenicAreaName?: string | null) => {
  const trimmedName = pretty(name);
  const trimmedAreaName = (scenicAreaName || '').trim();
  if (!trimmedAreaName) return trimmedName;

  const prefix = `${trimmedAreaName}-`;
  return trimmedName.startsWith(prefix) ? trimmedName.slice(prefix.length) : trimmedName;
};

const normalizeSearchText = (value?: string | null) => (value || '').trim().toLowerCase();

const getSearchOptionTexts = (item: SearchOption, scenicAreaName?: string | null) => {
  const values = [
    item.placeName,
    item.label,
    stripPlaceNamePrefix(item.placeName, scenicAreaName),
    stripPlaceNamePrefix(item.label, scenicAreaName),
  ]
    .map((value) => normalizeSearchText(value))
    .filter(Boolean);

  return Array.from(new Set(values));
};

const scoreSearchOption = (item: SearchOption, keyword: string, scenicAreaName?: string | null) => {
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) return 0;

  const texts = getSearchOptionTexts(item, scenicAreaName);
  let bestScore = Number.POSITIVE_INFINITY;

  texts.forEach((text) => {
    if (text === normalizedKeyword) {
      bestScore = Math.min(bestScore, 0);
      return;
    }
    if (text.startsWith(normalizedKeyword)) {
      bestScore = Math.min(bestScore, 100 + text.length);
      return;
    }
    const includeIndex = text.indexOf(normalizedKeyword);
    if (includeIndex >= 0) {
      bestScore = Math.min(bestScore, 1000 + includeIndex * 10 + text.length);
    }
  });

  return Number.isFinite(bestScore) ? bestScore : Number.POSITIVE_INFINITY;
};

const matchesSearchOption = (item: SearchOption, keyword: string, scenicAreaName?: string | null) =>
  !normalizeSearchText(keyword) || Number.isFinite(scoreSearchOption(item, keyword, scenicAreaName));

const sortSearchOptions = (options: SearchOption[], keyword: string, scenicAreaName?: string | null) => {
  const deduped = Array.from(new Map(options.map((item) => [item.value, item])).values());
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) return deduped;

  return deduped.sort((left, right) => {
    const leftScore = scoreSearchOption(left, normalizedKeyword, scenicAreaName);
    const rightScore = scoreSearchOption(right, normalizedKeyword, scenicAreaName);
    if (leftScore !== rightScore) return leftScore - rightScore;

    const leftDisplay = stripPlaceNamePrefix(left.placeName || left.label, scenicAreaName);
    const rightDisplay = stripPlaceNamePrefix(right.placeName || right.label, scenicAreaName);
    if (leftDisplay.length !== rightDisplay.length) return leftDisplay.length - rightDisplay.length;

    return leftDisplay.localeCompare(rightDisplay, 'zh-CN');
  });
};

const parseCityDayRoutePayload = (raw: string): CityDayRoutePayloadStop[] => {
  if (!raw.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => ({
        id: typeof item?.id === 'string' ? item.id : '',
        scenicAreaId: typeof item?.scenicAreaId === 'string' ? item.scenicAreaId : null,
        name: String(item?.name || '').trim(),
        latitude: Number(item?.latitude),
        longitude: Number(item?.longitude),
        day: Number(item?.day || 0),
        order: Number(item?.order || 0),
      }))
      .filter((item) => item.name && hasCoord(item.latitude, item.longitude));
  } catch {
    return [];
  }
};

const pathPoints = (path: Path): [number, number][] =>
  path.routeGeometry?.length
    ? path.routeGeometry.map((point) => [point.latitude, point.longitude] as [number, number])
    : (path.segments || []).flatMap((segment) =>
        segment.pathPoints?.length
          ? segment.pathPoints.map((point) => [point.latitude, point.longitude] as [number, number])
          : [
              [segment.fromLocation.latitude, segment.fromLocation.longitude] as [number, number],
              [segment.toLocation.latitude, segment.toLocation.longitude] as [number, number],
            ],
      );

const normalizeCongestionFactor = (factor?: number) => {
  const raw = Number(factor || 1);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return raw > 1 ? 1 / raw : raw;
};

const congestionMeta = (factor?: number) => {
  const value = normalizeCongestionFactor(factor);
  if (value >= 0.85) return { label: '畅通', color: '#16a34a', tagColor: 'green' as const };
  if (value >= 0.6) return { label: '缓行', color: '#f59e0b', tagColor: 'gold' as const };
  return { label: '拥挤', color: '#dc2626', tagColor: 'red' as const };
};

const summarizeTransportSequence = (segments: PathSegment[] | undefined, fallbackModes: TransportType[]) => {
  const ordered = (segments || [])
    .map((segment) => segment.transportation)
    .filter((item): item is TransportType => Boolean(item));
  const uniqueOrdered = ordered.filter((item, index) => ordered.indexOf(item) === index);
  const modes = uniqueOrdered.length ? uniqueOrdered : fallbackModes;
  const labels = modes.map((item) => transportLabelMap[item]);
  return labels.length > 1 ? `建议方式：${labels.join(' → ')}` : `建议方式：${labels[0] || '步行'}`;
};

const buildTransportPlan = (segments: PathSegment[] | undefined, fallbackModes: TransportType[]) => {
  const source = segments?.length
    ? segments
    : fallbackModes.map((mode) => ({
        transportation: mode,
        distance: 0,
        time: 0,
        isConnector: false,
      } as Pick<PathSegment, 'transportation' | 'distance' | 'time'>));

  const groups: TransportPlanItem[] = [];
  source.forEach((segment, segmentIndex) => {
    const transportation = (segment.transportation || fallbackModes[0] || 'walk') as TransportType;
    const current = groups[groups.length - 1];
    const segmentConnector = Boolean((segment as PathSegment).isConnector);
    if (current && current.transportation === transportation && Boolean(current.isConnector) === segmentConnector) {
      current.distance += Number(segment.distance || 0);
      current.time += Number(segment.time || 0);
      current.segmentCount += 1;
      current.endSegmentIndex = segmentIndex;
      return;
    }
    groups.push({
      transportation,
      distance: Number(segment.distance || 0),
      time: Number(segment.time || 0),
      isConnector: segmentConnector,
      segmentCount: 1,
      startSegmentIndex: segmentIndex,
      endSegmentIndex: segmentIndex,
    });
  });
  return groups;
};

const describeTransportPlan = (item: TransportPlanItem, index: number, total: number) => {
  if (item.isConnector) {
    if (index === 0) return '从起点步行接驳进入路网';
    if (index === total - 1) return '从路网步行接驳到终点';
    return '中途步行接驳换乘';
  }

  if (item.transportation === 'walk') {
    return `沿主路线步行前进${item.segmentCount > 1 ? `，覆盖 ${item.segmentCount} 段道路` : ''}`;
  }
  if (item.transportation === 'bicycle') {
    return `沿主路线骑行前进${item.segmentCount > 1 ? `，覆盖 ${item.segmentCount} 段道路` : ''}`;
  }
  return `沿主路线乘电瓶车前进${item.segmentCount > 1 ? `，覆盖 ${item.segmentCount} 段道路` : ''}`;
};

const collectActualTransportModes = (paths: Path[], fallbackModes: TransportType[]) => {
  const ordered: TransportType[] = [];
  paths.forEach((path) => {
    const candidates = (path.transportationModes?.length
      ? path.transportationModes
      : path.segments?.map((segment) => segment.transportation).filter(Boolean)) as TransportType[] | undefined;
    (candidates || []).forEach((mode) => {
      if (mode && !ordered.includes(mode)) {
        ordered.push(mode);
      }
    });
  });
  return ordered.length ? ordered : fallbackModes;
};

const PathPlanningPage: React.FC = () => {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const scenicAreaId = searchParams.get('scenicAreaId') || '';
  const scenicAreaName = searchParams.get('scenicName') || '';
  const queryKeyword = searchParams.get('keyword') || '';
  const queryStartName = searchParams.get('startName') || '';
  const queryEndName = searchParams.get('endName') || '';
  const startNodeIdFromQuery = searchParams.get('startNodeId') || '';
  const endNodeIdFromQuery = searchParams.get('endNodeId') || '';
  const queryTransportation = (searchParams.get('transportation') || '') as TransportType;
  const queryMode = searchParams.get('mode') || '';
  const queryStrategy = (searchParams.get('strategy') || '') as MultiPointStrategy | '';
  const queryTransportations = (searchParams.get('transportations') || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is TransportType => ['walk', 'bicycle', 'electric_cart'].includes(item));
  const querySource = searchParams.get('source') || '';
  const autoPlanFromQuery = searchParams.get('autoPlan') === '1';
  const dayLabelFromQuery = searchParams.get('dayLabel') || '';
  const cityLabelFromQuery = searchParams.get('cityLabel') || '';
  const dayRoutePayloadFromQuery = parseCityDayRoutePayload(searchParams.get('dayRoutePayload') || '');
  const queryStartLat = Number(searchParams.get('startLat') || '');
  const queryStartLng = Number(searchParams.get('startLng') || '');
  const queryEndLat = Number(searchParams.get('endLat') || '');
  const queryEndLng = Number(searchParams.get('endLng') || '');
  const isCityItineraryNavigation = querySource === 'city-itinerary' && dayRoutePayloadFromQuery.length > 0;

  const [roadNetwork, setRoadNetwork] = useState<{ nodes: RoadNetworkNode[]; edges: RoadNetworkEdge[] }>({ nodes: [], edges: [] });
  const [planningProfile, setPlanningProfile] = useState<PlanningProfile | null>(null);
  const [loadingRoadNetwork, setLoadingRoadNetwork] = useState(true);
  const [loadingRoute, setLoadingRoute] = useState(false);

  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  const [targetInput, setTargetInput] = useState('');
  const [startOptions, setStartOptions] = useState<SearchOption[]>([]);
  const [endOptions, setEndOptions] = useState<SearchOption[]>([]);
  const [targetOptions, setTargetOptions] = useState<SearchOption[]>([]);
  const [selectedStart, setSelectedStart] = useState<SearchOption | null>(null);
  const [selectedEnd, setSelectedEnd] = useState<SearchOption | null>(null);
  const [selectedTargetOption, setSelectedTargetOption] = useState<SearchOption | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<SearchOption[]>([]);

  const [searchingStart, setSearchingStart] = useState(false);
  const [searchingEnd, setSearchingEnd] = useState(false);
  const [searchingTarget, setSearchingTarget] = useState(false);
  const [startDropdownOpen, setStartDropdownOpen] = useState(false);
  const [endDropdownOpen, setEndDropdownOpen] = useState(false);
  const [targetDropdownOpen, setTargetDropdownOpen] = useState(false);

  const [multiPointMode, setMultiPointMode] = useState(false);
  const [strategy, setStrategy] = useState<MultiPointStrategy>('shortest_time');
  const [transportModes, setTransportModes] = useState<TransportType[]>(['walk']);
  const [transportationPath, setTransportationPath] = useState<Path | null>(null);
  const [multiPreview, setMultiPreview] = useState<MultiPreview | null>(null);
  const [activeLegId, setActiveLegId] = useState<string | null>(null);
  const [activeTransportPlanId, setActiveTransportPlanId] = useState<string | null>(null);
  const [baseMapMode, setBaseMapMode] = useState<'street' | 'scenic'>('scenic');
  const [showRoadNetwork, setShowRoadNetwork] = useState(false);
  const {
    location: currentLocation,
    error: currentLocationError,
    isLoading: resolvingCurrentLocation,
    isWatching: isWatchingCurrentLocation,
    requestLocation,
    startWatching,
    stopWatching,
    getLatestError: getLatestCurrentLocationError,
  } = useCurrentLocation({
    enableHighAccuracy: true,
    timeout: 8000,
    maximumAge: 30000,
  });

  const startTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const targetTimerRef = useRef<number | null>(null);
  const startSearchSeqRef = useRef(0);
  const endSearchSeqRef = useRef(0);
  const targetSearchSeqRef = useRef(0);
  const initSignatureRef = useRef<string>('');
  const dayRouteInitSignatureRef = useRef<string>('');
  const autoPlanTriggeredRef = useRef(false);
  const singleEndDraftRef = useRef<{ input: string; option: SearchOption | null }>({ input: '', option: null });
  const multiTargetDraftRef = useRef<{ input: string; options: SearchOption[] }>({
    input: '',
    options: [],
  });

  const scenicSelfOption = useMemo<SearchOption | null>(() => {
    if (!scenicAreaId || !scenicAreaName) {
      return null;
    }

    return {
      value: scenicAreaId,
      label: scenicAreaName,
      placeName: scenicAreaName,
      placeType: 'scenic_area',
      scenicAreaId,
    };
  }, [scenicAreaId, scenicAreaName]);

  const localOptions = useMemo(
    () => (scenicSelfOption ? [scenicSelfOption, ...roadNetwork.nodes.map(nodeToOption)] : roadNetwork.nodes.map(nodeToOption)),
    [roadNetwork.nodes, scenicSelfOption],
  );
  const preferredLocalOptions = useMemo(
    () => [
      ...localOptions.filter((item) => item.placeType !== 'junction'),
      ...localOptions.filter((item) => item.placeType === 'junction'),
    ],
    [localOptions],
  );
  const defaultLocalOptions = useMemo(() => {
    const userSelectable = preferredLocalOptions.filter(isUserSelectablePlace);
    return userSelectable.length ? userSelectable : preferredLocalOptions;
  }, [preferredLocalOptions]);
  const optionRegistry = useMemo(() => {
    const map = new Map<string, SearchOption>();
    [...localOptions, ...startOptions, ...endOptions, ...targetOptions, ...selectedTargets, ...(selectedStart ? [selectedStart] : []), ...(selectedEnd ? [selectedEnd] : [])].forEach((item) => map.set(item.value, item));
    return map;
  }, [endOptions, localOptions, selectedEnd, selectedStart, selectedTargets, startOptions, targetOptions]);

  const mergeOptions = (current: SearchOption[], ...items: Array<SearchOption | null | undefined>) => {
    const map = new Map(current.map((item) => [item.value, item] as const));
    items.forEach((item) => {
      if (item?.value) map.set(item.value, item);
    });
    return Array.from(map.values());
  };

  const displayPlaceName = (item?: Pick<SearchOption, 'placeName' | 'label'> | null) =>
    stripPlaceNamePrefix(item?.placeName || item?.label || '', scenicAreaName);

  const setOptionsByTarget = (target: 'start' | 'end' | 'target', options: SearchOption[]) => {
    if (target === 'start') setStartOptions(options);
    if (target === 'end') setEndOptions(options);
    if (target === 'target') setTargetOptions(options);
  };

  const getSearchSeqRef = (target: 'start' | 'end' | 'target') =>
    target === 'start' ? startSearchSeqRef : target === 'end' ? endSearchSeqRef : targetSearchSeqRef;

  const buildLocalSearchOptions = (keyword: string, target: 'start' | 'end' | 'target') => {
    const scopedScenicName = scenicAreaName || routeContext?.scenicAreaName;
    const normalizedKeyword = normalizeSearchText(keyword);
    const baseOptions = normalizedKeyword
      ? defaultLocalOptions.filter((item) => matchesSearchOption(item, normalizedKeyword, scopedScenicName))
      : defaultLocalOptions;
    const sorted = normalizedKeyword ? sortSearchOptions(baseOptions, normalizedKeyword, scopedScenicName) : baseOptions;

    if (target === 'start' && selectedStart) {
      return mergeOptions(sorted, selectedStart);
    }
    if (target === 'end' && selectedEnd) {
      return mergeOptions(sorted, selectedEnd);
    }
    if (target === 'target' && selectedTargets.length) {
      return mergeOptions(sorted, ...selectedTargets);
    }
    return sorted;
  };

  const applyLocalSearchOptions = (keyword: string, target: 'start' | 'end' | 'target') => {
    setOptionsByTarget(target, buildLocalSearchOptions(keyword, target));
  };

  const setDropdownOpenByTarget = (target: 'start' | 'end' | 'target', open: boolean) => {
    if (target === 'start') setStartDropdownOpen(open);
    if (target === 'end') setEndDropdownOpen(open);
    if (target === 'target') setTargetDropdownOpen(open);
  };

  const routePaths = useMemo(() => (multiPreview ? multiPreview.paths : transportationPath ? [transportationPath] : []), [multiPreview, transportationPath]);
  const hasStreetRoute = routePaths.some((item) => item.routeSource === 'osrm');
  const routeContext: RouteContext | null = useMemo(
    () => multiPreview?.paths.find((item) => item.routeContext)?.routeContext || transportationPath?.routeContext || null,
    [multiPreview, transportationPath],
  );
  const activePlanningProfile = planningProfile || routeContext?.planningProfile || null;
  const allowedTransportModes = useMemo(
    () =>
      activePlanningProfile?.allowedTransportations?.length
        ? activePlanningProfile.allowedTransportations
        : (['walk', 'bicycle', 'electric_cart'] as TransportType[]),
    [activePlanningProfile],
  );
  const defaultTransportModes = useMemo(
    () =>
      activePlanningProfile?.defaultTransportations?.length
        ? activePlanningProfile.defaultTransportations
        : (['walk'] as TransportType[]),
    [activePlanningProfile],
  );
  const planningProfileDescription =
    activePlanningProfile?.description ||
    '当前场景未识别为校园或景区，默认保留通用步行 / 骑行 / 电瓶车模式。';

  const cityDaySourceHint = dayRoutePayloadFromQuery.length
    ? `${cityLabelFromQuery || '城市行程'} · ${dayLabelFromQuery || '当日路线'}`
    : '';

  useEffect(() => {
    const loadRoadNetwork = async () => {
      setLoadingRoadNetwork(true);
      try {
        const response = await pathPlanningService.getRoadNetwork(scenicAreaId || undefined);
        setRoadNetwork({ nodes: response.data.nodes, edges: response.data.edges });
        setPlanningProfile(response.data.planningProfile || null);
      } catch (error) {
        message.error(resolveErrorMessage(error, '加载路网失败，请稍后重试。'));
      } finally {
        setLoadingRoadNetwork(false);
      }
    };
    void loadRoadNetwork();
  }, [message, scenicAreaId]);

  useEffect(() => {
    if (!defaultLocalOptions.length) return;
    setStartOptions(mergeOptions(defaultLocalOptions, selectedStart));
    setEndOptions(mergeOptions(defaultLocalOptions, selectedEnd));
    setTargetOptions(mergeOptions(defaultLocalOptions, ...selectedTargets));
  }, [defaultLocalOptions, selectedEnd, selectedStart, selectedTargets]);

  useEffect(() => {
    if (queryTransportations.length) {
      setTransportModes(queryTransportations);
      return;
    }

    if (queryTransportation) {
      setTransportModes([queryTransportation]);
    }
  }, [queryTransportation, queryTransportations]);

  useEffect(() => {
    if (queryStrategy === 'shortest_distance' || queryStrategy === 'shortest_time') {
      setStrategy(queryStrategy);
    }
  }, [queryStrategy]);

  useEffect(() => {
    if (loadingRoadNetwork || !dayRoutePayloadFromQuery.length) {
      return;
    }

    const initializeCityDayRoute = async () => {
      const signature = JSON.stringify(dayRoutePayloadFromQuery);
      if (dayRouteInitSignatureRef.current === signature) {
        return;
      }
      dayRouteInitSignatureRef.current = signature;
      autoPlanTriggeredRef.current = false;

      const toOption = (stop: CityDayRoutePayloadStop, index: number): SearchOption => ({
        value: stop.id || `city-day-${stop.scenicAreaId || 'poi'}-${stop.day || 0}-${stop.order || index + 1}`,
        label: stop.name,
        placeName: stop.name,
        placeType: 'poi',
        scenicAreaId: stop.scenicAreaId || null,
        latitude: stop.latitude,
        longitude: stop.longitude,
      });

      const stopSelections = dayRoutePayloadFromQuery.map((stop, index) => toOption(stop, index));

      setMultiPointMode(queryMode === 'multi' || stopSelections.length > 1);
      setSelectedEnd(null);
      setEndInput('');
      setSelectedTargets(stopSelections);
      setSelectedTargetOption(null);
      setTargetInput('');
      setTargetOptions((current) => mergeOptions(current, ...stopSelections));

      if (isCityItineraryNavigation) {
        const currentLocation = await getCurrentLocationOption();
        if (currentLocation) {
          setSelectedStart(currentLocation.option);
          setStartInput(currentLocation.option.placeName);
          setStartOptions((current) => mergeOptions(current, currentLocation.option, ...stopSelections));
          return;
        }
      }

      const fallbackStart = stopSelections[0];
      setSelectedStart(fallbackStart);
      setStartInput(displayPlaceName(fallbackStart));
      setStartOptions((current) => mergeOptions(current, fallbackStart, ...stopSelections));
    };

    void initializeCityDayRoute();
  }, [dayRoutePayloadFromQuery, isCityItineraryNavigation, loadingRoadNetwork, queryMode]);

  useEffect(() => {
    setTransportModes((current) => {
      const filtered = current.filter((mode) => allowedTransportModes.includes(mode));
      if (filtered.length) {
        return filtered;
      }
      return [...defaultTransportModes];
    });
  }, [allowedTransportModes, defaultTransportModes]);

  useEffect(
    () => () => {
      [startTimerRef, endTimerRef, targetTimerRef].forEach((timerRef) => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
      });
    },
    [],
  );

  useEffect(() => {
    if (!routePaths.length) return;
    setBaseMapMode(hasStreetRoute ? 'street' : 'scenic');
    if (!hasStreetRoute) setShowRoadNetwork(false);
  }, [hasStreetRoute, routePaths.length]);

  useEffect(() => {
    setActiveLegId(null);
    if (multiPointMode) {
      singleEndDraftRef.current = {
        input: endInput,
        option: selectedEnd,
      };
      const nextMultiDraft = multiTargetDraftRef.current;
      setSelectedEnd(null);
      setEndInput('');
      if (nextMultiDraft.options.length || nextMultiDraft.input) {
        setSelectedTargets(nextMultiDraft.options);
        setSelectedTargetOption(null);
        setTargetInput(nextMultiDraft.input);
      }
    } else {
      const nextEndDraft = singleEndDraftRef.current;
      if (nextEndDraft.input) {
        setEndInput(nextEndDraft.input);
      }
      if (nextEndDraft.option) {
        setSelectedEnd(nextEndDraft.option);
        setEndOptions((current) => mergeOptions(current, nextEndDraft.option));
      }
      setSelectedTargets([]);
      setSelectedTargetOption(null);
      setTargetInput('');
    }
  }, [multiPointMode]);

  useEffect(() => {
    if (multiPointMode) {
      multiTargetDraftRef.current = {
        input: targetInput,
        options: selectedTargets,
      };
    } else {
      singleEndDraftRef.current = {
        input: endInput,
        option: selectedEnd,
      };
    }
  }, [endInput, multiPointMode, selectedEnd, selectedTargets, targetInput]);

  useEffect(() => {
    const initialize = async () => {
      const signature = JSON.stringify({
        scenicAreaId,
        queryStartName,
        queryEndName,
        queryKeyword,
        startNodeIdFromQuery,
        endNodeIdFromQuery,
        queryStartLat: hasCoord(queryStartLat, queryStartLng) ? `${queryStartLat}:${queryStartLng}` : '',
        queryEndLat: hasCoord(queryEndLat, queryEndLng) ? `${queryEndLat}:${queryEndLng}` : '',
      });
      if (initSignatureRef.current === signature) {
        return;
      }
      initSignatureRef.current = signature;

      const initialStart =
        (startNodeIdFromQuery && (optionRegistry.get(startNodeIdFromQuery) || localOptions.find((item) => item.value === startNodeIdFromQuery))) ||
        null;
      if (initialStart) {
        setSelectedStart(initialStart);
        setStartInput(displayPlaceName(initialStart));
        setStartOptions((current) => mergeOptions(current, initialStart));
      } else if (hasCoord(queryStartLat, queryStartLng)) {
        try {
          const nearest = await pathPlanningService.findNearestNode(queryStartLat, queryStartLng, scenicAreaId || undefined);
          const matched = optionRegistry.get(nearest.data.nodeId) || localOptions.find((item) => item.value === nearest.data.nodeId);
          const finalOption: SearchOption =
            matched || {
              value: nearest.data.nodeId,
              label: queryStartName || '当前位置',
              placeName: queryStartName || '当前位置',
              placeType: 'poi',
              scenicAreaId,
              latitude: queryStartLat,
              longitude: queryStartLng,
            };
          setSelectedStart(finalOption);
          setStartInput(displayPlaceName(finalOption));
          setStartOptions((current) => mergeOptions(current, finalOption));
        } catch {
          setStartInput(queryStartName || '当前位置');
        }
      } else if (queryStartName) {
        setStartInput(queryStartName);
      }

      if (endNodeIdFromQuery) {
        const initialEnd = optionRegistry.get(endNodeIdFromQuery) || localOptions.find((item) => item.value === endNodeIdFromQuery) || null;
        if (initialEnd) {
          setSelectedEnd(initialEnd);
          setEndInput(displayPlaceName(initialEnd));
          setEndOptions((current) => mergeOptions(current, initialEnd));
          return;
        }
      }

      const initialEndName = queryEndName || queryKeyword;
      if (!initialEndName && !hasCoord(queryEndLat, queryEndLng)) return;
        setEndInput(initialEndName || '查询目的地');

      if (hasCoord(queryEndLat, queryEndLng)) {
        try {
          const nearest = await pathPlanningService.findNearestNode(queryEndLat, queryEndLng, scenicAreaId || undefined);
          const matched = optionRegistry.get(nearest.data.nodeId) || localOptions.find((item) => item.value === nearest.data.nodeId);
          const finalOption: SearchOption =
            matched || {
              value: nearest.data.nodeId,
            label: initialEndName || '查询目的地',
            placeName: initialEndName || '查询目的地',
              placeType: '设施',
              scenicAreaId,
              latitude: queryEndLat,
              longitude: queryEndLng,
            };
          setSelectedEnd(finalOption);
          setEndInput(displayPlaceName(finalOption));
          setEndOptions((current) => mergeOptions(current, finalOption));
          return;
        } catch {
          // ignore and fall through to name search
        }
      }

      if (initialEndName) {
        try {
          const response = await pathPlanningService.searchNodesByName(initialEndName, SEARCH_RESULT_LIMIT, scenicAreaId || undefined);
          const option = response.data.map(searchToOption)[0];
          if (option) {
            setSelectedEnd(option);
            setEndInput(displayPlaceName(option));
            setEndOptions((current) => mergeOptions(current, option));
          }
        } catch {
          // ignore
        }
      }
    };

    if (loadingRoadNetwork) return;
    void initialize();
  }, [
    endNodeIdFromQuery,
    loadingRoadNetwork,
    localOptions,
    optionRegistry,
    queryEndLat,
    queryEndLng,
    queryEndName,
    queryKeyword,
    queryStartLat,
    queryStartLng,
    queryStartName,
    scenicAreaId,
    startNodeIdFromQuery,
  ]);

  useEffect(() => {
    const hydrateQuerySelections = async () => {
      if (loadingRoadNetwork) {
        return;
      }

      if (queryStartName) {
        try {
          const response = await pathPlanningService.searchNodesByName(queryStartName, SEARCH_RESULT_LIMIT, scenicAreaId || undefined);
          const namedOption = findBestNamedOption(response.data.map(searchToOption), queryStartName);
          if (namedOption) {
            const displayOption: SearchOption = {
              ...namedOption,
              label: queryStartName,
              placeName: queryStartName,
              latitude: hasCoord(queryStartLat, queryStartLng) ? queryStartLat : namedOption.latitude,
              longitude: hasCoord(queryStartLat, queryStartLng) ? queryStartLng : namedOption.longitude,
            };
            setSelectedStart(displayOption);
            setStartInput(queryStartName);
            setStartOptions((current) => mergeOptions(current, displayOption));
          }
        } catch {
          // ignore
        }
      }

      const targetEndName = queryEndName || queryKeyword;
      if (targetEndName) {
        try {
          const response = await pathPlanningService.searchNodesByName(targetEndName, SEARCH_RESULT_LIMIT, scenicAreaId || undefined);
          const namedOption = findBestNamedOption(response.data.map(searchToOption), targetEndName);
          if (namedOption) {
            const displayOption: SearchOption = {
              ...namedOption,
              label: targetEndName,
              placeName: targetEndName,
              latitude: hasCoord(queryEndLat, queryEndLng) ? queryEndLat : namedOption.latitude,
              longitude: hasCoord(queryEndLat, queryEndLng) ? queryEndLng : namedOption.longitude,
            };
            setSelectedEnd(displayOption);
            setEndInput(targetEndName);
            setEndOptions((current) => mergeOptions(current, displayOption));
          }
        } catch {
          // ignore
        }
      }
    };

    void hydrateQuerySelections();
  }, [
    loadingRoadNetwork,
    queryEndLat,
    queryEndLng,
    queryEndName,
    queryKeyword,
    queryStartLat,
    queryStartLng,
    queryStartName,
    scenicAreaId,
  ]);

  useEffect(() => {
    setTransportationPath(null);
    setMultiPreview(null);
    setActiveLegId(null);
    setActiveTransportPlanId(null);
  }, [startInput, endInput, multiPointMode, selectedTargets, strategy, transportModes]);

  const searchNodes = async (keyword: string, target: 'start' | 'end' | 'target') => {
    const requestId = ++getSearchSeqRef(target).current;
    const localFallback = buildLocalSearchOptions(keyword, target);
    if (scenicAreaId && defaultLocalOptions.length) {
      setOptionsByTarget(target, localFallback);
      return;
    }
    if (target === 'start') setSearchingStart(true);
    if (target === 'end') setSearchingEnd(true);
    if (target === 'target') setSearchingTarget(true);
    try {
      const trimmedKeyword = keyword.trim().toLowerCase();
      const response = await pathPlanningService.searchNodesByName(keyword, SEARCH_RESULT_LIMIT, scenicAreaId || undefined);
      const options = sortSearchOptions(
        response.data.map(searchToOption).filter(isUserSelectablePlace),
        keyword,
        scenicAreaName || routeContext?.scenicAreaName,
      );
      const localMatches = defaultLocalOptions.filter(
        (item) =>
          !trimmedKeyword ||
          item.placeName.toLowerCase().includes(trimmedKeyword) ||
          item.label.toLowerCase().includes(trimmedKeyword) ||
          displayPlaceName(item).toLowerCase().includes(trimmedKeyword),
      );
      const fallback = keyword.trim()
        ? sortSearchOptions(localMatches, keyword, scenicAreaName || routeContext?.scenicAreaName)
        : defaultLocalOptions;
      if (requestId !== getSearchSeqRef(target).current) return;
      setOptionsByTarget(target, options.length ? options : fallback);
    } catch {
      const trimmedKeyword = keyword.trim().toLowerCase();
      const fallback = sortSearchOptions(
        defaultLocalOptions.filter(
          (item) =>
            !trimmedKeyword ||
            item.placeName.toLowerCase().includes(trimmedKeyword) ||
            item.label.toLowerCase().includes(trimmedKeyword) ||
            displayPlaceName(item).toLowerCase().includes(trimmedKeyword),
        ),
        keyword,
        scenicAreaName || routeContext?.scenicAreaName,
      );
      if (requestId !== getSearchSeqRef(target).current) return;
      setOptionsByTarget(target, fallback);
    } finally {
      if (requestId !== getSearchSeqRef(target).current) return;
      if (target === 'start') setSearchingStart(false);
      if (target === 'end') setSearchingEnd(false);
      if (target === 'target') setSearchingTarget(false);
    }
  };

  const debounceSearch = (keyword: string, target: 'start' | 'end' | 'target') => {
    const timerRef = target === 'start' ? startTimerRef : target === 'end' ? endTimerRef : targetTimerRef;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void searchNodes(keyword, target), 220);
  };

  const searchSelectOptions = (options: SearchOption[]) =>
    options.map((item) => ({
      value: item.value,
      label: (
        <Space direction="vertical" size={0}>
          <Text strong>{displayPlaceName(item)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {placeTypeLabelMap[item.placeType] || item.placeType}
          </Text>
        </Space>
      ),
    }));

  const resolveExactSelection = async (input: string, selected: SearchOption | null, currentOptions: SearchOption[]) => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (selected && (selected.value === trimmed || selected.placeName === trimmed)) return selected;

    if (scenicSelfOption && (trimmed === scenicSelfOption.placeName || trimmed === scenicSelfOption.label)) {
      return scenicSelfOption;
    }

    const localMatch = currentOptions.find(
      (item) =>
        item.placeName === trimmed ||
        item.label === trimmed ||
        displayPlaceName(item) === trimmed ||
        item.value === trimmed,
    );
    if (localMatch) return localMatch;

    const response = await pathPlanningService.searchNodesByName(trimmed, SEARCH_RESULT_LIMIT, scenicAreaId || undefined);
    const candidates = response.data.map(searchToOption);
    return candidates.find((item) => item.placeName === trimmed) || candidates.find((item) => item.placeName.includes(trimmed)) || candidates[0] || null;
  };

  const resolveNavigableNode = async (input: string, selected: SearchOption | null, currentOptions: SearchOption[]) => {
    const option = await resolveExactSelection(input, selected, currentOptions);
    if (!option) return null;
    if (option.placeType === 'scenic_area') {
      return { nodeId: option.value, option };
    }
    if (
      option.placeType === 'junction' ||
      option.placeType === 'facility' ||
      option.placeType === 'attraction' ||
      !hasCoord(option.latitude, option.longitude)
    ) {
      return { nodeId: option.value, option };
    }

    const scopedLocalOptions = localOptions.filter(
      (item) =>
        item.placeType === 'junction' &&
        (!option.scenicAreaId || item.scenicAreaId === option.scenicAreaId),
    );
    if (scopedLocalOptions.length && hasCoord(option.latitude, option.longitude)) {
      const nearestLocal = scopedLocalOptions
        .map((item) => ({
          option: item,
          distance: haversineDistance(
            Number(option.latitude),
            Number(option.longitude),
            Number(item.latitude || 0),
            Number(item.longitude || 0),
          ),
        }))
        .sort((left, right) => left.distance - right.distance)[0]?.option;

      if (nearestLocal) {
        return { nodeId: nearestLocal.value, option };
      }
    }

    const nearest = await pathPlanningService.findNearestNode(Number(option.latitude), Number(option.longitude), scenicAreaId || undefined);
    return { nodeId: nearest.data.nodeId, option };
  };

  const buildCurrentLocationOption = async (
    latitude: number,
    longitude: number,
  ): Promise<CurrentLocationResolution | null> => {
    try {
      const response = await pathPlanningService.findNearestNode(latitude, longitude, scenicAreaId || undefined);
      const matched =
        optionRegistry.get(response.data.nodeId) || localOptions.find((item) => item.value === response.data.nodeId);
      const option = matched
        ? {
            ...matched,
            label: '当前位置',
            placeName: '当前位置',
            placeType: 'poi',
            latitude,
            longitude,
          }
        : {
            value: response.data.nodeId,
            label: '当前位置',
            placeName: '当前位置',
            placeType: 'poi',
            scenicAreaId,
            latitude,
            longitude,
          };

      const distanceToMatchedNode =
        matched && hasCoord(matched.latitude, matched.longitude)
          ? haversineDistance(latitude, longitude, Number(matched.latitude), Number(matched.longitude))
          : 0;

      const warning =
        scenicAreaId && distanceToMatchedNode > CURRENT_LOCATION_DISTANCE_WARNING_METERS
          ? `检测到你当前位置距离${scenicAreaName || routeContext?.scenicAreaName || '当前校园/景区'}内部路网较远，已为你匹配到最近可导航点。`
          : null;

      return { option, warning };
    } catch (error) {
      message.error(resolveErrorMessage(error, '获取当前位置失败，请稍后重试。'));
      return null;
    }
  };

  const getCurrentLocationOption = async (): Promise<CurrentLocationResolution | null> => {
    const nextLocation = currentLocation || (await requestLocation());
    if (!nextLocation) {
      message.warning({
        key: 'path-current-location-error',
        content: getLatestCurrentLocationError() || currentLocationError || '无法获取当前位置。',
      });
      return null;
    }

    return buildCurrentLocationOption(nextLocation.latitude, nextLocation.longitude);
  };

  const applyCurrentLocationAsStart = (option: SearchOption) => {
    setSelectedStart(option);
    setStartInput(displayPlaceName(option));
    setStartOptions((current) => mergeOptions(current, option));
  };

  const handleUseCurrentLocation = async () => {
    const resolved = await getCurrentLocationOption();
    if (!resolved) return;
    applyCurrentLocationAsStart(resolved.option);
    if (resolved.warning) {
      message.warning(resolved.warning);
    }
    message.success('已将当前位置设置为起点。');
  };

  const handleToggleCurrentLocationTracking = () => {
    if (isWatchingCurrentLocation) {
      stopWatching();
      message.success('已停止实时跟踪起点。');
      return;
    }

    const started = startWatching();
    if (started) {
      message.success('已开启实时跟踪，当前位置会持续同步到起点。');
    } else {
      message.warning({
        key: 'path-current-location-error',
        content: getLatestCurrentLocationError() || currentLocationError || '无法获取当前位置。',
      });
    }
  };

  useEffect(() => {
    if (!currentLocation || !isWatchingCurrentLocation) {
      return;
    }

    let cancelled = false;
    const syncTrackedLocation = async () => {
      const resolved = await buildCurrentLocationOption(currentLocation.latitude, currentLocation.longitude);
      if (!resolved || cancelled) {
        return;
      }

      applyCurrentLocationAsStart(resolved.option);
    };

    void syncTrackedLocation();

    return () => {
      cancelled = true;
    };
  }, [
    currentLocation?.latitude,
    currentLocation?.longitude,
    isWatchingCurrentLocation,
    localOptions,
    message,
    optionRegistry,
    scenicAreaId,
  ]);

  const handleAddTarget = async () => {
    const trimmedTargetInput = targetInput.trim();
    const immediateSelection =
      selectedTargetOption &&
      (!trimmedTargetInput ||
        displayPlaceName(selectedTargetOption) === trimmedTargetInput ||
        selectedTargetOption.placeName === trimmedTargetInput ||
        selectedTargetOption.value === trimmedTargetInput)
        ? selectedTargetOption
        : targetOptions.find(
            (item) =>
              item.placeName === trimmedTargetInput ||
              item.label === trimmedTargetInput ||
              displayPlaceName(item) === trimmedTargetInput ||
              item.value === trimmedTargetInput,
          ) || null;

    const resolved = immediateSelection || (await resolveExactSelection(targetInput, null, targetOptions));
    if (!resolved) {
      message.warning('请先选择一个有效的途经点。');
      return;
    }
    if (selectedTargets.some((item) => item.value === resolved.value)) {
      message.warning('该途经点已经添加过了。');
      return;
    }
    setSelectedTargets((current) => [...current, resolved]);
    setSelectedTargetOption(null);
    setTargetInput('');
    setTargetOptions((current) => mergeOptions(current, resolved));
    setDropdownOpenByTarget('target', false);
  };

  const buildMultiPreview = async (
    optimized: MultiPointPath,
    transportations: TransportType[],
    startNodeId: string,
  ): Promise<MultiPreview> => {
    const order = [...optimized.order];
    if (order[order.length - 1] !== startNodeId) {
      order.push(startNodeId);
    }

    const paths: Path[] = [];
    for (let index = 0; index < order.length - 1; index += 1) {
      const response = await pathPlanningService.planAdvancedRoute(order[index], order[index + 1], strategy, transportations);
      paths.push(response.data);
    }

    const actualTransportModes = collectActualTransportModes(paths, transportations);

    return {
      order,
      totalDistance: paths.reduce((sum, item) => sum + Number(item.distance || 0), 0),
      totalTime: paths.reduce((sum, item) => sum + Number(item.time || 0), 0),
      paths,
      strategy,
      transportationModes: actualTransportModes,
    };
  };

  const buildSequentialPreview = async (
    orderedStops: Array<{ nodeId: string; option: SearchOption }>,
    transportations: TransportType[],
  ): Promise<MultiPreview> => {
    const paths: Path[] = [];
    for (let index = 0; index < orderedStops.length - 1; index += 1) {
      const response = await pathPlanningService.planAdvancedRoute(
        orderedStops[index].nodeId,
        orderedStops[index + 1].nodeId,
        strategy,
        transportations,
      );
      paths.push(response.data);
    }

    const actualTransportModes = collectActualTransportModes(paths, transportations);

    return {
      order: orderedStops.map((item) => item.option.value),
      totalDistance: paths.reduce((sum, item) => sum + Number(item.distance || 0), 0),
      totalTime: paths.reduce((sum, item) => sum + Number(item.time || 0), 0),
      paths,
      strategy,
      transportationModes: actualTransportModes,
    };
  };

  const handleSubmit = async () => {
    if (!startInput.trim()) {
      message.warning('请选择起点。');
      return;
    }

    const modes = (transportModes.length ? transportModes : ['walk']) as TransportType[];
    setLoadingRoute(true);
    setActiveLegId(null);

    try {
      const resolvedStart = await resolveNavigableNode(startInput, selectedStart, startOptions);
      if (!resolvedStart) {
        message.warning('起点无法识别，请从候选列表中重新选择。');
        return;
      }
      setSelectedStart(resolvedStart.option);
      setStartInput(displayPlaceName(resolvedStart.option));
      setStartOptions((current) => mergeOptions(current, resolvedStart.option));

      if (multiPointMode) {
        if (!selectedTargets.length) {
          message.warning('请至少添加一个途经点。');
          return;
        }
        const resolvedTargets = await Promise.all(
          selectedTargets.map(async (item) => {
            const resolved = await resolveNavigableNode(item.placeName, item, targetOptions);
            return resolved || { nodeId: item.value, option: item };
          }),
        );
        const uniqueTargets = resolvedTargets.filter((item) => item.nodeId !== resolvedStart.nodeId);
        if (!uniqueTargets.length) {
          message.warning('请至少保留一个与起点不同的途经点。');
          return;
        }
        setSelectedTargets(uniqueTargets.map((item) => item.option));
        const preview = isCityItineraryNavigation
          ? await buildSequentialPreview(
              [{ nodeId: resolvedStart.nodeId, option: resolvedStart.option }, ...uniqueTargets],
              modes,
            )
          : await (async () => {
              const optimized = await pathPlanningService.optimizeMultiPointPath(
                [resolvedStart.nodeId, ...uniqueTargets.map((item) => item.nodeId)],
                strategy,
                modes,
              );
              return buildMultiPreview(optimized.data, modes, resolvedStart.nodeId);
            })();
        setTransportationPath(null);
        setMultiPreview(preview);
      } else {
        if (!endInput.trim()) {
          message.warning('请选择终点。');
          return;
        }
        const resolvedEnd = await resolveNavigableNode(endInput, selectedEnd, endOptions);
        if (!resolvedEnd) {
          message.warning('终点无法识别，请从候选列表中重新选择。');
          return;
        }
        if (resolvedStart.nodeId === resolvedEnd.nodeId) {
          message.warning('起点和终点不能相同。');
          return;
        }
        setSelectedEnd(resolvedEnd.option);
        setEndInput(displayPlaceName(resolvedEnd.option));
        setEndOptions((current) => mergeOptions(current, resolvedEnd.option));
        const response = await pathPlanningService.planAdvancedRoute(resolvedStart.nodeId, resolvedEnd.nodeId, strategy, modes);
        setMultiPreview(null);
        setTransportationPath(response.data);
      }
    } catch (error) {
      message.error(resolveErrorMessage(error, '生成路径失败，请稍后重试。'));
    } finally {
      setLoadingRoute(false);
    }
  };

  useEffect(() => {
    if (!autoPlanFromQuery || !dayRoutePayloadFromQuery.length) {
      return;
    }

    if (loadingRoadNetwork || loadingRoute || transportationPath || multiPreview) {
      return;
    }

    const expectedTargetCount = isCityItineraryNavigation
      ? dayRoutePayloadFromQuery.length
      : Math.max(dayRoutePayloadFromQuery.length - 1, 0);

    if (!multiPointMode || !selectedStart || selectedTargets.length !== expectedTargetCount) {
      return;
    }

    if (autoPlanTriggeredRef.current) {
      return;
    }

    autoPlanTriggeredRef.current = true;
    void handleSubmit();
  }, [
    autoPlanFromQuery,
    dayRoutePayloadFromQuery,
    isCityItineraryNavigation,
    loadingRoadNetwork,
    loadingRoute,
    multiPreview,
    multiPointMode,
    selectedStart,
    selectedTargets,
    transportationPath,
  ]);

  const routeLegs = useMemo<RouteLeg[]>(
    () =>
      routePaths.map((path, index) => {
        const fromId = multiPreview?.order[index] || path.path?.[0] || `start-${index}`;
        const toId = multiPreview?.order[index + 1] || path.path?.[path.path.length - 1] || `end-${index}`;
        const isReturn = Boolean(
          multiPreview &&
            index === routePaths.length - 1 &&
            multiPreview.order[index + 1] === multiPreview.order[0] &&
            routePaths.length > 1,
        );
        return {
          id: `leg-${index}`,
          fromId,
          toId,
          fromName:
            !multiPreview && index === 0
              ? selectedStart?.placeName || optionRegistry.get(fromId)?.placeName || pretty(fromId)
              : optionRegistry.get(fromId)?.placeName || pretty(fromId),
          toName:
            !multiPreview && index === routePaths.length - 1
              ? selectedEnd?.placeName || optionRegistry.get(toId)?.placeName || pretty(toId)
              : optionRegistry.get(toId)?.placeName || pretty(toId),
          distance: Number(path.distance || 0),
          time: Number(path.time || 0),
          color: isReturn ? '#7c3aed' : routeLegPalette[index % routeLegPalette.length],
          points: pathPoints(path),
          isReturn,
          isConnector: Boolean(path.segments?.every((segment) => segment.isConnector)),
        };
      }),
    [multiPreview, optionRegistry, routePaths, selectedEnd?.placeName, selectedStart?.placeName],
  );

  const routeLegTransportPlans = useMemo(
    () =>
      routePaths.map((path, index) => {
        const fallbackModes =
          ((path.transportationModes?.length
            ? path.transportationModes
            : path.segments?.map((segment) => segment.transportation).filter(Boolean)) as TransportType[] | undefined) ||
          transportModes;

        return buildTransportPlan(path.segments, fallbackModes).map((item, planIndex) => ({
          ...item,
          id: `leg-${index}-plan-${planIndex}`,
        }));
      }),
    [routePaths, transportModes],
  );

  const congestionSegments = useMemo(
    () =>
      routePaths.flatMap((path, pathIndex) =>
        (() => {
          const activeSegments = path.segments || [];
          const planGroups = routeLegTransportPlans[pathIndex] || [];
          const transportationSet = Array.from(
            new Set(activeSegments.map((segment) => segment.transportation).filter(Boolean)),
          );
          const useTransportColors = transportationSet.length > 1;
          return activeSegments.map((segment: PathSegment, segmentIndex) => {
            const transportPlanId =
              planGroups.find(
                (group) => segmentIndex >= group.startSegmentIndex && segmentIndex <= group.endSegmentIndex,
              )?.id || null;
            const isActive = activeTransportPlanId
              ? transportPlanId === activeTransportPlanId
              : !activeLegId || activeLegId === `leg-${pathIndex}`;
            const highlightColor = segment.isConnector ? '#dc2626' : '#ef4444';

            return ({
            transportPlanId,
            id: `leg-${pathIndex}-segment-${segmentIndex}`,
            points: segment.pathPoints?.length
              ? segment.pathPoints.map((point) => [point.latitude, point.longitude] as [number, number])
              : [
                  [segment.fromLocation.latitude, segment.fromLocation.longitude] as [number, number],
                  [segment.toLocation.latitude, segment.toLocation.longitude] as [number, number],
                ],
            color: activeTransportPlanId
              ? isActive
                ? highlightColor
                : segment.isConnector
                  ? '#f8b4b4'
                  : '#cbd5e1'
              : segment.isConnector
                ? '#f59e0b'
                : useTransportColors && segment.transportation
                  ? transportColorMap[segment.transportation]
                  : congestionMeta(segment.congestionFactor).color,
            isActive,
            title: `${segment.isConnector ? '步行接驳' : transportLabelMap[(segment.transportation || 'walk') as TransportType]} · ${
              segment.roadName || roadTypeLabelMap[segment.roadType] || '道路'
            }`,
            dashArray: segment.isConnector ? '6,8' : undefined,
            opacity: activeTransportPlanId ? (isActive ? (segment.isConnector ? 0.92 : 0.98) : 0.16) : segment.isConnector ? 0.75 : undefined,
            weight: activeTransportPlanId ? (isActive ? (segment.isConnector ? 5 : 7) : 2) : segment.isConnector ? 3 : undefined,
            isConnector: Boolean(segment.isConnector),
          });
        });
      })(),
      ),
    [activeLegId, activeTransportPlanId, routeLegTransportPlans, routePaths],
  );

  const mapLegendItems = useMemo(() => {
    const items: Array<{ id: string; label: string; color: string; dashArray?: string }> = [];
    const seen = new Set<string>();

    routePaths.forEach((path) => {
      (path.segments || []).forEach((segment) => {
        const key = segment.isConnector ? 'connector' : segment.transportation || 'walk';
        if (seen.has(key)) return;
        seen.add(key);

        if (segment.isConnector) {
          items.push({ id: key, label: '步行接驳', color: '#f59e0b', dashArray: '6,8' });
          return;
        }

        const transportation = (segment.transportation || 'walk') as TransportType;
        items.push({
          id: key,
          label: `${transportLabelMap[transportation]}路线`,
          color: transportColorMap[transportation],
        });
      });
    });

    return items;
  }, [routePaths]);

  const internalPlaceMarkers = useMemo(
    () =>
      roadNetwork.nodes
        .filter(
          (node) =>
            (node.type === 'attraction' || node.type === 'facility') &&
            hasCoord(node.location.latitude, node.location.longitude),
        )
        .map((node) => ({
          id: `internal-${node.id}`,
          position: [node.location.latitude, node.location.longitude] as [number, number],
          title: pretty(node.name),
          type: node.type,
        })),
    [roadNetwork.nodes],
  );

  const mapMarkers = useMemo(() => {
    const baseInternalMarkers = routeLegs.length
      ? internalPlaceMarkers.map((marker) => ({
          ...marker,
          opacity: activeTransportPlanId ? 0.18 : 0.62,
          size: activeTransportPlanId ? 22 : 26,
          dimmed: true,
        }))
      : internalPlaceMarkers;

    if (!routeLegs.length) {
      const previewMarkers: Array<{ id: string; position: [number, number]; title: string; type?: string; label?: string }> = [...baseInternalMarkers];

      if (hasCoord(selectedStart?.latitude, selectedStart?.longitude)) {
        previewMarkers.push({
          id: 'draft-start',
          position: [Number(selectedStart?.latitude), Number(selectedStart?.longitude)],
          title: `当前起点：${selectedStart?.placeName || selectedStart?.label || '起点'}`,
          type: 'start',
          label: 'S',
        });
      }

      if (!multiPointMode && hasCoord(selectedEnd?.latitude, selectedEnd?.longitude)) {
        previewMarkers.push({
          id: 'draft-end',
          position: [Number(selectedEnd?.latitude), Number(selectedEnd?.longitude)],
          title: `当前终点：${selectedEnd?.placeName || selectedEnd?.label || '终点'}`,
          type: 'end',
          label: 'E',
        });
      }

      if (multiPointMode) {
        selectedTargets.forEach((item, index) => {
          if (!hasCoord(item.latitude, item.longitude)) {
            return;
          }

          previewMarkers.push({
            id: `draft-target-${item.value}`,
            position: [Number(item.latitude), Number(item.longitude)],
            title: `途经点 ${index + 1}：${displayPlaceName(item)}`,
            type: 'waypoint',
            label: String(index + 1),
          });
        });
      }

      return previewMarkers;
    }

    const markers: Array<{ id: string; position: [number, number]; title: string; type?: string; label?: string; opacity?: number; size?: number; dimmed?: boolean }> = [...baseInternalMarkers];
    const firstLeg = routePaths[0];
    const firstStartPoint =
      firstLeg?.segments?.[0]?.fromLocation
        ? [firstLeg.segments[0].fromLocation.latitude, firstLeg.segments[0].fromLocation.longitude] as [number, number]
        : routeLegs[0].points[0];
    if (firstStartPoint) {
      markers.push({ id: 'start', position: firstStartPoint, title: `导航起点：${routeLegs[0].fromName}`, type: 'start', label: 'S' });
    }
    routeLegs.forEach((leg, index) => {
      const sourcePath = routePaths[index];
      const lastSegment = sourcePath?.segments?.[sourcePath.segments.length - 1];
      const point =
        lastSegment?.toLocation
          ? [lastSegment.toLocation.latitude, lastSegment.toLocation.longitude] as [number, number]
          : leg.points[leg.points.length - 1];
      if (!point) return;
      const isLast = index === routeLegs.length - 1;
      markers.push({
        id: `marker-${leg.id}`,
        position: point,
        title: leg.isReturn ? `返回起点：${leg.toName}` : isLast ? `导航终点：${leg.toName}` : `途经点 ${index + 1}：${leg.toName}`,
        type: leg.isReturn ? 'return' : isLast ? 'end' : 'waypoint',
        label: leg.isReturn ? '返' : isLast ? '终' : String(index + 1),
      });
    });

    return markers;
  }, [activeTransportPlanId, internalPlaceMarkers, multiPointMode, routeLegs, routePaths, selectedEnd, selectedStart, selectedTargets]);

  const mapCenter = useMemo<[number, number]>(() => {
    const center = routeContext?.center;
    if (center) return [center.latitude, center.longitude];
    if (routeLegs[0]?.points[0]) return routeLegs[0].points[0];
    if (selectedStart?.placeName === '当前位置' && hasCoord(selectedStart.latitude, selectedStart.longitude)) {
      return [Number(selectedStart.latitude), Number(selectedStart.longitude)];
    }
    const firstNode = roadNetwork.nodes[0];
    if (firstNode) return [firstNode.location.latitude, firstNode.location.longitude];
    return [39.9042, 116.4074];
  }, [roadNetwork.nodes, routeContext?.center, routeLegs, selectedStart]);

  const shouldFocusCurrentLocationPreview =
    !routeLegs.length &&
    selectedStart?.placeName === '当前位置' &&
    hasCoord(selectedStart.latitude, selectedStart.longitude);
  const shouldFocusTransportPlan = Boolean(activeTransportPlanId);

  const activeLeg = routeLegs.find((item) => item.id === activeLegId) || routeLegs[0] || null;
  const activePathIndex = activeLeg ? routeLegs.findIndex((item) => item.id === activeLeg.id) : 0;
  const activeTransportPlan =
    activePathIndex >= 0
      ? routeLegTransportPlans[activePathIndex]?.find((item) => item.id === activeTransportPlanId) || null
      : null;
  const mapRouteLegs = useMemo(
    () => routeLegs.map((leg) => ({ id: leg.id, points: leg.points, color: leg.color, title: leg.id })),
    [routeLegs],
  );
  const mapFocusPoints = useMemo(() => {
    if (shouldFocusCurrentLocationPreview && selectedStart?.latitude && selectedStart?.longitude) {
      return [[Number(selectedStart.latitude), Number(selectedStart.longitude)] as [number, number]];
    }

    if (!activeTransportPlan || activePathIndex < 0) {
      if (activeLeg?.points?.length) {
        return activeLeg.points;
      }

      return mapMarkers.map((item) => item.position);
    }

    const activePath = routePaths[activePathIndex];
    const segments = activePath?.segments?.slice(
      activeTransportPlan.startSegmentIndex,
      activeTransportPlan.endSegmentIndex + 1,
    );

    return (segments || []).flatMap((segment) =>
      segment.pathPoints?.length
        ? segment.pathPoints.map((point) => [point.latitude, point.longitude] as [number, number])
        : [
            [segment.fromLocation.latitude, segment.fromLocation.longitude] as [number, number],
            [segment.toLocation.latitude, segment.toLocation.longitude] as [number, number],
          ],
    );
  }, [activeLeg, activePathIndex, activeTransportPlan, mapMarkers, routePaths, selectedStart, shouldFocusCurrentLocationPreview]);
  const noResultContent = <Text type="secondary">当前范围内暂无匹配地点</Text>;

  return (
    <div style={{ padding: '28px 24px 40px' }}>
      <Space direction="vertical" size={24} style={{ width: '100%' }}>
        <div>
          <Title level={2} style={{ marginBottom: 8 }}>{`${scenicAreaName || routeContext?.scenicAreaName || '景区或校园'}内部路线规划`}</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            回到更稳定的按名称选点体验，同时保留多目标点、最短时间 / 最短距离和混合交通工具功能。
          </Paragraph>
        </div>

        {cityDaySourceHint ? (
          <Card
            variant="borderless"
            style={{
              ...cardStyle,
              background: 'linear-gradient(135deg, rgba(37,99,235,0.08), rgba(16,185,129,0.05))',
            }}
            bodyStyle={{ padding: 18 }}
          >
            <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space wrap>
                <Tag color="blue">城市日程接力</Tag>
                <Text strong>{cityDaySourceHint}</Text>
              </Space>
              <Text type="secondary">已按这一天的景点顺序自动切入多目标详细导航。</Text>
            </Space>
          </Card>
        ) : null}

        <Card style={cardStyle} bodyStyle={{ padding: 24 }}>
          <Row gutter={[20, 20]}>
            <Col xs={24} lg={11}>
              <Text strong>起点</Text>
              <AutoComplete
                style={{ width: '100%', marginTop: 8 }}
                value={startInput}
                options={searchSelectOptions(startOptions)}
                open={startDropdownOpen && startOptions.length > 0}
                onChange={(value) => {
                  const nextValue = String(value);
                  setStartInput(nextValue);
                  if (selectedStart && nextValue !== displayPlaceName(selectedStart)) {
                    setSelectedStart(null);
                  }
                  applyLocalSearchOptions(nextValue, 'start');
                  setDropdownOpenByTarget('start', true);
                  debounceSearch(nextValue, 'start');
                }}
                onSearch={(value) => {
                  setStartInput(value);
                  applyLocalSearchOptions(value, 'start');
                  setDropdownOpenByTarget('start', true);
                  debounceSearch(value, 'start');
                }}
                onSelect={(value) => {
                  const option = optionRegistry.get(String(value));
                  if (!option) return;
                  setSelectedStart(option);
                  setStartInput(displayPlaceName(option));
                  setDropdownOpenByTarget('start', false);
                }}
                onFocus={() => {
                  applyLocalSearchOptions(startInput, 'start');
                  setDropdownOpenByTarget('start', true);
                }}
                onBlur={() => {
                  if (selectedStart && startInput === displayPlaceName(selectedStart)) return;
                  setSelectedStart(null);
                  window.setTimeout(() => setDropdownOpenByTarget('start', false), 120);
                }}
                placeholder="按名称搜索起点"
                filterOption={false}
                notFoundContent={searchingStart ? <Spin size="small" /> : noResultContent}
                size="large"
              />
              <Space wrap style={{ marginTop: 12 }}>
                <Button icon={<AimOutlined />} loading={resolvingCurrentLocation} onClick={() => void handleUseCurrentLocation()}>
                  使用当前位置
                </Button>
                <Button type={isWatchingCurrentLocation ? 'primary' : 'default'} onClick={handleToggleCurrentLocationTracking}>
                  {isWatchingCurrentLocation ? '停止实时跟踪' : '实时跟踪起点'}
                </Button>
                <Button
                  icon={<SwapOutlined />}
                  onClick={() => {
                    const previousStart = startInput;
                    const previousEnd = endInput;
                    const previousStartOption = selectedStart;
                    const previousEndOption = selectedEnd;
                    setStartInput(previousEnd);
                    setEndInput(previousStart);
                    setSelectedStart(previousEndOption);
                    setSelectedEnd(previousStartOption);
                  }}
                >
                  交换起终点                </Button>
              </Space>
              <Space wrap style={{ marginTop: 8 }}>
                {isWatchingCurrentLocation ? <Tag color="green">实时定位中</Tag> : null}
                {currentLocation ? (
                  <Tag color="blue">{`定位：${currentLocation.latitude.toFixed(5)}, ${currentLocation.longitude.toFixed(5)}`}</Tag>
                ) : null}
                {currentLocationError ? <Tag color="red">{currentLocationError}</Tag> : null}
              </Space>
            </Col>
            <Col xs={24} lg={13}>
              {!multiPointMode ? (
                <>
                  <Text strong>终点</Text>
                  <AutoComplete
                    style={{ width: '100%', marginTop: 8 }}
                    value={endInput}
                    options={searchSelectOptions(endOptions)}
                    open={endDropdownOpen && endOptions.length > 0}
                    onChange={(value) => {
                      const nextValue = String(value);
                      setEndInput(nextValue);
                      if (selectedEnd && nextValue !== displayPlaceName(selectedEnd)) {
                        setSelectedEnd(null);
                      }
                      applyLocalSearchOptions(nextValue, 'end');
                      setDropdownOpenByTarget('end', true);
                      debounceSearch(nextValue, 'end');
                    }}
                    onSearch={(value) => {
                      setEndInput(value);
                      applyLocalSearchOptions(value, 'end');
                      setDropdownOpenByTarget('end', true);
                      debounceSearch(value, 'end');
                    }}
                    onSelect={(value) => {
                      const option = optionRegistry.get(String(value));
                      if (!option) return;
                      setSelectedEnd(option);
                      setEndInput(displayPlaceName(option));
                      setDropdownOpenByTarget('end', false);
                    }}
                    onFocus={() => {
                      applyLocalSearchOptions(endInput, 'end');
                      setDropdownOpenByTarget('end', true);
                    }}
                    onBlur={() => {
                      if (selectedEnd && endInput === displayPlaceName(selectedEnd)) return;
                      setSelectedEnd(null);
                      window.setTimeout(() => setDropdownOpenByTarget('end', false), 120);
                    }}
                    placeholder="按名称搜索终点"
                    filterOption={false}
                    notFoundContent={searchingEnd ? <Spin size="small" /> : noResultContent}
                    size="large"
                  />
                </>
              ) : (
                <>
                  <Text strong>途经点</Text>
                  <AutoComplete
                    style={{ width: '100%', marginTop: 8 }}
                    value={targetInput}
                    options={searchSelectOptions(targetOptions)}
                    open={targetDropdownOpen && targetOptions.length > 0}
                    onChange={(value) => {
                      const nextValue = String(value);
                      setTargetInput(nextValue);
                      if (selectedTargetOption && displayPlaceName(selectedTargetOption) !== nextValue) {
                        setSelectedTargetOption(null);
                      }
                      applyLocalSearchOptions(nextValue, 'target');
                      setDropdownOpenByTarget('target', true);
                      debounceSearch(nextValue, 'target');
                    }}
                    onSearch={(value) => {
                      setTargetInput(value);
                      if (selectedTargetOption && displayPlaceName(selectedTargetOption) !== value) {
                        setSelectedTargetOption(null);
                      }
                      applyLocalSearchOptions(value, 'target');
                      setDropdownOpenByTarget('target', true);
                      debounceSearch(value, 'target');
                    }}
                    onSelect={(value) => {
                      const option = optionRegistry.get(String(value));
                      if (!option) return;
                      setSelectedTargetOption(option);
                      setTargetInput(displayPlaceName(option));
                      setDropdownOpenByTarget('target', false);
                    }}
                    onFocus={() => {
                      applyLocalSearchOptions(targetInput, 'target');
                      setDropdownOpenByTarget('target', true);
                    }}
                    onBlur={() => {
                      if (selectedTargetOption && targetInput === displayPlaceName(selectedTargetOption)) return;
                      setSelectedTargetOption(null);
                      window.setTimeout(() => setDropdownOpenByTarget('target', false), 120);
                    }}
                    placeholder="添加途经点"
                    filterOption={false}
                    notFoundContent={searchingTarget ? <Spin size="small" /> : noResultContent}
                    size="large"
                  />
                  <Space wrap style={{ marginTop: 12 }}>
                    <Button icon={<PlusOutlined />} onClick={() => void handleAddTarget()}>
                      添加途经点
                    </Button>
                  </Space>
                  <div style={{ marginTop: 12, minHeight: 32 }}>
                    {selectedTargets.length ? (
                      <Space wrap>
                        {selectedTargets.map((item) => (
                          <Tag
                            key={item.value}
                            closable
                            color="blue"
                            onClose={(event) => {
                              event.preventDefault();
                              setSelectedTargets((current) => current.filter((target) => target.value !== item.value));
                            }}
                          >
                            {displayPlaceName(item)}
                          </Tag>
                        ))}
                      </Space>
                    ) : (
                      <Text type="secondary">已选途经点会显示在这里。</Text>
                    )}
                  </div>
                </>
              )}
            </Col>
          </Row>
          <Row gutter={[20, 20]} style={{ marginTop: 20 }}>
            <Col xs={24} lg={10}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Text strong>规划模式</Text>
                <Radio.Group value={multiPointMode ? 'multi' : 'single'} onChange={(event) => setMultiPointMode(event.target.value === 'multi')}>
                  <Radio.Button value="single">单终点</Radio.Button>
                  <Radio.Button value="multi">多目标点</Radio.Button>
                </Radio.Group>
              </Space>
            </Col>
            <Col xs={24} lg={7}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Text strong>规划策略</Text>
                <Radio.Group value={strategy} onChange={(event) => setStrategy(event.target.value)}>
                  <Radio.Button value="shortest_time">最短时间</Radio.Button>
                  <Radio.Button value="shortest_distance">最短距离</Radio.Button>
                </Radio.Group>
              </Space>
            </Col>
            <Col xs={24} lg={7}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Text strong>交通工具</Text>
                <Space wrap>
                  <Tag color={activePlanningProfile?.kind === 'campus' ? 'blue' : activePlanningProfile?.kind === 'scenic' ? 'green' : 'default'}>
                    场景：{activePlanningProfile?.label || '通用'}
                  </Tag>
                  {activePlanningProfile?.vehicleTransportation ? (
                    <Tag color="purple">主交通：{transportLabelMap[activePlanningProfile.vehicleTransportation as TransportType]}</Tag>
                  ) : null}
                </Space>
                <Checkbox.Group
                  options={allowedTransportModes.map((value) => ({ value, label: transportLabelMap[value] }))}
                  value={transportModes}
                  onChange={(values) => {
                    const nextModes = (values as TransportType[]).filter(Boolean);
                    setTransportModes(nextModes.length ? nextModes : [...defaultTransportModes]);
                  }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {planningProfileDescription}
                </Text>
              </Space>
            </Col>
          </Row>
          <Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
            当前只展示当前景区或校园范围内的候选地点。多目标点模式下，先添加途经点，再生成最优路线；系统会在参观完成后自动返回起点。
          </Text>
          <Space style={{ marginTop: 24 }} wrap>
            <Button type="primary" onClick={() => void handleSubmit()} loading={loadingRoute} size="large">
              开始规划
            </Button>
            <Button
              size="large"
              icon={<ReloadOutlined />}
              onClick={() => {
                setStartInput('');
                setEndInput('');
                setTargetInput('');
                setSelectedStart(null);
                setSelectedEnd(null);
                setSelectedTargets([]);
                setTransportationPath(null);
                setMultiPreview(null);
                setActiveLegId(null);
                setTransportModes([...defaultTransportModes]);
              }}
            >
              重置
            </Button>
            <Button size="large" onClick={() => navigate('/query')}>
              返回查询页
            </Button>
          </Space>
        </Card>

        <Card style={cardStyle} bodyStyle={{ padding: 24 }}>
          <Row gutter={[24, 24]}>
            <Col xs={24} lg={11}>
              <Space direction="vertical" size={18} style={{ width: '100%' }}>
                <div>
                  <Title level={3} style={{ marginBottom: 8 }}>路径结果</Title>
                  <Text type="secondary">当前范围：{scenicAreaName || routeContext?.scenicAreaName || '当前地图范围'}</Text>
                </div>
                {loadingRoadNetwork ? <Spin tip="正在加载路网..." /> : null}
                {loadingRoute ? <Spin tip="正在生成路径..." /> : null}
                {!loadingRoute && !routeLegs.length ? <Empty description="请选择地点并开始规划。" /> : null}
                {routeLegs.length ? (
                  <>
                    <Space wrap>
                      <Tag color="blue">策略：{strategyLabelMap[multiPreview?.strategy || transportationPath?.strategy || strategy]}</Tag>
                      <Tag color={activePlanningProfile?.kind === 'campus' ? 'blue' : activePlanningProfile?.kind === 'scenic' ? 'green' : 'default'}>
                        场景：{activePlanningProfile?.label || '通用'}
                      </Tag>
                      <Tag color="purple">
                        交通工具：
                        {(multiPreview?.transportationModes || transportationPath?.transportationModes || transportModes)
                          .map((item) => transportLabelMap[item])
                          .join(' / ')}
                      </Tag>
                      <Tag color="green">路径来源：{hasStreetRoute ? '真实街道' : '景区路网'}</Tag>
                      {(multiPreview?.transportationModes || transportationPath?.transportationModes || transportModes).length > 1 ? (
                        <Tag color="magenta">混合交通</Tag>
                      ) : null}
                      {multiPointMode ? <Tag color="cyan">多目标点</Tag> : <Tag color="default">单终点</Tag>}
                      {multiPointMode ? <Tag color="purple">返回起点</Tag> : null}
                    </Space>
                    <Card variant="borderless" style={{ borderRadius: 20, background: '#f8fafc' }}>
                      <Space direction="vertical" size={14} style={{ width: '100%' }}>
                        <Text strong>
                          总计：{formatDistance(multiPreview?.totalDistance || Number(transportationPath?.distance || 0))} / {formatTime(multiPreview?.totalTime || Number(transportationPath?.time || 0))}
                        </Text>
                        {routeLegs.map((leg, index) => {
                          const meta = congestionMeta(routePaths[index]?.segments?.[0]?.congestionFactor);
                          const legModes =
                            (routePaths[index]?.segments
                              ?.map((segment) => segment.transportation)
                              .filter((item): item is TransportType => Boolean(item))
                              .filter((item, itemIndex, source) => source.indexOf(item) === itemIndex)) || [];
                          const transportPlan = routeLegTransportPlans[index] || [];
                          return (
                            <Card
                              key={leg.id}
                              hoverable
                              variant="borderless"
                              onClick={() => {
                                setActiveLegId(leg.id);
                                setActiveTransportPlanId(null);
                              }}
                              style={{
                                borderRadius: 18,
                                cursor: 'pointer',
                                border: activeLegId === leg.id || (!activeLegId && index === 0) ? `2px solid ${leg.color}` : '1px solid rgba(148,163,184,0.18)',
                                boxShadow: 'none',
                              }}
                            >
                              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                                  <Text strong>第 {index + 1} 段：{leg.fromName} {'->'} {leg.toName}</Text>
                                  <Text>{formatDistance(leg.distance)} / {formatTime(leg.time)}</Text>
                                </Space>
                                <Space wrap>
                                  {leg.isReturn ? <Tag color="purple">回程</Tag> : null}
                                  <Tag color={meta.tagColor}>{meta.label}</Tag>
                                  <Tag color="geekblue">{summarizeTransportSequence(routePaths[index]?.segments, legModes.length ? legModes : transportModes)}</Tag>
                                </Space>
                                {transportPlan.length > 1 ? (
                                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                    {transportPlan.map((item, planIndex) => (
                                      <div
                                        key={item.id || `${leg.id}-plan-${planIndex}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setActiveLegId(leg.id);
                                          setActiveTransportPlanId(activeTransportPlanId === item.id ? null : item.id || null);
                                        }}
                                        style={{
                                          width: '100%',
                                          padding: '12px 14px',
                                          borderRadius: 14,
                                          cursor: 'pointer',
                                          border:
                                            activeTransportPlanId === item.id
                                              ? '1px solid rgba(37,99,235,0.55)'
                                              : '1px solid rgba(148,163,184,0.18)',
                                          background:
                                            activeTransportPlanId === item.id
                                              ? 'rgba(37,99,235,0.08)'
                                              : 'rgba(255,255,255,0.82)',
                                          boxShadow:
                                            activeTransportPlanId === item.id ? '0 10px 24px rgba(37,99,235,0.12)' : 'none',
                                          transition: 'all 0.18s ease',
                                        }}
                                      >
                                        <Space wrap size={[8, 8]}>
                                          <Tag color={item.isConnector ? 'gold' : item.transportation === 'walk' ? 'green' : item.transportation === 'bicycle' ? 'blue' : 'orange'}>
                                            第 {planIndex + 1} 段：{item.isConnector ? '步行接驳' : transportLabelMap[item.transportation]}
                                          </Tag>
                                          <Tag color={activeTransportPlanId === item.id ? 'geekblue' : 'default'}>
                                            {activeTransportPlanId === item.id ? '已选中' : '点击聚焦'}
                                          </Tag>
                                          <Text type="secondary">
                                            {formatDistance(item.distance)} / {formatTime(item.time)}
                                          </Text>
                                        </Space>
                                        <Text type="secondary">{describeTransportPlan(item, planIndex, transportPlan.length)}</Text>
                                      </div>
                                    ))}
                                  </Space>
                                ) : null}
                              </Space>
                            </Card>
                          );
                        })}
                      </Space>
                    </Card>
                  </>
                ) : null}
              </Space>
            </Col>
            <Col xs={24} lg={13}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                  <Space>
                    <Button type={baseMapMode === 'scenic' ? 'primary' : 'default'} onClick={() => setBaseMapMode('scenic')}>景区导航图</Button>
                    <Button type={baseMapMode === 'street' ? 'primary' : 'default'} disabled={!hasStreetRoute} onClick={() => setBaseMapMode('street')}>真实街道图</Button>
                  </Space>
                  <Space>
                    <Text>{baseMapMode === 'scenic' ? '模板路网底图' : '显示路网参考线'}</Text>
                    <Switch
                      checked={baseMapMode === 'scenic' ? true : showRoadNetwork}
                      onChange={setShowRoadNetwork}
                      disabled={hasStreetRoute || baseMapMode === 'scenic'}
                    />
                  </Space>
                </Space>
                <Card variant="borderless" style={{ borderRadius: 24, background: '#f8fafc' }} bodyStyle={{ padding: 12 }}>
                    <MapComponent
                      center={mapCenter}
                      zoom={16}
                      focusZoom={shouldFocusTransportPlan ? 18 : 16}
                      preferFocusPoints={shouldFocusCurrentLocationPreview || shouldFocusTransportPlan}
                      markers={mapMarkers}
                    routeLegs={mapRouteLegs}
                    congestionSegments={congestionSegments}
                    activeRouteLegId={activeLegId || routeLegs[0]?.id || null}
                    focusPoints={mapFocusPoints}
                    roadNetwork={roadNetwork}
                    showRoadNetwork={!hasStreetRoute && showRoadNetwork}
                    baseMapMode={baseMapMode}
                    scenicAreaName={scenicAreaName || routeContext?.scenicAreaName || null}
                    routeSource={(hasStreetRoute ? 'osrm' : 'graph') as 'graph' | 'osrm'}
                    showDirectionArrows
                    pathLegendItems={mapLegendItems}
                  />
                </Card>
              </Space>
            </Col>
          </Row>
        </Card>
      </Space>
    </div>
  );
};

export default PathPlanningPage;
