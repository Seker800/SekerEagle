CREATE TABLE "EagleTaskPolicy" (
  "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "libraryMode" "LibraryMode" NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('DETAILS','VIDEO','EMBEDDING','AI_TAGS','FACES','COLOR','PYRAMID','SMART_FOLDERS','TAG_INDEX')),
  paused BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (0,1)),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("ownerId","libraryMode",family)
);
CREATE TRIGGER eagle_task_policy_worker_wakeup AFTER INSERT OR UPDATE OR DELETE
ON "EagleTaskPolicy" FOR EACH ROW EXECUTE FUNCTION notify_sekereagle_worker_wakeup();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleTaskPolicy"
FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
