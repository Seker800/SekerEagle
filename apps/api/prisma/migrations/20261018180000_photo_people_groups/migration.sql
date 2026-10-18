BEGIN;
-- AlterEnum
ALTER TYPE "EagleMediaJobKind" ADD VALUE 'ANALYZE_PHOTO_FACES';

-- CreateTable
CREATE TABLE "EaglePhotoPerson" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO',
    "name" TEXT,
    "prototype" DOUBLE PRECISION[],
    "modelVersion" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaglePhotoPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaglePhotoFace" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO',
    "assetId" TEXT NOT NULL,
    "assetRevision" INTEGER NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "personId" TEXT,
    "box" DOUBLE PRECISION[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "userAssigned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EaglePhotoFace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaglePhotoGroup" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO',
    "kind" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "title" TEXT,
    "bestAssetId" TEXT,
    "bestSelectedByUser" BOOLEAN NOT NULL DEFAULT false,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EaglePhotoGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaglePhotoGroupMember" (
    "ownerId" TEXT NOT NULL,
    "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO',
    "groupId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,

    CONSTRAINT "EaglePhotoGroupMember_pkey" PRIMARY KEY ("groupId","assetId")
);

-- CreateIndex
CREATE INDEX "EaglePhotoPerson_ownerId_libraryMode_idx" ON "EaglePhotoPerson"("ownerId", "libraryMode");

-- CreateIndex
CREATE UNIQUE INDEX "EaglePhotoPerson_ownerId_libraryMode_id_key" ON "EaglePhotoPerson"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EaglePhotoFace_ownerId_libraryMode_personId_idx" ON "EaglePhotoFace"("ownerId", "libraryMode", "personId");

-- CreateIndex
CREATE INDEX "EaglePhotoFace_ownerId_libraryMode_assetId_isCurrent_idx" ON "EaglePhotoFace"("ownerId", "libraryMode", "assetId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "EaglePhotoGroup_ownerId_libraryMode_id_key" ON "EaglePhotoGroup"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EaglePhotoGroup_ownerId_libraryMode_sourceKey_key" ON "EaglePhotoGroup"("ownerId", "libraryMode", "sourceKey");

-- CreateIndex
CREATE INDEX "EaglePhotoGroupMember_ownerId_libraryMode_assetId_idx" ON "EaglePhotoGroupMember"("ownerId", "libraryMode", "assetId");

-- AddForeignKey
ALTER TABLE "EaglePhotoPerson" ADD CONSTRAINT "EaglePhotoPerson_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaglePhotoFace" ADD CONSTRAINT "EaglePhotoFace_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaglePhotoFace" ADD CONSTRAINT "EaglePhotoFace_ownerId_libraryMode_personId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "personId") REFERENCES "EaglePhotoPerson"("ownerId", "libraryMode", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaglePhotoGroup" ADD CONSTRAINT "EaglePhotoGroup_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaglePhotoGroup" ADD CONSTRAINT "EaglePhotoGroup_ownerId_libraryMode_bestAssetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "bestAssetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE SET NULL ("bestAssetId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaglePhotoGroupMember" ADD CONSTRAINT "EaglePhotoGroupMember_ownerId_libraryMode_groupId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "groupId") REFERENCES "EaglePhotoGroup"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaglePhotoGroupMember" ADD CONSTRAINT "EaglePhotoGroupMember_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "EaglePhotoPerson" ADD CONSTRAINT "EaglePhotoPerson_photo_only" CHECK ("libraryMode" = 'PHOTO');
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePhotoPerson" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();

ALTER TABLE "EaglePhotoFace" ADD CONSTRAINT "EaglePhotoFace_photo_only" CHECK ("libraryMode" = 'PHOTO');
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePhotoFace" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();

ALTER TABLE "EaglePhotoGroup" ADD CONSTRAINT "EaglePhotoGroup_photo_only" CHECK ("libraryMode" = 'PHOTO');
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePhotoGroup" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();

ALTER TABLE "EaglePhotoGroupMember" ADD CONSTRAINT "EaglePhotoGroupMember_photo_only" CHECK ("libraryMode" = 'PHOTO');
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePhotoGroupMember" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();

ALTER TABLE "EaglePhotoFace" ADD CONSTRAINT face_shape CHECK (array_length(box, 1) = 4 AND array_length(embedding, 1) = 128);

ALTER TABLE "EaglePhotoPerson" ADD CONSTRAINT person_embedding_shape CHECK (array_length(prototype,1)=128);
ALTER TABLE "EaglePhotoGroup" ADD CONSTRAINT photo_group_kind CHECK (kind IN ('BURST','SIMILAR','MANUAL'));

COMMIT;
