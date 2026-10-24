import { Prisma } from '@prisma/client';

export function dailyWindowSql(start: Prisma.Sql, end: Prisma.Sql) {
  return Prisma.sql`CASE WHEN ${start}=${end} THEN true WHEN ${start}<${end}
    THEN to_char(now() AT TIME ZONE 'Asia/Shanghai','HH24:MI')>=${start} AND to_char(now() AT TIME ZONE 'Asia/Shanghai','HH24:MI')<${end}
    ELSE to_char(now() AT TIME ZONE 'Asia/Shanghai','HH24:MI')>=${start} OR to_char(now() AT TIME ZONE 'Asia/Shanghai','HH24:MI')<${end} END`;
}
/** Same Shanghai window as library-core, evaluated at the database clock before claiming. */
export function backgroundScheduleSql(owner: Prisma.Sql, mode: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM (VALUES(1)) singleton(n)
    LEFT JOIN "EagleProcessingSetting" schedule ON schedule."ownerId"=${owner} AND schedule."libraryMode"=${mode}
    WHERE COALESCE(schedule.mode,'NIGHT')='ALWAYS'
      OR (COALESCE(schedule.mode,'NIGHT')='NIGHT' AND
        ${dailyWindowSql(Prisma.sql`COALESCE(schedule."nightStart",'23:00')`, Prisma.sql`COALESCE(schedule."nightEnd",'06:00')`)})
  )`;
}
