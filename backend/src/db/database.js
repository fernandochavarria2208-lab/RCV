// backend/src/db/database.js
"use strict";

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

let db;

/**
 * En Cloud Run el FS es de solo lectura excepto /tmp.
 * Usamos DB_PATH si viene por entorno; si no:
 *  - production => /tmp/rcv.sqlite
 *  - dev/local  => archivo junto al código.
 */
const DEFAULT_PROD = path.join('/tmp', 'rcv.sqlite');
const DEFAULT_DEV  = path.resolve(__dirname, 'taller_rcv.db');
const DB_PATH = process.env.DB_PATH ||
  (process.env.NODE_ENV === 'production' ? DEFAULT_PROD : DEFAULT_DEV);

/** Abre/retorna la conexión singleton */
function getDB() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH);
  }
  return db;
}

/** Crea carpeta contenedora si aplica */
function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Ejecuta ALTER ADD COLUMN solo si la columna no existe */
function addColumnIfMissing(db, table, columnName, columnDDL) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${table})`, (e, rows) => {
      if (e) return reject(e);
      const exists = rows.some(r => (r.name || '').toLowerCase() === columnName.toLowerCase());
      if (exists) return resolve(false);
      db.run(`ALTER TABLE ${table} ADD COLUMN ${columnDDL}`, err => {
        if (err) return reject(err);
        resolve(true);
      });
    });
  });
}

/** Crea tablas base */
function createTables(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('PRAGMA foreign_keys = ON;');

      // === USUARIOS ===
      db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          usuario TEXT UNIQUE,
          nombre TEXT,
          email TEXT,
          rol TEXT,
          estado TEXT DEFAULT 'activo',          -- 'activo'|'inactivo' (seguimos tu modelo)
          forzarCambio INTEGER DEFAULT 0,
          permisos TEXT DEFAULT '[]',            -- legacy
          permisos_extras TEXT,                  -- nuevo campo para compatibilidad
          password TEXT,
          ultimoAcceso TEXT
        )
      `);

      // === BITÁCORA ===
      db.run(`
        CREATE TABLE IF NOT EXISTS bitacora (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fecha TEXT,
          accion TEXT,
          usuarioAfectado TEXT,
          hechoPor TEXT,
          detalles TEXT
        )
      `);

      // === CLIENTES ===
      db.run(`
        CREATE TABLE IF NOT EXISTS clientes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL,
          identificacion TEXT,
          telefono TEXT,
          email TEXT,
          direccion TEXT,
          ciudad TEXT,
          notas TEXT,
          estado TEXT DEFAULT 'activo',
          fechaRegistro TEXT,
          actualizado TEXT
        )
      `);

      // === CATÁLOGO: vocabularios ===
      db.run(`CREATE TABLE IF NOT EXISTS secciones_servicio (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS areas_vehiculo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE
      )`);

      // === CATÁLOGO principal ===
      db.run(`
        CREATE TABLE IF NOT EXISTS catalogo (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          sku           TEXT UNIQUE,
          nombre        TEXT NOT NULL UNIQUE,
          tipo          TEXT NOT NULL CHECK (tipo IN ('servicio','repuesto')),
          seccion_id    INTEGER,
          area_id       INTEGER,
          categoria     TEXT,
          unidad        TEXT DEFAULT 'unidad',
          precio_base   REAL NOT NULL CHECK(precio_base >= 0),
          impuesto_pct  REAL DEFAULT 0 CHECK(impuesto_pct >= 0),
          activo        INTEGER DEFAULT 1,
          FOREIGN KEY (seccion_id) REFERENCES secciones_servicio(id) ON DELETE SET NULL,
          FOREIGN KEY (area_id)     REFERENCES areas_vehiculo(id)     ON DELETE SET NULL
        )
      `);

      // Historial de precios
      db.run(`
        CREATE TABLE IF NOT EXISTS catalogo_precios (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          catalogo_id   INTEGER NOT NULL,
          precio        REAL NOT NULL CHECK(precio >= 0),
          vigente_desde TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (catalogo_id) REFERENCES catalogo(id) ON DELETE CASCADE
        )
      `);

      // Semillas vocabulario
      db.run(`INSERT OR IGNORE INTO secciones_servicio (nombre) VALUES
        ('Motor'), ('Transmisión'), ('Frenos'), ('Eléctrico'), ('Aire acondicionado'), ('Enfriamiento')`);
      db.run(`INSERT OR IGNORE INTO areas_vehiculo (nombre) VALUES
        ('Suspensión'), ('Dirección'), ('Carrocería'), ('Escape'), ('Frenos'), ('Ruedas')`);

      // === SAR: CAI y Documentos ===
      db.run(`
        CREATE TABLE IF NOT EXISTS cai_autorizaciones (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          cai              TEXT    NOT NULL,
          documento_tipo   TEXT    NOT NULL,
          establecimiento  TEXT    NOT NULL,
          punto_emision    TEXT    NOT NULL,
          tipo_doc         TEXT    NOT NULL,            -- 01=Factura, 04=NC, 05=ND
          rango_inicio     INTEGER NOT NULL,
          rango_fin        INTEGER NOT NULL,
          fecha_limite     TEXT    NOT NULL,            -- YYYY-MM-DD
          estado           TEXT    NOT NULL DEFAULT 'vigente',
          resolucion       TEXT,
          UNIQUE(cai, documento_tipo, establecimiento, punto_emision, tipo_doc)
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_cai_aut_vig ON cai_autorizaciones(estado, fecha_limite)`);

      db.run(`
        CREATE TABLE IF NOT EXISTS documentos (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo               TEXT    NOT NULL,          -- FACTURA, NC, ND, etc.
          cai_id             INTEGER NOT NULL,
          secuencia          INTEGER NOT NULL,
          correlativo        TEXT    NOT NULL,          -- EEE-PPP-TT-SSSSSSSS
          fecha_emision      TEXT    NOT NULL,
          lugar_emision      TEXT,
          moneda             TEXT    NOT NULL DEFAULT 'HNL',
          emisor_rtn         TEXT    NOT NULL,
          emisor_nombre      TEXT    NOT NULL,
          emisor_domicilio   TEXT,
          cliente_rtn        TEXT,
          cliente_nombre     TEXT,
          subtotal_gravado   REAL    NOT NULL DEFAULT 0,
          subtotal_exento    REAL    NOT NULL DEFAULT 0,
          isv_15             REAL    NOT NULL DEFAULT 0,
          isv_18             REAL    NOT NULL DEFAULT 0,
          descuento_total    REAL    NOT NULL DEFAULT 0,
          total              REAL    NOT NULL DEFAULT 0,
          total_letras       TEXT,
          destino            TEXT,
          estado             TEXT    NOT NULL DEFAULT 'emitido',
          created_at         TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (cai_id) REFERENCES cai_autorizaciones(id) ON DELETE RESTRICT,
          UNIQUE(cai_id, secuencia),
          UNIQUE(correlativo)
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_documentos_cai ON documentos(cai_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_documentos_estado ON documentos(estado)`);

      db.run(`
        CREATE TABLE IF NOT EXISTS documento_items (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          documento_id     INTEGER NOT NULL,
          descripcion      TEXT    NOT NULL,
          cantidad         REAL    NOT NULL,
          precio_unitario  REAL    NOT NULL,
          descuento        REAL    NOT NULL DEFAULT 0,
          tarifa_isv       INTEGER NOT NULL,            -- 0|15|18
          base_imponible   REAL    NOT NULL DEFAULT 0,
          impuesto         REAL    NOT NULL DEFAULT 0,
          total_linea      REAL    NOT NULL DEFAULT 0,
          FOREIGN KEY (documento_id) REFERENCES documentos(id) ON DELETE CASCADE
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_items_doc ON documento_items(documento_id)`);

      // Listo
      resolve();
    });
  });
}

/** Migra columnas nuevas en usuarios si faltan */
async function migrateUsuariosColumns(db) {
  await addColumnIfMissing(db, 'usuarios', 'email', 'email TEXT');
  await addColumnIfMissing(db, 'usuarios', 'permisos_extras', 'permisos_extras TEXT');
}

/** Cuenta usuarios */
function countUsuarios(db) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) AS c FROM usuarios`, (err, row) => {
      if (err) return reject(err);
      resolve(row?.c || 0);
    });
  });
}

/** Seed de admin si la tabla está vacía */
async function seedAdminIfEmpty(db) {
  const c = await countUsuarios(db);
  if (c > 0) return;
  const hash = bcrypt.hashSync('Admin11', 10); // coincide con tus pruebas
  await new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO usuarios (usuario, nombre, email, rol, estado, forzarCambio, permisos, permisos_extras, password, ultimoAcceso)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      'admin',
      'Administrador',
      null,
      'admin',           // rol consistente con permisos
      'activo',
      0,
      JSON.stringify(['usuarios:admin','bitacora:leer']),
      JSON.stringify([]),
      hash,
      null
    ],
    err => err ? reject(err) : resolve());
  });
  console.log('🧩 Seed: usuario admin/Admin11 creado (tabla vacía).');
}

/** Inicializa todo */
async function initDB() {
  ensureDirFor(DB_PATH);
  const instance = getDB();
  await createTables(instance);
  await migrateUsuariosColumns(instance);
  await seedAdminIfEmpty(instance);
  console.log('✅ Conectado a SQLite:', DB_PATH);
  return instance;
}

module.exports = { initDB, getDB };
