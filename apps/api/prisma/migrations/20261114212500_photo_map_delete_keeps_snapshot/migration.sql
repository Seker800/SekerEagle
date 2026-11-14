-- Deleting or replacing a photo no longer blanks the whole map. The last visible
-- generation stays readable while the background index catches up; member reads
-- already filter deleted rows and mismatched media revisions, so the deleted
-- photo disappears from the location list immediately and only the aggregate
-- count stays stale for one rebuild.
--
-- A photo becoming private still revokes the visible generation at once, and a
-- coordinate change away from an existing location still does too: those are the
-- changes that could expose a location that was previously hidden or different.
-- Hard deletes are treated like soft deletes (dirty only), not as a privacy
-- revocation.
CREATE OR REPLACE FUNCTION mark_photo_map_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT; sensitive BOOLEAN := false;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD."libraryMode"<>'PHOTO' THEN RETURN OLD; END IF;
  owner_id:=OLD."ownerId";
 ELSE
  IF NEW."libraryMode"<>'PHOTO' THEN RETURN NEW; END IF;
  owner_id:=NEW."ownerId";
  IF TG_OP='UPDATE' THEN
   IF TG_TABLE_NAME='EagleAsset' THEN
    IF (NEW."isPrivate",NEW."deletedAt",NEW."mediaRevision",NEW."chronologicalAt") IS NOT DISTINCT FROM (OLD."isPrivate",OLD."deletedAt",OLD."mediaRevision",OLD."chronologicalAt") THEN RETURN NEW; END IF;
    sensitive:=NEW."isPrivate" AND NOT OLD."isPrivate";
   ELSE
    IF (NEW.latitude,NEW.longitude,NEW."assetRevision") IS NOT DISTINCT FROM (OLD.latitude,OLD.longitude,OLD."assetRevision") THEN RETURN NEW; END IF;
    -- Re-analysis may bump assetRevision without moving the photo; only an actual
    -- coordinate change away from an existing location revokes the generation.
    sensitive:=(NEW.latitude,NEW.longitude) IS DISTINCT FROM (OLD.latitude,OLD.longitude)
      AND (OLD.latitude IS NOT NULL OR OLD.longitude IS NOT NULL);
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
 "availableAt"=CASE WHEN "EaglePhotoMapState"."lastError" IS NOT NULL
   THEN "EaglePhotoMapState"."availableAt"
   ELSE LEAST(COALESCE("EaglePhotoMapState"."dirtyAt",now())+interval '10 minutes',now()+interval '1 minute') END;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
