// backend/src/db/database.js
"use strict";

const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const bcrypt = require("bcryptjs");

// Usa DB_PATH si está definido (en Cloud Run / contenedor suele ser /tmp/rcv.sqlite)
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, "taller_rcv.db");

let db;

/* -------------------- Helpers Promesa -------------------- */
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
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/* -------------------- Migraciones utilitarias -------------------- */
async function hasColumn(table, column) {
  const rows = await all(db, `PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

/* -------------------- Esquema / Tablas -------------------- */
async function createTables() {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS usuarios (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario       TEXT UNIQUE,
      nombre        TEXT,
      email         TEXT,                           -- ⬅️ campo email soportado
      rol           TEXT,
      estado        TEXT DEFAULT 'activo',
      forzarCambio  INTEGER DEFAULT 0,
      permisos      TEXT DEFAULT '[]',
      password      TEXT,
      ultimoAcceso  TEXT
    )`
  );

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

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS clientes (
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
    )`
  );

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

  // SAR: CAI / Documentos
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS cai_autorizaciones (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      cai              TEXT    NOT NULL,
      documento_tipo   TEXT    NOT NULL,            -- FACTURA, NC, ND, etc.
      establecimiento  TEXT    NOT NULL,            -- 3 dígitos
      punto_emision    TEXT    NOT NULL,            -- 3 dígitos
      tipo_doc         TEXT    NOT NULL,            -- 2 dígitos (01=Factura, 04=NC, 05=ND)
      rango_inicio     INTEGER NOT NULL,
      rango_fin        INTEGER NOT NULL,
      fecha_limite     TEXT    NOT NULL,            -- YYYY-MM-DD
      estado           TEXT    NOT NULL DEFAULT 'vigente', -- vigente|vencido|agotado
      resolucion       TEXT,
      UNIQUE(cai, documento_tipo, establecimiento, punto_emision, tipo_doc)
    )`
  );
  await run(db, `CREATE INDEX IF NOT EXISTS idx_cai_aut_vig ON cai_autorizaciones(estado, fecha_limite)`);

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS documentos (
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
      tarifa_isv       INTEGER NOT NULL,            -- 0|15|18
      base_imponible   REAL    NOT NULL DEFAULT 0,
      impuesto         REAL    NOT NULL DEFAULT 0,
      total_linea      REAL    NOT NULL DEFAULT 0,
      FOREIGN KEY (documento_id) REFERENCES documentos(id) ON DELETE CASCADE
    )`
  );
  await run(db, `CREATE INDEX IF NOT EXISTS idx_items_doc ON documento_items(documento_id)`);
}

/* -------------------- Semillas catalogo -------------------- */
async function seedVocabularios() {
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

/* -------------------- Migraciones -------------------- */
async function migrate() {
  // Asegura que 'email' exista en usuarios aunque la tabla ya viniera de antes.
  const hasEmail = await hasColumn("usuarios", "email");
  if (!hasEmail) {
    await run(db, `ALTER TABLE usuarios ADD COLUMN email TEXT`);
    console.log("🛠️  Migración: columna usuarios.email añadida");
  }
}

/* -------------------- Admin por defecto / Reset -------------------- */
async function ensureAdmin() {
  const username = (process.env.ADMIN_USER || "admin").trim();
  const password = (process.env.ADMIN_PASS || "admin123").trim();
  const emailEnv = (process.env.ADMIN_EMAIL || "").trim(); // opcional
  const force = String(process.env.FORCE_ADMIN_RESET || "0") === "1";

  const row = await get(
    db,
    `SELECT id, usuario, email FROM usuarios WHERE lower(usuario) = lower(?)`,
    [username]
  );

  const hash = await bcrypt.hash(password, 10);

  if (!row) {
    await run(
      db,
      `INSERT INTO usuarios
        (usuario, nombre, email, rol, estado, forzarCambio, permisos, password, ultimoAcceso)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username,
        "Administrador",
        emailEnv || null,
        "administrador",
        "activo",
        0,
        JSON.stringify(["usuarios.admin", "bitacora.view"]),
        hash,
        null,
      ]
    );
    console.log(
      `✅ Usuario ${username} creado${emailEnv ? " con email " + emailEnv : ""}`
    );
    return;
  }

  if (force) {
    if (emailEnv) {
      await run(
        db,
        `UPDATE usuarios
           SET password = ?, forzarCambio = 0, estado = 'activo', email = ?
         WHERE id = ?`,
        [hash, emailEnv, row.id]
      );
      console.log(
        `🔐 Usuario ${username} reseteado y email actualizado a ${emailEnv}`
      );
    } else {
      await run(
        db,
        `UPDATE usuarios
           SET password = ?, forzarCambio = 0, estado = 'activo'
         WHERE id = ?`,
        [hash, row.id]
      );
      console.log(`🔐 Usuario ${username} reseteado (email sin cambios)`);
    }
  } else {
    console.log(`ℹ️ Usuario ${username} ya existe (sin reset).`);
  }
}

/* -------------------- init / get -------------------- */
async function initDB() {
  return new Promise((resolve) => {
    db = new sqlite3.Database(dbPath, async (err) => {
      if (err) {
        console.error("❌ Error al conectar DB:", err.message);
        // Igual resolvemos para no bloquear arranque; pero sin DB fallará al usar getDB()
        return resolve();
      }
      console.log("✅ Conectado a SQLite:", dbPath);

      try {
        await run(db, `PRAGMA foreign_keys = ON;`);
        await createTables();
        await migrate();
        await seedVocabularios();
        await ensureAdmin();
        resolve();
      } catch (e) {
        console.error("❌ Error al inicializar DB:", e.message);
        resolve();
      }
    });
  });
}

function getDB() {
  if (!db) throw new Error("DB no inicializada. Llama initDB() primero.");
  return db;
}

module.exports = { initDB, getDB };
