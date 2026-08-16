CREATE TABLE "EagleProcessingSetting" (
  "ownerId" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'NIGHT',
  "nightStart" TEXT NOT NULL DEFAULT '23:00',
  "nightEnd" TEXT NOT NULL DEFAULT '06:00',
  "timeZone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EagleProcessingSetting_pkey" PRIMARY KEY ("ownerId"),
  CONSTRAINT "EagleProcessingSetting_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
