// backend/src/server.js  — entrypoint único para Cloud Run
"use strict";

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { initDB, getDB } = require('./db/database');

// ====== IMPORTS DE RUTAS ======
const usuariosRoutes       = require('./routes/usuariosRoutes');
const bitacoraRoutes       = require('./routes/bitacoraRoutes');
const clientesRoutes       = require('./routes/clientesRoutes');
const authRoutes           = require('./routes/authRoutes');
const vehiculosRoutes      = require('./routes/vehiculosRoutes');
const ordenesRoutes        = require('./routes/ordenesRoutes');
const cotizacionesRoutes   = require('./routes/cotizacionesRoutes');
const kardexRoutes         = require('./routes/kardexRoutes');
const productosRoutes      = require('./routes/productosRoutes');
const itemsRoutesMod       = require('./routes/itemsRoutes');       // <- puede exportar {router}
const catalogoRoutesMod    = require('./routes/catalogoRoutes');    // <- puede exportar {router}
const facturacionRoutesMod = require('./routes/facturacionRoutes');
const gastosRoutes         = require('./routes/gastosRoutes');
const reportesRoutes       = require('./routes/reportesRoutes');
const dashboardRoutes      = require('./routes/dashboardRoutes');
const tiemposRoutes        = require('./routes/tiemposRoutes');
const adminLocalRoutes     = require('./routes/adminLocalRoutes');

// 🔧 Normalizador para aceptar exportaciones: router | {router} | default
function pickRouter(name, mod) {
  const r = (mod && (mod.router || mod.default || mod)) || null;
  if (typeof r !== 'function') {
    console.error(`❌ ${name} NO exporta un Router. typeof=`, typeof r, 'valor=', r);
    throw new TypeError(`${name} debe exportar un Router (usa "module.exports = router")`);
  }
  return r;
}

const itemsRoutes        = pickRouter('itemsRoutes', itemsRoutesMod);
const catalogoRoutes     = pickRouter('catalogoRoutes', catalogoRoutesMod);
const facturacionRoutes  = pickRouter('facturacionRoutes', facturacionRoutesMod);

const app = express();
const PORT = process.env.PORT || 8080;               // ⬅️ Cloud Run usa 8080
const NODE_ENV = process.env.NODE_ENV || 'development';

// 🔐 Cloud Run detrás de proxy (X-Forwarded-For/Proto, cookies "secure")
app.set('trust proxy', 1);

// ❌ (ELIMINADO) CORS global abierto que anulaba la lista de orígenes:
// app.use(cors({ origin: true, credentials: true }));

// ✅ CORS inteligente (dev: localhost/LAN; prod: dominios permitidos)
const allowedOrigins = [
  'https://fernandochavarria2208-lab.github.io', // ⬅️ GitHub Pages (frontend público)
  // 'https://serviciosmecanicosrcv.duckdns.org', // (si lo vuelves a usar)
];

const corsOptions = {
  origin(origin, cb) {
    // Permite herramientas como curl/Postman (sin Origin)
    if (!origin) return cb(null, true);

    if (origin === 'null') {
      // Origen "file://" en pruebas locales; elimínalo si no lo usas
      return cb(null, true);
    }

    // En desarrollo, acepta localhost/LAN
    if (NODE_ENV !== 'production') {
      const isLocal = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(origin);
      if (isLocal) return cb(null, true);
    }

    // En producción, solo dominios permitidos
    if (allowedOrigins.includes(origin)) return cb(null, true);

    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: [
    // comunes
    'Content-Type','Authorization','X-Requested-With',
    // tus custom (mayúsculas y minúsculas para curarnos en salud)
    'X-Actor','X-Actor-Usuario','X-Actor-Rol',
    'x-actor','x-actor-usuario','x-actor-rol'
  ],
  exposedHeaders: ['x-token-refresh','X-Token-Refresh']
};

// Aplica CORS solo bajo /api (incluye preflight)
app.use('/api', cors(corsOptions));
app.options('/api', cors(corsOptions));
app.options('/api/*', cors(corsOptions));

// Body parsers
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Healthchecks básicos
app.get('/_alive', (_req, res) => res.json({ ok: true, env: NODE_ENV, ts: new Date().toISOString() }));
app.get('/_warmup', (_req, res) => res.json({ ok: true, warmed: true, ts: new Date().toISOString() }));
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ====== MONTAJE DE RUTAS ======
app.use('/api/auth',        pickRouter('authRoutes', authRoutes));
app.use('/api/usuarios',    pickRouter('usuariosRoutes', usuariosRoutes));
app.use('/api/bitacora',    pickRouter('bitacoraRoutes', bitacoraRoutes));
app.use('/api/clientes',    pickRouter('clientesRoutes', clientesRoutes));
app.use('/api/vehiculos',   pickRouter('vehiculosRoutes', vehiculosRoutes));
app.use('/api/ordenes',     pickRouter('ordenesRoutes', ordenesRoutes));
app.use('/api',             cotizacionesRoutes);      // define su propio prefijo interno
app.use('/api/kardex',      pickRouter('kardexRoutes', kardexRoutes));
app.use('/api/productos',   pickRouter('productosRoutes', productosRoutes));
app.use('/api/items',       itemsRoutes);             // base dedicada
app.use('/api/catalogo',    catalogoRoutes);          // base dedicada
app.use('/api/gastos',      gastosRoutes);
app.use('/api/reportes',    reportesRoutes);
app.use('/api',             dashboardRoutes);
app.use('/api',             tiemposRoutes);
app.use('/api',             adminLocalRoutes);

// CAI/documentos (internamente define /cai, /documentos, etc.)
app.use('/api',             facturacionRoutes);

// Archivos subidos estáticos
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// Frontend estático (opcional; si el contenedor lo incluye)
const frontCandidates = [
  path.join(__dirname, '..', 'frontend'),
  path.join(__dirname, '..', '..', 'frontend'),
  path.join(__dirname, '..', '..', 'Frontend'),
];
const FRONT_DIR = frontCandidates.find(p => fs.existsSync(p));
if (FRONT_DIR) {
  console.log('🗂️  Sirviendo FRONTEND desde:', FRONT_DIR);
  app.use('/frontend', express.static(FRONT_DIR, {
    etag: true, lastModified: true, cacheControl: true, maxAge: 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith(path.sep + 'sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Service-Worker-Allowed', '/frontend/');
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      }
      if (filePath.endsWith('manifest.webmanifest')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      }
    }
  }));
  app.get('/', (_req, res) => res.redirect('/frontend/'));
} else {
  console.warn('⚠️  No se encontró carpeta "frontend". Revisa la ruta.');
}

// /public estático (opcional)
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

// 404 JSON solo para /api (no afecta a /frontend o /static)
app.use('/api', (req, res, _next) => {
  res.status(404).json({ ok: false, error: 'Not Found', path: req.originalUrl });
});

// Manejador de errores (incluye errores de CORS)
app.use((err, req, res, _next) => {
  const origin = req.get('Origin') || null;
  if (err && typeof err.message === 'string' && err.message.startsWith('Not allowed by CORS')) {
    return res.status(403).json({ ok: false, error: 'CORS blocked', origin });
  }
  console.error('💥 Error no controlado:', err);
  res.status(500).json({ ok: false, error: 'Internal Server Error' });
});

// Arranque DB y server
initDB();
app.set('db', getDB());

app.listen(PORT, '0.0.0.0', () => {
  console.log('>>> RUNNING APP FILE:', __filename);
  console.log('>>> CWD:', process.cwd());
  console.log(`✅ API Taller RCV escuchando en http://0.0.0.0:${PORT}`);
  console.log(`🌱 NODE_ENV=${NODE_ENV} | AllowedOrigins=${JSON.stringify(allowedOrigins)}`);
  if (FRONT_DIR) console.log(`🌐 Frontend en http://0.0.0.0:${PORT}/frontend/`);
});
