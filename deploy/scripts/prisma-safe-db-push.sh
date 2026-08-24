#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-}"

if [ -z "$APP_DIR" ]; then
  echo "Usage: $0 <app-dir>"
  exit 1
fi

ENV_FILE="$APP_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

DATABASE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | tail -n 1 | cut -d= -f2-)"

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not configured in $ENV_FILE"
  exit 1
fi

PSQL_DATABASE_URL="${DATABASE_URL%%\?*}"

cd "$APP_DIR"

psql "$PSQL_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'SupportTicket'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'SupportTicket'
        AND column_name = 'number'
    ) THEN
      EXECUTE 'ALTER TABLE "SupportTicket" ADD COLUMN "number" INTEGER';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class
      WHERE relkind = 'S'
        AND relname = 'SupportTicket_number_seq'
    ) THEN
      EXECUTE 'CREATE SEQUENCE "SupportTicket_number_seq"';
    END IF;

    EXECUTE 'ALTER SEQUENCE "SupportTicket_number_seq" OWNED BY "SupportTicket"."number"';
    EXECUTE 'ALTER TABLE "SupportTicket" ALTER COLUMN "number" SET DEFAULT nextval(''"SupportTicket_number_seq"'')';

    PERFORM setval(
      '"SupportTicket_number_seq"',
      COALESCE((SELECT MAX("number") FROM "SupportTicket" WHERE "number" IS NOT NULL), 1),
      EXISTS (SELECT 1 FROM "SupportTicket" WHERE "number" IS NOT NULL)
    );

    WITH duplicates AS (
      SELECT "id"
      FROM (
        SELECT
          "id",
          "number",
          ROW_NUMBER() OVER (PARTITION BY "number" ORDER BY "createdAt" NULLS FIRST, "id") AS duplicate_rank
        FROM "SupportTicket"
        WHERE "number" IS NOT NULL
      ) ranked
      WHERE ranked.duplicate_rank > 1
    ),
    needs_number AS (
      SELECT "id"
      FROM "SupportTicket"
      WHERE "number" IS NULL
      UNION
      SELECT "id" FROM duplicates
    ),
    assigned AS (
      SELECT "id", nextval('"SupportTicket_number_seq"')::INTEGER AS "number"
      FROM needs_number
    )
    UPDATE "SupportTicket" AS ticket
    SET "number" = assigned."number"
    FROM assigned
    WHERE ticket."id" = assigned."id";
  END IF;
END $$;
SQL

npx prisma db push --accept-data-loss --schema packages/db/prisma/schema.prisma
