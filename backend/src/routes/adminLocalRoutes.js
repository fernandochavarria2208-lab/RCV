// backend/src/routes/adminLocalRoutes.js
// NOTA: Esto es un módulo "local" para gestión básica de usuarios/bitácora
// sin tocar tu sistema de auth existente. Guarda en tablas separadas.

const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');

// 👇 NUEVO: guard de permisos (usa Authorization: Bearer … y consulta BD)
const { requirePermission } = require('../middleware/requirePermission');

// 👇 NUEVO: toda esta sección requiere rol/permisos de administración
router.use(requirePermission('usuarios.admin'));

function promisify(db) {
  const getAsync = (sql, params=[]) => new Promise((res, rej)=>db.get(sql, params, (e,r)=>e?rej(e):res(r)));
  const allAsync = (sql, params=[]) => new Promise((res, rej)=>db.all(sql, params, (e,r)=>e?rej(e):res(r)));
  const runAsync = (sql, params=[]) => new Promise((res, rej)=>db.run(sql, params, function(e){e?rej(e):res(this)}));
  return { getAsync, allAsync, runAsync };
}

async function ensure(db) {
  const { runAsync } = promisify(db);
  await runAsync(`
    CREATE TABLE IF NOT EXISTS usuarios_admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT UNIQUE NOT NULL,
      contrasena TEXT NOT NULL,
      rol TEXT NOT NULL,
      creado_en TEXT DEFAULT (datetime('now'))
    )
  `);
  await runAsync(`
    CREATE TABLE IF NOT EXISTS bitacora_admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT,
      accion TEXT,
      ts TEXT DEFAULT (datetime('now'))
    )
  `);
}

// GET /api/admin/usuarios
router.get('/admin/usuarios', async (_req, res) => {
  try {
    const db = getDB(); await ensure(db);
    const { allAsync } = promisify(db);
    const rows = await allAsync(`SELECT id, usuario, rol, creado_en FROM usuarios_admin ORDER BY usuario`);
    res.json(rows||[]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/usuarios  {usuario, contrasena, rol}
router.post('/admin/usuarios', async (req, res) => {
  try {
    const { usuario, contrasena, rol } = req.body || {};
    if (!usuario || !contrasena || !rol) return res.status(400).json({ error: 'DATOS_REQUERIDOS' });
    const db = getDB(); await ensure(db);
    const { runAsync, getAsync } = promisify(db);
    const ins = await runAsync(`INSERT INTO usuarios_admin (usuario, contrasena, rol) VALUES (?,?,?)`,[usuario, contrasena, rol]);
    const row = await getAsync(`SELECT id, usuario, rol, creado_en FROM usuarios_admin WHERE id=?`,[ins.lastID]);
    res.status(201).json(row);
  } catch (e) { 
    const msg = /UNIQUE/.test(e.message) ? 'USUARIO_EXISTE' : e.message;
    res.status(500).json({ error: msg });
  }
});

// PUT /api/admin/usuarios/:id/password  {contrasena}
router.put('/admin/usuarios/:id/password', async (req, res) => {
  try {
    const id = req.params.id; const { contrasena } = req.body || {};
    if (!contrasena) return res.status(400).json({ error: 'CONTRASENA_REQUERIDA' });
    const db = getDB(); await ensure(db);
    const { runAsync, getAsync } = promisify(db);
    await runAsync(`UPDATE usuarios_admin SET contrasena=? WHERE id=?`,[contrasena, id]);
    const row = await getAsync(`SELECT id, usuario, rol, creado_en FROM usuarios_admin WHERE id=?`,[id]);
    res.json(row||{ ok:true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/bitacora
router.get('/admin/bitacora', async (_req, res) => {
  try {
    const db = getDB(); await ensure(db);
    const { allAsync } = promisify(db);
    const rows = await allAsync(`SELECT ts, usuario, accion FROM bitacora_admin ORDER BY ts DESC LIMIT 200`);
    res.json(rows||[]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/bitacora  {usuario, accion}
router.post('/admin/bitacora', async (req, res) => {
  try {
    const db = getDB(); await ensure(db);
    const { usuario, accion } = req.body || {};
    if (!accion) return res.status(400).json({ error: 'ACCION_REQUERIDA' });
    const { runAsync } = promisify(db);
    await runAsync(`INSERT INTO bitacora_admin (usuario, accion) VALUES (?,?)`,[usuario||null, accion]);
    res.status(201).json({ ok:true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
