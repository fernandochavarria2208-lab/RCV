// backend/src/routes/reportesRoutes.js
const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requirePermission } = require('../middleware/requirePermission'); // ✅ permisos

// ----- helpers promisify -----
function promisify(db) {
  const getAsync = (sql, params = []) =>
    new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));
  const allAsync = (sql, params = []) =>
    new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
  return { getAsync, allAsync };
}

async function tableExists(db, name) {
  const { getAsync } = promisify(db);
  try {
    const r = await getAsync(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [name]
    );
    return !!r;
  } catch {
    return false;
  }
}

function dateRange(req) {
  const from = (req.query.from || req.query.desde || '').slice(0, 10);
  const to   = (req.query.to   || req.query.hasta || '').slice(0, 10);
  return { from, to };
}

// Aplica permiso a todas las rutas de este módulo (solo lectura de reportes)
router.use(requirePermission('reportes.view'));

/* ====== Resumen mensual ====== */
/* GET /api/reportes?mes=YYYY-MM   (compat)
   GET /api/reportes/mensual?mes=YYYY-MM (alias)
   GET /api?mes=YYYY-MM            (si montas en /api/reportes y llamas a /) */
async function mensualHandler(req, res) {
  try {
    const db = getDB();
    const { getAsync } = promisify(db);
    const { mes } = req.query;
    if (!mes) return res.status(400).json({ error: 'MES_REQUERIDO' });

    const desde = `${mes}-01`;
    const hasta = `${mes}-31`;

    const hasDoc = await tableExists(db, 'documentos');
    const hasGas = await tableExists(db, 'gastos');

    const ventas = hasDoc
      ? await getAsync(
          `
          SELECT
            IFNULL(SUM(subtotal_gravado),0) AS gravado,
            IFNULL(SUM(subtotal_exento),0)  AS exento,
            IFNULL(SUM(isv_15),0)           AS isv_15,
            IFNULL(SUM(isv_18),0)           AS isv_18,
            IFNULL(SUM(total),0)            AS total,
            COUNT(*)                        AS cantidad
          FROM documentos
          WHERE estado='emitido' AND fecha_emision >= ? AND fecha_emision <= ?
        `,
          [desde, hasta]
        )
      : { gravado: 0, exento: 0, isv_15: 0, isv_18: 0, total: 0, cantidad: 0 };

    const gastos = hasGas
      ? await getAsync(
          `
          SELECT
            IFNULL(SUM(monto_gravado),0) AS gravado,
            IFNULL(SUM(monto_exento),0)  AS exento,
            IFNULL(SUM(isv_15),0)        AS isv_15,
            IFNULL(SUM(isv_18),0)        AS isv_18,
            IFNULL(SUM(total),0)         AS total,
            COUNT(*)                     AS cantidad
          FROM gastos
          WHERE fecha >= ? AND fecha <= ?
        `,
          [desde, hasta]
        )
      : { gravado: 0, exento: 0, isv_15: 0, isv_18: 0, total: 0, cantidad: 0 };

    const neto = (Number(ventas.total) || 0) - (Number(gastos.total) || 0);
    res.json({ mes, ventas, gastos, neto });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.get('/', mensualHandler);
router.get('/mensual', mensualHandler);
// Prefijos (por si montas en /api)
router.get('/reportes', mensualHandler);
router.get('/reportes/mensual', mensualHandler);

/* ====== Ventas por día ====== */
/* GET /api/reportes/ventas?from=YYYY-MM-DD&to=YYYY-MM-DD */
async function ventasHandler(req, res) {
  try {
    const db = getDB();
    const { allAsync } = promisify(db);
    const { from, to } = dateRange(req);

    const hasDoc = await tableExists(db, 'documentos');
    if (!hasDoc) return res.json({ ventas_total: 0, ventas_por_dia: [] });

    const where = from && to ? `WHERE fecha_emision BETWEEN ? AND ?` : ``;
    const params = from && to ? [from, to] : [];
    const rows = await allAsync(
      `
      SELECT date(fecha_emision) AS fecha, SUM(total) AS total
      FROM documentos
      ${where}
      GROUP BY date(fecha_emision)
      ORDER BY fecha
    `,
      params
    );
    const ventas_total = (rows || []).reduce((a, r) => a + Number(r.total || 0), 0);
    res.json({ ventas_total, ventas_por_dia: rows || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.get('/ventas', ventasHandler);
router.get('/reportes/ventas', ventasHandler);

/* ====== Gastos por categoría ====== */
/* GET /api/reportes/gastos?from=YYYY-MM-DD&to=YYYY-MM-DD */
async function gastosHandler(req, res) {
  try {
    const db = getDB();
    const { allAsync } = promisify(db);
    const { from, to } = dateRange(req);

    const hasGas = await tableExists(db, 'gastos');
    if (!hasGas) return res.json({ gastos_total: 0, gastos_por_categoria: [] });

    const where = from && to ? `WHERE fecha BETWEEN ? AND ?` : ``;
    const params = from && to ? [from, to] : [];
    const rows = await allAsync(
      `
      SELECT COALESCE(categoria,'Sin categoría') AS categoria, SUM(total) AS total
      FROM gastos
      ${where}
      GROUP BY COALESCE(categoria,'Sin categoría')
    `,
      params
    );
    const gastos_total = (rows || []).reduce((a, r) => a + Number(r.total || 0), 0);
    res.json({ gastos_total, gastos_por_categoria: rows || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.get('/gastos', gastosHandler);
router.get('/reportes/gastos', gastosHandler);

/* ====== Finanzas combinadas ====== */
/* GET /api/reportes/finanzas?from=YYYY-MM-DD&to=YYYY-MM-DD */
async function finanzasHandler(req, res) {
  try {
    const db = getDB();
    const { allAsync } = promisify(db);
    const { from, to } = dateRange(req);

    const hasDoc = await tableExists(db, 'documentos');
    const hasGas = await tableExists(db, 'gastos');

    const ventas = hasDoc
      ? await allAsync(
          `
          SELECT date(fecha_emision) AS fecha, SUM(total) AS total
          FROM documentos
          ${from && to ? 'WHERE fecha_emision BETWEEN ? AND ?' : ''}
          GROUP BY date(fecha_emision)
        `,
          from && to ? [from, to] : []
        )
      : [];

    const gastos = hasGas
      ? await allAsync(
          `
          SELECT COALESCE(categoria,'Sin categoría') AS categoria, SUM(total) AS total
          FROM gastos
          ${from && to ? 'WHERE fecha BETWEEN ? AND ?' : ''}
          GROUP BY COALESCE(categoria,'Sin categoría')
        `,
          from && to ? [from, to] : []
        )
      : [];

    const ventas_total = (ventas || []).reduce((a, r) => a + Number(r.total || 0), 0);
    const gastos_total = (gastos || []).reduce((a, r) => a + Number(r.total || 0), 0);

    const ventas_por_dia = (ventas || []).map(v => ({
      fecha: v.fecha,
      total: Number(v.total || 0),
      isv15: 0, // si luego necesitas desglose por tasa, aquí lo agregas
      isv18: 0
    }));

    res.json({ ventas_total, gastos_total, ventas_por_dia, gastos_por_categoria: gastos || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.get('/finanzas', finanzasHandler);
router.get('/reportes/finanzas', finanzasHandler);

module.exports = router;
