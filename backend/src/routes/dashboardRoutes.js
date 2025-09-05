"use strict";

const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requirePermission } = require('../middleware/requirePermission');

const IS_PG = (process.env.DB_ENGINE || '').toLowerCase().includes('postg');

// Health
router.get('/_alive', (_req, res) => res.json({ ok: true, mod: 'dashboard' }));

function promisify(db) {
  const getAsync = (sql, params=[]) => new Promise((res, rej)=>db.get(sql, params, (e,r)=>e?rej(e):res(r)));
  const allAsync = (sql, params=[]) => new Promise((res, rej)=>db.all(sql, params, (e,r)=>e?rej(e):res(r)));
  return { getAsync, allAsync };
}

async function tableExists(db, name) {
  const { getAsync } = promisify(db);
  if (IS_PG) {
    const r = await getAsync(`SELECT to_regclass($1) AS t`, [name]).catch(()=>null);
    return !!(r && r.t);
  }
  const r = await getAsync(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]).catch(()=>null);
  return !!r;
}

function monthRange(date = new Date()) {
  const y = date.getFullYear(); const m = date.getMonth();
  const from = new Date(Date.UTC(y, m, 1));
  const to   = new Date(Date.UTC(y, m+1, 0, 23,59,59,999));
  const iso = d => d.toISOString().slice(0,10);
  return { from: iso(from), to: iso(to) };
}
function prevMonthRange() { const d = new Date(); d.setMonth(d.getMonth()-1); return monthRange(d); }

// KPIs
router.get('/kpis', requirePermission('dashboard.view'), async (_req, res) => {
  try {
    const db = getDB(); const { getAsync } = promisify(db);
    const { from, to } = monthRange();
    const { from: fromPrev, to: toPrev } = prevMonthRange();

    // Órdenes activas
    let activas = 0;
    if (await tableExists(db, 'ordenes')) {
      const cond = IS_PG
        ? `LOWER(COALESCE(estado,estatus,'')) NOT ILIKE '%entreg%' AND LOWER(COALESCE(estado,estatus,'')) NOT ILIKE '%cerrad%' AND LOWER(COALESCE(estado,estatus,'')) NOT ILIKE '%anul%'`
        : `LOWER(COALESCE(estado,estatus,'')) NOT LIKE '%entreg%' AND LOWER(COALESCE(estado,estatus,'')) NOT LIKE '%cerrad%' AND LOWER(COALESCE(estado,estatus,'')) NOT LIKE '%anul%'`;
      const rA = await getAsync(`SELECT COALESCE(COUNT(*),0) AS c FROM ordenes WHERE ${cond}`).catch(()=>({c:0}));
      activas = Number(rA?.c||0);
    }

    // Entregas de hoy
    let paraHoy = 0;
    if (await tableExists(db, 'ordenes')) {
      const hoy = new Date().toISOString().slice(0,10);
      const rH = await getAsync(`
        SELECT COALESCE(COUNT(*),0) AS c
        FROM ordenes
        WHERE CAST(COALESCE(fecha_entrega, entrega) AS DATE) = ${IS_PG ? '$1' : '?'}
          AND LOWER(COALESCE(estado,estatus,'')) NOT ${IS_PG ? 'ILIKE' : 'LIKE'} '%entreg%'
      `,[hoy]).catch(()=>({c:0}));
      paraHoy = Number(rH?.c||0);
    }

    // Ingresos del mes (documentos emitidos)
    let ingresosMes = 0, ingresosMesPrev = 0;
    if (await tableExists(db, 'documentos')) {
      const rV  = await getAsync(`SELECT COALESCE(SUM(total),0) AS total FROM documentos WHERE estado='emitido' AND CAST(fecha_emision AS DATE) BETWEEN ${IS_PG?'$1 AND $2':'? AND ?'}`, [from,to]).catch(()=>({total:0}));
      const rV2 = await getAsync(`SELECT COALESCE(SUM(total),0) AS total FROM documentos WHERE estado='emitido' AND CAST(fecha_emision AS DATE) BETWEEN ${IS_PG?'$1 AND $2':'? AND ?'}`, [fromPrev,toPrev]).catch(()=>({total:0}));
      ingresosMes = Number(rV?.total||0); ingresosMesPrev = Number(rV2?.total||0);
    }

    // Clientes nuevos del mes
    let clientesNuevos = 0, clientesNuevosPrev = 0;
    if (await tableExists(db, 'clientes')) {
      const rC  = await getAsync(`SELECT COALESCE(COUNT(*),0) AS c FROM clientes WHERE CAST(COALESCE(fecha_creacion, created_at, fecha) AS DATE) BETWEEN ${IS_PG?'$1 AND $2':'? AND ?'}`, [from,to]).catch(()=>({c:0}));
      const rC2 = await getAsync(`SELECT COALESCE(COUNT(*),0) AS c FROM clientes WHERE CAST(COALESCE(fecha_creacion, created_at, fecha) AS DATE) BETWEEN ${IS_PG?'$1 AND $2':'? AND ?'}`, [fromPrev,toPrev]).catch(()=>({c:0}));
      clientesNuevos = Number(rC?.c||0); clientesNuevosPrev = Number(rC2?.c||0);
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
        activas: '—',
        paraHoy: '—',
        ingresosMes: tendencia(ingresosMes, ingresosMesPrev),
        clientesNuevos: tendencia(clientesNuevos, clientesNuevosPrev),
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Panel
router.get('/panel', requirePermission('dashboard.view'), async (req, res) => {
  try {
    const db = getDB(); const { allAsync } = promisify(db);
    const rol = String(req.query.rol||'').toLowerCase();
    const user = String(req.query.user||'').toLowerCase();
    const hoy = new Date().toISOString().slice(0,10);

    const hasOrdenes = await tableExists(db, 'ordenes');
    if (!hasOrdenes) return res.json({ en_proceso:[], vencidas:[], asignadas:[] });

    const qBase = `
      SELECT 
        id,
        COALESCE(placa, vehiPlaca, patente, '') AS placa,
        LOWER(COALESCE(estado, estatus, '')) AS estado,
        CAST(COALESCE(fecha, fecha_creacion, createdAt, creadoEn) AS DATE) AS fecha_creacion,
        CAST(COALESCE(fecha_entrega, entrega, '' ) AS DATE) AS fecha_entrega,
        COALESCE(tecnico, asignadoA, asignado, asignado_a, '') AS asignado
      FROM ordenes
    `;

    const likeNot = IS_PG ? 'NOT ILIKE' : 'NOT LIKE';

    const en_proceso = await allAsync(`
      ${qBase}
      WHERE estado ILIKE '%proceso%' OR estado ILIKE '%diagn%' OR estado ILIKE '%pend%' OR estado ILIKE '%repar%' OR estado ILIKE '%espera%'
      ORDER BY fecha_creacion DESC
      LIMIT 50
    `);

    const vencidas = await allAsync(`
      ${qBase}
      WHERE fecha_entrega IS NOT NULL AND fecha_entrega < ${IS_PG?'$1':'?'} AND estado ${likeNot} '%entreg%' AND estado ${likeNot} '%cerrad%'
      ORDER BY fecha_entrega ASC
      LIMIT 50
    `,[hoy]);

    let asignadas = [];
    if (user) {
      asignadas = await allAsync(`
        ${qBase}
        WHERE LOWER(COALESCE(tecnico, asignadoA, asignado, asignado_a, '')) ${IS_PG?'ILIKE':'LIKE'} ${IS_PG?"('%' || $1 || '%')":"?}
        ORDER BY fecha_creacion DESC
        LIMIT 50
      `,[user]);
    }

    res.json({ en_proceso, vencidas, asignadas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
