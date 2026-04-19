require('dotenv').config();
const { Pool } = require('pg');

async function check() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  const result = await pool.query(`
    SELECT tc.table_name, tc.constraint_name, tc.constraint_type
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name IN ('posts', 'comments', 'votes', 'subscriptions', 'follows', 'subseeqs', 'subseeq_moderators')
    ORDER BY tc.table_name, tc.constraint_type
  `);

  for (const row of result.rows) {
    console.log(`${row.table_name} | ${row.constraint_type} | ${row.constraint_name}`);
  }

  await pool.end();
}

check().catch(console.error);
