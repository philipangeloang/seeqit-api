/**
 * Run database migrations
 * Usage: node scripts/migrate.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

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

  const migrationFile = path.join(__dirname, 'migration-add-users.sql');
  const sql = fs.readFileSync(migrationFile, 'utf-8');

  console.log('Connecting to database...');
  console.log('Running migration: migration-add-users.sql');

  try {
    await pool.query(sql);
    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
