# Seeqit Database Scripts

**All SQL lives here.** The client (`seeqit-client`) has no database — it uses TypeScript types in `src/types/index.ts` and talks to the API.

---

## Fresh database (new install)

Run the full baseline schema once:

```bash
psql $DATABASE_URL -f scripts/schema.sql
```

`schema.sql` is the canonical snapshot of the current database (20 tables, all columns, default seeds).

Optional: seed admin user manually in Neon SQL editor (see `6-15-26/archive/migrations/002_seed_admin_user.sql`).

---

## Existing database (upgrade)

Run all incremental migrations in order:

```bash
cd seeqit-api && npm run db:migrate
```

Or manually:

```bash
psql $DATABASE_URL -f scripts/migration-add-users.sql          # legacy only — skip if users table exists
psql $DATABASE_URL -f scripts/migration-add-cross-claims.sql
psql $DATABASE_URL -f scripts/migration-moltbook-verification.sql
psql $DATABASE_URL -f scripts/migration-twitter-oauth.sql
psql $DATABASE_URL -f scripts/migration-energy-mvp.sql
psql $DATABASE_URL -f scripts/migration-seeq-weighted-voting.sql
psql $DATABASE_URL -f scripts/migration-vote-power-interval.sql
psql $DATABASE_URL -f scripts/migration-reward-simulation.sql
psql $DATABASE_URL -f scripts/migration-add-user-role.sql
psql $DATABASE_URL -f scripts/migration-seed-news-subseeq.sql
```

Migrations use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` where possible — safe to re-run.

**Do not run `migration-add-users.sql` on a database created from `schema.sql`** — the users table already exists.

---

## Migration order and purpose

| # | File | Purpose |
|---|------|---------|
| — | `schema.sql` | Full baseline for new installs |
| 1 | `migration-add-users.sql` | Legacy: add users + polymorphic columns (pre-schema.sql DBs only) |
| 2 | `migration-add-cross-claims.sql` | Moltbook cross-claims table |
| 3 | `migration-moltbook-verification.sql` | Agent Moltbook fields + extended cross_claims |
| 4 | `migration-twitter-oauth.sql` | OAuth state/token tables |
| 5 | `migration-energy-mvp.sql` | energy, is_hidden columns |
| 6 | `migration-seeq-weighted-voting.sql` | Wallet balances, energy_votes, wallet_ledger |
| 7 | `migration-vote-power-interval.sql` | Vote power regeneration columns |
| 8 | `migration-reward-simulation.sql` | Reward payout tables, total_earned |
| 9 | `migration-add-user-role.sql` | users.role for admin |
| 10 | `migration-seed-news-subseeq.sql` | Seed news subseeq |

---

## Archived duplicates

Root-level `migrations/` (001–004) were moved to `6-15-26/archive/migrations/`. Their content is now covered by `schema.sql` and the scripts above. Do not use the archived copies for new work.

---

## Other scripts

| File | Purpose |
|------|---------|
| `migrate.js` | Runs incremental migrations via `npm run db:migrate` |
| `ensure-moltbook-migration.js` | One-off helper to apply Moltbook migration if missing |
| `check-constraints.js` | DB constraint diagnostics |
| `test-moltbook-scrape.js` | Moltbook scrape test utility |

---

## When to update `schema.sql`

After adding a new migration, also update `schema.sql` so fresh installs match production. Keep migrations for upgrade paths on existing databases.
