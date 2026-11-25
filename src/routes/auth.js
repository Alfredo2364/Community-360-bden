const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sql, getSqlPool } = require('../config/sql');
const { requireAuth, revokeToken } = require('../middleware/auth');

const router = express.Router();

const DOCENTE_SHORT_USER = 'lizandro.reyes';
const DOCENTE_FULL_EMAIL = 'lizandro.reyes@utmetropolitana.edu.mx';
const DOCENTE_BCRYPT_HASH = '$2a$10$qs3OW2F6Dagc0tZ48i5GOupsPsINSiibZgHr3TzHqmqHTMUfBh42i';

router.post('/login', async (req, res) => {
  try {
    const rawIdentifier = (req.body.email || req.body.username || req.body.user || '').trim();
    const password = req.body.password || '';

    if (!rawIdentifier || !password) {
      return res.status(400).json({
        ok: false,
        error: 'Se requieren credenciales completas (email/usuario y password).'
      });
    }

    const normalizedIdentifier =
      rawIdentifier.toLowerCase() === DOCENTE_SHORT_USER
        ? DOCENTE_FULL_EMAIL
        : rawIdentifier;

    const pool = await getSqlPool();

    if (normalizedIdentifier.toLowerCase() === DOCENTE_FULL_EMAIL) {
      await pool
        .request()
        .input('email', sql.NVarChar(150), DOCENTE_FULL_EMAIL)
        .input('password_hash', sql.VarChar(255), DOCENTE_BCRYPT_HASH)
        .input('rol', sql.VarChar(40), 'docente')
        .query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.admins WHERE LOWER(email) = LOWER(@email))
          BEGIN
            INSERT INTO dbo.admins (email, password_hash, rol)
            VALUES (@email, @password_hash, @rol);
          END
        `);
    }

    const result = await pool
      .request()
      .input('identifier', sql.NVarChar(150), normalizedIdentifier)
      .query(`
        SELECT TOP 1 id, email, password_hash, rol, created_at
        FROM dbo.admins
        WHERE LOWER(email) = LOWER(@identifier)
           OR LOWER(LEFT(email, CHARINDEX('@', email + '@') - 1)) = LOWER(@identifier)
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({
        ok: false,
        error: 'Credenciales inválidas.'
      });
    }

    const admin = result.recordset[0];
    const validPassword = await bcrypt.compare(password, admin.password_hash);
    if (!validPassword) {
      return res.status(401).json({
        ok: false,
        error: 'Credenciales inválidas.'
      });
    }

    const payload = {
      id: admin.id,
      email: admin.email,
      rol: admin.rol
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });

    return res.status(200).json({
      ok: true,
      token,
      user: payload
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Error interno al autenticar contra Azure SQL.',
      detail: err.message
    });
  }
});

router.post('/logout', requireAuth, (req, res) => {
  revokeToken(req.token);
  return res.status(200).json({
    ok: true,
    message: 'Sesión cerrada exitosamente.'
  });
});

router.get('/me', requireAuth, (req, res) => {
  return res.status(200).json({
    ok: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      rol: req.user.rol
    }
  });
});

module.exports = router;
