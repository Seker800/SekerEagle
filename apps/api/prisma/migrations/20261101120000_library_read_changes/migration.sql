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
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleLibraryReadState"
  FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleLibraryReadChange"
  FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
INSERT INTO "EagleLibraryReadState" ("ownerId","libraryMode")
  SELECT DISTINCT "ownerId","libraryMode" FROM "EagleAsset";

CREATE FUNCTION eagle_record_library_read_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope record; next_revision bigint; recording boolean; affected text[];
BEGIN
  -- Keep one commit-ordered counter even while logging is disabled. Enabling the
  -- reader joins this row lock, so pre-activation writers cannot commit unnoticed.
  FOR scope IN SELECT DISTINCT "ownerId","libraryMode" FROM changed ORDER BY "ownerId","libraryMode"
  LOOP
    INSERT INTO "EagleLibraryReadState" ("ownerId","libraryMode",revision)
      VALUES (scope."ownerId",scope."libraryMode",1)
      ON CONFLICT ("ownerId","libraryMode") DO UPDATE
      SET revision="EagleLibraryReadState".revision+1
      RETURNING revision,enabled INTO next_revision,recording;
    IF NOT recording THEN CONTINUE; END IF;
    IF TG_ARGV[0]='asset' THEN
      SELECT array_agg(DISTINCT id) INTO affected FROM changed
        WHERE "ownerId"=scope."ownerId" AND "libraryMode"=scope."libraryMode";
    ELSIF TG_ARGV[0]='relation' THEN
      SELECT array_agg(DISTINCT "assetId") INTO affected FROM changed
        WHERE "ownerId"=scope."ownerId" AND "libraryMode"=scope."libraryMode";
    ELSIF TG_ARGV[0]='swatch' THEN
      SELECT array_agg(DISTINCT a."assetId") INTO affected FROM changed c
        JOIN "EagleAssetColorAnalysis" a ON a.id=c."analysisId" AND a."ownerId"=c."ownerId" AND a."libraryMode"=c."libraryMode"
        WHERE c."ownerId"=scope."ownerId" AND c."libraryMode"=scope."libraryMode";
    ELSIF TG_ARGV[0]='directory' THEN
      SELECT array_agg(DISTINCT link."assetId") INTO affected FROM changed c
        JOIN "EagleAssetManualTag" link ON link."tagId"=c.id AND link."ownerId"=c."ownerId" AND link."libraryMode"=c."libraryMode"
        WHERE c."ownerId"=scope."ownerId" AND c."libraryMode"=scope."libraryMode";
    ELSE affected := ARRAY[]::text[];
    END IF;
    INSERT INTO "EagleLibraryReadChange" ("ownerId","libraryMode",revision,"assetIds",rebuild)
      VALUES (scope."ownerId",scope."libraryMode",next_revision,coalesce(affected,ARRAY[]::text[]),false);
  END LOOP;
  RETURN NULL;
END $$;

DO $$
DECLARE table_name text; kind text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['EagleAsset','EagleAssetAnnotation','EaglePhotoMetadata',
    'EaglePhotoLocation','EaglePhotoFace','EagleAssetManualTag','EagleAssetAiTag',
    'EagleAssetColorAnalysis','EagleManualTag']
  LOOP
    kind := CASE WHEN table_name='EagleAsset' THEN 'asset'
      WHEN table_name='EagleManualTag' THEN 'directory' ELSE 'relation' END;
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
