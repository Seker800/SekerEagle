CREATE TABLE "EaglePhotoPersonSeparation" (
 "ownerId" TEXT NOT NULL, "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO',
 "firstId" TEXT NOT NULL, "secondId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EaglePhotoPersonSeparation_pkey" PRIMARY KEY ("ownerId","libraryMode","firstId","secondId"),
 CONSTRAINT "EaglePhotoPersonSeparation_order" CHECK ("firstId" < "secondId" AND "libraryMode"='PHOTO'),
 CONSTRAINT "EaglePhotoPersonSeparation_first_fkey" FOREIGN KEY ("ownerId","libraryMode","firstId") REFERENCES "EaglePhotoPerson"("ownerId","libraryMode","id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "EaglePhotoPersonSeparation_second_fkey" FOREIGN KEY ("ownerId","libraryMode","secondId") REFERENCES "EaglePhotoPerson"("ownerId","libraryMode","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EaglePhotoPersonSeparation_ownerId_libraryMode_secondId_idx" ON "EaglePhotoPersonSeparation"("ownerId","libraryMode","secondId");

CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePhotoPersonSeparation" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
