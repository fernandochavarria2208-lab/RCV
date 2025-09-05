// backend/src/routes/tiemposRoutes.js
const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');

function promisify(db) {
  const getAsync = (sql, params = []) =>
    new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));
  const allAsync = (sql, params = []) =>
    new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
  const runAsync = (sql, params = []) =>
    new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
  return { getAsync, allAsync, runAsync };
}

// ====== bootstrap (lazy, una sola vez) ======
let _bootstrapped = false;
async function ensureTableOnce() {
  if (_bootstrapped) return;
  const db = getDB();
  const { runAsync } = promisify(db);
  await new Promise((ok, ko) =>
    db.exec(
      `
      CREATE TABLE IF NOT EXISTS tiempos_orden (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orden_id TEXT NOT NULL,
        user_id TEXT,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER,
        duration_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tiempos_orden_open
        ON tiempos_orden(orden_id, user_id, end_ts);
      CREATE INDEX IF NOT EXISTS idx_tiempos_orden_start
        ON tiempos_orden(start_ts);
      `,
      (e) => (e ? ko(e) : ok())
    )
  );
  _bootstrapped = true;
}

// ejecuta bootstrap antes de atender cualquier ruta de este módulo
router.use(async (_req, _res, next) => {
  try { await ensureTableOnce(); next(); } catch (e) { next(e); }
});

// ====== handlers ======
async function startTimer(req, res) {
  try {
    const db = getDB();
    const { runAsync, getAsync } = promisify(db);
    const ordenId = String(req.params.id);
    const userId = String(req.body?.user_id || '');
    const now = Date.now();

    // Si ya hay uno corriendo para ese user/orden, no duplica
    const running = await getAsync(
      `
      SELECT * FROM tiempos_orden
      WHERE orden_id=? AND (user_id=? OR ?='') AND end_ts IS NULL
      ORDER BY id DESC LIMIT 1
      `,
      [ordenId, userId, userId]
    );
    if (running) return res.json(running);

    const ins = await runAsync(
      `INSERT INTO tiempos_orden (orden_id, user_id, start_ts) VALUES (?,?,?)`,
      [ordenId, userId, now]
    );
    const row = await getAsync(`SELECT * FROM tiempos_orden WHERE id=?`, [ins.lastID]);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function stopTimer(req, res) {
  try {
    const db = getDB();
    const { runAsync, getAsync } = promisify(db);
    const ordenId = String(req.params.id);
    const userId = String(req.body?.user_id || '');
    const now = Date.now();

    const running = await getAsync(
      `
      SELECT * FROM tiempos_orden
      WHERE orden_id=? AND (user_id=? OR ?='') AND end_ts IS NULL
      ORDER BY id DESC LIMIT 1
      `,
      [ordenId, userId, userId]
    );
    if (!running) return res.status(404).json({ error: 'NO_RUNNING_TIMER' });

    const duration = now - Number(running.start_ts || now);
    await runAsync(
      `UPDATE tiempos_orden SET end_ts=?, duration_ms=? WHERE id=?`,
      [now, duration, running.id]
    );
    const row = await getAsync(`SELECT * FROM tiempos_orden WHERE id=?`, [running.id]);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function resumenTimer(req, res) {
  try {
    const db = getDB();
    const { getAsync } = promisify(db);
    const ordenId = String(req.params.id);
    const userId = String(req.query.user_id || '');
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const today = todayStart.getTime();

    const running = await getAsync(
      `
      SELECT id, start_ts FROM tiempos_orden
      WHERE orden_id=? AND (user_id=? OR ?='') AND end_ts IS NULL
      ORDER BY id DESC LIMIT 1
      `,
      [ordenId, userId, userId]
    );

    const sumToday = await getAsync(
      `
      SELECT IFNULL(SUM(duration_ms),0) AS total
      FROM tiempos_orden
      WHERE orden_id=? AND (user_id=? OR ?='') AND end_ts IS NOT NULL AND start_ts >= ?
      `,
      [ordenId, userId, userId, today]
    );

    const sumAll = await getAsync(
      `
      SELECT IFNULL(SUM(duration_ms),0) AS total
      FROM tiempos_orden
      WHERE orden_id=? AND (user_id=? OR ?='') AND end_ts IS NOT NULL
      `,
      [ordenId, userId, userId]
    );

    res.json({
      running: !!running,
      running_since: running?.start_ts || null,
      total_today_ms: Number(sumToday?.total || 0),
      total_all_ms: Number(sumAll?.total || 0),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ====== rutas (compat doble) ======
// Si montas con app.use('/api', tiemposRoutes):
router.post('/ordenes/:id/timer/start', startTimer);
router.post('/ordenes/:id/timer/stop',  stopTimer);
router.get ('/ordenes/:id/timer/resumen', resumenTimer);

// Si montas con app.use('/api/ordenes', tiemposRoutes) o app.use('/api/tiempos', tiemposRoutes):
router.post('/:id/timer/start', startTimer);
router.post('/:id/timer/stop',  stopTimer);
router.get ('/:id/timer/resumen', resumenTimer);

module.exports = router;
