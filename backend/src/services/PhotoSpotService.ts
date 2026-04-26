import { In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Attraction } from '../entities/Attraction';
import { PhotoCheckin } from '../entities/PhotoCheckin';
import { PhotoSpot } from '../entities/PhotoSpot';
import { ScenicArea } from '../entities/ScenicArea';
import { mapTemplateRuntimeService } from './MapTemplateRuntimeService';

function getPhotoSpotRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(PhotoSpot);
}

function getPhotoCheckinRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(PhotoCheckin);
}

function getAttractionRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(Attraction);
}

function getScenicAreaRepository() {
  if (!AppDataSource) {
    throw new Error('Database not initialized');
  }
  return AppDataSource.getRepository(ScenicArea);
}

type CrowdLevel = 'low' | 'medium' | 'high';
type LightingCondition = 'excellent' | 'good' | 'fair' | 'poor';

export class PhotoSpotService {
  async getPhotoSpotsByScenicArea(scenicAreaId: string): Promise<Array<{
    id: string;
    scenicAreaId: string;
    attractionId: string | null;
    name: string;
    location: { latitude: number; longitude: number };
    bestTime: string;
    description: string;
    examplePhotos: string[];
    popularity: number;
    crowdLevel: CrowdLevel;
    lightingCondition: LightingCondition;
  }>> {
    const photoSpotRepository = getPhotoSpotRepository();

    let spots = await photoSpotRepository.find({
      where: { scenicAreaId },
      order: { popularity: 'DESC', createdAt: 'ASC' },
    });

    if (!spots.length) {
      const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId);
      if (runtimeMap?.photoSpots.length) {
        spots = runtimeMap.photoSpots;
      } else {
        await this.generateDefaultPhotoSpots(scenicAreaId);
        spots = await photoSpotRepository.find({
          where: { scenicAreaId },
          order: { popularity: 'DESC', createdAt: 'ASC' },
        });
      }
    }

    return spots.map((spot) => ({
      id: spot.id,
      scenicAreaId: spot.scenicAreaId,
      attractionId: spot.attractionId,
      name: spot.name,
      location: {
        latitude: Number(spot.latitude),
        longitude: Number(spot.longitude),
      },
      bestTime: spot.bestTime || this.computeBestTime(spot.crowdLevel, spot.lightingCondition, new Date()),
      description: spot.description || '',
      examplePhotos: this.parseExamplePhotos(spot.examplePhotos),
      popularity: spot.popularity || 0,
      crowdLevel: spot.crowdLevel,
      lightingCondition: spot.lightingCondition,
    }));
  }

  async calculateBestPhotoTime(photoSpotId: string): Promise<string> {
    const photoSpotRepository = getPhotoSpotRepository();
    const spot = await photoSpotRepository.findOne({ where: { id: photoSpotId } });
    const runtimeSpot = spot ?? (await this.resolveRuntimePhotoSpot(photoSpotId));
    if (!runtimeSpot) {
      throw new Error('Photo spot not found');
    }

    const bestTime = this.computeBestTime(runtimeSpot.crowdLevel, runtimeSpot.lightingCondition, new Date());
    if (spot && spot.bestTime !== bestTime) {
      spot.bestTime = bestTime;
      await photoSpotRepository.save(spot);
    }
    return bestTime;
  }

  async uploadCheckinPhoto(
    photoSpotId: string,
    data: { photoUrl: string; caption?: string; userId?: string | null },
  ): Promise<{
    id: string;
    userId: string | null;
    photoSpotId: string;
    photoUrl: string;
    caption: string;
    timestamp: string;
    likes: number;
  }> {
    const photoSpotRepository = getPhotoSpotRepository();
    const photoCheckinRepository = getPhotoCheckinRepository();

    const spot = await photoSpotRepository.findOne({ where: { id: photoSpotId } });
    const runtimeSpot = spot ?? (await this.resolveRuntimePhotoSpot(photoSpotId));
    if (!runtimeSpot) {
      throw new Error('Photo spot not found');
    }

    const checkin = photoCheckinRepository.create({
      photoSpotId,
      userId: data.userId ?? null,
      photoUrl: data.photoUrl,
      caption: data.caption || '',
      likes: 0,
    });
    const savedCheckin = await photoCheckinRepository.save(checkin);

    if (spot) {
      spot.popularity = (spot.popularity || 0) + 1;
      await photoSpotRepository.save(spot);
    }

    return {
      id: savedCheckin.id,
      userId: savedCheckin.userId,
      photoSpotId: savedCheckin.photoSpotId,
      photoUrl: savedCheckin.photoUrl,
      caption: savedCheckin.caption || '',
      timestamp: savedCheckin.createdAt.toISOString(),
      likes: savedCheckin.likes || 0,
    };
  }

  async getCheckinStats(photoSpotId: string): Promise<{
    totalCheckins: number;
    recentCheckins: Array<{
      id: string;
      userId: string | null;
      photoSpotId: string;
      photoUrl: string;
      caption: string;
      timestamp: string;
      likes: number;
    }>;
  }> {
    const photoCheckinRepository = getPhotoCheckinRepository();

    const [totalCheckins, recentCheckins] = await Promise.all([
      photoCheckinRepository.count({ where: { photoSpotId } }),
      photoCheckinRepository.find({
        where: { photoSpotId },
        order: { createdAt: 'DESC' },
        take: 8,
      }),
    ]);

    return {
      totalCheckins,
      recentCheckins: recentCheckins.map((checkin) => ({
        id: checkin.id,
        userId: checkin.userId,
        photoSpotId: checkin.photoSpotId,
        photoUrl: checkin.photoUrl,
        caption: checkin.caption || '',
        timestamp: checkin.createdAt.toISOString(),
        likes: checkin.likes || 0,
      })),
    };
  }

  async getPopularPhotos(scenicAreaId: string, limit: number = 9): Promise<Array<{
    id: string;
    userId: string | null;
    photoSpotId: string;
    photoUrl: string;
    caption: string;
    timestamp: string;
    likes: number;
  }>> {
    const photoSpotRepository = getPhotoSpotRepository();
    const photoCheckinRepository = getPhotoCheckinRepository();

    const spots = await photoSpotRepository.find({ where: { scenicAreaId }, select: ['id'] });
    if (!spots.length) {
      const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId);
      if (!runtimeMap?.photoSpots.length) {
        return [];
      }
      const ids = runtimeMap.photoSpots.map((item) => item.id);
      const checkins = await photoCheckinRepository.find({
        where: { photoSpotId: In(ids) },
        order: { likes: 'DESC', createdAt: 'DESC' },
        take: limit,
      });

      return checkins.map((checkin) => ({
        id: checkin.id,
        userId: checkin.userId,
        photoSpotId: checkin.photoSpotId,
        photoUrl: checkin.photoUrl,
        caption: checkin.caption || '',
        timestamp: checkin.createdAt.toISOString(),
        likes: checkin.likes || 0,
      }));
    }
    const ids = spots.map((item) => item.id);

    const checkins = await photoCheckinRepository.find({
      where: { photoSpotId: In(ids) },
      order: { likes: 'DESC', createdAt: 'DESC' },
      take: limit,
    });

    return checkins.map((checkin) => ({
      id: checkin.id,
      userId: checkin.userId,
      photoSpotId: checkin.photoSpotId,
      photoUrl: checkin.photoUrl,
      caption: checkin.caption || '',
      timestamp: checkin.createdAt.toISOString(),
      likes: checkin.likes || 0,
    }));
  }

  private async resolveRuntimePhotoSpot(photoSpotId: string): Promise<PhotoSpot | null> {
    const parts = String(photoSpotId || '').split('|');
    if (parts.length < 5 || parts[0] !== 'rt') {
      return null;
    }
    const scenicAreaId = parts[3];
    if (!scenicAreaId) {
      return null;
    }
    const runtimeMap = await mapTemplateRuntimeService.getRuntimeMapForScenicAreaId(scenicAreaId);
    return runtimeMap?.photoSpots.find((item) => item.id === photoSpotId) || null;
  }

  private async generateDefaultPhotoSpots(scenicAreaId: string): Promise<void> {
    const attractionRepository = getAttractionRepository();
    const scenicAreaRepository = getScenicAreaRepository();
    const photoSpotRepository = getPhotoSpotRepository();

    const attractions = await attractionRepository.find({
      where: { scenicAreaId },
      order: { averageRating: 'DESC', reviewCount: 'DESC' },
      take: 12,
    });

    const withLocation = attractions.filter(
      (item) => item.latitude !== null && item.latitude !== undefined && item.longitude !== null && item.longitude !== undefined,
    );

    const crowdPattern: CrowdLevel[] = ['low', 'medium', 'high', 'medium'];
    const lightingPattern: LightingCondition[] = ['excellent', 'good', 'fair', 'good'];
    const spotSeeds = withLocation.slice(0, 4);

    const spotsToSave: PhotoSpot[] = [];
    for (let i = 0; i < spotSeeds.length; i += 1) {
      const attraction = spotSeeds[i];
      const crowdLevel = crowdPattern[i % crowdPattern.length];
      const lightingCondition = lightingPattern[i % lightingPattern.length];
      const bestTime = this.computeBestTime(crowdLevel, lightingCondition, new Date());
      const photos = [
        `https://picsum.photos/seed/${attraction.id}-a/800/500`,
        `https://picsum.photos/seed/${attraction.id}-b/800/500`,
        `https://picsum.photos/seed/${attraction.id}-c/800/500`,
      ];

      spotsToSave.push(
        photoSpotRepository.create({
          scenicAreaId,
          attractionId: attraction.id,
          name: `${attraction.name}摄影位`,
          description: `${attraction.name}附近视野开阔，适合拍摄环境人像与风景构图。`,
          latitude: Number(attraction.latitude),
          longitude: Number(attraction.longitude),
          bestTime,
          popularity: Math.max(10, Number(attraction.reviewCount || 0)),
          crowdLevel,
          lightingCondition,
          examplePhotos: JSON.stringify(photos),
        }),
      );
    }

    if (!spotsToSave.length) {
      const scenic = await scenicAreaRepository.findOne({ where: { id: scenicAreaId } });
      if (!scenic || scenic.latitude === null || scenic.longitude === null) {
        return;
      }
      const fallbackPhotos = [
        `https://picsum.photos/seed/${scenicAreaId}-a/800/500`,
        `https://picsum.photos/seed/${scenicAreaId}-b/800/500`,
      ];
      spotsToSave.push(
        photoSpotRepository.create({
          scenicAreaId,
          attractionId: null,
          name: `${scenic.name}主景观位`,
          description: '景区核心景观位，适合拍摄到访打卡照。',
          latitude: Number(scenic.latitude),
          longitude: Number(scenic.longitude),
          bestTime: this.computeBestTime('medium', 'good', new Date()),
          popularity: 20,
          crowdLevel: 'medium',
          lightingCondition: 'good',
          examplePhotos: JSON.stringify(fallbackPhotos),
        }),
      );
    }

    if (spotsToSave.length) {
      await photoSpotRepository.save(spotsToSave);
    }
  }

  private computeBestTime(crowdLevel: CrowdLevel, lightingCondition: LightingCondition, date: Date): string {
    const month = date.getMonth() + 1;

    const seasonRange =
      month >= 3 && month <= 5
        ? { morning: '07:00-09:30', evening: '16:30-18:30' }
        : month >= 6 && month <= 8
          ? { morning: '06:00-08:30', evening: '18:00-19:30' }
          : month >= 9 && month <= 11
            ? { morning: '07:30-10:00', evening: '16:00-18:00' }
            : { morning: '09:00-11:00', evening: '14:00-16:30' };

    if (lightingCondition === 'excellent') {
      return seasonRange.morning;
    }
    if (crowdLevel === 'high') {
      return seasonRange.evening;
    }
    if (lightingCondition === 'poor') {
      return '建议晴天拍摄，推荐 10:00-12:00';
    }
    return `${seasonRange.morning} / ${seasonRange.evening}`;
  }

  private parseExamplePhotos(raw: string): string[] {
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
      return [];
    } catch {
      return [];
    }
  }
}

