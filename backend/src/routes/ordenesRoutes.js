// backend/src/routes/ordenesRoutes.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const router = express.Router();
const { getDB } = require('../db/database');
const { requirePermission } = require('../middleware/requirePermission'); // ✅ middleware (singular)
const ctrl = require('../controllers/ordenesController');

// ───────────────────────────────────────────────────────
// Ensure schema / migraciones (idempotente)
function ensureSchema(req, res, next){
  const db = getDB();

  // Tablas base (no destruye si existen)
  const createOrdenes = `
    CREATE TABLE IF NOT EXISTS ordenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT
    );`;

  const createVehiculos = `
    CREATE TABLE IF NOT EXISTS vehiculos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER,
      placa TEXT NOT NULL,
      marca TEXT,
      modelo TEXT,
      anio INTEGER,
      vin TEXT,
      color TEXT
    );`;

  const createClientes = `
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      identificacion TEXT,
      telefono TEXT,
      email TEXT
    );`;

  // Para el LEFT JOIN del controller
  const createUsuarios = `
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT,
      nombre TEXT,
      rol TEXT
    );`;

  // Helper: agrega columna solo si falta
  function addColumnIfMissing(table, column, type, cb){
    db.all(`PRAGMA table_info(${table})`, (e, rows)=>{
      if (e) return cb && cb(e);
      const exists = (rows || []).some(r => r && r.name === column);
      if (exists) return cb && cb(null);
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`, cb);
    });
  }

  db.exec(createOrdenes + createVehiculos + createClientes + createUsuarios, (err)=>{
    if (err) return res.status(500).json({ error: err.message });

    // Asegura TODAS las columnas que usa el controller
    const cols = [
      ['ordenes','numero','TEXT'],
      ['ordenes','vehiculo_id','INTEGER'],
      ['ordenes','estado','TEXT'],
      ['ordenes','descripcion','TEXT'],
      ['ordenes','mano_obra','REAL'],
      ['ordenes','total','REAL'],
      ['ordenes','prioridad','TEXT'],
      ['ordenes','asignado_a','INTEGER'],
      ['ordenes','cita','TEXT'],
      ['ordenes','recepcion_json','TEXT'],
      ['ordenes','fotos_json','TEXT'],
      ['ordenes','fechaRegistro','TEXT'],
      ['ordenes','actualizado','TEXT'],
    ];

    (function run(i){
      if (i >= cols.length) return next();
      const [t, c, ty] = cols[i];
      addColumnIfMissing(t, c, ty, () => run(i+1));
    })(0);
  });
}

router.use(ensureSchema);

// ───────────────────────────────────────────────────────
// Upload de fotos de recepción (antes de /:id)
const uploadRoot = path.join(__dirname, '..', '..', 'public', 'uploads', 'ordenes');
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(uploadRoot, String(req.params.id));
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ts = Date.now();
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${ts}-${Math.random().toString(36).slice(2,8)}${ext || '.jpg'}`);
  }
});
const upload = multer({ storage });

// Requiere permiso de edición de órdenes
router.post('/:id/recepcion-fotos', requirePermission('ordenes.edit'), upload.array('fotos', 20), ctrl.guardarFotosOrden);

// ───────────────────────────────────────────────────────
// CRUD con permisos
router.get('/',       requirePermission('ordenes.view'), ctrl.getOrdenes);
router.post('/',      requirePermission('ordenes.edit'), ctrl.crearOrden);
router.get('/:id',    requirePermission('ordenes.view'), ctrl.getOrden);
router.put('/:id',    requirePermission('ordenes.edit'), ctrl.actualizarOrden);
router.delete('/:id', requirePermission('ordenes.edit'), ctrl.eliminarOrden);

module.exports = router;
