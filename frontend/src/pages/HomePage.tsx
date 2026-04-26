import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, Empty, Modal, Radio, Row, Skeleton, Space, Tag, Typography, message } from 'antd';
import {
  CloseOutlined,
  DeleteOutlined,
  FireOutlined,
  HeartOutlined,
  RiseOutlined,
  SaveOutlined,
  StarOutlined,
  TagsOutlined,
  UserOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons';
import PremiumPageHero from '../components/PremiumPageHero';
import { useAppDispatch, useAppSelector } from '../store';
import { getRankingAttractions, RankingType } from '../store/slices/recommendationSlice';
import { updateInterests } from '../store/slices/userSlice';
import { resolveScenicCoverPresentation } from '../utils/scenicPresentation';
import { replaceTianjinMedicalWithBupt } from '../utils/scenicPromotions';
import type { ScenicArea } from '../services/recommendationService';

const { Title, Paragraph, Text } = Typography;

const rankingDescMap: Record<RankingType, string> = {
  popularity: '适合快速浏览当前最受欢迎的景区与校园。',
  rating: '更适合优先挑选评分稳定、口碑更好的目的地。',
  review: '更适合查看近期讨论活跃、游客反馈更丰富的地点。',
  personalized: '结合你的兴趣标签与行为偏好，生成更贴近个人口味的推荐。',
};

const stageCards = [
  {
    title: '旅游前',
  subtitle: '?????????? AIGC ?????',
  tags: ['????', '????', 'AIGC ??'],
    actionLabel: '进入智能行程',
    accent: 'linear-gradient(135deg, rgba(109,93,252,0.18), rgba(125,211,252,0.18))',
    to: '/journey',
  },
  {
    title: '旅游中',
    subtitle: '景区详情、设施查询、路径规划、室内导航与美食联动。',
    tags: ['地图 A / B / C', '设施检索', '导航联动'],
    actionLabel: '进入查询中心',
    accent: 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(45,212,191,0.16))',
    to: '/query',
  },
  {
    title: '旅游后',
    subtitle: '?????????? AIGC ?????',
    tags: ['????', '????', 'AIGC ??'],
    actionLabel: '进入旅行日记',
    accent: 'linear-gradient(135deg, rgba(251,146,60,0.14), rgba(251,191,36,0.18))',
    to: '/diary',
  },
];

const mapCards = [
  {
    title: '地图 A：景区总览',
    description: '用于旅游前的景区发现、热门排行浏览和目标景区筛选。',
    tags: ['首页', '景区总览', '智能行程'],
    actionLabel: '查看景区总览',
    to: '/scenic-overview',
  },
  {
    title: '地图 B：景区内部地图',
    description: '用于游中阶段的景点、设施、路网和户外导航联动。',
    tags: ['景区详情', '设施查询', '路径规划'],
    actionLabel: '进入户外导航',
    to: '/path-planning',
  },
  {
    title: '地图 C：室内楼层图',
    description: '用于入口到房间、房间到房间和跨楼层电梯导航。',
    tags: ['室内导航', '楼层切换', '房间选点'],
    actionLabel: '进入室内导航',
    to: '/indoor-navigation',
  },
];

const summaryCardTone = [
  'linear-gradient(135deg, rgba(125,211,252,0.22), rgba(255,255,255,0.96))',
  'linear-gradient(135deg, rgba(251,191,36,0.18), rgba(255,255,255,0.96))',
  'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(255,255,255,0.96))',
  'linear-gradient(135deg, rgba(244,114,182,0.18), rgba(255,255,255,0.96))',
];

const creativeTags = ['探索模式', '惊喜推荐', '摄影打卡', 'AIGC 动画', '社交组队', '个性提醒'];
const travelCities = ['北京', '上海', '广州', '杭州', '南京', '天津', '武汉', '西安', '成都', '重庆'];
const SELECTED_CITY_STORAGE_KEY = 'home:selectedCity';
const ACTIVE_CITY_STORAGE_KEY = 'home:activeRecommendationCity';

const primaryInterestTags = [
  '自然',
  '人文',
  '校园',
  '观光型',
  '休闲度假',
  '探险体验',
  '文化教育',
  '博物馆',
  '古建筑',
  '公园',
  '摄影打卡',
  '慢逛',
];

const secondaryInterestTags = ['遗址', '湖泊', '展馆', '图书馆', '观景台', '拍照', '亲子', '情侣', '半日游', '夜游'];
const allInterestTags = [...primaryInterestTags, ...secondaryInterestTags];

const panelHeaderStyles = {
  recommendation: {
    background: 'linear-gradient(135deg, rgba(104,92,255,0.98), rgba(148,117,255,0.9))',
    color: '#ffffff',
  },
  ranking: {
    background: 'linear-gradient(135deg, rgba(255,122,89,0.96), rgba(255,163,99,0.9))',
    color: '#ffffff',
  },
};

const panelCardStyle = {
  borderRadius: 28,
  boxShadow: '0 22px 46px rgba(15,23,42,0.08)',
  height: '100%',
  background: 'linear-gradient(180deg, rgba(255,255,255,1), rgba(248,250,252,0.98))',
};

const resolveInterestTrend = (interestCount: number) => (interestCount > 0 ? '偏好已建模' : '待完善兴趣');
const toNumber = (value?: number | null) => Number(value || 0);

const restoreCityPreference = (storageKey: string): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const value = window.localStorage.getItem(storageKey);
  return value && travelCities.includes(value) ? value : null;
};

type InterestTagSectionProps = {
  title: string;
  hint: string;
  tags: string[];
  selectedTags: string[];
  onToggle: (tag: string) => void;
  icon: React.ReactNode;
};

const InterestTagSection: React.FC<InterestTagSectionProps> = ({ title, hint, tags, selectedTags, onToggle, icon }) => (
  <div
    style={{
      borderRadius: 20,
      padding: 20,
      border: '1px solid rgba(226,232,240,0.85)',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96))',
    }}
  >
    <Space size={10} align="center" style={{ marginBottom: 14 }}>
      <span
        style={{
          width: 28,
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 10,
          color: '#6d5dfc',
          background: 'rgba(109,93,252,0.10)',
        }}
      >
        {icon}
      </span>
      <Text strong style={{ fontSize: 20, color: '#0f172a' }}>
        {title}
      </Text>
      <Text type="secondary">{hint}</Text>
    </Space>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {tags.map((tag) => {
        const selected = selectedTags.includes(tag);
        return (
          <Button
            key={tag}
            type={selected ? 'primary' : 'default'}
            shape="round"
            onClick={() => onToggle(tag)}
            style={{
              minWidth: 110,
              height: 42,
              borderRadius: 999,
              fontWeight: 600,
              borderColor: selected ? 'transparent' : 'rgba(203,213,225,0.9)',
              background: selected
                ? 'linear-gradient(135deg, rgba(109,93,252,0.96), rgba(148,117,255,0.92))'
                : 'rgba(255,255,255,0.96)',
              boxShadow: selected ? '0 10px 22px rgba(109,93,252,0.24)' : 'none',
            }}
          >
            {tag}
          </Button>
        );
      })}
    </div>
  </div>
);

type InterestProfileModalProps = {
  open: boolean;
  selectedTags: string[];
  isSaving: boolean;
  onClose: () => void;
  onToggleTag: (tag: string) => void;
  onClear: () => void;
  onSave: () => void;
};

const InterestProfileModal: React.FC<InterestProfileModalProps> = ({
  open,
  selectedTags,
  isSaving,
  onClose,
  onToggleTag,
  onClear,
  onSave,
}) => (
  <Modal
    open={open}
    onCancel={onClose}
    footer={null}
    closeIcon={<CloseOutlined />}
    width={920}
    centered
    destroyOnClose={false}
    styles={{
      body: {
        padding: 24,
        background: 'linear-gradient(180deg, rgba(255,255,255,1), rgba(248,250,252,0.98))',
      },
      content: {
        borderRadius: 28,
        overflow: 'hidden',
      },
    }}
  >
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <div>
        <Space size={12} align="center" style={{ marginBottom: 8 }}>
          <span
            style={{
              width: 54,
              height: 54,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 18,
              background: 'rgba(109,93,252,0.10)',
              color: '#6d5dfc',
              fontSize: 22,
            }}
          >
            <HeartOutlined />
          </span>
          <div>
            <Title level={3} style={{ margin: 0 }}>
              完善兴趣画像
            </Title>
            <Text type="secondary">选择你的主兴趣标签，系统会优先推荐更符合你偏好的景区与校园。</Text>
          </div>
        </Space>
      </div>

      <InterestTagSection
        title="1. 主兴趣标签"
        hint="建议优先选择 3-5 项"
        tags={primaryInterestTags}
        selectedTags={selectedTags}
        onToggle={onToggleTag}
        icon={<TagsOutlined />}
      />

      <InterestTagSection
        title="2. 更多偏好"
        hint="可选，用于进一步细化推荐"
        tags={secondaryInterestTags}
        selectedTags={selectedTags}
        onToggle={onToggleTag}
        icon={<TagsOutlined />}
      />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: 20,
          borderRadius: 22,
          background: 'linear-gradient(135deg, rgba(245,247,255,0.98), rgba(250,250,255,0.98))',
          border: '1px solid rgba(226,232,240,0.85)',
        }}
      >
        <div style={{ flex: 1, minWidth: 260 }}>
          <Text strong style={{ display: 'block', marginBottom: 12, fontSize: 18 }}>
            当前已选 {selectedTags.length} 项
          </Text>
          <Space wrap size={[8, 10]}>
            {selectedTags.length > 0 ? (
              selectedTags.map((tag) => (
                <Tag
                  key={tag}
                  closable
                  onClose={(event) => {
                    event.preventDefault();
                    onToggleTag(tag);
                  }}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 999,
                    background: 'rgba(109,93,252,0.08)',
                    borderColor: 'rgba(109,93,252,0.18)',
                    color: '#6d5dfc',
                  }}
                >
                  {tag}
                </Tag>
              ))
            ) : (
              <Text type="secondary">还没有选择兴趣标签</Text>
            )}
          </Space>
        </div>
        <Space wrap>
          <Button icon={<DeleteOutlined />} shape="round" size="large" onClick={onClear}>
            清空选择
          </Button>
          <Button
            type="primary"
            shape="round"
            size="large"
            loading={isSaving}
            icon={<SaveOutlined />}
            onClick={onSave}
            style={{
              minWidth: 170,
              borderColor: 'transparent',
              background: 'linear-gradient(135deg, rgba(109,93,252,0.96), rgba(148,117,255,0.92))',
              boxShadow: '0 12px 26px rgba(109,93,252,0.24)',
            }}
          >
            保存兴趣画像
          </Button>
        </Space>
      </div>
    </Space>
  </Modal>
);

type CityPlanningCardProps = {
  selectedCity: string | null;
  activeRecommendationCity: string | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelectCity: (city: string) => void;
  onEnterRecommendation: () => void;
};

const CityPlanningCard: React.FC<CityPlanningCardProps> = ({
  selectedCity,
  activeRecommendationCity,
  isExpanded,
  onToggleExpand,
  onSelectCity,
  onEnterRecommendation,
}) => (
  <Card
    variant="borderless"
    style={{
      borderRadius: 24,
      height: '100%',
      background: 'linear-gradient(135deg, rgba(244,114,182,0.10), rgba(255,255,255,0.96))',
      boxShadow: '0 20px 40px rgba(15,23,42,0.08)',
      border: '1px solid rgba(255,255,255,0.7)',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(255,255,255,0.72)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.6)',
          fontSize: 18,
        }}
      >
        <EnvironmentOutlined style={{ color: '#ec4899' }} />
      </div>
      <Tag style={{ marginInlineEnd: 0, borderRadius: 999, background: 'rgba(255,255,255,0.72)' }}>
        出行前规划
      </Tag>
    </div>
    <Text type="secondary" style={{ letterSpacing: 0.5 }}>
      目的城市
    </Text>
    <div style={{ marginTop: 10, fontSize: 34, fontWeight: 700, color: '#0f172a' }}>{selectedCity || '未选择'}</div>
    <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 8 }}>
      {activeRecommendationCity
        ? `当前将优先显示 ${activeRecommendationCity} 的推荐标题。`
        : '在出发前先选择你想探索的城市。'}
    </Paragraph>

    {(isExpanded || !selectedCity) && (
      <div
        style={{
          marginTop: 16,
          paddingTop: 16,
          borderTop: '1px solid rgba(226,232,240,0.72)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        {travelCities.map((city) => {
          const selected = city === selectedCity;
          return (
            <Button
              key={city}
              type={selected ? 'primary' : 'default'}
              shape="round"
              onClick={() => onSelectCity(city)}
              style={{
                borderRadius: 999,
                minWidth: 74,
                borderColor: selected ? 'transparent' : 'rgba(203,213,225,0.92)',
                background: selected
                  ? 'linear-gradient(135deg, rgba(109,93,252,0.96), rgba(148,117,255,0.92))'
                  : 'rgba(255,255,255,0.96)',
              }}
            >
              {city}
            </Button>
          );
        })}
      </div>
    )}

    <Space wrap style={{ marginTop: 18 }}>
      <Button
        type="primary"
        shape="round"
        onClick={onEnterRecommendation}
        disabled={!selectedCity}
        style={{
          borderColor: 'transparent',
          background: 'linear-gradient(135deg, rgba(109,93,252,0.96), rgba(148,117,255,0.92))',
          boxShadow: '0 12px 26px rgba(109,93,252,0.24)',
        }}
      >
        进入城市推荐
      </Button>
      <Button shape="round" onClick={onToggleExpand}>
        切换城市
      </Button>
    </Space>
  </Card>
);

const getHomeRankingText = (item: ScenicArea, type: RankingType) => {
  if (type === 'popularity') {
    return `热度指数 ${toNumber(item.popularity)} · 客流量 ${toNumber(item.visitorCount)}`;
  }
  if (type === 'rating') {
    return `综合评分 ${toNumber(item.averageRating || item.rating).toFixed(2)} · 评论量 ${toNumber(item.reviewCount)}`;
  }
  if (type === 'review') {
    return `评论量 ${toNumber(item.reviewCount)} · 综合评分 ${toNumber(item.averageRating || item.rating).toFixed(2)}`;
  }
  return `综合评分 ${toNumber(item.averageRating || item.rating).toFixed(2)} · 热度指数 ${toNumber(item.popularity)}`;
};

const openScenicDestination = (navigate: ReturnType<typeof useNavigate>, item: ScenicArea) => {
  navigate(`/scenic-area/${item.id}`);
};

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { topAttractions, rankingMeta, isLoading } = useAppSelector((state) => state.recommendation);
  const { user, isLoading: isUserSaving } = useAppSelector((state) => state.user);
  const [rankingType, setRankingType] = useState<RankingType>('popularity');
  const [isInterestModalOpen, setIsInterestModalOpen] = useState(false);
  const [selectedInterestTags, setSelectedInterestTags] = useState<string[]>([]);
  const [selectedCity, setSelectedCity] = useState<string | null>(() => restoreCityPreference(SELECTED_CITY_STORAGE_KEY));
  const [activeRecommendationCity, setActiveRecommendationCity] = useState<string | null>(() =>
    restoreCityPreference(ACTIVE_CITY_STORAGE_KEY),
  );
  const [isCityCardExpanded, setIsCityCardExpanded] = useState(false);
  const interestRefreshKey = Array.isArray(user?.interests) ? user.interests.join('|') : '';

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (selectedCity) {
      window.localStorage.setItem(SELECTED_CITY_STORAGE_KEY, selectedCity);
    } else {
      window.localStorage.removeItem(SELECTED_CITY_STORAGE_KEY);
    }
  }, [selectedCity]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (activeRecommendationCity) {
      window.localStorage.setItem(ACTIVE_CITY_STORAGE_KEY, activeRecommendationCity);
    } else {
      window.localStorage.removeItem(ACTIVE_CITY_STORAGE_KEY);
    }
  }, [activeRecommendationCity]);

  useEffect(() => {
    dispatch(
      getRankingAttractions({
        type: rankingType,
        limit: 10,
        city: activeRecommendationCity || undefined,
      }),
    );
  }, [activeRecommendationCity, dispatch, interestRefreshKey, rankingType]);

  useEffect(() => {
    const nextSelectedTags = Array.isArray(user?.interests)
      ? user.interests.filter((tag) => allInterestTags.includes(tag))
      : [];
    setSelectedInterestTags(nextSelectedTags);
  }, [user?.interests]);

  const list = useMemo(() => replaceTianjinMedicalWithBupt(topAttractions).slice(0, 10), [topAttractions]);
  const featuredList = useMemo(() => list, [list]);
  const hotList = useMemo(() => list, [list]);

  const toggleInterestTag = (tag: string) => {
    setSelectedInterestTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  };

  const handleOpenInterestModal = () => {
    setIsInterestModalOpen(true);
  };

  const handleCloseInterestModal = () => {
    setIsInterestModalOpen(false);
    const restoredTags = Array.isArray(user?.interests) ? user.interests.filter((tag) => allInterestTags.includes(tag)) : [];
    setSelectedInterestTags(restoredTags);
  };

  const handleClearInterestTags = () => {
    setSelectedInterestTags([]);
  };

  const handleSaveInterestTags = async () => {
    if (!user) {
      message.warning('请先登录后再保存兴趣画像');
      return;
    }

    try {
      await dispatch(updateInterests(selectedInterestTags)).unwrap();
      message.success('兴趣画像已保存');
      setIsInterestModalOpen(false);
    } catch (error) {
      message.error(typeof error === 'string' ? error : '保存兴趣画像失败');
    }
  };

  const handleSelectCity = (city: string) => {
    setSelectedCity(city);
  };

  const handleToggleCityCard = () => {
    setIsCityCardExpanded((current) => !current);
  };

  const handleEnterCityRecommendation = () => {
    if (!selectedCity) {
      message.warning('请先选择出发城市');
      return;
    }

    setActiveRecommendationCity(selectedCity);
    setIsCityCardExpanded(false);
    message.success(`已切换为 ${selectedCity} 城市推荐模式`);
  };

  const summaryCards = [
    {
      label: '推荐目的地',
      value: list.length,
      suffix: '个',
      hint: '当前策略下直接可浏览的前十个目的地。',
      icon: <StarOutlined style={{ color: '#0ea5e9' }} />,
      trend: '前十直达',
    },
    {
      label: '兴趣标签',
      value: user?.interests?.length || 0,
      suffix: '项',
      hint: '已保存的个性化兴趣偏好标签。',
      icon: <UserOutlined style={{ color: '#f59e0b' }} />,
      trend: resolveInterestTrend(user?.interests?.length || 0),
    },
    {
      label: '核心服务',
      value: 9,
      suffix: '项',
      hint: '覆盖推荐、查询、导航、日记、社交与提醒。',
      icon: <RiseOutlined style={{ color: '#6366f1' }} />,
      trend: '主链路已贯通',
    },
  ];

  const navigateToOverview = (section: 'recommendation' | 'ranking') => {
    navigate(`/scenic-overview?type=${rankingType}&section=${section}`);
  };

  const recommendationPanelTitle = activeRecommendationCity ? `为你推荐${activeRecommendationCity}的场所` : '为你推荐的场所';
  const recommendationPanelDescription =
    rankingType === 'personalized' && rankingMeta?.reason === 'guest_fallback'
      ? '登录后可使用个性化推荐，当前先按热度为你展示热门景点与校园。'
      : rankingType === 'personalized' && rankingMeta?.reason === 'interest_required'
        ? '你还没有完善兴趣画像，当前先按热度为你展示热门景点与校园。'
        : rankingType === 'personalized' && rankingMeta?.reason === 'no_interest_match'
          ? '当前没有符合你兴趣画像的景点或校园，请适当调整兴趣标签后再试。'
          : rankingDescMap[rankingType];
  const recommendationEmptyDescription =
    rankingType === 'personalized' && rankingMeta?.reason === 'no_interest_match'
      ? '当前没有符合你兴趣画像的景点或校园，请适当调整兴趣标签后再试。'
      : '暂无推荐数据';

  return (
    <div style={{ padding: 8, maxWidth: 1380, margin: '0 auto' }}>
      <InterestProfileModal
        open={isInterestModalOpen}
        selectedTags={selectedInterestTags}
        isSaving={isUserSaving}
        onClose={handleCloseInterestModal}
        onToggleTag={toggleInterestTag}
        onClear={handleClearInterestTags}
        onSave={handleSaveInterestTags}
      />

      <PremiumPageHero
        title="欢迎来到个性化旅游系统"
        description="把景区推荐、景区浏览、路径规划、设施查询、美食联动、室内导航和旅行日记组织成更完整的一站式旅游工作台。"
        tags={['工作台布局', '推荐 + 导航 + 内容沉浸', '地图 A / B / C 联动']}
        eyebrow="智能旅游工作台"
        sideContent={
          <CityPlanningCard
            selectedCity={selectedCity}
            activeRecommendationCity={activeRecommendationCity}
            isExpanded={isCityCardExpanded}
            onToggleExpand={handleToggleCityCard}
            onSelectCity={handleSelectCity}
            onEnterRecommendation={handleEnterCityRecommendation}
          />
        }
        actions={
          <Space wrap>
            <Button type="primary" onClick={() => navigate('/journey')}>
              浏览智能行程
            </Button>
            <Button onClick={() => navigate('/scenic-overview')}>景区总览</Button>
            <Button onClick={() => navigate('/diary')}>旅行日记</Button>
          </Space>
        }
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
        {summaryCards.map((item, index) => (
          <Col key={item.label} xs={24} sm={12} lg={8}>
            <Card
              variant="borderless"
              hoverable={index === 1}
              onClick={index === 1 ? handleOpenInterestModal : undefined}
              style={{
                borderRadius: 24,
                height: '100%',
                background: summaryCardTone[index],
                boxShadow: '0 20px 40px rgba(15,23,42,0.08)',
                border: '1px solid rgba(255,255,255,0.7)',
                cursor: index === 1 ? 'pointer' : 'default',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(255,255,255,0.72)',
                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.6)',
                    fontSize: 18,
                  }}
                >
                  {item.icon}
                </div>
                <Tag style={{ marginInlineEnd: 0, borderRadius: 999, background: 'rgba(255,255,255,0.72)' }}>
                  {item.trend}
                </Tag>
              </div>
              <Text type="secondary" style={{ letterSpacing: 0.5 }}>
                {item.label}
              </Text>
              <div style={{ marginTop: 10, fontSize: 34, fontWeight: 700, color: '#0f172a' }}>
                {item.value}
                {'suffix' in item && item.suffix ? (
                  <span style={{ fontSize: 14, marginLeft: 6, color: '#64748b' }}>{item.suffix}</span>
                ) : null}
              </div>
              <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 8 }}>
                {item.hint}
              </Paragraph>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
        <Col xs={24} xl={16}>
          <Card variant="borderless" styles={{ body: { padding: 18 } }} style={panelCardStyle}>
            <div
              style={{
                ...panelHeaderStyles.recommendation,
                padding: '22px 24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                borderRadius: 24,
                boxShadow: '0 18px 38px rgba(104,92,255,0.22)',
              }}
            >
              <div>
                <Space size={8} align="center" style={{ marginBottom: 6 }}>
                  <StarOutlined />
                  <Text style={{ color: 'rgba(255,255,255,0.82)' }}>基于你的偏好智能推荐</Text>
                </Space>
                <Title level={3} style={{ margin: 0, color: '#ffffff' }}>
                  {recommendationPanelTitle}
                </Title>
                <Text style={{ color: 'rgba(255,255,255,0.82)' }}>{recommendationPanelDescription}</Text>
              </div>
              <Button
                ghost
                style={{ borderColor: 'rgba(255,255,255,0.4)', color: '#ffffff', borderRadius: 999 }}
                onClick={() => navigateToOverview('recommendation')}
              >
                推荐更多
              </Button>
            </div>

            <div style={{ padding: '18px 4px 4px' }}>
              <Radio.Group
                value={rankingType}
                onChange={(event) => setRankingType(event.target.value as RankingType)}
                buttonStyle="solid"
                style={{ marginBottom: 18 }}
              >
                <Radio.Button value="popularity">热度</Radio.Button>
                <Radio.Button value="rating">评分</Radio.Button>
                <Radio.Button value="review">好评</Radio.Button>
                <Radio.Button value="personalized">个性化</Radio.Button>
              </Radio.Group>

              {isLoading ? (
                <Skeleton active paragraph={{ rows: 10 }} />
              ) : featuredList.length === 0 ? (
                <Empty description={recommendationEmptyDescription} />
              ) : (
                <Row gutter={[16, 16]}>
                  {featuredList.map((item, index) => {
                    const presentation = resolveScenicCoverPresentation(item);

                    return (
                      <Col key={item.id} xs={24} sm={12} xl={8}>
                        <Card
                          variant="borderless"
                          hoverable
                          onClick={() => openScenicDestination(navigate, item)}
                          style={{
                            borderRadius: 22,
                            overflow: 'hidden',
                            boxShadow: '0 16px 30px rgba(15,23,42,0.08)',
                            background: 'linear-gradient(180deg, rgba(255,255,255,1), rgba(248,250,252,0.98))',
                            border: '1px solid rgba(226,232,240,0.72)',
                            height: '100%',
                          }}
                          cover={
                            <div
                              style={{
                                height: 208,
                                padding: 14,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                color: '#fff',
                                backgroundColor: '#1e293b',
                                backgroundImage: `linear-gradient(180deg, rgba(15,23,42,0.08), rgba(15,23,42,0.72)), url(${presentation.coverImageUrl})`,
                                backgroundPosition: 'center',
                                backgroundSize: 'cover',
                                backgroundRepeat: 'no-repeat',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                                <Tag color="cyan">{presentation.cityLabel || item.category || '景区'}</Tag>
                                <Tag color={index < 3 ? 'volcano' : 'gold'}>{index < 3 ? '热门推荐' : '优先推荐'}</Tag>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-end' }}>
                                <div>
                                  <div style={{ fontSize: 12, opacity: 0.92, marginBottom: 6 }}>{presentation.coverImageTheme}</div>
                                  <Title level={4} style={{ color: '#fff', margin: 0 }}>
                                    {item.name}
                                  </Title>
                                </div>
                              </div>
                            </div>
                          }
                        >
                          <Space direction="vertical" size={10} style={{ width: '100%' }}>
                            <div
                              style={{
                                borderRadius: 999,
                                background: 'rgba(248,250,252,0.96)',
                                padding: '8px 12px',
                                border: '1px solid rgba(226,232,240,0.7)',
                              }}
                            >
                              <Space size={14} wrap>
                                <Text strong style={{ color: '#f59e0b' }}>
                                  {'★'.repeat(5)}
                                </Text>
                                <Text>评分 {toNumber(item.averageRating || item.rating).toFixed(2)}</Text>
                                <Text type="secondary">评论 {toNumber(item.reviewCount)}</Text>
                              </Space>
                            </div>
                            <Space wrap>
                              <Tag color="orange">热度指数 {toNumber(item.popularity)}</Tag>
                              <Tag color="green">适合游览</Tag>
                              <Tag color="blue">{item.category || '景区'}</Tag>
                            </Space>
                            <Paragraph ellipsis={{ rows: 2 }} type="secondary" style={{ marginBottom: 0, minHeight: 44 }}>
                              {item.description || '适合纳入当前行程安排的精选目的地。'}
                            </Paragraph>
                            <Button
                              type="primary"
                              block
                              style={{ borderRadius: 999, height: 42 }}
                              onClick={(event) => {
                                event.stopPropagation();
                                openScenicDestination(navigate, item);
                              }}
                            >
                              查看详情
                            </Button>
                          </Space>
                        </Card>
                      </Col>
                    );
                  })}
                </Row>
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card variant="borderless" styles={{ body: { padding: 18 } }} style={panelCardStyle}>
            <div
              style={{
                ...panelHeaderStyles.ranking,
                padding: '22px 24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                borderRadius: 24,
                boxShadow: '0 18px 38px rgba(255,122,89,0.18)',
              }}
            >
              <div>
                <Space size={8} align="center" style={{ marginBottom: 6 }}>
                  <FireOutlined />
                  <Text style={{ color: 'rgba(255,255,255,0.82)' }}>当前策略下的热门榜单</Text>
                </Space>
                <Title level={3} style={{ margin: 0, color: '#ffffff' }}>
                  热门场所排行
                </Title>
                <Text style={{ color: 'rgba(255,255,255,0.82)' }}>这里的排序会和显示指标保持一致，避免榜单看起来不真实。</Text>
              </div>
              <Button
                ghost
                style={{ borderColor: 'rgba(255,255,255,0.4)', color: '#ffffff', borderRadius: 999 }}
                onClick={() => navigateToOverview('ranking')}
              >
                推荐更多
              </Button>
            </div>

            <div style={{ paddingTop: 16 }}>
              {isLoading ? (
                <Skeleton active paragraph={{ rows: 10 }} />
              ) : hotList.length === 0 ? (
                <Empty description={recommendationEmptyDescription} />
              ) : (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {hotList.map((item, index) => {
                    const presentation = resolveScenicCoverPresentation(item);
                    const tone =
                      index === 0
                        ? 'linear-gradient(135deg, rgba(255,245,214,0.98), rgba(255,251,235,0.96))'
                        : index === 1
                          ? 'linear-gradient(135deg, rgba(255,238,228,0.98), rgba(255,248,243,0.96))'
                          : index === 2
                            ? 'linear-gradient(135deg, rgba(237,233,254,0.98), rgba(250,245,255,0.96))'
                            : 'rgba(248,250,252,0.94)';

                    return (
                      <div
                        key={`hot-${item.id}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '52px 1fr auto',
                          gap: 14,
                          alignItems: 'center',
                          padding: 14,
                          borderRadius: 20,
                          background: tone,
                          cursor: 'pointer',
                          border: '1px solid rgba(226,232,240,0.7)',
                          boxShadow: index < 3 ? '0 14px 28px rgba(15,23,42,0.06)' : 'none',
                        }}
                        onClick={() => openScenicDestination(navigate, item)}
                      >
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 999,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: 22,
                            color: index < 3 ? '#b45309' : '#475569',
                            background: index < 3 ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.88)',
                          }}
                        >
                          {index + 1}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <Space size={8} wrap style={{ marginBottom: 6 }}>
                            <Tag color={index < 3 ? 'gold' : 'blue'}>{presentation.cityLabel || item.category || '景区'}</Tag>
                            {index < 3 ? <Tag color="volcano">当前高位</Tag> : null}
                          </Space>
                          <Text strong style={{ display: 'block', fontSize: 20, marginBottom: 6 }}>
                            {item.name}
                          </Text>
                          <Text type="secondary" style={{ display: 'block' }}>
                            {getHomeRankingText(item, rankingType)}
                          </Text>
                        </div>
                        <Tag color={index < 3 ? 'gold' : 'blue'}>{index < 3 ? 'TOP' : presentation.cityLabel || '热门'}</Tag>
                      </div>
                    );
                  })}
                </Space>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
        {stageCards.map((card) => (
          <Col key={card.title} xs={24} lg={8}>
            <Card
              variant="borderless"
              style={{
                borderRadius: 22,
                height: '100%',
                background: `${card.accent}, #ffffff`,
                boxShadow: '0 14px 30px rgba(15,23,42,0.06)',
              }}
            >
              <Space direction="vertical" size={14} style={{ width: '100%' }}>
                <div>
                  <Title level={3} style={{ marginBottom: 4 }}>
                    {card.title}
                  </Title>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    {card.subtitle}
                  </Paragraph>
                </div>
                <Space wrap>
                  {card.tags.map((tag) => (
                    <Tag key={tag} color="blue">
                      {tag}
                    </Tag>
                  ))}
                </Space>
                <Button type="primary" onClick={() => navigate(card.to)} style={{ alignSelf: 'flex-start' }}>
                  {card.actionLabel}
                </Button>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Card variant="borderless" style={{ borderRadius: 22, marginBottom: 18, boxShadow: '0 14px 30px rgba(15,23,42,0.06)' }}>
        <div style={{ marginBottom: 14 }}>
          <Title level={3} style={{ marginBottom: 2 }}>
            三张地图入口
          </Title>
          <Text type="secondary">按照课设原文档的地图 A / B / C 结构组织核心导航入口，减少功能割裂感。</Text>
        </div>
        <Row gutter={[16, 16]}>
          {mapCards.map((card) => (
            <Col key={card.title} xs={24} md={8}>
              <Card
                variant="borderless"
                style={{
                  borderRadius: 18,
                  height: '100%',
                  background: 'linear-gradient(180deg, rgba(255,255,255,1), rgba(246,251,255,0.94))',
                  boxShadow: '0 10px 24px rgba(15,23,42,0.06)',
                }}
              >
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Title level={4} style={{ margin: 0 }}>
                    {card.title}
                  </Title>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    {card.description}
                  </Paragraph>
                  <Space wrap>
                    {card.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </Space>
                  <Button onClick={() => navigate(card.to)}>{card.actionLabel}</Button>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Card variant="borderless" style={{ borderRadius: 22, boxShadow: '0 14px 30px rgba(15,23,42,0.06)' }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} lg={16}>
            <Title level={3} style={{ marginBottom: 4 }}>
              创意增强层
            </Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              这些功能超出课设原文档，但会继续保留并与推荐、导航、日记主链路联动，增强整体体验。
            </Paragraph>
          </Col>
          <Col xs={24} lg={8}>
            <Space wrap style={{ justifyContent: 'flex-end', display: 'flex' }}>
              {creativeTags.map((tag) => (
                <Tag key={tag} color="geekblue">
                  {tag}
                </Tag>
              ))}
            </Space>
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default HomePage;
