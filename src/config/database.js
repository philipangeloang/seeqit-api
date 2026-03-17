/**
 * Database connection and query helpers
 */

const { Pool } = require('pg');
const config = require('./index');

let pool = null;

/**
 * Initialize database connection pool
 */
function initializePool() {
  if (pool) return pool;
  
  if (!config.database.url) {
    console.warn('DATABASE_URL not set, using mock database');
    return null;
  }
  
  pool = new Pool({
    connectionString: config.database.url,
    ssl: config.database.ssl,
    max: 10,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000
  });

  pool.on('error', (err) => {
    console.error('Unexpected database error:', err);
    // Reset pool on fatal errors so next query gets a fresh connection
    pool = null;
  });
  
  return pool;
}

/**
 * Execute a query
 * 
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params, retries = 2) {
  const db = initializePool();

  if (!db) {
    throw new Error('Database not configured');
  }

  const start = Date.now();
  try {
    const result = await db.query(text, params);
    const duration = Date.now() - start;

    if (config.nodeEnv === 'development') {
      console.log('Query executed', { text: text.substring(0, 50), duration, rows: result.rowCount });
    }

    return result;
  } catch (err) {
    // Retry on connection errors (stale/terminated connections from Neon idle)
    if (retries > 0 && (err.message?.includes('Connection terminated') || err.code === 'ECONNRESET')) {
      console.warn(`DB connection error, retrying... (${retries} left)`);
      pool = null; // Force new pool
      return query(text, params, retries - 1);
    }
    throw err;
  }
}

/**
 * Execute a query and return first row
 * 
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object|null>} First row or null
 */
async function queryOne(text, params) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

/**
 * Execute a query and return all rows
 * 
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} All rows
 */
async function queryAll(text, params) {
  const result = await query(text, params);
  return result.rows;
}

/**
 * Execute multiple queries in a transaction
 * 
 * @param {Function} callback - Function receiving client
 * @returns {Promise<any>} Transaction result
 */
async function transaction(callback) {
  const db = initializePool();
  
  if (!db) {
    throw new Error('Database not configured');
  }
  
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check database connection
 * 
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  try {
    const db = initializePool();
    if (!db) return false;
    
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Close database connections
 */
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  initializePool,
  query,
  queryOne,
  queryAll,
  transaction,
  healthCheck,
  close,
  getPool: () => pool
};
