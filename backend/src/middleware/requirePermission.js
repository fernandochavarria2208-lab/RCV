// backend/src/middlewares/requirePermission.js
const jwt = require('jsonwebtoken');
const { getEffectivePermissions, parseExtras } = require('../auth/permissions');
const db = require('../db/database'); // ⚠️ Ajusta si tu export es distinto
const JWT_SECRET = process.env.JWT_SECRET || 'rcv_dev_secret';

// Helper: obtener usuario por ID desde BD (sqlite3 estilo db.get)
function getUserById(uid) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id, usuario, email, rol, permisos_extras FROM usuarios WHERE id = ?',
      [uid],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

// Autentica y enriquece req.user con datos reales de BD
async function authenticate(req) {
  const auth = req.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return { ok: false, code: 401, error: 'No token' };

  try {
    const payload = jwt.verify(token, JWT_SECRET); // { uid, usuario, rol?, iat, exp, ... }
    const userRow = await getUserById(payload.uid);
    if (!userRow) return { ok: false, code: 401, error: 'Usuario no existe' };

    const extras = parseExtras(userRow.permisos_extras);
    req.user = {
      id: userRow.id,
      usuario: userRow.usuario,
      email: userRow.email,
      rol: userRow.rol || payload.rol || 'usuario',
      permisos_extras: extras,
    };
    return { ok: true };
  } catch {
    return { ok: false, code: 401, error: 'Token inválido o expirado' };
  }
}

async function requireAuth(req, res, next) {
  const r = await authenticate(req);
  if (!r.ok) return res.status(r.code).json({ ok: false, error: r.error });
  next();
}

function requirePermission(slug) {
  return async (req, res, next) => {
    const r = await authenticate(req);
    if (!r.ok) return res.status(r.code).json({ ok: false, error: r.error });

    const effective = getEffectivePermissions(req.user);
    if (!effective.has(slug)) {
      return res.status(403).json({ error: 'Sin permiso', required: slug });
    }
    next();
  };
}

module.exports = { requireAuth, requirePermission };
