import express from 'express';
import { RecommendationService } from '../services/RecommendationService';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';

const router = express.Router();
const recommendationService = new RecommendationService();

const parseOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

router.get('/cities', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 12;
    const cities = await recommendationService.getCityDestinationOptions(limit);
    res.status(200).json({
      success: true,
      data: cities,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.post('/city-itinerary', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { cityLabel, theme, tripDays } = req.body || {};

    if (!cityLabel || typeof cityLabel !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMS',
          message: 'cityLabel is required',
        },
      });
    }

    const itinerary = await recommendationService.generateCityTravelItinerary(
      userId,
      cityLabel.trim(),
      theme || 'comprehensive',
      Number(tripDays || 1),
    );

    res.status(200).json({
      success: true,
      data: itinerary,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/ranking/popularity', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : undefined;
    const result = await recommendationService.getPopularityRanking(limit, city);
    res.status(200).json({
      success: true,
      data: result.items,
      meta: result.meta,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/ranking/rating', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : undefined;
    const result = await recommendationService.getRatingRanking(limit, city);
    res.status(200).json({
      success: true,
      data: result.items,
      meta: result.meta,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/ranking/review', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : undefined;
    const result = await recommendationService.getReviewRanking(limit, city);
    res.status(200).json({
      success: true,
      data: result.items,
      meta: result.meta,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/ranking/personalized', optionalAuthMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : undefined;
    const result = await recommendationService.getPersonalizedRanking(userId, limit, city);
    res.status(200).json({
      success: true,
      data: result.items,
      meta: result.meta,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/personalized', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const recommendations = await recommendationService.getPersonalizedRecommendations(userId, limit);
    res.status(200).json({
      success: true,
      data: recommendations,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/attractions/top-k', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const latitude = parseOptionalNumber(req.query.latitude);
    const longitude = parseOptionalNumber(req.query.longitude);
    const recommendations = await recommendationService.getTopKAttractionRecommendations(
      userId,
      limit,
      typeof latitude === 'number' && typeof longitude === 'number'
        ? { latitude, longitude }
        : undefined,
    );

    res.status(200).json({
      success: true,
      data: recommendations,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/attractions/by-tags', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const recommendations = await recommendationService.getTagBasedAttractionRecommendations(userId, limit);

    res.status(200).json({
      success: true,
      data: recommendations,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/incremental', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const limit = parseInt(req.query.limit as string, 10) || 5;
    const recommendations = await recommendationService.getIncrementalRecommendations(userId, limit);
    res.status(200).json({
      success: true,
      data: recommendations,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.post('/learn-behavior', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { itemId, behaviorType, category, rating } = req.body;
    await recommendationService.learnUserBehavior(userId, { itemId, behaviorType, category, rating });
    res.status(200).json({
      success: true,
      message: 'User behavior learned successfully',
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: {
        code: 'BEHAVIOR_LEARNING_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/exploration', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const recommendations = await recommendationService.getExplorationRecommendation(userId, limit);
    res.status(200).json({
      success: true,
      data: recommendations,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/surprise', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const limit = parseInt(req.query.limit as string, 10) || 5;
    const recommendations = await recommendationService.getSurpriseRecommendation(userId, limit);
    res.status(200).json({
      success: true,
      data: recommendations,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/time-aware', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const recommendations = await recommendationService.getTimeAwareRecommendation(userId, limit);
    res.status(200).json({
      success: true,
      data: recommendations,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/seasonal', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const recommendations = await recommendationService.getSeasonalRecommendation(userId, limit);
    res.status(200).json({
      success: true,
      data: recommendations,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/food', async (req, res) => {
  try {
    const locationId = req.query.locationId as string;
    const userId = (req as any).user?.userId;
    const cuisine = req.query.cuisine as string;
    const limit = parseInt(req.query.limit as string, 10) || 10;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMS',
          message: 'locationId is required',
        },
      });
    }

    const recommendations = await recommendationService.getFoodRecommendation(locationId, userId, cuisine, limit);
    res.status(200).json({
      success: true,
      data: recommendations,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/diary', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const recommendations = await recommendationService.getDiaryRecommendation(userId, limit);
    res.status(200).json({
      success: true,
      data: recommendations,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RECOMMENDATION_FAILED',
        message: error.message,
      },
    });
  }
});

router.get('/explanation', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const itemId = req.query.itemId as string;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMS',
          message: 'itemId is required',
        },
      });
    }

    const explanation = await recommendationService.getRecommendationExplanation(userId, itemId);
    res.status(200).json({
      success: true,
      data: explanation,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'EXPLANATION_FAILED',
        message: error.message,
      },
    });
  }
});

export default router;
