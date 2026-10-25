-- Forward-only additive migration. Requires explicit approval before application.
-- No existing rows are backfilled, updated, or deleted. Missing schedules are disabled.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE "EndpointSchedule" (
    "endpointId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "nextRunAt" TIMESTAMPTZ(3),
    "lastStartedAt" TIMESTAMPTZ(3),
    "lastFinishedAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(40),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "EndpointSchedule_pkey" PRIMARY KEY ("endpointId"),
    CONSTRAINT "EndpointSchedule_interval_check" CHECK ("intervalMinutes" IN (5, 15, 30, 60)),
    CONSTRAINT "EndpointSchedule_due_check" CHECK (("enabled" AND "nextRunAt" IS NOT NULL) OR (NOT "enabled" AND "nextRunAt" IS NULL))
);

CREATE TABLE "ScheduledCheck" (
    "checkResultId" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "scheduledFor" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ScheduledCheck_pkey" PRIMARY KEY ("checkResultId")
);

CREATE INDEX "EndpointSchedule_enabled_nextRunAt_idx" ON "EndpointSchedule"("enabled", "nextRunAt");
CREATE UNIQUE INDEX "ScheduledCheck_endpointId_scheduledFor_key" ON "ScheduledCheck"("endpointId", "scheduledFor");
ALTER TABLE "EndpointSchedule" ADD CONSTRAINT "EndpointSchedule_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledCheck" ADD CONSTRAINT "ScheduledCheck_checkResultId_fkey" FOREIGN KEY ("checkResultId") REFERENCES "CheckResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledCheck" ADD CONSTRAINT "ScheduledCheck_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
