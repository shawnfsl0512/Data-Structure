import { AppDataSource, initializeDatabase } from '../config/database';
import { ScenicArea } from '../entities/ScenicArea';
import { mapTemplateRuntimeService } from '../services/MapTemplateRuntimeService';

const main = async () => {
  await initializeDatabase();
  if (!AppDataSource?.isInitialized) {
    throw new Error('Database not initialized');
  }

  await mapTemplateRuntimeService.ensureTemplatesPersisted();

  const scenicAreaIds = (
    await AppDataSource.getRepository(ScenicArea).createQueryBuilder('scenic').select('scenic.id', 'id').getRawMany<{ id: string }>()
  ).map((item) => item.id);

  if (scenicAreaIds.length) {
    const placeholders = scenicAreaIds.map(() => '?').join(',');
    const facilitySubquery = `select id from facilities where scenicAreaId in (${placeholders})`;
    await AppDataSource.query(
      `delete from foods where facilityId in (${facilitySubquery})`,
      scenicAreaIds,
    );
    await AppDataSource.query(
      `delete from photo_spots where scenicAreaId in (${placeholders})`,
      scenicAreaIds,
    );
    await AppDataSource.query(
      `delete from road_graph_edges where scenicAreaId in (${placeholders})`,
      scenicAreaIds,
    );
    await AppDataSource.query(
      `delete from road_graph_nodes where scenicAreaId in (${placeholders})`,
      scenicAreaIds,
    );
    await AppDataSource.query(
      `delete from attractions where scenicAreaId in (${placeholders})`,
      scenicAreaIds,
    );
    await AppDataSource.query(
      `delete from facilities where scenicAreaId in (${placeholders})`,
      scenicAreaIds,
    );
  }

  await AppDataSource.query('VACUUM');

  const summary = await Promise.all([
    AppDataSource.query('select count(*) as count from map_templates'),
    AppDataSource.query('select count(*) as count from attractions'),
    AppDataSource.query('select count(*) as count from facilities'),
    AppDataSource.query('select count(*) as count from road_graph_nodes'),
    AppDataSource.query('select count(*) as count from road_graph_edges'),
  ]);

  console.log(
    JSON.stringify(
      {
        mapTemplates: Number(summary[0]?.[0]?.count || 0),
        attractions: Number(summary[1]?.[0]?.count || 0),
        facilities: Number(summary[2]?.[0]?.count || 0),
        roadGraphNodes: Number(summary[3]?.[0]?.count || 0),
        roadGraphEdges: Number(summary[4]?.[0]?.count || 0),
      },
      null,
      2,
    ),
  );
};

main()
  .catch((error) => {
    console.error('Failed to migrate internal maps to runtime templates:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (AppDataSource?.isInitialized) {
      await AppDataSource.destroy();
    }
  });
