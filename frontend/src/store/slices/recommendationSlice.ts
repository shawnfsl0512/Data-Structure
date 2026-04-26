import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import recommendationService, { ScenicArea, ScenicRankingMeta } from '../../services/recommendationService';
import { resolveErrorMessage } from '../../utils/errorMessage';

export type RankingType = 'popularity' | 'rating' | 'review' | 'personalized';

export interface RecommendationState {
  topAttractions: ScenicArea[];
  rankingMeta: ScenicRankingMeta | null;
  personalizedRecommendations: ScenicArea[];
  incrementalRecommendations: ScenicArea[];
  isLoading: boolean;
  error: string | null;
}

const initialState: RecommendationState = {
  topAttractions: [],
  rankingMeta: null,
  personalizedRecommendations: [],
  incrementalRecommendations: [],
  isLoading: false,
  error: null,
};

export const getTopAttractions = createAsyncThunk(
  'recommendation/getTopAttractions',
  async (limit: number = 10, { rejectWithValue }) => {
    const fallbackMessage = '获取热门景区失败';
    try {
      const response = await recommendationService.getPopularityRanking(limit);
      if (response.success) {
        return response.data;
      }
      return rejectWithValue(fallbackMessage);
    } catch (error) {
      return rejectWithValue(resolveErrorMessage(error, fallbackMessage));
    }
  },
);

export const getRankingAttractions = createAsyncThunk(
  'recommendation/getRankingAttractions',
  async ({ type, limit = 10, city }: { type: RankingType; limit?: number; city?: string }, { rejectWithValue }) => {
    const fallbackMessage = '????????';
    try {
      const response =
        type === 'rating'
          ? await recommendationService.getRatingRanking(limit, city)
          : type === 'review'
            ? await recommendationService.getReviewRanking(limit, city)
            : type === 'personalized'
              ? await recommendationService.getPersonalizedRanking(limit, city)
              : await recommendationService.getPopularityRanking(limit, city);

      if (response.success) {
        return { data: response.data, meta: response.meta || null };
      }
      return rejectWithValue(fallbackMessage);
    } catch (error) {
      if (type === 'personalized') {
        try {
          const fallbackResponse = await recommendationService.getPopularityRanking(limit, city);
          if (fallbackResponse.success) {
            return { data: fallbackResponse.data, meta: fallbackResponse.meta || null };
          }
        } catch {
          return rejectWithValue('?????????????????????');
        }
      }

      return rejectWithValue(resolveErrorMessage(error, fallbackMessage));
    }
  },
);

export const getPersonalizedRecommendations = createAsyncThunk(
  'recommendation/getPersonalizedRecommendations',
  async (limit: number = 10, { rejectWithValue }) => {
    const fallbackMessage = '????????';
    try {
      const response = await recommendationService.getPersonalizedRecommendations(limit);
      if (response.success) {
        return response.data;
      }
      return rejectWithValue(fallbackMessage);
    } catch (error) {
      return rejectWithValue(resolveErrorMessage(error, fallbackMessage));
    }
  },
);

export const getIncrementalRecommendations = createAsyncThunk(
  'recommendation/getIncrementalRecommendations',
  async (limit: number = 5, { rejectWithValue }) => {
    const fallbackMessage = '????????';
    try {
      const response = await recommendationService.getIncrementalRecommendations(limit);
      if (response.success) {
        return response.data;
      }
      return rejectWithValue(fallbackMessage);
    } catch (error) {
      return rejectWithValue(resolveErrorMessage(error, fallbackMessage));
    }
  },
);

export const learnUserBehavior = createAsyncThunk(
  'recommendation/learnUserBehavior',
  async (
    {
      itemId,
      behaviorType,
      category,
      rating,
    }: { itemId: string; behaviorType: string; category?: string; rating?: number },
    { rejectWithValue },
  ) => {
    const fallbackMessage = '????????';
    try {
      const response = await recommendationService.learnUserBehavior(
        itemId,
        behaviorType,
        category,
        rating,
      );
      if (response.success) {
        return response.message;
      }
      return rejectWithValue(fallbackMessage);
    } catch (error) {
      return rejectWithValue(resolveErrorMessage(error, fallbackMessage));
    }
  },
);

const recommendationSlice = createSlice({
  name: 'recommendation',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getTopAttractions.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(getTopAttractions.fulfilled, (state, action) => {
        state.isLoading = false;
        state.topAttractions = action.payload;
      })
      .addCase(getTopAttractions.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      .addCase(getRankingAttractions.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(getRankingAttractions.fulfilled, (state, action) => {
        state.isLoading = false;
        state.topAttractions = action.payload.data;
        state.rankingMeta = action.payload.meta;
      })
      .addCase(getRankingAttractions.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
        state.rankingMeta = null;
      })
      .addCase(getPersonalizedRecommendations.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(getPersonalizedRecommendations.fulfilled, (state, action) => {
        state.isLoading = false;
        state.personalizedRecommendations = action.payload;
      })
      .addCase(getPersonalizedRecommendations.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      .addCase(getIncrementalRecommendations.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(getIncrementalRecommendations.fulfilled, (state, action) => {
        state.isLoading = false;
        state.incrementalRecommendations = action.payload;
      })
      .addCase(getIncrementalRecommendations.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      .addCase(learnUserBehavior.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(learnUserBehavior.fulfilled, (state) => {
        state.isLoading = false;
      })
      .addCase(learnUserBehavior.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });
  },
});

export const { clearError } = recommendationSlice.actions;
export default recommendationSlice.reducer;
