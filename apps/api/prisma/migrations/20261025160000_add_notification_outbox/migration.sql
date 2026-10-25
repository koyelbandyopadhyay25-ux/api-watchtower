-- REVIEW ONLY: additive Phase 6B migration, not approved for application yet.
-- No backfill or writes to existing monitoring, authentication or schedule rows.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

-- CreateEnum
CREATE TYPE "IncidentKind" AS ENUM ('availability', 'schema');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('failure', 'recovery', 'schema_changed', 'schema_restored');

-- CreateEnum
CREATE TYPE "EmailState" AS ENUM ('pending', 'processing', 'smtp_accepted', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "EmailAttemptState" AS ENUM ('in_progress', 'smtp_accepted', 'retry_scheduled', 'permanent_failure', 'interrupted', 'cancelled');

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "endpointId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("endpointId")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "kind" "IncidentKind" NOT NULL,
    "openedCheckId" UUID NOT NULL,
    "closedCheckId" UUID,
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "resolution" VARCHAR(32),
    "fingerprint" CHAR(64),

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "checkResultId" UUID NOT NULL,
    "endpointName" VARCHAR(100) NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "eventId" UUID NOT NULL,
    "state" "EmailState" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(40),

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "EmailAttempt" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "leaseToken" UUID NOT NULL,
    "state" "EmailAttemptState" NOT NULL DEFAULT 'in_progress',
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "errorCode" VARCHAR(40),

    CONSTRAINT "EmailAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Incident_endpointId_openedAt_idx" ON "Incident"("endpointId", "openedAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_ownerId_endpointId_createdAt_idx" ON "NotificationEvent"("ownerId", "endpointId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationEvent_checkResultId_kind_key" ON "NotificationEvent"("checkResultId", "kind");

-- CreateIndex
CREATE INDEX "EmailOutbox_state_availableAt_idx" ON "EmailOutbox"("state", "availableAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_state_leaseExpiresAt_idx" ON "EmailOutbox"("state", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAttempt_eventId_number_key" ON "EmailAttempt"("eventId", "number");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_openedCheckId_fkey" FOREIGN KEY ("openedCheckId") REFERENCES "CheckResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_closedCheckId_fkey" FOREIGN KEY ("closedCheckId") REFERENCES "CheckResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_checkResultId_fkey" FOREIGN KEY ("checkResultId") REFERENCES "CheckResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttempt" ADD CONSTRAINT "EmailAttempt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "EmailOutbox"("eventId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express these partial-index/CHECK invariants; preserve in future SQL.
CREATE UNIQUE INDEX "Incident_one_open_per_kind" ON "Incident"("endpointId", "kind") WHERE "closedAt" IS NULL;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_resolution_state" CHECK (
  ("closedAt" IS NULL AND "closedCheckId" IS NULL AND "resolution" IS NULL) OR
  ("closedAt" IS NOT NULL AND "closedCheckId" IS NOT NULL AND "resolution" IS NOT NULL AND "resolution" IN ('check_recovered', 'sample_matches_baseline', 'baseline_accepted'))
);
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_attempt_bounds" CHECK ("attempts" BETWEEN 0 AND 5);
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_lease_state" CHECK (
  ("state" = 'processing' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR
  ("state" <> 'processing' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
);
ALTER TABLE "EmailAttempt" ADD CONSTRAINT "EmailAttempt_number_bounds" CHECK ("number" BETWEEN 1 AND 5);
ALTER TABLE "EmailAttempt" ADD CONSTRAINT "EmailAttempt_finish_state" CHECK (
  ("state" = 'in_progress' AND "finishedAt" IS NULL) OR ("state" <> 'in_progress' AND "finishedAt" IS NOT NULL)
);
COMMIT;
