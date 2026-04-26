import dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database';
import { ScenicArea } from '../entities/ScenicArea';
import { buildScenicClassificationTags } from '../utils/scenicTagging';

dotenv.config();

async function refreshScenicTags() {
  const dataSource = new DataSource(createDatabaseOptions());

  try {
    await dataSource.initialize();
    const scenicRepo = dataSource.getRepository(ScenicArea);
    const scenicAreas = await scenicRepo.find();

    for (const scenicArea of scenicAreas) {
      scenicArea.tags = buildScenicClassificationTags({
        name: scenicArea.name,
        category: scenicArea.category,
        description: scenicArea.description,
        city: scenicArea.city,
      }).join(',');
    }

    await scenicRepo.save(scenicAreas);
    console.log(`已刷新 ${scenicAreas.length} 条景区/校园标签。`);
  } catch (error) {
    console.error('刷新景区/校园标签失败:', error);
    process.exitCode = 1;
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

void refreshScenicTags();
