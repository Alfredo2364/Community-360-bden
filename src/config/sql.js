require('dotenv').config();
const sql = require('mssql');

const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DATABASE,
  server: process.env.SQL_SERVER,
  port: Number(process.env.SQL_PORT || 1433),
  pool: {
    max: 15,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: String(process.env.SQL_ENCRYPT).toLowerCase() !== 'false',
    trustServerCertificate: String(process.env.SQL_TRUST_SERVER_CERTIFICATE).toLowerCase() === 'true',
    connectTimeout: 60000,
    requestTimeout: 60000
  }
};

let poolPromise = null;

async function connectWithRetry(maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const pool = await new sql.ConnectionPool(sqlConfig).connect();
      return pool;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  }
  throw lastError;
}

async function getSqlPool() {
  if (poolPromise) {
    try {
      const pool = await poolPromise;
      if (pool.connected) return pool;
    } catch (_) {
      poolPromise = null;
    }
  }
  poolPromise = connectWithRetry(3);
  return poolPromise;
}

async function closeSqlPool() {
  if (poolPromise) {
    try {
      const pool = await poolPromise;
      await pool.close();
    } finally {
      poolPromise = null;
    }
  }
}

module.exports = {
  sql,
  sqlConfig,
  getSqlPool,
  closeSqlPool
};
