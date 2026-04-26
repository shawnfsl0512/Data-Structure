import api from './api';

export interface ScenicArea {
  id: string;
  name: string;
  category: string;
  description?: string;
  coverImageUrl?: string;
  cityLabel?: string;
  coverImageTheme?: string;
  latitude?: number;
  longitude?: number;
  rating: number;
  visitorCount: number;
  averageRating?: number;
  popularity?: number;
  reviewCount?: number;
  tags?: string[];
}

export interface ScenicRankingMeta {
  mode: 'popularity' | 'rating' | 'review' | 'personalized';
  fallbackMode?: 'popularity';
  reason?: 'guest_fallback' | 'interest_required' | 'no_interest_match';
  city?: string | null;
  appliedCityFilter: boolean;
  matchedCount?: number;
}

export interface RecommendationExplanation {
  factors: Array<{ name: string; weight: number; explanation: string }>;
  totalScore: number;
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

export interface RecommendationService {
  getPopularityRanking: (limit?: number, city?: string) => Promise<{ success: boolean; data: ScenicArea[]; meta?: ScenicRankingMeta }>;
  getRatingRanking: (limit?: number, city?: string) => Promise<{ success: boolean; data: ScenicArea[]; meta?: ScenicRankingMeta }>;
  getReviewRanking: (limit?: number, city?: string) => Promise<{ success: boolean; data: ScenicArea[]; meta?: ScenicRankingMeta }>;
  getPersonalizedRanking: (limit?: number, city?: string) => Promise<{ success: boolean; data: ScenicArea[]; meta?: ScenicRankingMeta }>;
  getPersonalizedRecommendations: (limit?: number) => Promise<{ success: boolean; data: ScenicArea[] }>;
  getIncrementalRecommendations: (limit?: number) => Promise<{ success: boolean; data: ScenicArea[] }>;
  getExplorationRecommendations: (limit?: number) => Promise<{ success: boolean; data: ScenicArea[] }>;
  getSurpriseRecommendations: (limit?: number) => Promise<{ success: boolean; data: ScenicArea[] }>;
  getCityDestinationOptions: (limit?: number) => Promise<{ success: boolean; data: CityDestinationOption[] }>;
  generateCityTravelItinerary: (payload: {
    cityLabel: string;
    theme: CityTravelTheme;
    tripDays: number;
  }) => Promise<{ success: boolean; data: CityTravelItinerary }>;
  getRecommendationExplanation: (itemId: string) => Promise<{ success: boolean; data: RecommendationExplanation }>;
  learnUserBehavior: (itemId: string, behaviorType: string, category?: string, rating?: number) => Promise<{ success: boolean; message: string }>;
}

const recommendationService: RecommendationService = {
  getPopularityRanking: async (limit = 10, city) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (city) query.set('city', city);
    return api.get(`/recommendations/ranking/popularity?${query.toString()}`);
  },
  
  getRatingRanking: async (limit = 10, city) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (city) query.set('city', city);
    return api.get(`/recommendations/ranking/rating?${query.toString()}`);
  },
  
  getReviewRanking: async (limit = 10, city) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (city) query.set('city', city);
    return api.get(`/recommendations/ranking/review?${query.toString()}`);
  },
  
  getPersonalizedRanking: async (limit = 10, city) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (city) query.set('city', city);
    return api.get(`/recommendations/ranking/personalized?${query.toString()}`);
  },
  
  getPersonalizedRecommendations: async (limit = 10) => {
    return api.get(`/recommendations/personalized?limit=${limit}`);
  },
  
  getIncrementalRecommendations: async (limit = 5) => {
    return api.get(`/recommendations/incremental?limit=${limit}`);
  },

  getExplorationRecommendations: async (limit = 10) => {
    return api.get(`/recommendations/exploration?limit=${limit}`);
  },

  getSurpriseRecommendations: async (limit = 5) => {
    return api.get(`/recommendations/surprise?limit=${limit}`);
  },

  getCityDestinationOptions: async (limit = 12) => {
    return api.get(`/recommendations/cities?limit=${limit}`);
  },

  generateCityTravelItinerary: async (payload) => {
    return api.post('/recommendations/city-itinerary', payload);
  },

  getRecommendationExplanation: async (itemId) => {
    return api.get(`/recommendations/explanation?itemId=${encodeURIComponent(itemId)}`);
  },
  
  learnUserBehavior: async (itemId, behaviorType, category, rating) => {
    return api.post('/recommendations/learn-behavior', { itemId, behaviorType, category, rating });
  }
};

export default recommendationService;
