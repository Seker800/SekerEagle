CREATE TABLE "EaglePhotoMapState" (
 "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
 "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO' CHECK ("libraryMode"='PHOTO'),
 "requestedVersion" INTEGER NOT NULL DEFAULT 1, "visibilityVersion" INTEGER NOT NULL DEFAULT 0,
 "builtVersion" INTEGER NOT NULL DEFAULT 0, "dirtyAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
 "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "activeSnapshotId" TEXT, "buildingSnapshotId" TEXT, "nextLevel" INTEGER NOT NULL DEFAULT 0,
 "leaseToken" TEXT, "lockedUntil" TIMESTAMP(3), "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT,
 PRIMARY KEY ("ownerId","libraryMode")
);
CREATE INDEX "EaglePhotoMapState_availableAt_lockedUntil_idx" ON "EaglePhotoMapState"("availableAt","lockedUntil");
CREATE TABLE "EaglePhotoMapSnapshot" (
 id TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO' CHECK ("libraryMode"='PHOTO'),
 version INTEGER NOT NULL, "visibilityVersion" INTEGER NOT NULL, summary JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
 UNIQUE ("ownerId","libraryMode",id),
 FOREIGN KEY ("ownerId","libraryMode") REFERENCES "EaglePhotoMapState"("ownerId","libraryMode") ON DELETE CASCADE
);
CREATE INDEX "EaglePhotoMapSnapshot_ownerId_libraryMode_createdAt_idx" ON "EaglePhotoMapSnapshot"("ownerId","libraryMode","createdAt");
CREATE TABLE "EaglePhotoMapPoint" (
 "ownerId" TEXT NOT NULL, "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO' CHECK ("libraryMode"='PHOTO'),
 "snapshotId" TEXT NOT NULL, "assetId" TEXT NOT NULL, "assetRevision" INTEGER NOT NULL, "isPrivate" BOOLEAN NOT NULL,
 "chronologicalAt" TIMESTAMP(3) NOT NULL, latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
 longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180), x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 2097151), y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 2097151),
 PRIMARY KEY ("ownerId","libraryMode","snapshotId","assetId"),
 FOREIGN KEY ("ownerId","libraryMode","snapshotId") REFERENCES "EaglePhotoMapSnapshot"("ownerId","libraryMode",id) ON DELETE CASCADE
);
CREATE INDEX "EaglePhotoMapPoint_snapshot_position_idx" ON "EaglePhotoMapPoint"("ownerId","libraryMode","snapshotId",x,y,"chronologicalAt","assetId");
CREATE TABLE "EaglePhotoMapCell" (
 "ownerId" TEXT NOT NULL, "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO' CHECK ("libraryMode"='PHOTO'),
 "snapshotId" TEXT NOT NULL, "includePrivate" BOOLEAN NOT NULL, level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 21),
 x INTEGER NOT NULL, y INTEGER NOT NULL, count INTEGER NOT NULL CHECK(count>0),
 latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL,
 south DOUBLE PRECISION NOT NULL, north DOUBLE PRECISION NOT NULL, west DOUBLE PRECISION NOT NULL, east DOUBLE PRECISION NOT NULL,
 "coverId" TEXT NOT NULL, "coverRevision" INTEGER NOT NULL,
 PRIMARY KEY("ownerId","libraryMode","snapshotId","includePrivate",level,x,y),
 FOREIGN KEY("ownerId","libraryMode","snapshotId") REFERENCES "EaglePhotoMapSnapshot"("ownerId","libraryMode",id) ON DELETE CASCADE,
 CHECK(x>=0 AND y>=0 AND x < (1::bigint << level) AND y < (1::bigint << level)),
 CHECK(latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
CREATE INDEX "EaglePhotoMapCell_snapshot_position_idx" ON "EaglePhotoMapCell"("ownerId","libraryMode","snapshotId","includePrivate",level,y,x);
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePhotoMapState" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePhotoMapSnapshot" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePhotoMapPoint" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePhotoMapCell" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();

-- Changes only coalesce a dirty marker. No location extraction or aggregation occurs in a write trigger.
CREATE FUNCTION mark_photo_map_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT; sensitive BOOLEAN := false;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD."libraryMode"<>'PHOTO' THEN RETURN OLD; END IF;
  owner_id:=OLD."ownerId"; sensitive:=true;
 ELSE
  IF NEW."libraryMode"<>'PHOTO' THEN RETURN NEW; END IF;
  owner_id:=NEW."ownerId";
  IF TG_OP='UPDATE' THEN
   IF TG_TABLE_NAME='EagleAsset' THEN
    IF (NEW."isPrivate",NEW."deletedAt",NEW."mediaRevision",NEW."chronologicalAt") IS NOT DISTINCT FROM (OLD."isPrivate",OLD."deletedAt",OLD."mediaRevision",OLD."chronologicalAt") THEN RETURN NEW; END IF;
    sensitive:=(NEW."isPrivate",NEW."deletedAt",NEW."mediaRevision") IS DISTINCT FROM (OLD."isPrivate",OLD."deletedAt",OLD."mediaRevision");
   ELSE
    IF (NEW.latitude,NEW.longitude,NEW."assetRevision") IS NOT DISTINCT FROM (OLD.latitude,OLD.longitude,OLD."assetRevision") THEN RETURN NEW; END IF;
    sensitive:=OLD.latitude IS NOT NULL OR OLD.longitude IS NOT NULL;
   END IF;
  END IF;
 END IF;
 INSERT INTO "EaglePhotoMapState" ("ownerId","libraryMode","visibilityVersion","dirtyAt","availableAt")
 SELECT owner_id,'PHOTO'::"LibraryMode",CASE WHEN sensitive THEN 1 ELSE 0 END,now(),now()+interval '1 minute'
 WHERE EXISTS(SELECT 1 FROM "User" WHERE id=owner_id)
 ON CONFLICT("ownerId","libraryMode") DO UPDATE SET
 "requestedVersion"="EaglePhotoMapState"."requestedVersion"+1,
 "visibilityVersion"="EaglePhotoMapState"."visibilityVersion"+CASE WHEN sensitive THEN 1 ELSE 0 END,
 "dirtyAt"=COALESCE("EaglePhotoMapState"."dirtyAt",now()),
 "availableAt"=LEAST(COALESCE("EaglePhotoMapState"."dirtyAt",now())+interval '10 minutes',now()+interval '1 minute'),
 "attempts"=0,"lastError"=NULL;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER photo_map_dirty AFTER INSERT OR DELETE OR UPDATE OF "isPrivate","deletedAt","mediaRevision","chronologicalAt" ON "EagleAsset" FOR EACH ROW EXECUTE FUNCTION mark_photo_map_dirty();
CREATE TRIGGER photo_map_dirty AFTER INSERT OR DELETE OR UPDATE OF latitude,longitude,"assetRevision" ON "EaglePhotoMetadata" FOR EACH ROW EXECUTE FUNCTION mark_photo_map_dirty();
CREATE TRIGGER photo_map_dirty AFTER INSERT OR DELETE OR UPDATE OF latitude,longitude,"assetRevision" ON "EaglePhotoLocation" FOR EACH ROW EXECUTE FUNCTION mark_photo_map_dirty();
INSERT INTO "EaglePhotoMapState"("ownerId","libraryMode","availableAt")
 SELECT DISTINCT "ownerId",'PHOTO'::"LibraryMode",now()+interval '1 minute' FROM "EagleAsset" WHERE "libraryMode"='PHOTO';
