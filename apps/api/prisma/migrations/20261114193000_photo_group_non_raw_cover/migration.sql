-- Automatic photo groups rank their cover by a 128px sharpness score only, so a
-- RAW member can outrank its camera-rendered JPEG sibling and become the gallery
-- cover. Use the READY non-RAW sibling instead; manual user choices stay intact.
WITH raw_mime AS (
  SELECT unnest(
    ARRAY[
      'image/x-adobe-dng',
      'image/x-canon-cr2',
      'image/x-canon-cr3',
      'image/x-canon-crw',
      'image/x-nikon-nef',
      'image/x-nikon-nrw',
      'image/x-sony-arw',
      'image/x-sony-sr2',
      'image/x-fuji-raf',
      'image/x-olympus-orf',
      'image/x-panasonic-rw2',
      'image/x-leica-rwl',
      'image/x-pentax-pef',
      'image/x-samsung-srw',
      'image/x-kodak-kdc',
      'image/x-raw'
    ]::text[]
  ) AS "mimeType"
), candidates AS (
  SELECT
    g.id AS "groupId",
    m."assetId",
    ROW_NUMBER() OVER (
      PARTITION BY g.id
      ORDER BY a."isPrivate" ASC, a."createdAt" DESC, m."assetId" ASC
    ) AS position
  FROM "EaglePhotoGroup" g
  JOIN "EaglePhotoGroupMember" m
    ON m."ownerId" = g."ownerId"
   AND m."libraryMode" = g."libraryMode"
   AND m."groupId" = g.id
  JOIN "EagleAsset" a
    ON a."ownerId" = m."ownerId"
   AND a."libraryMode" = m."libraryMode"
   AND a.id = m."assetId"
  WHERE g."libraryMode" = 'PHOTO'
    AND g."bestSelectedByUser" = false
    AND g."bestAssetId" IS NOT NULL
    AND a."lifecycleStatus" = 'READY'
    AND a."deletedAt" IS NULL
    AND a."mimeType" NOT IN (SELECT "mimeType" FROM raw_mime)
    AND EXISTS (
      SELECT 1
      FROM "EagleAsset" best
      WHERE best."ownerId" = g."ownerId"
        AND best."libraryMode" = g."libraryMode"
        AND best.id = g."bestAssetId"
        AND best."mimeType" IN (SELECT "mimeType" FROM raw_mime)
    )
)
UPDATE "EaglePhotoGroup" g
SET "bestAssetId" = candidates."assetId"
FROM candidates
WHERE g.id = candidates."groupId"
  AND candidates.position = 1;
