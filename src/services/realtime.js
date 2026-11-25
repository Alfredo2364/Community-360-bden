const { getSqlPool } = require('../config/sql');
const { getContainers } = require('../config/cosmos');
const { verifyTokenString, extractBearerToken } = require('../middleware/auth');
const { computeRealtimeMetrics } = require('../utils/metrics');

let ioInstance = null;

function getAllowedOrigins() {
  const origins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
  if (process.env.FRONTEND_URL) {
    process.env.FRONTEND_URL.split(',')
      .map((u) => u.trim().replace(/\/+$/, ''))
      .filter(Boolean)
      .forEach((u) => origins.add(u));
  }
  return Array.from(origins);
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  const cleanOrigin = origin.trim().replace(/\/+$/, '');
  const allowed = getAllowedOrigins();
  return allowed.includes(cleanOrigin);
}

function getSocketCorsConfig() {
  return {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS_NOT_ALLOWED'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: true
  };
}

async function buildRealtimeSnapshot(lastEvent = null) {
  const pool = await getSqlPool();
  const containers = getContainers();

  const [sqlStatsResult, cosmosInteractionsResult] = await Promise.all([
    pool.request().query(`
      SELECT
        COUNT(*) AS totalUsuarios,
        SUM(CASE WHEN estatus = 'activo' THEN 1 ELSE 0 END) AS activos,
        SUM(CASE WHEN estatus = 'en_riesgo' THEN 1 ELSE 0 END) AS enRiesgo,
        SUM(CASE WHEN estatus = 'inactivo' THEN 1 ELSE 0 END) AS inactivos
      FROM dbo.usuarios
    `),
    containers.interacciones.items
      .query(
        'SELECT c.id_interaccion, c.id_usuario, c.timestamp, c.canal, c.tipo, c.tema, c.sentimiento, c.reacciones_recibidas FROM c'
      )
      .fetchAll()
  ]);

  const sqlStats = sqlStatsResult.recordset[0] || {
    totalUsuarios: 0,
    activos: 0,
    enRiesgo: 0,
    inactivos: 0
  };

  const interactions = cosmosInteractionsResult.resources || [];
  const metrics = computeRealtimeMetrics(sqlStats, interactions);

  const recentInteractions = [...interactions]
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, 8);

  return {
    ...metrics,
    recentInteractions,
    evento: lastEvent || {
      operacion: 'SNAPSHOT',
      id_interaccion: null,
      id_usuario: null,
      canal: null,
      tipo: null,
      timestamp: new Date().toISOString()
    }
  };
}

function initRealtime(io) {
  ioInstance = io;

  io.use((socket, next) => {
    const authToken =
      socket.handshake.auth?.token ||
      extractBearerToken(socket.handshake.headers?.authorization) ||
      socket.handshake.query?.token;

    if (!authToken) {
      return next(new Error('UNAUTHORIZED_WEBSOCKET_NO_TOKEN'));
    }

    try {
      const user = verifyTokenString(authToken);
      socket.user = user;
      return next();
    } catch (_) {
      return next(new Error('UNAUTHORIZED_WEBSOCKET_INVALID_TOKEN'));
    }
  });

  io.on('connection', async (socket) => {
    try {
      const snapshot = await buildRealtimeSnapshot({
        operacion: 'CONNECTED',
        detalle: `Sesión iniciada (${socket.user.email})`,
        timestamp: new Date().toISOString()
      });
      socket.emit('dashboard:update', snapshot);
    } catch (err) {
      socket.emit('dashboard:error', { error: err.message });
    }
  });
}

async function emitDashboardUpdate(eventDetails) {
  const snapshot = await buildRealtimeSnapshot(eventDetails);
  if (ioInstance) {
    ioInstance.emit('dashboard:update', snapshot);
  }
  return snapshot;
}

module.exports = {
  getAllowedOrigins,
  isOriginAllowed,
  getSocketCorsConfig,
  initRealtime,
  buildRealtimeSnapshot,
  emitDashboardUpdate
};
