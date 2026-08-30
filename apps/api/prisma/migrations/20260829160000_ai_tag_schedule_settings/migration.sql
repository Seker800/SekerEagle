ALTER TABLE "EagleProcessingSetting"
  ADD COLUMN "aiTagManualEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiTagScheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiTagScheduleStart" TEXT NOT NULL DEFAULT '23:00',
  ADD COLUMN "aiTagScheduleEnd" TEXT NOT NULL DEFAULT '06:00';
