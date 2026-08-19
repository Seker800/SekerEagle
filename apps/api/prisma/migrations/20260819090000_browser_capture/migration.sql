CREATE TABLE "EagleBrowserCapture" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "clientCaptureId" TEXT NOT NULL,
    "uploadSessionId" TEXT NOT NULL,
    "assetId" TEXT,
    "displayName" TEXT NOT NULL,
    "pageTitle" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "imageUrl" TEXT,
    "altText" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "extensionVersion" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleBrowserCapture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EagleBrowserCapture_uploadSessionId_key" ON "EagleBrowserCapture"("uploadSessionId");
CREATE UNIQUE INDEX "EagleBrowserCapture_ownerId_clientCaptureId_key" ON "EagleBrowserCapture"("ownerId", "clientCaptureId");
CREATE UNIQUE INDEX "EagleBrowserCapture_ownerId_uploadSessionId_key" ON "EagleBrowserCapture"("ownerId", "uploadSessionId");
CREATE UNIQUE INDEX "EagleBrowserCapture_ownerId_id_key" ON "EagleBrowserCapture"("ownerId", "id");
CREATE INDEX "EagleBrowserCapture_ownerId_createdAt_idx" ON "EagleBrowserCapture"("ownerId", "createdAt");
CREATE INDEX "EagleBrowserCapture_ownerId_assetId_capturedAt_idx" ON "EagleBrowserCapture"("ownerId", "assetId", "capturedAt");

ALTER TABLE "EagleBrowserCapture" ADD CONSTRAINT "EagleBrowserCapture_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EagleBrowserCapture" ADD CONSTRAINT "EagleBrowserCapture_ownerId_uploadSessionId_fkey"
    FOREIGN KEY ("ownerId", "uploadSessionId") REFERENCES "UploadSession"("uploaderId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EagleBrowserCapture" ADD CONSTRAINT "EagleBrowserCapture_ownerId_assetId_fkey"
    FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
