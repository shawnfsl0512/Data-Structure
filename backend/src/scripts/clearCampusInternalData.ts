import path from 'path';
import sqlite3 from 'sqlite3';

type CountRow = {
  count: number;
};

const DB_PATH = path.resolve(__dirname, '../../travel_system.db');

const run = (db: sqlite3.Database, sql: string, params: unknown[] = []) =>
  new Promise<void>((resolvePromise, rejectPromise) => {
    db.run(sql, params, (error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });

const get = <T>(db: sqlite3.Database, sql: string, params: unknown[] = []) =>
  new Promise<T | undefined>((resolvePromise, rejectPromise) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise(row as T | undefined);
    });
  });

const all = <T>(db: sqlite3.Database, sql: string, params: unknown[] = []) =>
  new Promise<T[]>((resolvePromise, rejectPromise) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise(rows as T[]);
    });
  });

const campusCategorySql = `
  select category as campusCategory
  from scenic_areas
  where rowid = 11
  limit 1
`;

const campusIdsSql = `
  select id
  from scenic_areas
  where category = (${campusCategorySql})
`;

const countsSql = `
  select
    (select count(*) from attractions where scenicAreaId in (${campusIdsSql})) as attractions,
    (select count(*) from facilities where scenicAreaId in (${campusIdsSql})) as facilities,
    (select count(*) from photo_spots where scenicAreaId in (${campusIdsSql})) as photo_spots,
    (select count(*) from road_graph_nodes where scenicAreaId in (${campusIdsSql})) as road_graph_nodes,
    (select count(*) from road_graph_edges where scenicAreaId in (${campusIdsSql})) as road_graph_edges,
    (select count(*) from foods where facilityId in (select id from facilities where scenicAreaId in (${campusIdsSql}))) as foods
`;

const main = async () => {
  const db = new sqlite3.Database(DB_PATH);

  try {
    const campusCount = await get<CountRow>(
      db,
      `select count(*) as count from scenic_areas where category = (${campusCategorySql})`,
    );

    if (!campusCount?.count) {
      throw new Error('未找到校园主记录，取消清理。');
    }

    const beforeCounts = await get<Record<string, number>>(db, countsSql);
    const campusIds = await all<{ id: string }>(db, campusIdsSql);

    await run(db, 'BEGIN TRANSACTION');
    await run(
      db,
      `delete from foods where facilityId in (select id from facilities where scenicAreaId in (${campusIdsSql}))`,
    );
    await run(db, `delete from photo_spots where scenicAreaId in (${campusIdsSql})`);
    await run(db, `delete from road_graph_edges where scenicAreaId in (${campusIdsSql})`);
    await run(db, `delete from road_graph_nodes where scenicAreaId in (${campusIdsSql})`);
    await run(db, `delete from attractions where scenicAreaId in (${campusIdsSql})`);
    await run(db, `delete from facilities where scenicAreaId in (${campusIdsSql})`);
    await run(db, 'COMMIT');

    const afterCounts = await get<Record<string, number>>(db, countsSql);

    console.log(
      JSON.stringify(
        {
          database: DB_PATH,
          campusCount: campusCount.count,
          campusIds: campusIds.map((item) => item.id),
          beforeCounts,
          afterCounts,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    try {
      await run(db, 'ROLLBACK');
    } catch {
      // Ignore rollback failures when transaction never started.
    }
    throw error;
  } finally {
    db.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
