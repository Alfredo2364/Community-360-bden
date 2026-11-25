require('dotenv').config();
const jwt = require('jsonwebtoken');

const revokedTokens = new Set();

function extractBearerToken(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const parts = headerValue.trim().split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}

function verifyTokenString(token) {
  if (!token || revokedTokens.has(token)) {
    const err = new Error('Token inválido o revocado.');
    err.status = 401;
    throw err;
  }
  return jwt.verify(token, process.env.JWT_SECRET);
}

function revokeToken(token) {
  if (token) {
    revokedTokens.add(token);
  }
}

function requireAuth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({
      ok: false,
      error: 'No autorizado. Se requiere token Bearer JWT.'
    });
  }

  try {
    const decoded = verifyTokenString(token);
    req.user = decoded;
    req.token = token;
    return next();
  } catch (_) {
    return res.status(401).json({
      ok: false,
      error: 'Token JWT inválido, expirado o sesión cerrada.'
    });
  }
}

module.exports = {
  extractBearerToken,
  verifyTokenString,
  revokeToken,
  requireAuth
};
