// backend/src/server.js
"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const { initDB, getDB } = require("./db/database");

const app = express();
const PORT = process.env.PORT || 8080;
const NODE_ENV = process.env.NODE_ENV || "development";

/* ========================= CORS ========================= */
const allowedOrigins = [
  "https://fernandochavarria2208-lab.github.io",
  // agrega aquí dominios productivos si los usas
];

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl/Postman
    if (origin === "null") return cb(null, true); // file:// en pruebas

    if (NODE_ENV !== "production") {
      const isLocal = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(origin);
      if (isLocal) return cb(null, true);
    }

    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS: " + origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type", "Authorization", "X-Requested-With",
    "X-Actor","X-Actor-Usuario","X-Actor-Rol",
    "x-actor","x-actor-usuario","x-actor-rol",
  ],
  exposedHeaders: ["x-token-refresh", "X-Token-Refresh"],
};

// Aplica CORS solo en /api
app.use("/api", cors(corsOptions));
app.options("/api/*", cors(corsOptions));

/* ====================== BODY PARSER ===================== */
app.use(express.json({ limit: "1mb" }));

/* ===================== DB INIT / HANDLE ================= */
initDB().catch(err => {
  console.error("❌ Error inicializando DB:", err?.message || err);
});
app.set("db", getDB());

/* ====================== HEALTH CHECK ==================== */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/* ===== Helpers para cargar routers sin romper el server ===== */
function tryRequire(modPath) {
  try {
    return require(modPath);
  } catch (e) {
    if (e && (e.code === "MODULE_NOT_FOUND" || String(e).includes("Cannot find module"))) {
      console.warn(`⚠️  Router faltante: ${modPath} (se omite)`);
      return null;
    }
    console.error(`❌ Error al requerir ${modPath}:`, e.message);
    return null;
  }
}

function pickRouter(name, mod) {
  if (!mod) return null;
  const r = (mod.router || mod.default || mod);
  if (typeof r === "function") return r;
  console.error(`❌ ${name} NO exporta un Router. typeof=`, typeof r);
  return null;
}

function mount(base, name, modPath) {
  const mod = tryRequire(modPath);
  const router = pickRouter(name, mod);
  if (!router) {
    console.warn(`↪️  No se montó ${name} (faltante o inválido). Ruta base: ${base}`);
    return;
  }
  app.use(base, router);
  console.log(`✅ Montado ${name} en ${base}`);
}

/* ======================== RUTAS ========================= */
// Auth primero (deberías tener estos archivos)
mount("/api/auth", "authRoutes", "./routes/authRoutes");

// El resto son opcionales; si el archivo no existe, no rompe:
mount("/api/usuarios",    "usuariosRoutes",    "./routes/usuariosRoutes");
mount("/api/bitacora",    "bitacoraRoutes",    "./routes/bitacoraRoutes");
mount("/api/clientes",    "clientesRoutes",    "./routes/clientesRoutes");
mount("/api/vehiculos",   "vehiculosRoutes",   "./routes/vehiculosRoutes");
mount("/api/ordenes",     "ordenesRoutes",     "./routes/ordenesRoutes");
mount("/api",             "cotizacionesRoutes","./routes/cotizacionesRoutes");
mount("/api/kardex",      "kardexRoutes",      "./routes/kardexRoutes");
mount("/api/productos",   "productosRoutes",   "./routes/productosRoutes");
mount("/api/items",       "itemsRoutes",       "./routes/itemsRoutes");
mount("/api/catalogo",    "catalogoRoutes",    "./routes/catalogoRoutes");
mount("/api/gastos",      "gastosRoutes",      "./routes/gastosRoutes");
mount("/api/reportes",    "reportesRoutes",    "./routes/reportesRoutes");
mount("/api",             "dashboardRoutes",   "./routes/dashboardRoutes");
mount("/api",             "tiemposRoutes",     "./routes/tiemposRoutes");
mount("/api",             "adminLocalRoutes",  "./routes/adminLocalRoutes");

// CAI / documentos (si existe, trae /cai, /documentos, etc.)
mount("/api",             "facturacionRoutes", "./routes/facturacionRoutes");

/* =========== Archivos estáticos (opcionales) =========== */
// /uploads (si existe la carpeta)
const uploadsDir = path.join(__dirname, "..", "public", "uploads");
if (fs.existsSync(uploadsDir)) {
  app.use("/uploads", express.static(uploadsDir));
  console.log("🗂️  Sirviendo /uploads desde", uploadsDir);
}

// /frontend (si lo empaquetas en la imagen)
const frontCandidates = [
  path.join(__dirname, "..", "frontend"),
  path.join(__dirname, "..", "..", "frontend"),
  path.join(__dirname, "..", "..", "Frontend"),
];
const FRONT_DIR = frontCandidates.find(p => fs.existsSync(p));
if (FRONT_DIR) {
  app.use("/frontend", express.static(FRONT_DIR, {
    etag: true, lastModified: true, cacheControl: true, maxAge: 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith(path.sep + "sw.js")) {
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Service-Worker-Allowed", "/frontend/");
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      }
      if (filePath.endsWith("manifest.webmanifest")) {
        res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
      }
    }
  }));
  app.get("/", (_req, res) => res.redirect("/frontend/"));
  console.log("🗂️  Sirviendo FRONTEND desde:", FRONT_DIR);
}

/* ======================== SERVER ======================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ API Taller RCV escuchando en http://0.0.0.0:${PORT}`);
});
