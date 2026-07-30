-- CreateTable
CREATE TABLE "Site" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "semsSiteId" TEXT NOT NULL,
    "epaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "streetAddress" TEXT,
    "supplementalAddress" TEXT,
    "city" TEXT,
    "county" TEXT,
    "state" TEXT NOT NULL,
    "zip" TEXT,
    "fipsCode" TEXT,
    "congressionalDistrict" TEXT,
    "epaRegion" TEXT,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "nplStatusCode" TEXT NOT NULL,
    "nplStatusName" TEXT NOT NULL,
    "federalFacility" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "humanExposureStatus" TEXT,
    "groundwaterMigrationStatus" TEXT,
    "constructionComplete" TEXT,
    "sitewideReadyForUse" TEXT,
    "measuresFetchedAt" DATETIME,
    "profileUrl" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Contaminant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "SiteContaminant" (
    "siteId" INTEGER NOT NULL,
    "contaminantId" INTEGER NOT NULL,
    "media" TEXT NOT NULL,

    PRIMARY KEY ("siteId", "contaminantId", "media"),
    CONSTRAINT "SiteContaminant_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SiteContaminant_contaminantId_fkey" FOREIGN KEY ("contaminantId") REFERENCES "Contaminant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GeocodeCache" (
    "normalizedQuery" TEXT NOT NULL PRIMARY KEY,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "matchedAddress" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "IngestRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "recordsUpserted" INTEGER NOT NULL DEFAULT 0,
    "recordsRejected" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Site_semsSiteId_key" ON "Site"("semsSiteId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_epaId_key" ON "Site"("epaId");

-- CreateIndex
CREATE INDEX "Site_latitude_longitude_idx" ON "Site"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Site_state_idx" ON "Site"("state");

-- CreateIndex
CREATE UNIQUE INDEX "Contaminant_name_key" ON "Contaminant"("name");
