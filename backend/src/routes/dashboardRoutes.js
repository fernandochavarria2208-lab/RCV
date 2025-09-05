// backend/src/routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requirePermission } = require('../middleware/requirePermission'); // ⬅️ singular

// Helpers promisify
function promisify(db) {
  const getAsync = (sql, params=[]) => new Promise((res, rej)=>db.get(sql, params, (e,r)=>e?rej(e):res(r)));
  const allAsync = (sql, params=[]) => new Promise((res, rej)=>db.all(sql, params, (e,r)=>e?rej(e):res(r)));
  const runAsync = (sql, params=[]) => new Promise((res, rej)=>db.run(sql, params, function(e){e?rej(e):res(this)}));
  return { getAsync, allAsync, runAsync };
}

async function tableExists(db, name) {
  const { getAsync } = promisify(db);
  const r = await getAsync(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]).catch(()=>null);
  return !!r;
}
function monthRange(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-11
  const from = new Date(Date.UTC(y, m, 1));
  const to   = new Date(Date.UTC(y, m+1, 0, 23,59,59,999));
  const iso = d => d.toISOString().slice(0,10);
  return { from: iso(from), to: iso(to) };
}
function prevMonthRange() {
  const d = new Date(); d.setMonth(d.getMonth()-1);
  return monthRange(d);
}

/* ======================================
   KPIs reales (defensivos)
   GET /api/dashboard/kpis
   ====================================== */
router.get('/dashboard/kpis', requirePermission('dashboard.view'), async (_req, res) => {
  try {
    const db = getDB(); const { getAsync } = promisify(db);
    const { from, to } = monthRange();
    const { from: fromPrev, to: toPrev } = prevMonthRange();

    // Órdenes activas (si existe tabla ordenes)
    let activas = 0, activasPrev = 0;
    if (await tableExists(db, 'ordenes')) {
      // Consideramos activas las que NO están cerradas/entregadas/anuladas
      const qAct = `SELECT COUNT(*) AS c FROM ordenes WHERE LOWER(COALESCE(estado,estatus,'')) NOT GLOB '*entreg*' AND LOWER(COALESCE(estado,estatus,'')) NOT GLOB '*cerrad*' AND LOWER(COALESCE(estado,estatus,'')) NOT GLOB '*anul*'`;
      const rA = await getAsync(qAct).catch(()=>({c:0}));
      activas = Number(rA?.c||0);
      // “prev” no aplica por ser estado actual ⇒ 0
      activasPrev = activas;
    }

    // Entregas de HOY (si existe ordenes con fecha_entrega)
    let paraHoy = 0, paraHoyPrev = 0;
    if (await tableExists(db, 'ordenes')) {
      const hoy = new Date().toISOString().slice(0,10);
      const rH = await getAsync(`
        SELECT COUNT(*) AS c
        FROM ordenes
        WHERE date(COALESCE(fecha_entrega, entrega)) = ? 
          AND LOWER(COALESCE(estado,estatus,'')) NOT GLOB '*entreg*'
      `,[hoy]).catch(()=>({c:0}));
      paraHoy = Number(rH?.c||0);
      paraHoyPrev = paraHoy;
    }

    // Ingresos del mes (documentos emitidos)
    let ingresosMes = 0, ingresosMesPrev = 0;
    if (await tableExists(db, 'documentos')) {
      const rV = await getAsync(`
        SELECT IFNULL(SUM(total),0) AS total
        FROM documentos
        WHERE estado='emitido' AND date(fecha_emision) BETWEEN ? AND ?
      `,[from,to]).catch(()=>({total:0}));
      ingresosMes = Number(rV?.total||0);

      const rV2 = await getAsync(`
        SELECT IFNULL(SUM(total),0) AS total
        FROM documentos
        WHERE estado='emitido' AND date(fecha_emision) BETWEEN ? AND ?
      `,[fromPrev,toPrev]).catch(()=>({total:0}));
      ingresosMesPrev = Number(rV2?.total||0);
    }

    // Clientes nuevos del mes (si existe tabla clientes)
    let clientesNuevos = 0, clientesNuevosPrev = 0;
    if (await tableExists(db, 'clientes')) {
      const rC = await getAsync(`
        SELECT IFNULL(COUNT(*),0) AS c
        FROM clientes
        WHERE date(COALESCE(fecha_creacion, created_at, fecha)) BETWEEN ? AND ?
      `,[from,to]).catch(()=>({c:0}));
      clientesNuevos = Number(rC?.c||0);

      const rC2 = await getAsync(`
        SELECT IFNULL(COUNT(*),0) AS c
        FROM clientes
        WHERE date(COALESCE(fecha_creacion, created_at, fecha)) BETWEEN ? AND ?
      `,[fromPrev,toPrev]).catch(()=>({c:0}));
      clientesNuevosPrev = Number(rC2?.c||0);
    }

    const tendencia = (curr, prev) => {
      if (!prev) return (curr? '+∞' : '0');
      const delta = curr - prev;
      const pct = (delta / (prev||1)) * 100;
      const sign = delta>0 ? '+' : (delta<0 ? '' : '±');
      return `${sign}${pct.toFixed(0)}%`;
    };

    res.json({
      activas,
      paraHoy,
      ingresosMes,
      clientesNuevos,
      tendencias: {
        activas: '—', // estado puntual
        paraHoy: '—', // estado puntual
        ingresosMes: tendencia(ingresosMes, ingresosMesPrev),
        clientesNuevos: tendencia(clientesNuevos, clientesNuevosPrev),
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ======================================
   Panel por rol
   GET /api/dashboard/panel?rol=tech|manager|frontdesk|parts|qa&user=<texto>
   ====================================== */
router.get('/dashboard/panel', requirePermission('dashboard.view'), async (req, res) => {
  try {
    const db = getDB(); const { allAsync } = promisify(db);
    const rol = String(req.query.rol||'').toLowerCase();
    const user = String(req.query.user||'').toLowerCase();
    const hoy = new Date().toISOString().slice(0,10);

    const hasOrdenes = await tableExists(db, 'ordenes');
    if (!hasOrdenes) {
      return res.json({ en_proceso:[], vencidas:[], asignadas:[] });
    }

    // util estado “en proceso”
    const qBase = `
      SELECT 
        id,
        COALESCE(placa, vehiPlaca, patente, '') AS placa,
        LOWER(COALESCE(estado, estatus, '')) AS estado,
        date(COALESCE(fecha, fecha_creacion, createdAt, creadoEn)) AS fecha_creacion,
        date(COALESCE(fecha_entrega, entrega, '' )) AS fecha_entrega,
        COALESCE(tecnico, asignadoA, asignado, asignado_a, '') AS asignado
      FROM ordenes
    `;

    const en_proceso = await allAsync(`
      ${qBase}
      WHERE estado GLOB '*proceso*' OR estado GLOB '*diagn*' OR estado GLOB '*pend*' OR estado GLOB '*repar*' OR estado GLOB '*espera*'
      ORDER BY fecha_creacion DESC
      LIMIT 50
    `);

    const vencidas = await allAsync(`
      ${qBase}
      WHERE fecha_entrega IS NOT NULL AND fecha_entrega < ? AND estado NOT GLOB '*entreg*' AND estado NOT GLOB '*cerrad*'
      ORDER BY fecha_entrega ASC
      LIMIT 50
    `,[hoy]);

    let asignadas = [];
    if (user) {
      asignadas = await allAsync(`
        ${qBase}
        WHERE LOWER(COALESCE(tecnico, asignadoA, asignado, asignado_a, '')) LIKE ?
        ORDER BY fecha_creacion DESC
        LIMIT 50
      `,[`%${user}%`]);
    }

    res.json({ en_proceso, vencidas, asignadas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
