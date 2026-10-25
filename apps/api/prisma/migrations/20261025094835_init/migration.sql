-- CreateEnum
CREATE TYPE "CheckOutcome" AS ENUM ('success', 'http_error', 'network_error', 'invalid_json', 'schema_changed');

-- CreateEnum
CREATE TYPE "CheckErrorCode" AS ENUM ('timeout', 'dns_failure', 'connection_failure', 'tls_failure', 'http_status', 'invalid_json', 'unknown');

-- CreateEnum
CREATE TYPE "SchemaChangeType" AS ENUM ('added', 'removed', 'type_changed');

-- CreateTable
CREATE TABLE "Endpoint" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "baselineSchema" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckResult" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "httpStatus" INTEGER,
    "responseTimeMs" INTEGER,
    "outcome" "CheckOutcome" NOT NULL,
    "errorCode" "CheckErrorCode",
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemaChange" (
    "id" UUID NOT NULL,
    "checkResultId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "changeType" "SchemaChangeType" NOT NULL,
    "previousTypes" TEXT[],
    "currentTypes" TEXT[],

    CONSTRAINT "SchemaChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckResult_endpointId_checkedAt_idx" ON "CheckResult"("endpointId", "checkedAt");

-- CreateIndex
CREATE INDEX "SchemaChange_checkResultId_idx" ON "SchemaChange"("checkResultId");

-- AddForeignKey
ALTER TABLE "CheckResult" ADD CONSTRAINT "CheckResult_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchemaChange" ADD CONSTRAINT "SchemaChange_checkResultId_fkey" FOREIGN KEY ("checkResultId") REFERENCES "CheckResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
