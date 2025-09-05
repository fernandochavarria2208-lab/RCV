// backend/src/routes/cotizacionesRoutes.js
const express = require('express');
const router = express.Router();
const dbMod = require('../db/database'); // soporta getDB() y opcional initDB()

// ✅ Guard de permisos
const { requirePermission } = require('../middleware/requirePermission');

// === Promesas utilitarias para sqlite3 ===
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

// === DB segura (evita crash si getDB() aún no fue inicializada) ===
function getSafeDB() {
  try {
    return dbMod.getDB();
  } catch (e) {
    if (typeof dbMod.initDB === 'function') {
      return dbMod.initDB();
    }
    throw e;
  }
}

// === Bootstrap de tablas (lazy, se ejecuta solo una vez al primer request) ===
let _bootstrapped = false;
async function ensureTablesOnce() {
  if (_bootstrapped) return;
  const db = getSafeDB();
  await new Promise((res, rej) =>
    db.exec(
      `
      CREATE TABLE IF NOT EXISTS cotizaciones (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha         TEXT DEFAULT (DATE('now')),
        cliente_id    INTEGER,
        subtotal      REAL DEFAULT 0,
        isv_total     REAL DEFAULT 0,
        total         REAL DEFAULT 0,
        estado        TEXT DEFAULT 'borrador', -- 'borrador' | 'aprobada' | 'rechazada'
        created_at    TEXT DEFAULT (DATETIME('now'))
      );

      CREATE TABLE IF NOT EXISTS cotizacion_items (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        cotizacion_id    INTEGER NOT NULL,
        item_id          INTEGER,                   -- puede referir a productos.id o catalogo.id
        tipo             TEXT NOT NULL CHECK (tipo IN ('servicio','repuesto','producto')),
        descripcion      TEXT,
        cantidad         REAL NOT NULL,
        precio_unitario  REAL NOT NULL,
        descuento_pct    REAL DEFAULT 0,            -- % (0..100)
        impuesto_pct     REAL DEFAULT 0,            -- % (0, 15, 18)
        base_linea       REAL DEFAULT 0,            -- cantidad * precio * (1 - desc%)
        impuesto_monto   REAL DEFAULT 0,
        total_linea      REAL DEFAULT 0,
        FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_cot_fec ON cotizaciones(fecha);
      CREATE INDEX IF NOT EXISTS idx_cot_items_cot ON cotizacion_items(cotizacion_id);
      `,
      (e) => (e ? rej(e) : res())
    )
  );
  _bootstrapped = true;
}

// === Helpers numéricos ===
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clamp = (n, min, max) => Math.min(Math.max(Number(n) || 0, min), max);

// === Lookups seguros (inventario / catálogo) ===
async function safeGetProducto(db, id) {
  const { getAsync } = promisify(db);
  try {
    return await getAsync(
      `SELECT id, nombre, tipo, tarifa_isv, precio FROM productos WHERE id=?`,
      [id]
    );
  } catch (e) {
    // si no existe tabla productos, devuelve null (no romper)
    if ((e.message || '').includes('no such table')) return null;
    throw e;
  }
}
async function safeGetCatalogo(db, id) {
  const { getAsync } = promisify(db);
  try {
    // mapear a formato homogéneo:
    // - precio FINAL calculado desde precio_base + impuesto_pct
    // - alias tarifa_isv = impuesto_pct
    return await getAsync(
      `SELECT 
         id, 
         nombre, 
         tipo, 
         COALESCE(impuesto_pct,0) AS tarifa_isv,
         (COALESCE(precio_base,0) * (1 + COALESCE(impuesto_pct,0)/100.0)) AS precio
       FROM catalogo 
       WHERE id=?`,
      [id]
    );
  } catch (e) {
    if ((e.message || '').includes('no such table')) return null;
    throw e;
  }
}

// === Normaliza línea según frontend enlazado ===
// Reglas:
// - Default del sistema: 15% a todo, pero permitir 0 o 18 (seleccionable).
// - Si el frontend envía impuesto (impuesto_pct o tarifa_isv), se respeta.
// - 'tipo' debe ser uno de: servicio | repuesto | producto.
function computeLineFromRaw(raw) {
  const tipo = String(raw.tipo || '').toLowerCase(); // 'servicio' | 'repuesto' | 'producto'
  const cantidad = Number(raw.cantidad || 0);
  const precio = Number(raw.precio_unitario || 0);
  if (!['servicio', 'repuesto', 'producto'].includes(tipo)) throw new Error('TIPO_INVALIDO');
  if (cantidad <= 0 || precio < 0) throw new Error('CANTIDAD_O_PRECIO_INVALIDO');

  const descripcion = raw.descripcion || null;

  // Descuento en % (acepta variantes del frontend)
  let descuento_pct = 0;
  if (raw.descuento_pct !== undefined && raw.descuento_pct !== null && raw.descuento_pct !== '') {
    descuento_pct = clamp(raw.descuento_pct, 0, 100);
  } else if (raw.descuento !== undefined && raw.descuento !== null && raw.descuento !== '') {
    const d = Number(raw.descuento);
    const bruto = cantidad * precio;
    if (d > 1) {
      descuento_pct = bruto > 0 ? clamp((d / bruto) * 100, 0, 100) : 0;
    } else if (d >= 0 && d <= 1) {
      descuento_pct = clamp(d * 100, 0, 100);
    }
  }

  // Impuesto (aceptar impuesto_pct o tarifa_isv)
  let impuesto_pct = null;
  if (raw.impuesto_pct !== undefined && raw.impuesto_pct !== null && raw.impuesto_pct !== '') {
    impuesto_pct = Number(raw.impuesto_pct);
  } else if (raw.tarifa_isv !== undefined && raw.tarifa_isv !== null && raw.tarifa_isv !== '') {
    impuesto_pct = Number(raw.tarifa_isv);
  }

  // ✅ Default 15% a todo si no viene nada (tal como pediste)
  if (impuesto_pct === null || Number.isNaN(impuesto_pct)) impuesto_pct = 15;

  // Aceptar solo 0/15/18; si viene otro, clamp al rango 0..100 (flexible)
  if (![0, 15, 18].includes(Number(impuesto_pct))) {
    impuesto_pct = clamp(impuesto_pct, 0, 100);
  }

  const base_bruta = cantidad * precio;
  const base_linea = round2(base_bruta * (1 - (descuento_pct / 100)));
  const impuesto_monto = round2(base_linea * (Number(impuesto_pct) / 100));
  const total_linea = round2(base_linea + impuesto_monto);

  return {
    tipo,
    descripcion,
    cantidad,
    precio,
    descuento_pct: round2(descuento_pct),
    impuesto_pct: round2(impuesto_pct),
    base_linea,
    impuesto_monto,
    total_linea,
  };
}

// ——— helpers para interpretar la referencia del item (si el frontend manda pistas) ———
// Soporta:
//  - raw.item_ref = 'prod:123' | 'cat:456'
//  - raw.source / raw.origen = 'prod'|'producto'|'productos' | 'cat'|'catalogo' (prioridad)
//  - si no hay pista: intenta ambas tablas; si 'tipo' === 'servicio', prioriza catálogo.
function parseItemSource(raw) {
  let prefer = null; // 'prod' | 'cat' | null
  let id = raw.item_id;

  if (typeof raw.item_ref === 'string') {
    const s = raw.item_ref.toLowerCase();
    if (s.startsWith('prod:')) { prefer = 'prod'; id = Number(s.split(':')[1]); }
    if (s.startsWith('cat:'))  { prefer = 'cat';  id = Number(s.split(':')[1]); }
  }
  const src = (raw.source || raw.origen || '').toString().toLowerCase();
  if (['prod','producto','productos'].includes(src)) prefer = 'prod';
  if (['cat','catalogo'].includes(src)) prefer = 'cat';

  return { prefer, id: Number(id || 0) || null };
}

// ✅ Toda la sección de cotizaciones requiere permiso de VER
router.use(requirePermission('cotizaciones.view'));

// === Búsqueda unificada para autocompletar ===
// GET /api/cotizaciones/items/buscar?q=texto&tipo=servicio|repuesto|producto&limit=20
router.get('/cotizaciones/items/buscar', async (req, res) => {
  try {
    await ensureTablesOnce();
    const db = getSafeDB();
    const { allAsync } = promisify(db);
    const { q = '', tipo, limit = 20 } = req.query;

    // Sanitiza y tokeniza
    const raw = String(q || '').trim().replace(/[%_]/g, '');
    const tokens = raw ? raw.split(/\s+/).filter(Boolean) : [];
    const L = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));

    // Construye WHERE dinámico
    const whereTokens = (alias) => tokens.map(() => `(${alias}.nombre LIKE ? OR ${alias}.sku LIKE ?)`).join(' AND ');
    const paramsFromTokens = () => tokens.flatMap(tok => [`%${tok}%`, `%${tok}%`]);

    // Buscar en productos (precio = final; tarifa_isv ya guardada)
    let productos = [];
    try {
      const conds = [];
      const params = [];
      if (tipo && ['servicio','repuesto','producto'].includes(tipo)) {
        conds.push('p.tipo = ?'); params.push(tipo);
      }
      if (tokens.length) { conds.push(whereTokens('p')); params.push(...paramsFromTokens()); }
      const sqlProd = `
        SELECT
          'prod' AS source,
          p.id    AS item_id,
          p.nombre,
          p.sku,
          p.tipo,
          p.precio AS precio_sugerido,   -- PRECIO FINAL
          p.tarifa_isv AS tarifa_isv,
          COALESCE(p.activo,1) AS activo,
          p.stock
        FROM productos p
        ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
        ORDER BY p.nombre
        LIMIT ?
      `;
      productos = await allAsync(sqlProd, [...params, L]);
    } catch (e) {
      // si no existe la tabla, seguimos solo con catálogo
      if (!String(e.message||'').includes('no such table')) throw e;
    }

    // Buscar en catálogo (calcular precio_final desde precio_base + impuesto_pct)
    let catalogo = [];
    try {
      const conds = [];
      const params = [];
      if (tipo && ['servicio','repuesto','producto'].includes(tipo)) {
        conds.push('c.tipo = ?'); params.push(tipo);
      }
      if (tokens.length) { conds.push(whereTokens('c')); params.push(...paramsFromTokens()); }
      const sqlCat = `
        SELECT
          'cat' AS source,
          c.id  AS item_id,
          c.nombre,
          c.sku,
          c.tipo,
          (COALESCE(c.precio_base,0) * (1 + COALESCE(c.impuesto_pct,0)/100.0)) AS precio_sugerido, -- PRECIO FINAL
          COALESCE(c.impuesto_pct,0) AS tarifa_isv,
          COALESCE(c.activo,1) AS activo,
          NULL AS stock
        FROM catalogo c
        ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
        ORDER BY c.nombre
        LIMIT ?
      `;
      catalogo = await allAsync(sqlCat, [...params, L]);
    } catch (e) {
      if (!String(e.message||'').includes('no such table')) throw e;
    }

    // Unir, ordenar y recortar
    const merged = [...productos, ...catalogo]
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .slice(0, L)
      .map(r => ({
        // Formato unificado para el frontend
        item_ref: `${r.source}:${r.item_id}`,
        source: r.source,            // 'prod' | 'cat'
        item_id: r.item_id,
        tipo: r.tipo,                // 'servicio' | 'repuesto' | 'producto'
        nombre: r.nombre,
        sku: r.sku || null,
        tarifa_isv: Number(r.tarifa_isv || 0), // 0|15|18
        precio_sugerido: Number(r.precio_sugerido || 0), // PRECIO FINAL sugerido
        stock: r.stock ?? null,
        activo: Number(r.activo || 0)
      }));

    res.json(merged);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === Crear cotización ===
// POST /api/cotizaciones  { cliente_id, fecha, items:[{item_id?,item_ref?,source?,origen?,tipo?,descripcion?,cantidad,precio_unitario,descuento|descuento_pct,impuesto_pct|tarifa_isv}] }
router.post('/cotizaciones', requirePermission('cotizaciones.edit'), async (req, res) => {
  let db;
  try {
    await ensureTablesOnce();
    db = getSafeDB();
    // 👇 Declaramos una sola vez y reutilizamos ambos
    const { getAsync, runAsync } = promisify(db);

    const { cliente_id = null, fecha = null, items = [] } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'ITEMS_REQUERIDOS' });
    }

    await runAsync('BEGIN TRANSACTION');

    const insCab = await runAsync(
      `INSERT INTO cotizaciones (fecha, cliente_id, subtotal, isv_total, total, estado)
       VALUES (?, ?, 0, 0, 0, 'borrador')`,
      [fecha || null, cliente_id || null]
    );
    const cotId = insCab.lastID;

    let subtotal = 0;
    let isv_total = 0;

    for (const raw0 of items) {
      const raw = { ...raw0 };

      // —— Resolver desde inventario o catálogo ——
      const { prefer, id } = parseItemSource(raw);
      let prod = null, cat = null;

      if (id) {
        if (prefer === 'prod') {
          prod = await safeGetProducto(db, id);
          if (!prod) cat = await safeGetCatalogo(db, id);
        } else if (prefer === 'cat') {
          cat = await safeGetCatalogo(db, id);
          if (!cat) prod = await safeGetProducto(db, id);
        } else {
          // sin preferencia explícita: si dice servicio, intenta primero catálogo
          if (String(raw.tipo || '').toLowerCase() === 'servicio') {
            cat = await safeGetCatalogo(db, id);
            if (!cat) prod = await safeGetProducto(db, id);
          } else {
            prod = await safeGetProducto(db, id);
            if (!prod) cat = await safeGetCatalogo(db, id);
          }
        }
      }

      // Completar campos faltantes desde la fuente detectada
      if (prod) {
        if (!raw.tipo) raw.tipo = prod.tipo || 'producto';
        if (!raw.descripcion) raw.descripcion = prod.nombre;
        if (raw.impuesto_pct === undefined && raw.tarifa_isv === undefined && prod.tarifa_isv != null) {
          raw.impuesto_pct = prod.tarifa_isv;
        }
        if (raw.precio_unitario == null && prod.precio != null) raw.precio_unitario = prod.precio;
      } else if (cat) {
        if (!raw.tipo) raw.tipo = (cat.tipo || 'servicio');
        if (!raw.descripcion) raw.descripcion = cat.nombre;
        if (raw.impuesto_pct === undefined && raw.tarifa_isv === undefined && cat.tarifa_isv != null) {
          raw.impuesto_pct = cat.tarifa_isv;
        }
        if (raw.precio_unitario == null && cat.precio != null) raw.precio_unitario = cat.precio;
      }

      const line = computeLineFromRaw(raw);

      subtotal = round2(subtotal + line.base_linea);
      isv_total = round2(isv_total + line.impuesto_monto);

      await runAsync(
        `INSERT INTO cotizacion_items
          (cotizacion_id, item_id, tipo, descripcion, cantidad, precio_unitario, descuento_pct, impuesto_pct, base_linea, impuesto_monto, total_linea)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          cotId,
          raw.item_id ?? null,
          line.tipo,
          line.descripcion,
          line.cantidad,
          line.precio,
          line.descuento_pct,
          line.impuesto_pct,
          line.base_linea,
          line.impuesto_monto,
          line.total_linea,
        ]
      );
    }

    const total = round2(subtotal + isv_total);
    await runAsync(`UPDATE cotizaciones SET subtotal=?, isv_total=?, total=? WHERE id=?`, [
      subtotal,
      isv_total,
      total,
      cotId,
    ]);

    await runAsync('COMMIT');

    // 👇 Reutilizamos getAsync ya declarado arriba (no lo redeclaramos)
    const created = await getAsync(`SELECT * FROM cotizaciones WHERE id=?`, [cotId]);
    res.status(201).json(created);
  } catch (e) {
    try {
      if (db) await promisify(db).runAsync('ROLLBACK');
    } catch {}
    res.status(500).json({ error: e.message || String(e) });
  }
});

// === Listado (compatible con frontend nuevo) ===
// GET /api/cotizaciones?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=20&offset=0&q=texto
router.get('/cotizaciones', async (req, res) => {
  try {
    await ensureTablesOnce();
    const db = getSafeDB();
    const { allAsync } = promisify(db);
    const { from, to, limit = 20, offset = 0, q = '' } = req.query;

    let where = '1=1';
    const params = [];

    if (from) { where += ' AND fecha >= ?'; params.push(from); }
    if (to)   { where += ' AND fecha <= ?'; params.push(to); }
    if (q && String(q).trim() !== '') {
      where += ` AND (
        CAST(id AS TEXT) LIKE '%' || ? || '%' OR
        id IN (SELECT cotizacion_id FROM cotizacion_items WHERE descripcion LIKE '%' || ? || '%')
      )`;
      params.push(q, q);
    }

    const rows = await allAsync(
      `SELECT id, fecha, cliente_id, subtotal, isv_total, total, estado, created_at
         FROM cotizaciones
        WHERE ${where}
        ORDER BY date(fecha) DESC, id DESC
        LIMIT ? OFFSET ?`,
      [...params, Number(limit) || 20, Number(offset) || 0]
    );

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === Detalle con items (devuelve alias esperados por el frontend) ===
// GET /api/cotizaciones/:id
router.get('/cotizaciones/:id', async (req, res) => {
  try {
    await ensureTablesOnce();
    const db = getSafeDB();
    const { getAsync, allAsync } = promisify(db);
    const { id } = req.params;

    const cab = await getAsync(
      `SELECT id, fecha, cliente_id, subtotal, isv_total, total, estado, created_at
         FROM cotizaciones WHERE id=?`,
      [id]
    );
    if (!cab) return res.status(404).json({ error: 'NO_ENCONTRADA' });

    const items = await allAsync(
      `SELECT id, item_id, tipo, descripcion, cantidad, precio_unitario, descuento_pct, impuesto_pct, base_linea, impuesto_monto, total_linea
         FROM cotizacion_items
        WHERE cotizacion_id=?
        ORDER BY id ASC`,
      [id]
    );

    const itemsConAlias = items.map((r) => ({
      ...r,
      tarifa_isv: r.impuesto_pct, // alias para el frontend
      descuento: r.descuento_pct, // alias en %
    }));

    res.json({ ...cab, items: itemsConAlias });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
