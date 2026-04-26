import api from './api';

export interface ScenicArea {
  id: string;
  name: string;
  category: string;
  city?: string | null;
  description?: string;
  coverImageUrl?: string;
  cityLabel?: string;
  coverImageTheme?: string;
  latitude?: number;
  longitude?: number;
  rating: number;
  visitorCount: number;
  tags?: string[];
  averageRating?: number;
  popularity?: number;
  reviewCount?: number;
  ticketPrice?: number;
}

export interface Facility {
  id: string;
  name: string;
  category: string;
  latitude?: number;
  longitude?: number;
  description?: string;
  distanceKm?: number;
  distanceSource?: 'road_network' | 'haversine';
  scenicAreaId?: string;
}

export interface Attraction {
  id: string;
  name: string;
  category: string;
  city?: string | null;
  description?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  type?: string;
  cuisine?: string;
  scenicAreaId?: string;
}

export interface SearchResult {
  scenicAreas: ScenicArea[];
  attractions: Attraction[];
  facilities: Facility[];
}

export interface ScenicAreaDetails {
  scenicArea: ScenicArea;
  attractions: Attraction[];
  facilities: Facility[];
}

export interface ImportResult {
  scenicAreas: number;
  attractions: number;
  facilities: number;
}

export interface ScenicAreaSearchParams {
  name?: string;
  categories?: string[];
  minRating?: number;
  limit?: number;
}

export interface QueryService {
  getScenicAreaDetails: (id: string) => Promise<{ success: boolean; data: ScenicAreaDetails }>;
  searchScenicAreas: (params: ScenicAreaSearchParams) => Promise<{ success: boolean; data: ScenicArea[] }>;
  searchScenicAreaSuggestions: (prefix: string, limit?: number) => Promise<{ success: boolean; data: string[] }>;
  getScenicAreaCategories: () => Promise<{ success: boolean; data: string[] }>;
  searchFacilities: (params: {
    type?: string;
    scenicAreaId?: string;
    limit?: number;
    latitude?: number;
    longitude?: number;
    radiusKm?: number;
  }) => Promise<{ success: boolean; data: Facility[] }>;
  searchFood: (query: string, limit?: number) => Promise<{ success: boolean; data: Attraction[] }>;
  search: (query: string, limit?: number) => Promise<{ success: boolean; data: SearchResult }>;
  searchScenicAreasByCategory: (category: string, limit?: number) => Promise<{ success: boolean; data: ScenicArea[] }>;
  searchScenicAreasByTag: (tag: string, limit?: number) => Promise<{ success: boolean; data: ScenicArea[] }>;
  exportScenicAreaData: () => Promise<Blob>;
  importScenicAreaData: (payload: unknown) => Promise<{ success: boolean; data: ImportResult }>;
}

const queryService: QueryService = {
  getScenicAreaDetails: async (id) => {
    return api.get(`/query/scenic-area/${id}`);
  },

  searchScenicAreas: async ({ name, categories = [], minRating, limit = 10 }) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (name?.trim()) {
      params.set('name', name.trim());
    }
    for (const category of categories) {
      if (category.trim()) {
        params.append('category', category.trim());
      }
    }
    if (typeof minRating === 'number' && Number.isFinite(minRating)) {
      params.set('min_rating', String(minRating));
    }
    return api.get(`/query/scenic-areas?${params.toString()}`);
  },

  searchScenicAreaSuggestions: async (prefix, limit = 10) => {
    return api.get(
      `/query/scenic-areas/suggestions?prefix=${encodeURIComponent(prefix)}&limit=${limit}`,
    );
  },

  getScenicAreaCategories: async () => {
    return api.get('/query/scenic-areas/categories');
  },

  searchFacilities: async ({ type, scenicAreaId, limit = 10, latitude, longitude, radiusKm }) => {
    let url = `/query/facilities?limit=${limit}`;
    if (type) url += `&type=${encodeURIComponent(type)}`;
    if (scenicAreaId) url += `&scenicAreaId=${encodeURIComponent(scenicAreaId)}`;
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      url += `&latitude=${latitude}&longitude=${longitude}`;
    }
    if (typeof radiusKm === 'number' && Number.isFinite(radiusKm) && radiusKm > 0) {
      url += `&radiusKm=${radiusKm}`;
    }
    return api.get(url);
  },

  searchFood: async (query, limit = 10) => {
    return api.get(`/query/food?query=${encodeURIComponent(query)}&limit=${limit}`);
  },

  search: async (query, limit = 15) => {
    return api.get(`/query/search?query=${encodeURIComponent(query)}&limit=${limit}`);
  },

  searchScenicAreasByCategory: async (category, limit = 10) => {
    return api.get(`/query/scenic-areas-by-category?category=${encodeURIComponent(category)}&limit=${limit}`);
  },

  searchScenicAreasByTag: async (tag, limit = 10) => {
    return api.get(`/query/scenic-areas-by-tag?tag=${encodeURIComponent(tag)}&limit=${limit}`);
  },

  exportScenicAreaData: async () => {
    return api.get('/query/export-data', { responseType: 'blob' });
  },

  importScenicAreaData: async (payload) => {
    return api.post('/query/import-data', payload);
  },
};

export default queryService;
