require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { queryOne, pool } = require('../src/config/database');

async function main() {
  const col = await queryOne(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'agents' AND column_name = 'is_moltbook_verified'`
  );
  console.log('is_moltbook_verified column exists:', !!col);

  if (!col) {
    console.log('Running migration...');
    const sql = fs.readFileSync(
      path.join(__dirname, 'migration-moltbook-verification.sql'),
      'utf8'
    );
    const { pool: pgPool } = require('../src/config/database');
    await pgPool.query(sql);
    console.log('Migration complete.');
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(async () => {
    try {
      const { pool: pgPool } = require('../src/config/database');
      await pgPool.end();
    } catch {
      // ignore
    }
  });
