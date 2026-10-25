-- REVIEW ONLY: application requires explicit approval, test database first.
-- No backfill. All existing endpoints remain unclaimed (ownerId IS NULL).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "passwordHash" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "User_email_normalized" CHECK ("email" = lower(btrim("email")))
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Session" (
  "tokenHash" CHAR(64) NOT NULL,
  "userId" UUID NOT NULL,
  "csrfToken" CHAR(43) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash"),
  CONSTRAINT "Session_expiry_after_creation" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

ALTER TABLE "Endpoint" ADD COLUMN "ownerId" UUID;
CREATE INDEX "Endpoint_ownerId_createdAt_idx" ON "Endpoint"("ownerId", "createdAt");
ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
