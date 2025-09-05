const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');

// ✅ Importa el guard de permisos
const { requirePermission } = require('../middleware/requirePermission');

// Conexión segura: usa la de app si existe; si no, usa getDB()
function dbConn(req) {
  return (req.app && req.app.get('db')) || getDB();
}

// Promesas para sqlite3
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this); // this.lastID, this.changes
    });
  });
}

function parseLimit(v, def = 50, min = 1, max = 100) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

// === Helpers de precio: se ingresa precio FINAL y el sistema calcula base e impuesto ===
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
/**
 * Dado un precio final con ISV incluido y un porcentaje de impuesto (0|15|18),
 * retorna { base, impuesto_monto, impuesto_pct, precio_final }
 */
function desglosarDesdeFinal(precio_final, impuesto_pct) {
  const pf = Number(precio_final) || 0;
  const pct = Number(impuesto_pct) || 0;
  if (pct <= 0) {
    return {
      base: round2(pf),
      impuesto_monto: 0,
      impuesto_pct: 0,
      precio_final: round2(pf),
    };
  }
  const base = round2(pf / (1 + pct / 100));
  const imp = round2(pf - base);
  return {
    base,
    impuesto_monto: imp,
    impuesto_pct: pct,
    precio_final: round2(pf),
  };
}

// ✅ Toda la sección de catálogo/inventario requiere permiso de VER inventario
router.use(requirePermission('inventario.view'));

/**
 * GET /api/catalogo
 * Filtros:
 *  - tipo=servicio|repuesto|producto
 *  - search=texto (tokenizado; busca en nombre y sku)
 *  - seccion_id=<id> (para servicios)
 *  - area_id=<id>    (para repuestos)
 *  - activo=1|0      (opcional; si no se envía, trae TODOS)
 *  - limit=<n>
 */
router.get('/', async (req, res) => {
  const db = dbConn(req);
  const { search = '', limit = 50, tipo, seccion_id, area_id, activo } = req.query;

  try {
    const params = [];
    const where = [];

    if (tipo === 'servicio' || tipo === 'repuesto' || tipo === 'producto') {
      where.push('c.tipo = ?'); params.push(tipo);
    }

    // Sanitiza comodines y tokeniza
    const q = String(search || '').trim().replace(/[%_]/g, '');
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      tokens.forEach(tok => {
        where.push('(c.nombre LIKE ? OR c.sku LIKE ?)');
        const like = `%${tok}%`;
        params.push(like, like);
      });
    }

    if (seccion_id) { where.push('c.seccion_id = ?'); params.push(Number(seccion_id)); }
    if (area_id)    { where.push('c.area_id = ?');    params.push(Number(area_id)); }
    if (activo === '1' || activo === '0') {
      where.push('c.activo = ?'); params.push(Number(activo));
    }

    const L = parseLimit(limit, 50, 1, 100);

    const sql = `
      SELECT
        c.id, c.sku, c.nombre, c.tipo, c.categoria, c.unidad,
        c.precio_base, c.impuesto_pct, c.seccion_id, c.area_id, c.activo,
        s.nombre AS seccion_nombre,
        a.nombre AS area_nombre
      FROM catalogo c
      LEFT JOIN secciones_servicio s ON s.id = c.seccion_id
      LEFT JOIN areas_vehiculo a     ON a.id = c.area_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.tipo, COALESCE(s.nombre, a.nombre), c.nombre
      LIMIT ?
    `;
    params.push(L);

    const rows = await all(db, sql, params);

    // Agrega campos calculados para el frontend (precio_final e impuesto_monto)
    const enriched = rows.map(r => {
      const precio_final = round2((Number(r.precio_base) || 0) * (1 + (Number(r.impuesto_pct) || 0) / 100));
      const imp_monto = round2(precio_final - (Number(r.precio_base) || 0));
      return {
        ...r,
        precio_final,
        impuesto_monto: imp_monto
      };
    });

    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* -------------- LISTAS AUXILIARES: van ANTES de /:id -------------- */

router.get('/secciones', async (req, res) => {
  const db = dbConn(req);
  try {
    const rows = await all(db, `SELECT id, nombre FROM secciones_servicio ORDER BY nombre`);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/areas', async (req, res) => {
  const db = dbConn(req);
  try {
    const rows = await all(db, `SELECT id, nombre FROM areas_vehiculo ORDER BY nombre`);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CRUD simple de secciones/áreas
router.post('/secciones', requirePermission('inventario.edit'), async (req, res) => {
  const db = dbConn(req);
  const { nombre } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
  try {
    const r = await run(db, `INSERT INTO secciones_servicio (nombre) VALUES (?)`, [nombre]);
    const row = await get(db, `SELECT * FROM secciones_servicio WHERE id=?`, [r.lastID]);
    res.status(201).json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/areas', requirePermission('inventario.edit'), async (req, res) => {
  const db = dbConn(req);
  const { nombre } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
  try {
    const r = await run(db, `INSERT INTO areas_vehiculo (nombre) VALUES (?)`, [nombre]);
    const row = await get(db, `SELECT * FROM areas_vehiculo WHERE id=?`, [r.lastID]);
    res.status(201).json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ------------------ CRUD catálogo ------------------ */

// Crear (precio FINAL: el sistema calcula precio_base e impuesto desde impuesto_pct o tarifa_isv)
router.post('/', requirePermission('inventario.edit'), async (req, res) => {
  const db = dbConn(req);
  const {
    sku, nombre, tipo, seccion_id = null, area_id = null,
    categoria = null, unidad = 'unidad',
    // Entradas posibles:
    precio_final,            // ✅ recomendado: precio que pagará el cliente
    precio_base,             // (compat) si viene se respeta, pero se ignora si viene precio_final
    impuesto_pct,            // 0|15|18
    tarifa_isv,              // (alias) 0|15|18
    activo = 1
  } = req.body || {};

  if (!nombre || !tipo) {
    return res.status(400).json({ error: 'nombre y tipo son obligatorios' });
  }
  // Ahora aceptamos 'producto' además de servicio|repuesto
  if (!['servicio','repuesto','producto'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo inválido (servicio|repuesto|producto)' });
  }
  if (tipo === 'servicio' && !seccion_id) {
    return res.status(400).json({ error: 'seccion_id es obligatorio para servicios' });
  }
  if (tipo === 'repuesto' && !area_id) {
    return res.status(400).json({ error: 'area_id es obligatorio para repuestos' });
  }
  // Para 'producto' no exigimos seccion/area

  // Determinar pct
  const pct = (tarifa_isv !== undefined ? Number(tarifa_isv) : (impuesto_pct !== undefined ? Number(impuesto_pct) : 0)) || 0;

  // Calcular base/imp desde precio_final si viene; de lo contrario, usar precio_base
  let baseToSave = 0;
  let pctToSave = 0;

  if (precio_final !== undefined && precio_final !== null && precio_final !== '') {
    const desg = desglosarDesdeFinal(precio_final, pct);
    baseToSave = desg.base;
    pctToSave = desg.impuesto_pct;
  } else {
    baseToSave = round2(precio_base || 0);
    pctToSave = pct;
  }

  try {
    const r = await run(db,
      `INSERT INTO catalogo
        (sku, nombre, tipo, seccion_id, area_id, categoria, unidad, precio_base, impuesto_pct, activo)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        sku || null, nombre, tipo,
        tipo === 'servicio' ? Number(seccion_id) : null,
        tipo === 'repuesto' ? Number(area_id)     : null,
        categoria, unidad, baseToSave, pctToSave, Number(activo)
      ]
    );
    const item = await get(db, `SELECT * FROM catalogo WHERE id=?`, [r.lastID]);

    // Enriquecer con precio_final e impuesto_monto
    const precio_final_resp = round2(item.precio_base * (1 + (item.impuesto_pct || 0) / 100));
    const impuesto_monto = round2(precio_final_resp - item.precio_base);

    res.status(201).json({ ...item, precio_final: precio_final_resp, impuesto_monto });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Editar (precio FINAL opcional; si viene, recalculamos)
router.put('/:id', requirePermission('inventario.edit'), async (req, res) => {
  const db = dbConn(req);
  const { id } = req.params;
  const {
    sku, nombre, tipo, seccion_id, area_id,
    categoria, unidad,
    precio_final,         // ✅ si viene, recalculamos
    precio_base,          // (compat)
    impuesto_pct,         // 0|15|18
    tarifa_isv,           // (alias)
    activo
  } = req.body || {};

  try {
    const current = await get(db, `SELECT * FROM catalogo WHERE id=?`, [id]);
    if (!current) return res.status(404).json({ error: 'No existe' });

    const newTipo = (tipo ?? current.tipo);
    if (!['servicio','repuesto','producto'].includes(newTipo)) {
      return res.status(400).json({ error: 'tipo inválido (servicio|repuesto|producto)' });
    }

    // Derivar seccion/area según el tipo final y lo enviado
    let newSeccion = current.seccion_id;
    let newArea    = current.area_id;

    if (newTipo === 'servicio') {
      newSeccion = (seccion_id !== undefined ? seccion_id : current.seccion_id);
      newArea = null;
      if (!newSeccion) return res.status(400).json({ error: 'seccion_id es obligatorio para servicios' });
    } else if (newTipo === 'repuesto') {
      newArea = (area_id !== undefined ? area_id : current.area_id);
      newSeccion = null;
      if (!newArea) return res.status(400).json({ error: 'area_id es obligatorio para repuestos' });
    } else {
      // producto: no forzamos seccion/area
      newSeccion = null;
      newArea = null;
    }

    // Calcular base/impuesto según entradas
    const pctIn = (tarifa_isv !== undefined ? Number(tarifa_isv) : (impuesto_pct !== undefined ? Number(impuesto_pct) : current.impuesto_pct)) || 0;

    let baseToSave = current.precio_base;
    let pctToSave = pctIn;

    if (precio_final !== undefined && precio_final !== null && precio_final !== '') {
      const desg = desglosarDesdeFinal(precio_final, pctIn);
      baseToSave = desg.base;
      pctToSave = desg.impuesto_pct;
    } else if (precio_base !== undefined) {
      baseToSave = round2(precio_base);
      pctToSave = pctIn;
    }

    const payload = {
      sku: (sku !== undefined ? (sku || null) : current.sku),
      nombre: (nombre !== undefined ? nombre : current.nombre),
      tipo: newTipo,
      seccion_id: newSeccion !== null ? Number(newSeccion) : null,
      area_id: newArea !== null ? Number(newArea) : null,
      categoria: (categoria !== undefined ? (categoria || null) : current.categoria),
      unidad: (unidad !== undefined ? (unidad || 'unidad') : (current.unidad || 'unidad')),
      precio_base: Number(baseToSave),
      impuesto_pct: Number(pctToSave),
      activo: (activo !== undefined ? Number(activo) : Number(current.activo ?? 1)),
    };

    await run(db, `
      UPDATE catalogo SET
        sku = ?,
        nombre = ?,
        tipo = ?,
        seccion_id = ?,
        area_id = ?,
        categoria = ?,
        unidad = ?,
        precio_base = ?,
        impuesto_pct = ?,
        activo = ?
      WHERE id = ?
    `, [
      payload.sku, payload.nombre, payload.tipo, payload.seccion_id, payload.area_id,
      payload.categoria, payload.unidad, payload.precio_base, payload.impuesto_pct, payload.activo,
      id
    ]);

    const item = await get(db, `
      SELECT
        c.id, c.sku, c.nombre, c.tipo, c.categoria, c.unidad,
        c.precio_base, c.impuesto_pct, c.seccion_id, c.area_id, c.activo,
        s.nombre AS seccion_nombre,
        a.nombre AS area_nombre
      FROM catalogo c
      LEFT JOIN secciones_servicio s ON s.id = c.seccion_id
      LEFT JOIN areas_vehiculo a     ON a.id = c.area_id
      WHERE c.id = ?
    `, [id]);

    const precio_final_resp = round2(item.precio_base * (1 + (item.impuesto_pct || 0) / 100));
    const impuesto_monto = round2(precio_final_resp - item.precio_base);

    res.json({ ...item, precio_final: precio_final_resp, impuesto_monto });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Borrado lógico
router.delete('/:id', requirePermission('inventario.edit'), async (req, res) => {
  const db = dbConn(req);
  const { id } = req.params;
  try {
    const cur = await get(db, `SELECT id FROM catalogo WHERE id=?`, [id]);
    if (!cur) return res.status(404).json({ error: 'No existe' });
    await run(db, `UPDATE catalogo SET activo=0 WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* -------------- IMPORTANTE: /:id va al FINAL -------------- */


/* ======== Productos para Facturación/Inventario (tabla "productos") ======== */
/* Estas rutas permiten a la factura/cotización seleccionar artículos con stock,
   e incluyen el tipo 'producto' para futuros items que no sean repuestos ni servicios. */

// GET /api/catalogo/productos?tipo=repuesto|servicio|producto&search=texto&activo=1&limit=100
router.get('/productos', async (req, res) => {
  const db = dbConn(req);
  const { search = '', limit = 100, tipo, activo } = req.query;

  try {
    const params = [];
    const where = [];

    if (tipo === 'servicio' || tipo === 'repuesto' || tipo === 'producto') {
      where.push('p.tipo = ?'); params.push(tipo);
    }

    if (activo === '1' || activo === '0') {
      where.push('COALESCE(p.activo,1) = ?'); params.push(Number(activo));
    }

    const q = String(search || '').trim().replace(/[%_]/g, '');
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      tokens.forEach(tok => {
        where.push('(p.nombre LIKE ? OR p.sku LIKE ?)');
        const like = `%${tok}%`;
        params.push(like, like);
      });
    }

    const L = Math.max(1, Math.min(200, parseInt(limit, 10) || 100));

    // En "productos" asumimos que el precio guardado es el PRECIO FINAL
    const rows = await all(db, `
      SELECT
        p.id,
        p.sku,
        p.nombre,
        p.tipo,               -- 'servicio' | 'repuesto' | 'producto'
        p.precio,             -- PRECIO FINAL (cliente)
        p.tarifa_isv,         -- 0 | 15 | 18
        p.stock,
        COALESCE(p.activo,1) AS activo
      FROM productos p
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.tipo, p.nombre
      LIMIT ?
    `, [...params, L]);

    // Para conveniencia del frontend, devolvemos desglose base/ISV
    const enriched = rows.map(r => {
      const desg = desglosarDesdeFinal(r.precio, r.tarifa_isv || 0);
      return {
        ...r,
        precio_final: desg.precio_final,
        base_imponible: desg.base,
        impuesto_monto: desg.impuesto_monto
      };
    });

    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/catalogo/productos/:id
router.get('/productos/:id', async (req, res) => {
  const db = dbConn(req);
  const { id } = req.params;
  try {
    const row = await get(db, `
      SELECT
        p.id,
        p.sku,
        p.nombre,
        p.tipo,
        p.precio,         -- PRECIO FINAL
        p.tarifa_isv,
        p.stock,
        COALESCE(p.activo,1) AS activo
      FROM productos p
      WHERE p.id = ?
    `, [id]);

    if (!row) return res.status(404).json({ error: 'No existe' });

    const desg = desglosarDesdeFinal(row.precio, row.tarifa_isv || 0);
    res.json({
      ...row,
      precio_final: desg.precio_final,
      base_imponible: desg.base,
      impuesto_monto: desg.impuesto_monto
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/catalogo/:id
router.get('/:id', async (req, res) => {
  const db = dbConn(req);
  const { id } = req.params;
  try {
    const row = await get(db, `
      SELECT
        c.id, c.sku, c.nombre, c.tipo, c.categoria, c.unidad,
        c.precio_base, c.impuesto_pct, c.seccion_id, c.area_id, c.activo,
        s.nombre AS seccion_nombre,
        a.nombre AS area_nombre
      FROM catalogo c
      LEFT JOIN secciones_servicio s ON s.id = c.seccion_id
      LEFT JOIN areas_vehiculo a     ON a.id = c.area_id
      WHERE c.id = ?
    `, [id]);
    if (!row) return res.status(404).json({ error: 'No existe' });

    const precio_final_resp = round2(row.precio_base * (1 + (row.impuesto_pct || 0) / 100));
    const impuesto_monto = round2(precio_final_resp - row.precio_base);

    res.json({ ...row, precio_final: precio_final_resp, impuesto_monto });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
