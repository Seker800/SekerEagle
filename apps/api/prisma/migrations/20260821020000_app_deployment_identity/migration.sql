CREATE TABLE "AppDeploymentIdentity" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppDeploymentIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppDeploymentIdentity_value_key"
ON "AppDeploymentIdentity"("value");
