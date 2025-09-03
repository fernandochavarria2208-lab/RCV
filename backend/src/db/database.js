// backend/src/db/database.js
"use strict";

const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const bcrypt = require("bcryptjs");

// Usa DB_PATH si está definido (en Cloud Run suele ser /tmp/rcv.sqlite)
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, "taller_rcv.db");

let db;

/* ----------------- helpers promisificados ----------------- */
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

/* ----------------- migraciones utilitarias ----------------- */
async function columnExists(table, col) {
  const rows = await all(db, `PRAGMA table_info(${table})`);
  return rows.some(r => r.name === col);
}

async function ensureUsuariosTable() {
  // Crea la tabla si no existe (con el esquema completo actual)
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS usuarios (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario        TEXT    UNIQUE NOT NULL,
      nombre         TEXT,
      email          TEXT,                           -- opcional; se usa para creación/reset
      rol            TEXT    DEFAULT 'usuario',
      estado         TEXT    DEFAULT 'activo',
      forzarCambio   INTEGER DEFAULT 0,
      permisos       TEXT    DEFAULT '[]',
      permisos_extras TEXT   DEFAULT '[]',
      password       TEXT,                           -- hash bcrypt
      ultimoAcceso   TEXT
    )`
  );

  // Migraciones de columnas (por si la tabla ya existía)
  if (!(await columnExists("usuarios", "email"))) {
    await run(db, `ALTER TABLE usuarios ADD COLUMN email TEXT`);
  }
  if (!(await columnExists("usuarios", "permisos_extras"))) {
    await run(db, `ALTER TABLE usuarios ADD COLUMN permisos_extras TEXT DEFAULT '[]'`);
  }

  // Índice único sobre email (permite múltiples NULL, SQLite los considera distintos)
  await run(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)`);

  // Campos frecuentes en tu app (bitácora y otros)
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS bitacora (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT,
      accion TEXT,
      usuarioAfectado TEXT,
      hechoPor TEXT,
      detalles TEXT
    )`
  );
}

async function ensureCatalogoBasico() {
  // Vocabularios
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS secciones_servicio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS areas_vehiculo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE
    )`
  );

  // Catálogo
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS catalogo (
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
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS catalogo_precios (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      catalogo_id   INTEGER NOT NULL,
      precio        REAL NOT NULL CHECK(precio >= 0),
      vigente_desde TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (catalogo_id) REFERENCES catalogo(id) ON DELETE CASCADE
    )`
  );

  // Semillas
  await run(
    db,
    `INSERT OR IGNORE INTO secciones_servicio (nombre) VALUES
     ('Motor'), ('Transmisión'), ('Frenos'), ('Eléctrico'), ('Aire acondicionado'), ('Enfriamiento')`
  );
  await run(
    db,
    `INSERT OR IGNORE INTO areas_vehiculo (nombre) VALUES
     ('Suspensión'), ('Dirección'), ('Carrocería'), ('Escape'), ('Frenos'), ('Ruedas')`
  );
}

/* --------- SAR (CAI/documentos) tablas que ya usas --------- */
async function ensureSAR() {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS cai_autorizaciones (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      cai              TEXT    NOT NULL,
      documento_tipo   TEXT    NOT NULL,
      establecimiento  TEXT    NOT NULL,
      punto_emision    TEXT    NOT NULL,
      tipo_doc         TEXT    NOT NULL,
      rango_inicio     INTEGER NOT NULL,
      rango_fin        INTEGER NOT NULL,
      fecha_limite     TEXT    NOT NULL,
      estado           TEXT    NOT NULL DEFAULT 'vigente',
      resolucion       TEXT,
      UNIQUE(cai, documento_tipo, establecimiento, punto_emision, tipo_doc)
    )`
  );
  await run(db, `CREATE INDEX IF NOT EXISTS idx_cai_aut_vig ON cai_autorizaciones(estado, fecha_limite)`);

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS documentos (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo               TEXT    NOT NULL,
      cai_id             INTEGER NOT NULL,
      secuencia          INTEGER NOT NULL,
      correlativo        TEXT    NOT NULL,
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
    )`
  );
  await run(db, `CREATE INDEX IF NOT EXISTS idx_documentos_cai ON documentos(cai_id)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_documentos_estado ON documentos(estado)`);

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS documento_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      documento_id     INTEGER NOT NULL,
      descripcion      TEXT    NOT NULL,
      cantidad         REAL    NOT NULL,
      precio_unitario  REAL    NOT NULL,
      descuento        REAL    NOT NULL DEFAULT 0,
      tarifa_isv       INTEGER NOT NULL,
      base_imponible   REAL    NOT NULL DEFAULT 0,
      impuesto         REAL    NOT NULL DEFAULT 0,
      total_linea      REAL    NOT NULL DEFAULT 0,
      FOREIGN KEY (documento_id) REFERENCES documentos(id) ON DELETE CASCADE
    )`
  );
  await run(db, `CREATE INDEX IF NOT EXISTS idx_items_doc ON documento_items(documento_id)`);

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS documentos_referencias (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id           INTEGER NOT NULL,
      ref_tipo         TEXT    NOT NULL,
      ref_cai          TEXT    NOT NULL,
      ref_correlativo  TEXT    NOT NULL,
      ref_fecha        TEXT    NOT NULL,
      motivo           TEXT,
      FOREIGN KEY (doc_id) REFERENCES documentos(id) ON DELETE CASCADE
    )`
  );
}

/* ----------------- siembra y reset admin ----------------- */
async function ensureAdmin() {
  const ADMIN_USER  = process.env.ADMIN_USER  || "admin";
  const ADMIN_PASS  = process.env.ADMIN_PASS  || "admin123";
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || null;
  const FORCE_RESET = String(process.env.FORCE_ADMIN_RESET || "0") === "1";

  const row = await get(db, `SELECT id FROM usuarios WHERE lower(usuario)=lower(?)`, [ADMIN_USER]);

  if (!row) {
    const hash = bcrypt.hashSync(ADMIN_PASS, 10);
    await run(
      db,
      `INSERT INTO usuarios (usuario, nombre, email, rol, estado, forzarCambio, permisos, permisos_extras, password, ultimoAcceso)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ADMIN_USER,
        "Administrador",
        ADMIN_EMAIL,
        "administrador",
        "activo",
        0,
        JSON.stringify(["usuarios.admin", "bitacora.view"]),
        JSON.stringify([]),
        hash,
        null,
      ]
    );
    console.log(`✅ Usuario admin creado (${ADMIN_USER})`);
  } else if (FORCE_RESET) {
    const hash = bcrypt.hashSync(ADMIN_PASS, 10);
    await run(
      db,
      `UPDATE usuarios
         SET password = ?, email = COALESCE(?, email), forzarCambio = 0, estado = 'activo'
       WHERE id = ?`,
      [hash, ADMIN_EMAIL, row.id]
    );
    console.log(`🔐 Password de ${ADMIN_USER} reseteado (FORCE_ADMIN_RESET=1)`);
  } else {
    // no-op
  }
}

/* ----------------- init/export ----------------- */
async function createOrMigrate() {
  await run(db, `PRAGMA foreign_keys = ON;`);
  await ensureUsuariosTable();
  await ensureCatalogoBasico();
  await ensureSAR();
  await ensureAdmin();
}

function initDB() {
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error("❌ Error al conectar DB:", err.message);
    } else {
      console.log("✅ SQLite conectado:", dbPath);
      createOrMigrate()
        .then(() => console.log("🛠️  Migraciones OK"))
        .catch((e) => console.error("❌ Migraciones fallaron:", e));
    }
  });
}

function getDB() {
  if (!db) throw new Error("DB no inicializada. Llama initDB() primero.");
  return db;
}

module.exports = { initDB, getDB };
