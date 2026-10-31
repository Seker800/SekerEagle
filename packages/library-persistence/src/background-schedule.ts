import { Prisma } from '@prisma/client';

export function dailyWindowSql(
  start: Prisma.Sql,
  end: Prisma.Sql,
  clock: Prisma.Sql = Prisma.sql`now()`,
) {
  const current = Prisma.sql`to_char(${clock} AT TIME ZONE 'Asia/Shanghai','HH24:MI')`;
  return Prisma.sql`CASE
    WHEN ${start} IS NULL OR ${end} IS NULL
      OR ${start} !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR ${end} !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN false
    WHEN ${start}=${end} THEN true
    WHEN ${start}<${end} THEN ${current}>=${start} AND ${current}<${end}
    ELSE ${current}>=${start} OR ${current}<${end} END`;
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
