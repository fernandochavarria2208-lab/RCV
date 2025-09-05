// backend/src/routes/vehiculosRoutes.js
const express = require('express');
const router = express.Router();

const vehiculosCtrl = require('../controllers/vehiculosController');
const { getDB } = require('../db/database');
const { requirePermission } = require('../middleware/requirePermission');

/**
 * Asegura tablas y columnas requeridas para vehiculos:
 * - vehiculos: cliente_id, placa, marca, modelo, anio, vin, color, notas, fechaRegistro, actualizado
 * - clientes/ordenes mínimas (no pisa las existentes)
 */
function ensureSchema(req, res, next) {
  const db = getDB();

  const createVehiculos = `
    CREATE TABLE IF NOT EXISTS vehiculos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER,
      placa TEXT NOT NULL,
      marca TEXT,
      modelo TEXT,
      anio INTEGER,
      vin TEXT,
      color TEXT,
      notas TEXT,
      fechaRegistro TEXT,
      actualizado TEXT
    );`;

  const createClientesMin = `
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      identificacion TEXT,
      telefono TEXT,
      email TEXT
    );`;

  const createOrdenesMin = `
    CREATE TABLE IF NOT EXISTS ordenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT,
      estado TEXT,
      vehiculo_id INTEGER
    );`;

  db.exec(createVehiculos + createClientesMin + createOrdenesMin, (err) => {
    if (err) return res.status(500).json({ error: err.message });

    // 👉 agrega cualquier columna faltante en vehiculos
    ensureColumns(db, 'vehiculos', [
      ['cliente_id', 'INTEGER'],
      ['placa', 'TEXT'],        // ya debería existir, pero por si acaso
      ['marca', 'TEXT'],
      ['modelo', 'TEXT'],
      ['anio', 'INTEGER'],
      ['vin', 'TEXT'],
      ['color', 'TEXT'],
      ['notas', 'TEXT'],
      ['fechaRegistro', 'TEXT'],
      ['actualizado', 'TEXT'],
    ])
      .then(() => next())
      .catch((e) => res.status(500).json({ error: e.message }));
  });
}

/** Agrega columnas si faltan (SQLite) */
function ensureColumns(db, table, columns) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${table});`, [], (err, rows) => {
      if (err) return reject(err);
      const have = new Set((rows || []).map((r) => r.name));
      const toAdd = columns.filter(([name]) => !have.has(name));
      if (!toAdd.length) return resolve();

      const runNext = () => {
        const col = toAdd.shift();
        if (!col) return resolve();
        const [name, type] = col;
        db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${type};`, [], (e) => {
          // Si otra instancia la agregó, ignorar “duplicate column name”
          if (e && !/duplicate column name/i.test(e.message)) return reject(e);
          runNext();
        });
      };
      runNext();
    });
  });
}

// Middleware de esquema antes de las rutas
router.use(ensureSchema);

// Rutas con permisos
router.get('/',     requirePermission('vehiculos.view'), vehiculosCtrl.getVehiculos);
router.get('/:id',  requirePermission('vehiculos.view'), vehiculosCtrl.getVehiculo);
router.post('/',    requirePermission('vehiculos.edit'), vehiculosCtrl.crearVehiculo);
router.put('/:id',  requirePermission('vehiculos.edit'), vehiculosCtrl.actualizarVehiculo);
router.delete('/:id', requirePermission('vehiculos.edit'), vehiculosCtrl.eliminarVehiculo);

module.exports = router;
