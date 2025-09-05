// backend/src/routes/itemsRoutes.js
const express = require('express');
const router = express.Router();
const dbMod = require('../db/database'); // getDB() / initDB()

// --- helpers sqlite promisificados ---
function promisify(db) {
  const getAsync = (sql, params = []) =>
    new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));
  const allAsync = (sql, params = []) =>
    new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
  const runAsync = (sql, params = []) =>
    new Promise((res, rej) =>
      db.run(sql, params, function (e) {
        if (e) rej(e);
        else res(this);
      })
    );
  return { getAsync, allAsync, runAsync };
}

// --- DB segura (si initDB existe, la invoca) ---
function getSafeDB() {
  try { return dbMod.getDB(); }
  catch (e) {
    if (typeof dbMod.initDB === 'function') return dbMod.initDB();
    throw e;
  }
}

// --- util de precios (precio_final = precio; calcula base/impuesto segun tarifa) ---
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function priceFields(precioFinal, tarifa) {
  const pf = round2(precioFinal);
  const t = Number(tarifa);
  const pct = Number.isFinite(t) ? t : 15; // ✅ default 15%
  const base = pct > 0 ? round2(pf / (1 + pct / 100)) : pf;
  const isv  = round2(pf - base);
  return { precio_final: pf, base_imponible: base, impuesto_monto: isv };
}

// --- SELECT seguros (si no existe la tabla, retornan []) ---
async function safeAllProductos(db, whereSql, params, limit, offset) {
  const { allAsync } = promisify(db);
  try {
    return await allAsync(
      `
      SELECT id AS item_id, sku, nombre, tipo, precio, tarifa_isv, stock, activo
      FROM productos
      WHERE ${whereSql}
      ORDER BY nombre ASC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit)||20, Number(offset)||0]
    );
  } catch (e) {
    if ((e.message || '').includes('no such table')) return [];
    throw e;
  }
}

async function safeAllCatalogo(db, whereSql, params, limit, offset) {
  const { allAsync } = promisify(db);
  try {
    return await allAsync(
      `
      SELECT
        id AS item_id,
        NULL AS sku,
        nombre,
        LOWER(COALESCE(tipo, 'servicio')) AS tipo,
        COALESCE(precio, precio_base, 0) AS precio,
        COALESCE(impuesto_pct, tarifa_isv, 15) AS tarifa_isv,
        COALESCE(activo, 1) AS activo
      FROM catalogo
      WHERE ${whereSql}
      ORDER BY nombre ASC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit)||20, Number(offset)||0]
    );
  } catch (e) {
    if ((e.message || '').includes('no such table')) return [];
    throw e;
  }
}

// --- normalización salida unificada ---
function normalizeProd(row) {
  const tarifa = Number.isFinite(Number(row.tarifa_isv)) ? Number(row.tarifa_isv) : 15; // ✅ default 15%
  const fields = priceFields(Number(row.precio||0), tarifa);
  return {
    ref: `prod:${row.item_id}`,
    source: 'prod',
    item_id: row.item_id,
    sku: row.sku || null,
    nombre: row.nombre,
    tipo: String(row.tipo || 'producto').toLowerCase(),
    precio: Number(row.precio || 0),
    tarifa_isv: tarifa,
    precio_final: fields.precio_final,
    base_imponible: fields.base_imponible,
    impuesto_monto: fields.impuesto_monto,
    stock: Number(row.stock ?? 0),
    activo: Number(row.activo ?? 1),
  };
}

function normalizeCat(row) {
  const tarifa = Number.isFinite(Number(row.tarifa_isv)) ? Number(row.tarifa_isv) : 15; // ✅ default 15%
  const fields = priceFields(Number(row.precio||0), tarifa);
  return {
    ref: `cat:${row.item_id}`,
    source: 'cat',
    item_id: row.item_id,
    sku: null,
    nombre: row.nombre,
    tipo: String(row.tipo || 'servicio').toLowerCase(),
    precio: Number(row.precio || 0),
    tarifa_isv: tarifa,
    precio_final: fields.precio_final,
    base_imponible: fields.base_imponible,
    impuesto_monto: fields.impuesto_monto,
    stock: 0,                              // catálogo no lleva stock
    activo: Number(row.activo ?? 1),
  };
}

// ========== RUTAS ==========

// GET /api/items?q=texto&tipo=servicio|producto|repuesto&source=prod|cat&limit=20&offset=0&solo_activos=1
router.get('/items', async (req, res) => {
  try {
    const db = getSafeDB();
    const { q = '', tipo = '', source = '', limit = 20, offset = 0, solo_activos = '' } = req.query;

    // Filtros comunes
    const hasQ = q && String(q).trim() !== '';
    const likeNombre = hasQ ? `%${q}%` : '';
    const likeNombreSku = hasQ ? [`%${q}%`, `%${q}%`] : [];

    // Filtro tipo (si es válido)
    const tipoNorm = String(tipo || '').toLowerCase();
    const tipoFilter = ['producto','repuesto','servicio'].includes(tipoNorm) ? tipoNorm : '';

    // -------- Productos ----------
    let whereProd = '1=1';
    const paramsProd = [];
    if (hasQ) { whereProd += ' AND (nombre LIKE ? OR sku LIKE ?)'; paramsProd.push(...likeNombreSku); }
    if (tipoFilter) { whereProd += ' AND LOWER(tipo) = ?'; paramsProd.push(tipoFilter); }
    if (String(solo_activos) === '1') { whereProd += ' AND COALESCE(activo,1) = 1'; }

    // -------- Catálogo -----------
    let whereCat = '1=1';
    const paramsCat = [];
    if (hasQ) { whereCat += ' AND (nombre LIKE ?)'; paramsCat.push(likeNombre); }
    if (tipoFilter) { whereCat += ' AND LOWER(COALESCE(tipo, "servicio")) = ?'; paramsCat.push(tipoFilter); }
    if (String(solo_activos) === '1') { whereCat += ' AND COALESCE(activo,1) = 1'; }

    // Ejecuta según 'source' solicitado
    const s = String(source || '').toLowerCase();
    const wantProd = !s || s === 'prod';
    const wantCat  = !s || s === 'cat';

    let rowsProd = [];
    let rowsCat = [];

    if (wantProd) rowsProd = await safeAllProductos(db, whereProd, paramsProd, limit, offset);
    if (wantCat)  rowsCat  = await safeAllCatalogo(db, whereCat, paramsCat, limit, offset);

    // Normaliza y mezcla
    const list = [];
    if (wantProd) list.push(...rowsProd.map(normalizeProd));
    if (wantCat)  list.push(...rowsCat.map(normalizeCat));

    // Orden sencillo por nombre (ya vienen ordenados, pero mezcla puede intercalar)
    list.sort((a, b) => a.nombre.localeCompare(b.nombre));

    // Aplica "ventana" final si llamaron a ambos sources
    const off = Number(offset) || 0;
    const lim = Number(limit) || 20;
    const slice = (!s ? list.slice(off, off + lim) : list); // si pidieron ambos, cortamos; si no, ya aplicó LIMIT por tabla

    res.json(slice);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// GET /api/items/:ref   (ref = "prod:2" | "cat:5" | "2" -> intenta prod luego cat)
router.get('/items/:ref', async (req, res) => {
  try {
    const db = getSafeDB();
    const { getAsync } = promisify(db);
    const ref = String(req.params.ref || '');
    let src = null, id = null;

    if (ref.includes(':')) {
      const [pfx, num] = ref.split(':');
      src = pfx.toLowerCase();
      id = Number(num);
    } else {
      id = Number(ref);
    }
    if (!id) return res.status(400).json({ error: 'ID_INVALIDO' });

    let row = null;

    if (!src || src === 'prod') {
      try {
        row = await getAsync(
          `SELECT id AS item_id, sku, nombre, tipo, precio, tarifa_isv, stock, activo
           FROM productos WHERE id=?`, [id]
        );
        if (row) return res.json(normalizeProd(row));
      } catch (e) {
        if (!(e.message || '').includes('no such table')) throw e;
      }
    }

    if (!src || src === 'cat') {
      try {
        row = await getAsync(
          `SELECT id AS item_id,
                  NULL AS sku,
                  nombre,
                  LOWER(COALESCE(tipo,'servicio')) AS tipo,
                  COALESCE(precio, precio_base, 0) AS precio,
                  COALESCE(impuesto_pct, tarifa_isv, 15) AS tarifa_isv,
                  COALESCE(activo,1) AS activo
           FROM catalogo WHERE id=?`, [id]
        );
        if (row) return res.json(normalizeCat(row));
      } catch (e) {
        if (!(e.message || '').includes('no such table')) throw e;
      }
    }

    return res.status(404).json({ error: 'NO_ENCONTRADO' });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

module.exports = router;
