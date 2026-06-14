/**
 * Run database migrations (incremental upgrades for existing databases)
 * Usage: npm run db:migrate
 *
 * For NEW databases, use schema.sql instead — do not run migration-add-users.sql.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS = [
  // Legacy — skip automatically if users table already has role column (post-schema.sql)
  'migration-add-users.sql',
  'migration-add-cross-claims.sql',
  'migration-moltbook-verification.sql',
  'migration-twitter-oauth.sql',
  'migration-energy-mvp.sql',
  'migration-seeq-weighted-voting.sql',
  'migration-vote-power-interval.sql',
  'migration-reward-simulation.sql',
  'migration-add-user-role.sql',
  'migration-seed-news-subseeq.sql'
];

async function shouldSkipLegacyUsersMigration(pool) {
  const result = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role'
  `);
  return result.rows.length > 0;
}

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL not set. Check your .env file.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  console.log('Connecting to database...');

  try {
    for (const file of MIGRATIONS) {
      if (file === 'migration-add-users.sql' && (await shouldSkipLegacyUsersMigration(pool))) {
        console.log('Skipping migration-add-users.sql (database already at current schema)');
        continue;
      }

      const migrationPath = path.join(__dirname, file);
      if (!fs.existsSync(migrationPath)) {
        console.warn(`Warning: ${file} not found, skipping`);
        continue;
      }

      const sql = fs.readFileSync(migrationPath, 'utf-8');
      console.log(`Running: ${file}`);
      await pool.query(sql);
      console.log(`  OK`);
    }

    console.log('All migrations completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
