// backend/index.js
"use strict";

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

// Opcional: si usas .env localmente
try { require("dotenv").config(); } catch {}

const { initDB, getDB } = require("./src/db/database");

const app = express();
const PORT = process.env.PORT || 3001;

// Cloud Run / proxies
app.set("trust proxy", true);

// Middlewares base
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("tiny"));

// ---- util para montar rutas sin que truene si falta el archivo
function mount(path, modulePath) {
  try {
    const router = require(modulePath);
    app.use(path, router);
    console.log(`✓ Ruta montada: ${path}  (${modulePath})`);
  } catch (e) {
    console.warn(`↷ Ruta NO montada: ${path}  (${modulePath}) -> ${e.message}`);
  }
}

// ---- health / alive
app.get("/api/health", async (_req, res) => {
  try {
    const db = getDB();
    // funciona tanto en PG como en SQLite
    db.get ? db.get("SELECT 1 AS ok", [], (err, row) => {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      res.json({ ok: true, db: true, ts: new Date().toISOString() });
    }) : res.json({ ok: true, db: "unknown", ts: new Date().toISOString() });
  } catch (e) {
    res.status(200).json({ ok: true, db: false, ts: new Date().toISOString() });
  }
});

app.get("/api/auth/_alive", (_req, res) => res.json({ ok: true, mod: "auth" }));

// ---- monta TODAS tus rutas
// (las que no existan simplemente se omiten con warning)
mount("/api/auth",        "./src/routes/authRoutes");          // si la tienes
mount("/api/usuarios",    "./src/routes/usuariosRoutes");
mount("/api/clientes",    "./src/routes/clientesRoutes");
mount("/api/vehiculos",   "./src/routes/vehiculosRoutes");
mount("/api/ordenes",     "./src/routes/ordenesRoutes");
mount("/api/cotizaciones","./src/routes/cotizacionesRoutes");
mount("/api/productos",   "./src/routes/productosRoutes");
mount("/api/items",       "./src/routes/itemsRoutes");
mount("/api/kardex",      "./src/routes/kardexRoutes");
mount("/api/facturacion", "./src/routes/facturacionRoutes");
mount("/api/gastos",      "./src/routes/gastosRoutes");
mount("/api/tiempos",     "./src/routes/tiemposRoutes");
mount("/api/reportes",    "./src/routes/reportesRoutes");
mount("/api/dashboard",   "./src/routes/dashboardRoutes");
mount("/api/bitacora",    "./src/routes/bitacoraRoutes");      // si existe

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// manejador de errores
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("❌ Error:", err);
  res.status(err.status || 500).json({ ok: false, error: err.message || "Error interno" });
});

// ---- levantar servidor tras inicializar DB
(async () => {
  try {
    await initDB(); // crea tablas mínimas si faltan (usuarios, etc.)
    app.listen(PORT, () => console.log(`🚀 API escuchando en :${PORT}`));
  } catch (e) {
    console.error("No se pudo inicializar DB:", e);
    process.exit(1);
  }
})();
