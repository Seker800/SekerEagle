-- Derived handoff extends the existing commit-ordered stream; business ownership is unchanged.
ALTER TABLE "EagleLibraryReadChange" ADD COLUMN "folderIds" text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN sources text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE FUNCTION eagle_record_library_semantic_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_sql text; scope record; next_revision bigint; recording boolean;
BEGIN
  IF TG_ARGV[0]='snapshot' THEN
    IF TG_OP='UPDATE' THEN
      source_sql := 'SELECT n."ownerId",n."libraryMode",n."folderId" FROM changed n JOIN previous p USING(id)
        WHERE n."isActive" AND (NOT p."isActive" OR n."folderId"<>p."folderId")
        UNION SELECT p."ownerId",p."libraryMode",p."folderId" FROM previous p JOIN changed n USING(id)
        WHERE p."isActive" AND (NOT n."isActive" OR n."folderId"<>p."folderId")';
    ELSE
      source_sql := 'SELECT "ownerId","libraryMode","folderId" FROM changed WHERE "isActive"';
    END IF;
  ELSIF TG_ARGV[0]='match' THEN
    source_sql := 'SELECT s."ownerId",s."libraryMode",s."folderId" FROM changed m
      JOIN "EagleSmartFolderSemanticSnapshot" s ON s.id=m."snapshotId" AND s."ownerId"=m."ownerId" AND s."libraryMode"=m."libraryMode"
      WHERE s."isActive"';
  ELSE
    source_sql := 'SELECT s."ownerId",s."libraryMode",s."folderId" FROM changed e
      JOIN "EagleSmartFolderSemanticMatch" m ON m."embeddingId"=e.id AND m."ownerId"=e."ownerId" AND m."libraryMode"=e."libraryMode"
      JOIN "EagleSmartFolderSemanticSnapshot" s ON s.id=m."snapshotId" AND s."ownerId"=m."ownerId" AND s."libraryMode"=m."libraryMode"
      WHERE s."isActive"';
    IF TG_OP='UPDATE' THEN
      source_sql := source_sql || ' AND EXISTS (SELECT 1 FROM previous p WHERE p.id=e.id
        AND ROW(p."assetRevision",p."spaceId",p.status,p."isCurrent") IS DISTINCT FROM ROW(e."assetRevision",e."spaceId",e.status,e."isCurrent"))';
    END IF;
  END IF;
  FOR scope IN EXECUTE 'SELECT "ownerId","libraryMode",array_agg(DISTINCT "folderId") AS folders FROM (' || source_sql || ') affected GROUP BY "ownerId","libraryMode" ORDER BY "ownerId","libraryMode"'
  LOOP
    INSERT INTO "EagleLibraryReadState" ("ownerId","libraryMode",revision)
      VALUES (scope."ownerId",scope."libraryMode",1)
      ON CONFLICT ("ownerId","libraryMode") DO UPDATE SET revision="EagleLibraryReadState".revision+1
      RETURNING revision,enabled INTO next_revision,recording;
    IF recording THEN
      INSERT INTO "EagleLibraryReadChange" ("ownerId","libraryMode",revision,"assetIds","folderIds")
        VALUES (scope."ownerId",scope."libraryMode",next_revision,ARRAY[]::text[],scope.folders);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

DO $$
DECLARE table_name text; kind text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['EagleSmartFolderSemanticSnapshot','EagleSmartFolderSemanticMatch','EagleAssetEmbedding']
  LOOP
    kind := CASE table_name WHEN 'EagleSmartFolderSemanticSnapshot' THEN 'snapshot'
      WHEN 'EagleSmartFolderSemanticMatch' THEN 'match' ELSE 'embedding' END;
    EXECUTE format('CREATE TRIGGER library_semantic_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION eagle_record_library_semantic_change(%L)',table_name,kind);
    EXECUTE format('CREATE TRIGGER library_semantic_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS previous NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION eagle_record_library_semantic_change(%L)',table_name,kind);
    EXECUTE format('CREATE TRIGGER library_semantic_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION eagle_record_library_semantic_change(%L)',table_name,kind);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION eagle_record_library_read_change() RETURNS trigger LANGUAGE plpgsql AS $$
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
    INSERT INTO "EagleLibraryReadChange" ("ownerId","libraryMode",revision,"assetIds",rebuild,sources)
      VALUES (scope."ownerId",scope."libraryMode",next_revision,coalesce(affected,ARRAY[]::text[]),false,ARRAY[TG_TABLE_NAME]);
  END LOOP;
  RETURN NULL;
END $$;
