import { Prisma } from '@prisma/client';

export function taskPolicyAllowsSql(owner: Prisma.Sql, mode: Prisma.Sql, family: Prisma.Sql) {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM "EagleTaskPolicy" policy
    WHERE policy."ownerId"=${owner} AND policy."libraryMode"=${mode} AND policy.family=${family} AND policy.paused)`;
}
export function taskPrioritySql(owner: Prisma.Sql, mode: Prisma.Sql, family: Prisma.Sql) {
  return Prisma.sql`COALESCE((SELECT policy.priority FROM "EagleTaskPolicy" policy
    WHERE policy."ownerId"=${owner} AND policy."libraryMode"=${mode} AND policy.family=${family}),0)`;
}
export function mediaTaskFamilySql(kind: Prisma.Sql, version: Prisma.Sql) {
  return Prisma.sql`CASE WHEN ${version}='photo-source-details-v1' THEN 'DETAILS'
    WHEN ${version} LIKE 'video-playback-%' THEN 'VIDEO'
    WHEN ${kind}::text='GENERATE_EMBEDDING' THEN 'EMBEDDING'
    WHEN ${kind}::text='ANALYZE_PHOTO_FACES' THEN 'FACES'
    WHEN ${kind}::text='EXTRACT_COLOR_PALETTE' THEN 'COLOR'
    WHEN ${kind}::text='GENERATE_IMAGE_PYRAMID' THEN 'PYRAMID'
    WHEN ${kind}::text='PURGE_ASSET' THEN 'CLEANUP' ELSE 'BROWSE' END`;
}
