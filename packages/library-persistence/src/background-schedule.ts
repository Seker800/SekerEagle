import { Prisma } from '@prisma/client';

/** Same Shanghai window as library-core, evaluated at the database clock before claiming. */
export function backgroundScheduleSql(owner: Prisma.Sql, mode: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM (VALUES(1)) singleton(n)
    LEFT JOIN "EagleProcessingSetting" schedule ON schedule."ownerId"=${owner} AND schedule."libraryMode"=${mode}
    WHERE COALESCE(schedule.mode,'NIGHT')='ALWAYS'
      OR (COALESCE(schedule.mode,'NIGHT')='NIGHT' AND
        CASE WHEN COALESCE(schedule."nightStart",'23:00')=COALESCE(schedule."nightEnd",'06:00') THEN true
        WHEN COALESCE(schedule."nightStart",'23:00')<COALESCE(schedule."nightEnd",'06:00')
        THEN to_char(now() AT TIME ZONE 'Asia/Shanghai','HH24:MI')>=COALESCE(schedule."nightStart",'23:00')
          AND to_char(now() AT TIME ZONE 'Asia/Shanghai','HH24:MI')<COALESCE(schedule."nightEnd",'06:00')
        ELSE to_char(now() AT TIME ZONE 'Asia/Shanghai','HH24:MI')>=COALESCE(schedule."nightStart",'23:00')
          OR to_char(now() AT TIME ZONE 'Asia/Shanghai','HH24:MI')<COALESCE(schedule."nightEnd",'06:00') END)
  )`;
}
