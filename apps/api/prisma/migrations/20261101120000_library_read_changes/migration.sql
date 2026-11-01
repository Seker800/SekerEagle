-- Derived handoff records are transactionally consistent with all canonical writers.
-- Scope row locking serializes revisions with commits, unlike a sequence cursor.
CREATE TABLE "EagleLibraryReadState" (
  "ownerId" text NOT NULL, "libraryMode" "LibraryMode" NOT NULL,
  revision bigint NOT NULL DEFAULT 0, enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("ownerId","libraryMode")
);
CREATE TABLE "EagleLibraryReadChange" (
  "ownerId" text NOT NULL, "libraryMode" "LibraryMode" NOT NULL,
  revision bigint NOT NULL, "assetIds" text[] NOT NULL, rebuild boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("ownerId","libraryMode",revision),
  FOREIGN KEY ("ownerId","libraryMode") REFERENCES "EagleLibraryReadState" ON DELETE CASCADE
);
INSERT INTO "EagleLibraryReadState" ("ownerId","libraryMode")
  SELECT DISTINCT "ownerId","libraryMode" FROM "EagleAsset";

CREATE FUNCTION eagle_record_library_read_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope record; next_revision bigint;
BEGIN
  -- Transition tables batch a createMany/updateMany/deleteMany into one event per scope.
  FOR scope IN
    SELECT r."ownerId",r."libraryMode",
      array_agg(DISTINCT CASE WHEN TG_ARGV[0]='asset' THEN r.id ELSE r."assetId" END)
        FILTER (WHERE CASE WHEN TG_ARGV[0]='asset' THEN r.id ELSE r."assetId" END IS NOT NULL) ids
    FROM (SELECT x->>'ownerId' "ownerId",(x->>'libraryMode')::"LibraryMode" "libraryMode",
      x->>'id' id,CASE WHEN TG_ARGV[0]='swatch' THEN
        (SELECT a."assetId" FROM "EagleAssetColorAnalysis" a WHERE a.id=x->>'analysisId'
          AND a."ownerId"=x->>'ownerId' AND a."libraryMode"=(x->>'libraryMode')::"LibraryMode")
        ELSE x->>'assetId' END "assetId" FROM (SELECT to_jsonb(c) x FROM changed c) j) r
    GROUP BY r."ownerId",r."libraryMode" ORDER BY r."ownerId",r."libraryMode"
  LOOP
    -- Installing the migration alone must not accumulate an unused journal.
    IF NOT EXISTS (SELECT 1 FROM "EagleLibraryReadState" s WHERE s."ownerId"=scope."ownerId"
      AND s."libraryMode"=scope."libraryMode" AND s.enabled) THEN CONTINUE; END IF;
    INSERT INTO "EagleLibraryReadState" ("ownerId","libraryMode",revision,enabled)
      VALUES (scope."ownerId",scope."libraryMode",1,true)
      ON CONFLICT ("ownerId","libraryMode") DO UPDATE
      SET revision="EagleLibraryReadState".revision+1 RETURNING revision INTO next_revision;
    INSERT INTO "EagleLibraryReadChange" ("ownerId","libraryMode",revision,"assetIds",rebuild)
      VALUES (scope."ownerId",scope."libraryMode",next_revision,coalesce(scope.ids,ARRAY[]::text[]),TG_ARGV[0]='directory');
    PERFORM pg_notify('sekereagle_library_read_change',scope."libraryMode"::text);
  END LOOP;
  RETURN NULL;
END $$;

DO $$
DECLARE table_name text; kind text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['EagleAsset','EagleAssetAnnotation','EaglePhotoMetadata',
    'EaglePhotoLocation','EaglePhotoFace','EagleAssetManualTag','EagleAssetAiTag',
    'EagleAssetColorAnalysis','EagleManualTag','EagleSmartFolder']
  LOOP
    kind := CASE WHEN table_name='EagleAsset' THEN 'asset'
      WHEN table_name IN ('EagleManualTag','EagleSmartFolder') THEN 'directory' ELSE 'relation' END;
    EXECUTE format('CREATE TRIGGER library_read_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION eagle_record_library_read_change(%L)',table_name,kind);
    EXECUTE format('CREATE TRIGGER library_read_update AFTER UPDATE ON %I REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION eagle_record_library_read_change(%L)',table_name,kind);
    EXECUTE format('CREATE TRIGGER library_read_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION eagle_record_library_read_change(%L)',table_name,kind);
  END LOOP;
END $$;

-- Swatches resolve their asset via the existing analysis, in the same transaction.
-- Cascaded analysis deletion is independently covered by the analysis trigger.
CREATE TRIGGER library_read_insert AFTER INSERT ON "EagleAssetColorSwatch"
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION eagle_record_library_read_change('swatch');
CREATE TRIGGER library_read_update AFTER UPDATE ON "EagleAssetColorSwatch"
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION eagle_record_library_read_change('swatch');
CREATE TRIGGER library_read_delete AFTER DELETE ON "EagleAssetColorSwatch"
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION eagle_record_library_read_change('swatch');
