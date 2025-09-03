// backend/src/routes/authRoutes.js
"use strict";

const express = require('express');
const jwt = require('jsonwebtoken');
const { login } = require('../controllers/authController');
const { getEffectivePermissions, parseExtras } = require('../auth/permissions');
const { getDB } = require('../db/database'); // respaldo si no viene por req.app

const router = express.Router();

// Debe coincidir con el usado en el controller al firmar el JWT
const JWT_SECRET = process.env.JWT_SECRET || 'rcv_dev_secret';

// --- Health simple del módulo de auth ---
router.get('/_alive', (_req, res) => res.json({ ok: true }));

// --- Login: usa el controlador ---
router.post('/login', login);

// --- Verify: valida JWT y devuelve datos del token ---
// Devuelve { ok, user: { id, usuario, rol, permisos_extras? }, iat, exp }
router.get('/verify', (req, res) => {
  const auth = req.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'No token' });

  try {
    const payload = jwt.verify(token, JWT_SECRET); // { uid, usuario, rol, permisos_extras?, iat, exp }
    return res.json({
      ok: true,
      user: {
        id: payload.uid,
        usuario: payload.usuario,
        rol: payload.rol || 'usuario',
        permisos_extras: parseExtras(payload.permisos_extras),
      },
      iat: payload.iat,
      exp: payload.exp,
    });
  } catch {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }
});

// --- Helper BD ---
function getUserById(db, uid) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, usuario, nombre, email, rol, permisos_extras
         FROM usuarios
        WHERE id = ?`,
      [uid],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

// --- Perfil real desde BD + permisos efectivos ---
// Devuelve { ok, user:{...}, permisos_extras, permisos_efectivos }
router.get('/me', async (req, res) => {
  const auth = req.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'No token' });

  try {
    const payload = jwt.verify(token, JWT_SECRET); // { uid, ... }

    // Obtén la instancia de la BD desde el server (set en server.js) o como respaldo desde el singleton
    const db = req.app.get('db') || getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'DB no inicializada' });

    const userRow = await getUserById(db, payload.uid);
    if (!userRow) return res.status(401).json({ ok: false, error: 'Usuario no existe' });

    const extras = parseExtras(userRow.permisos_extras);
    const permisos_efectivos = Array.from(
      getEffectivePermissions({ rol: userRow.rol, permisos_extras: extras })
    );

    return res.json({
      ok: true,
      user: {
        id: userRow.id,
        usuario: userRow.usuario,
        nombre: userRow.nombre || null,
        email: userRow.email || null,
        rol: userRow.rol || 'usuario',
      },
      permisos_extras: extras,
      permisos_efectivos,
    });
  } catch {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }
});

module.exports = router;
