import { Prisma } from '@prisma/client';
import { hexColorLab } from '@sekereagle/library-core';
import { normalizeHexColor, COLOR_PROCESSOR_VERSION } from './eagle-color-search';

type LabSql = readonly [Prisma.Sql, Prisma.Sql, Prisma.Sql];
const literalLab = (values: readonly number[]): LabSql => [Prisma.sql`${values[0]}`, Prisma.sql`${values[1]}`, Prisma.sql`${values[2]}`];
const swatchLab = (alias: 'first'|'second'): LabSql => ['labL','labA','labB'].map(field=>Prisma.raw(`floor(${alias}."${field}"+0.5)`)) as unknown as LabSql;
const distance76 = (a:LabSql,b:LabSql) => Prisma.sql`sqrt(power(${a[0]}-${b[0]},2)+power(${a[1]}-${b[1]},2)+power(${a[2]}-${b[2]},2))`;

/** CIEDE2000 expressed as scalar SQL, with parity tests against the pure reference.
 * No database extension, stored session state or library-wide ID materialization.
 */
export function deltaE2000Sql(a: LabSql, b: LabSql): Prisma.Sql {
  return Prisma.sql`(WITH input AS (
    SELECT ${a[0]}::float8 l1,${a[1]}::float8 a1,${a[2]}::float8 b1,
           ${b[0]}::float8 l2,${b[1]}::float8 a2,${b[2]}::float8 b2
  ), chroma AS (
    SELECT *, (sqrt(a1*a1+b1*b1)+sqrt(a2*a2+b2*b2))/2 cm FROM input
  ), correction AS (
    SELECT *, (1-sqrt(power(cm,7)/(power(cm,7)+6103515625)))/2 g FROM chroma
  ), adjusted AS (
    SELECT *, a1*(1+g) ap1,a2*(1+g) ap2 FROM correction
  ), polar AS (
    SELECT *,sqrt(ap1*ap1+b1*b1) cp1,sqrt(ap2*ap2+b2*b2) cp2,
      CASE WHEN ap1=0 AND b1=0 THEN 0 ELSE degrees(atan2(b1,ap1))+CASE WHEN b1<0 THEN 360 ELSE 0 END END h1,
      CASE WHEN ap2=0 AND b2=0 THEN 0 ELSE degrees(atan2(b2,ap2))+CASE WHEN b2<0 THEN 360 ELSE 0 END END h2 FROM adjusted
  ), differences AS (
    SELECT *,l2-l1 dl,cp2-cp1 dc,(l1+l2)/2 lm,(cp1+cp2)/2 cpm,
      CASE WHEN cp1*cp2=0 THEN 0 WHEN h2-h1>180 THEN h2-h1-360 WHEN h2-h1 < -180 THEN h2-h1+360 ELSE h2-h1 END dh,
      CASE WHEN cp1*cp2=0 THEN h1+h2 WHEN abs(h1-h2)<=180 THEN (h1+h2)/2 WHEN h1+h2<360 THEN (h1+h2+360)/2 ELSE (h1+h2-360)/2 END hm FROM polar
  ), factors AS (
    SELECT *,2*sqrt(cp1*cp2)*sin(radians(dh/2)) dhp,
      1-0.17*cos(radians(hm-30))+0.24*cos(radians(2*hm))+0.32*cos(radians(3*hm+6))-0.20*cos(radians(4*hm-63)) t,
      1+0.015*power(lm-50,2)/sqrt(20+power(lm-50,2)) sl,1+0.045*cpm sc,
      -2*sqrt(power(cpm,7)/(power(cpm,7)+6103515625))*sin(radians(60*exp(-power((hm-275)/25,2)))) rt FROM differences
  ), terms AS (
    SELECT dl/sl l,dc/sc c,dhp/(1+0.015*cpm*t) h,rt FROM factors
  ) SELECT sqrt(greatest(0,l*l+c*c+h*h+rt*c*h)) FROM terms)`;
}

/** NULL means ineligible; otherwise the ordinary Eagle color ordering score. */
export function colorScoreSql(value: string, assetAlias = 'asset'): Prisma.Sql {
  // Aliases are internal identifiers, never client values.
  if (!/^[a-z_][a-z0-9_]*$/.test(assetAlias)) throw new Error('Invalid color asset alias');
  const hex=normalizeHexColor(value), target=literalLab(hexColorLab(hex));
  const first=swatchLab('first'),second=swatchLab('second');
  const d1=distance76(target,first),d2=distance76(target,second);
  const matches=(lab:LabSql,d:Prisma.Sql)=>Prisma.sql`${deltaE2000Sql(target,lab)}<20 AND ${d}<70`;
  const asset=Prisma.raw(assetAlias);
  return Prisma.sql`(SELECT CASE
    WHEN first.weight<0.25 THEN NULL
    WHEN lower(first.hex)=${hex} OR lower(second.hex)=${hex} THEN 0.01
    WHEN first.weight>0.33 AND ${matches(first,d1)} THEN ${d1}
    WHEN first.weight>0.50 AND second.weight>0.08
      AND ${deltaE2000Sql(literalLab([100,0,0]),first)}<5
      AND ${matches(second,d2)} THEN ${d2}+5
    WHEN second.weight>0.33 AND ${matches(second,d2)} THEN ${d2}
    ELSE NULL END
    FROM "EagleAssetColorAnalysis" analysis
    JOIN "EagleAssetColorSwatch" first ON first."analysisId"=analysis.id AND first."ownerId"=analysis."ownerId" AND first."libraryMode"=analysis."libraryMode" AND first.rank=0
    LEFT JOIN "EagleAssetColorSwatch" second ON second."analysisId"=analysis.id AND second."ownerId"=analysis."ownerId" AND second."libraryMode"=analysis."libraryMode" AND second.rank=1
    WHERE analysis."assetId"=${asset}.id AND analysis."ownerId"=${asset}."ownerId" AND analysis."libraryMode"=${asset}."libraryMode"
      AND analysis."assetRevision"=${asset}."mediaRevision" AND analysis."isCurrent"
      AND analysis.status='COMPLETED'::"EagleColorAnalysisStatus" AND analysis."processorVersion"=${COLOR_PROCESSOR_VERSION}
  )`;
}
