-- Invalidation hints only. PostgreSQL delivers/coalesces NOTIFY after COMMIT;
-- listener reconnection changes the API epoch, so no event cursor or write counter is needed.
CREATE FUNCTION notify_sekereagle_workspace_changes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE projection text; source text; visibility text; scope record;
BEGIN
  SELECT 'jsonb_build_object(' || string_agg(format('%L,r.%I', name, name), ',') || ')'
    INTO projection FROM unnest(string_to_array(TG_ARGV[1], ',')) name;
  IF TG_OP = 'UPDATE' THEN
    source := format('(SELECT %s AS d FROM changed r EXCEPT SELECT %s AS d FROM previous r)
      UNION (SELECT %s AS d FROM previous r EXCEPT SELECT %s AS d FROM changed r)', projection, projection, projection, projection);
  ELSE source := format('SELECT %s AS d FROM changed r', projection); END IF;
  visibility := CASE TG_ARGV[2]
    WHEN 'private' THEN 'false'
    WHEN 'asset' THEN 'NOT (d->>''isPrivate'')::boolean'
    WHEN 'relation' THEN 'a.id IS NOT NULL AND NOT a."isPrivate"'
    WHEN 'analysis' THEN 'a.id IS NOT NULL AND NOT a."isPrivate"'
    WHEN 'operation' THEN 'op.id IS NOT NULL AND NOT op."isPrivate"'
    WHEN 'person' THEN 'a.id IS NOT NULL AND NOT a."isPrivate"'
    WHEN 'agent' THEN 'a.id IS NOT NULL AND NOT a."isPrivate"'
    ELSE 'NOT coalesce((d->>''isPrivate'')::boolean,false)' END;
  FOR scope IN EXECUTE format('
    WITH delta AS MATERIALIZED (%s)
    SELECT coalesce(d->>''ownerId'',d->>''uploaderId'') AS owner_id,
      d->>''libraryMode'' AS mode, bool_or(%s) AS public
    FROM delta
    LEFT JOIN "EagleAssetColorAnalysis" ca ON %L=''analysis'' AND ca.id=d->>''analysisId''
      AND ca."ownerId"=d->>''ownerId'' AND ca."libraryMode"::text=d->>''libraryMode''
    LEFT JOIN "EagleAssetOperation" op ON %L=''operation'' AND op.id=d->>''operationId''
      AND op."ownerId"=d->>''ownerId'' AND op."libraryMode"::text=d->>''libraryMode''
    LEFT JOIN "EaglePhotoFace" face ON %L=''person'' AND face."personId"=d->>''id''
      AND face."ownerId"=d->>''ownerId'' AND face."libraryMode"::text=d->>''libraryMode'' AND face."isCurrent"
    LEFT JOIN "EaglePhotoAgentSuggestion" suggestion ON %L=''agent'' AND suggestion."taskId"=d->>''id''
      AND suggestion."ownerId"=d->>''ownerId'' AND suggestion."libraryMode"::text=d->>''libraryMode''
    LEFT JOIN "EagleAsset" a ON a.id=coalesce(d->>''assetId'',ca."assetId",face."assetId",suggestion."assetId")
      AND a."ownerId"=d->>''ownerId'' AND a."libraryMode"::text=d->>''libraryMode''
    GROUP BY coalesce(d->>''ownerId'',d->>''uploaderId''),d->>''libraryMode''',
    source,visibility,TG_ARGV[2],TG_ARGV[2],TG_ARGV[2],TG_ARGV[2])
  LOOP
    IF scope.owner_id IS NOT NULL AND scope.mode IN ('MATERIAL','PHOTO') THEN
      PERFORM pg_notify('sekereagle_workspace_changes',json_build_object(
        'ownerId',scope.owner_id,'libraryMode',scope.mode,
        'kinds',string_to_array(TG_ARGV[0],','),'public',scope.public)::text);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

DO $$
DECLARE spec record; fields text;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('EagleAsset','ASSETS,LABELS,PEOPLE,MAP,FOLDERS,RECOMMENDATIONS','asset'),
    ('EagleAssetAnnotation','ASSETS,FOLDERS','relation'),
    ('EagleAssetRendition','ASSETS','relation'),
    ('EaglePhotoMetadata','ASSETS,FOLDERS','relation'),
    ('EaglePhotoLocation','MAP,ASSETS,FOLDERS','relation'),
    ('EaglePhotoFace','PEOPLE,ASSETS','relation'),
    ('EaglePhotoPerson','PEOPLE','person'),
    ('EaglePhotoPersonSeparation','PEOPLE','public'),
    ('EaglePhotoGroup','ASSETS','public'),
    ('EaglePhotoGroupMember','ASSETS','relation'),
    ('EagleAssetManualTag','ASSETS,LABELS,FOLDERS,RECOMMENDATIONS','relation'),
    ('EagleAssetAiTag','ASSETS,LABELS,FOLDERS','relation'),
    ('EagleAssetColorAnalysis','ASSETS,FOLDERS','relation'),
    ('EagleAssetColorSwatch','ASSETS,FOLDERS','analysis'),
    ('EagleManualTag','LABELS,FOLDERS,RECOMMENDATIONS','public'),
    ('EagleManualTagGroup','LABELS','public'),
    ('EagleManualTagGroupMembership','LABELS','public'),
    ('EagleAiTag','LABELS,FOLDERS','public'),
    ('EagleSmartFolder','FOLDERS','public'),
    ('EagleSmartFolderSemanticSnapshot','FOLDERS,TASKS','public'),
    ('EagleSmartFolderSemanticMatch','FOLDERS','relation'),
    ('EagleVectorTagSuggestion','RECOMMENDATIONS','relation'),
    ('EagleManualTagSemanticConfig','RECOMMENDATIONS,LABELS,TASKS','public'),
    ('EagleTagPrototypeSnapshot','RECOMMENDATIONS,LABELS,TASKS','public'),
    ('EagleTagSemanticBuild','RECOMMENDATIONS,LABELS,TASKS','public'),
    ('EagleAssetEmbedding','RECOMMENDATIONS,FOLDERS,TASKS','relation'),
    ('EagleMediaJob','TASKS','relation'),
    ('EagleAssetOperation','OPERATIONS,TASKS','public'),
    ('EagleAssetOperationItem','OPERATIONS,TASKS','operation'),
    ('EagleProcessingSetting','SETTINGS,TASKS','public'),
    ('EagleTaskPolicy','SETTINGS,TASKS','public'),
    ('EagleImportRun','TASKS','public'),
    ('UploadSession','TASKS','public'),
    ('EaglePhotoAgentTask','AGENT,TASKS','agent'),
    ('EaglePhotoAgentSuggestion','AGENT,TASKS','relation'),
    ('EaglePhotoAgentEvent','AGENT','relation'),
    ('EaglePhotoAgentPreference','AGENT,SETTINGS','public'),
    -- Public map source changes above start observation. Build leases are private
    -- progress hints; an already observed public build is polled until terminal.
    ('EaglePhotoMapState','MAP,TASKS','private')
  ) AS entries(table_name,kinds,visibility)
  LOOP
    SELECT string_agg(column_name,',' ORDER BY ordinal_position) INTO fields
      FROM information_schema.columns WHERE table_schema='public' AND table_name=spec.table_name
      AND column_name NOT IN ('updatedAt','heartbeatAt','lockedAt','lockedUntil','leaseUntil',
        'leaseToken','leaseVersion','lastClaimedAt','embedding','snapshots','inputIds','assetIds',
        'completionParts','multipartUploadId','objectKey','originalObjectKey');
    IF fields IS NULL THEN RAISE EXCEPTION 'Missing change source %',spec.table_name; END IF;
    EXECUTE format('CREATE TRIGGER workspace_change_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION notify_sekereagle_workspace_changes(%L,%L,%L)',spec.table_name,spec.kinds,fields,spec.visibility);
    EXECUTE format('CREATE TRIGGER workspace_change_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS previous NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION notify_sekereagle_workspace_changes(%L,%L,%L)',spec.table_name,spec.kinds,fields,spec.visibility);
    EXECUTE format('CREATE TRIGGER workspace_change_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION notify_sekereagle_workspace_changes(%L,%L,%L)',spec.table_name,spec.kinds,fields,spec.visibility);
  END LOOP;
END $$;
