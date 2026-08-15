# Database migrations

## Current source of truth

Production D1 schema changes are the committed SQL files in `drizzle/`, applied in filename order by Cloudflare Wrangler. The production deployment script runs:

```sh
wrangler d1 migrations apply radiologyos --remote
```

Do not generate or replace an already committed migration after it may have been applied to an environment.

## Why `npm run db:generate` is guarded

The repository has a historical Drizzle metadata gap: `drizzle/meta/_journal.json` and the available snapshots do not represent the full committed SQL migration history. `db/schema.ts` also does not yet model every table/column introduced by later manual migrations.

Running `drizzle-kit generate` against that stale state can create duplicate or rollback-like SQL for objects that already exist in D1. `npm run db:generate` therefore runs `scripts/db-generate-guard.mjs` first and fails closed unless both conditions are true:

1. the latest journal tag equals the latest committed SQL migration tag; and
2. a snapshot for that latest migration number exists.

This guard does not affect production deployment because deployment applies committed SQL migrations directly.

## Re-enabling generated migrations

Re-enable normal Drizzle generation only as a dedicated migration-maintenance change:

1. reconstruct a canonical Drizzle schema that matches the fully migrated D1 shape;
2. rebaseline `drizzle/meta` through the latest committed migration without changing production data;
3. verify a fresh `drizzle-kit generate` proposes no duplicate/destructive migration for the current schema;
4. keep the generation guard until CI proves the journal and latest snapshot are current;
5. review the generated SQL before any future migration is merged or applied.

Clinical and tenant-integrity triggers that are intentionally authored as raw SQL remain part of the committed migration history even when the table shape is represented in Drizzle.
