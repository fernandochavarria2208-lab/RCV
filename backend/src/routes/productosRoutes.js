// backend/src/routes/productosRoutes.js
const express = require('express');
const router = express.Router();
const dbMod = require('../db/database'); // getDB() / initDB()
const { requirePermission } = require('../middleware/requirePermission'); // ✅ permisos (singular)

// ---------- helpers sqlite a promesas ----------
function promisify(db) {
  const getAsync = (sql, params = []) =>
    new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));
  const allAsync = (sql, params = []) =>
    new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
  const runAsync = (sql, params = []) =>
    new Promise((res, rej) => db.run(sql, params, function (e) { if (e) rej(e); else res(this); }));
  return { getAsync, allAsync, runAsync };
}
function getSafeDB() {
  try { return dbMod.getDB(); }
  catch (e) { if (typeof dbMod.initDB === 'function') return dbMod.initDB(); throw e; }
}
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
function priceFields(precioFinal, tarifa) {
  const pf = round2(precioFinal);
  let t  = Number(tarifa);
  if (!Number.isFinite(t)) t = 15;     // ✅ default 15%
  if (t <= 0) return { precio_final: pf, base_imponible: pf, impuesto_monto: 0 };
  const base = round2(pf / (1 + t / 100));
  const isv  = round2(pf - base);
  return { precio_final: pf, base_imponible: base, impuesto_monto: isv };
}

// ---------- bootstrap + migración (lazy) ----------
let _booted = false;
async function ensureTablesOnce() {
  if (_booted) return;
  const db = getSafeDB();
  const { allAsync, runAsync } = promisify(db);

  // Crea tabla si no existe (sin defaults con funciones)
  await new Promise((resolve, reject) =>
    db.exec(`
      CREATE TABLE IF NOT EXISTS productos (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        sku            TEXT,
        nombre         TEXT NOT NULL,
        tipo           TEXT NOT NULL DEFAULT 'producto' CHECK (tipo IN ('producto','repuesto','servicio')),
        precio         REAL NOT NULL DEFAULT 0,
        tarifa_isv     REAL NOT NULL DEFAULT 15,   -- ✅ default 15
        stock          REAL NOT NULL DEFAULT 0,
        activo         INTEGER NOT NULL DEFAULT 1,
        precio_final   REAL NOT NULL DEFAULT 0,
        base_imponible REAL NOT NULL DEFAULT 0,
        impuesto_monto REAL NOT NULL DEFAULT 0,
        created_at     TEXT,
        updated_at     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_prod_nombre ON productos(nombre);
      CREATE INDEX IF NOT EXISTS idx_prod_sku ON productos(sku);
    `, err => err ? reject(err) : resolve())
  );

  // Detecta columnas existentes
  const cols = await allAsync(`PRAGMA table_info(productos)`);
  const names = new Set(cols.map(c => c.name));

  // Agrega columnas faltantes (sin DEFAULT con funciones)
  const alters = [];
  if (!names.has('precio_final'))   alters.push(`ALTER TABLE productos ADD COLUMN precio_final   REAL NOT NULL DEFAULT 0;`);
  if (!names.has('base_imponible')) alters.push(`ALTER TABLE productos ADD COLUMN base_imponible REAL NOT NULL DEFAULT 0;`);
  if (!names.has('impuesto_monto')) alters.push(`ALTER TABLE productos ADD COLUMN impuesto_monto REAL NOT NULL DEFAULT 0;`);
  if (!names.has('created_at'))     alters.push(`ALTER TABLE productos ADD COLUMN created_at     TEXT;`);
  if (!names.has('updated_at'))     alters.push(`ALTER TABLE productos ADD COLUMN updated_at     TEXT;`);

  if (alters.length) {
    await new Promise((resolve, reject) => db.run('BEGIN', err => err ? reject(err) : resolve()));
    try {
      for (const sql of alters) await runAsync(sql);

      // Recalcula precios y rellena timestamps para filas existentes
      await runAsync(`
        UPDATE productos
           SET precio_final = CASE WHEN precio_final IS NULL OR precio_final = 0 THEN precio ELSE precio_final END,
               base_imponible = CASE
                                  WHEN tarifa_isv IS NULL OR tarifa_isv = 0
                                    THEN COALESCE(precio_final, precio)
                                  ELSE ROUND(COALESCE(precio_final, precio) / (1 + (tarifa_isv/100.0)), 2)
                                END,
               impuesto_monto = ROUND(COALESCE(precio_final, precio) - base_imponible, 2)
      `);

      await runAsync(`
        UPDATE productos
           SET created_at = COALESCE(created_at, DATETIME('now')),
               updated_at = COALESCE(updated_at, DATETIME('now'))
         WHERE created_at IS NULL OR updated_at IS NULL
      `);

      await new Promise((resolve, reject) => db.run('COMMIT', err => err ? reject(err) : resolve()));
    } catch (e) {
      await new Promise(resolve => db.run('ROLLBACK', () => resolve()));
      throw e;
    }
  }

  _booted = true;
}
router.use(async (_req, _res, next) => { try { await ensureTablesOnce(); next(); } catch (e) { next(e); } });

// ---------- handlers ----------
async function listProductos(req, res) {
  try {
    const db = getSafeDB();
    const { allAsync } = promisify(db);
    const { limit = 50, offset = 0, q = '', solo_activos = '' } = req.query;

    let where = '1=1';
    const params = [];
    if (q && String(q).trim() !== '') {
      where += ` AND (nombre LIKE '%' || ? || '%' OR sku LIKE '%' || ? || '%')`;
      params.push(q, q);
    }
    if (String(solo_activos) === '1') where += ` AND activo = 1`;

    const rows = await allAsync(
      `SELECT id, sku, nombre, tipo, precio, tarifa_isv, stock, activo,
              precio_final, base_imponible, impuesto_monto
         FROM productos
        WHERE ${where}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...params, Number(limit) || 50, Number(offset) || 0]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message || String(e) }); }
}

async function getProducto(req, res) {
  try {
    const db = getSafeDB();
    const { getAsync } = promisify(db);
    const row = await getAsync(
      `SELECT id, sku, nombre, tipo, precio, tarifa_isv, stock, activo,
              precio_final, base_imponible, impuesto_monto
         FROM productos WHERE id=?`, [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'NO_ENCONTRADO' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message || String(e) }); }
}

async function createProducto(req, res) {
  const db = getSafeDB();
  const { getAsync, runAsync } = promisify(db);
  try {
    const {
      sku = null,
      nombre,
      tipo = 'producto',
      precio = 0,           // PRECIO FINAL
      tarifa_isv = 15,      // ✅ default 15
      stock = 0,
      activo = 1
    } = req.body || {};

    if (!nombre || String(nombre).trim() === '') {
      return res.status(400).json({ error: 'NOMBRE_REQUERIDO' });
    }
    let tipoNorm = String(tipo).toLowerCase();
    if (!['producto','repuesto','servicio'].includes(tipoNorm)) {
      return res.status(400).json({ error: 'TIPO_INVALIDO' });
    }

    // ✅ asegura 15% por defecto si viene inválido/NaN
    let t = Number(tarifa_isv);
    if (!Number.isFinite(t)) t = 15;

    const pf = Number(precio) || 0;
    const fields = priceFields(pf, t);

    const result = await runAsync(
      `INSERT INTO productos
        (sku, nombre, tipo, precio, tarifa_isv, stock, activo,
         precio_final, base_imponible, impuesto_monto, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,DATETIME('now'),DATETIME('now'))`,
      [sku, nombre, tipoNorm, pf, t, Number(stock)||0, Number(activo)?1:0,
       fields.precio_final, fields.base_imponible, fields.impuesto_monto]
    );

    const row = await getAsync(
      `SELECT id, sku, nombre, tipo, precio, tarifa_isv, stock, activo,
              precio_final, base_imponible, impuesto_monto
         FROM productos WHERE id=?`, [result.lastID]
    );
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message || String(e) }); }
}

async function updateProducto(req, res) {
  const db = getSafeDB();
  const { getAsync, runAsync } = promisify(db);
  try {
    const id = req.params.id;
    const current = await getAsync(`SELECT * FROM productos WHERE id=?`, [id]);
    if (!current) return res.status(404).json({ error: 'NO_ENCONTRADO' });

    const payload = {
      sku:        req.body?.sku ?? current.sku,
      nombre:     req.body?.nombre ?? current.nombre,
      tipo:       (req.body?.tipo ?? current.tipo),
      precio:     Number(req.body?.precio ?? current.precio),
      tarifa_isv: req.body?.tarifa_isv ?? current.tarifa_isv,
      stock:      Number(req.body?.stock ?? current.stock),
      activo:     (req.body?.activo ?? current.activo)
    };

    // Normaliza tipo
    payload.tipo = String(payload.tipo || 'producto').toLowerCase();
    if (!['producto','repuesto','servicio'].includes(payload.tipo)) payload.tipo = 'producto';

    // ✅ asegura 15% por defecto si viene inválido/ausente
    let t = Number(payload.tarifa_isv);
    if (!Number.isFinite(t)) t = 15;

    const fields = priceFields(payload.precio, t);

    await runAsync(
      `UPDATE productos
          SET sku=?,
              nombre=?,
              tipo=?,
              precio=?,
              tarifa_isv=?,
              stock=?,
              activo=?,
              precio_final=?,
              base_imponible=?,
              impuesto_monto=?,
              updated_at=DATETIME('now')
        WHERE id=?`,
      [
        payload.sku,
        payload.nombre,
        payload.tipo,
        Number(payload.precio)||0,
        t,
        Number(payload.stock)||0,
        (Number(payload.activo)?1:0),
        fields.precio_final,
        fields.base_imponible,
        fields.impuesto_monto,
        id
      ]
    );

    const row = await getAsync(
      `SELECT id, sku, nombre, tipo, precio, tarifa_isv, stock, activo,
              precio_final, base_imponible, impuesto_monto
         FROM productos WHERE id=?`, [id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message || String(e) }); }
}

// ---------- Rutas (compat doble) ----------
// Si montas con: app.use('/api', productosRoutes)
router.get('/productos',     requirePermission('inventario.view'), listProductos);
router.get('/productos/:id', requirePermission('inventario.view'), getProducto);
router.post('/productos',    requirePermission('inventario.edit'), createProducto);
router.put('/productos/:id', requirePermission('inventario.edit'), updateProducto);

// Si montas con: app.use('/api/productos', productosRoutes)
router.get('/',     requirePermission('inventario.view'), listProductos);
router.get('/:id',  requirePermission('inventario.view'), getProducto);
router.post('/',    requirePermission('inventario.edit'), createProducto);
router.put('/:id',  requirePermission('inventario.edit'), updateProducto);

module.exports = router;
