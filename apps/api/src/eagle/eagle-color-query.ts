import { Prisma } from '@prisma/client';
import { hexColorLab } from '@sekereagle/library-core';
import { COLOR_PROCESSOR_VERSION, normalizeHexColor } from './eagle-color-search';
import { compileSearchPredicate, type AssetSearchWhere } from './eagle-search-predicate';
import { deltaE2000Sql, distance76, paletteScoreCaseSql } from './eagle-color-sql';

type LabSql = readonly [Prisma.Sql, Prisma.Sql, Prisma.Sql];
export function hasColorSearch(value: unknown): boolean {
  if (!value || typeof value !== 'object' || value instanceof Date) return false;
  if (Array.isArray(value)) return value.some(hasColorSearch);
  return Object.entries(value).some(
    ([key, child]) => key === 'colorMatch' || hasColorSearch(child),
  );
}
/** A safe superset for hydration and palette preparation; exact boolean groups remain in SQL. */
export function colorCandidateWhere(where: AssetSearchWhere): Prisma.EagleAssetWhereInput {
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(visit);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, child]) => key !== 'colorMatch' && !(key === 'NOT' && hasColorSearch(child)))
        .map(([key, child]) => [key, visit(child)]),
    );
  };
  return visit(where) as Prisma.EagleAssetWhereInput;
}
function colorsIn(where: unknown, result = new Set<string>()): Set<string> {
  if (!where || typeof where !== 'object' || where instanceof Date) return result;
  if (Array.isArray(where)) {
    for (const child of where) colorsIn(child, result);
    return result;
  }
  for (const [key, child] of Object.entries(where))
    if (key === 'colorMatch') {
      if (typeof child !== 'string') throw new Error('Unsupported search color');
      result.add(normalizeHexColor(child));
    } else colorsIn(child, result);
  return result;
}

/** One distance evaluation per distinct swatch, not per asset or per returned page row. */
export function colorSearchPlan(where: AssetSearchWhere, rankColor?: string) {
  const colors = colorsIn(where);
  if (rankColor) colors.add(normalizeHexColor(rankColor));
  const ctes: Prisma.Sql[] = [],
    joins: Prisma.Sql[] = [],
    scores = new Map<string, Prisma.Sql>();
  if (colors.size) {
    ctes.push(Prisma.sql`color_assets AS MATERIALIZED (
      SELECT asset.id FROM "EagleAsset" asset WHERE ${compileSearchPredicate(colorCandidateWhere(where))}
    )`);
    ctes.push(Prisma.sql`color_palettes AS MATERIALIZED (
      SELECT analysis."assetId" id, first.hex "firstHex",first.weight "firstWeight",second.hex "secondHex",second.weight "secondWeight",
        floor(first."labL"+0.5) "firstL",floor(first."labA"+0.5) "firstA",floor(first."labB"+0.5) "firstB",
        floor(second."labL"+0.5) "secondL",floor(second."labA"+0.5) "secondA",floor(second."labB"+0.5) "secondB"
      FROM color_assets scope JOIN "EagleAsset" asset ON asset.id=scope.id
      JOIN "EagleAssetColorAnalysis" analysis ON analysis."assetId"=asset.id AND analysis."ownerId"=asset."ownerId" AND analysis."libraryMode"=asset."libraryMode"
        AND analysis."assetRevision"=asset."mediaRevision" AND analysis."isCurrent" AND analysis.status='COMPLETED'::"EagleColorAnalysisStatus" AND analysis."processorVersion"=${COLOR_PROCESSOR_VERSION}
      JOIN "EagleAssetColorSwatch" first ON first."analysisId"=analysis.id AND first."ownerId"=analysis."ownerId" AND first."libraryMode"=analysis."libraryMode" AND first.rank=0
      LEFT JOIN "EagleAssetColorSwatch" second ON second."analysisId"=analysis.id AND second."ownerId"=analysis."ownerId" AND second."libraryMode"=analysis."libraryMode" AND second.rank=1
    )`);
    ctes.push(Prisma.sql`color_swatches AS MATERIALIZED (
      SELECT "firstHex" hex,"firstL" l,"firstA" a,"firstB" b FROM color_palettes
      UNION SELECT "secondHex","secondL","secondA","secondB" FROM color_palettes WHERE "secondHex" IS NOT NULL
    )`);
    const swatch = [Prisma.raw('c.l'), Prisma.raw('c.a'), Prisma.raw('c.b')] as const;
    const white = [Prisma.sql`100.0`, Prisma.sql`0.0`, Prisma.sql`0.0`] as const;
    for (const [index, color] of [...colors].entries()) {
      const name = Prisma.raw(`color_scores_${index}`),
        dist = Prisma.raw(`color_distances_${index}`),
        alias = `color_match_${index}`;
      const target = hexColorLab(color).map((v) => Prisma.sql`${v}`) as unknown as LabSql;
      // One JSONB map keeps distance lookup unique without multiplying color CTE join estimates.
      ctes.push(Prisma.sql`${dist} AS MATERIALIZED (
        SELECT jsonb_object_agg(c.hex,jsonb_build_array(
          ${deltaE2000Sql(target, swatch)},${distance76(target, swatch)},${deltaE2000Sql(white, swatch)}
        )) data FROM color_swatches c
      )`);
      const numberAt = (position: 'first' | 'second', component: 0 | 1 | 2) =>
        Prisma.sql`(distances.data -> ${Prisma.raw(`p."${position}Hex"`)} ->> ${component}::int)::float8`;
      const d100 = numberAt('first', 0),
        d176 = numberAt('first', 1),
        d200 = numberAt('second', 0),
        d276 = numberAt('second', 1),
        white00 = numberAt('first', 2);
      const score = paletteScoreCaseSql(
        color,
        {
          hex: Prisma.raw('p."firstHex"'),
          weight: Prisma.raw('p."firstWeight"'),
          d00: d100,
          d76: d176,
        },
        {
          hex: Prisma.raw('p."secondHex"'),
          weight: Prisma.raw('p."secondWeight"'),
          d00: d200,
          d76: d276,
        },
        white00,
      );
      ctes.push(Prisma.sql`${name} AS MATERIALIZED (
        SELECT p.id,${score} score FROM color_palettes p CROSS JOIN ${dist} distances
      )`);
      joins.push(
        Prisma.sql`LEFT JOIN ${name} ${Prisma.raw(alias)} ON ${Prisma.raw(alias)}.id=asset.id`,
      );
      scores.set(color, Prisma.raw(`${alias}.score`));
    }
  }
  return {
    with: ctes.length ? Prisma.sql`WITH ${Prisma.join(ctes)}` : Prisma.empty,
    from: Prisma.sql`"EagleAsset" asset ${joins.length ? Prisma.join(joins, ' ') : Prisma.empty}`,
    where: compileSearchPredicate(where, scores),
    score: rankColor ? scores.get(normalizeHexColor(rankColor))! : Prisma.empty,
  };
}
