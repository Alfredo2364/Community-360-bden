require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const { initRealtime, isOriginAllowed, getSocketCorsConfig } = require('./services/realtime');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && isOriginAllowed(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (!requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: getSocketCorsConfig()
});

initRealtime(io);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

app.use('/api/*', (_req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Endpoint API no encontrado.'
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`[Community 360] Servidor híbrido activo en http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
});

module.exports = { app, server, io };
