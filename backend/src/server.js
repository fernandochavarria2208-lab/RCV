// Backend/src/server.js (CORS inteligente, SIN bypass de auth)
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
      // Origen "file://" en pruebas locales; si no lo usas, puedes quitarlo
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
app.options('/api/*', cors(corsOptions));

// Body parser
app.use(express.json({ limit: '1mb' }));

// Healthcheck
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ====== MONTAJE DE RUTAS ======
app.use('/api/auth',        pickRouter('authRoutes', authRoutes));
app.use('/api/usuarios',    pickRouter('usuariosRoutes', usuariosRoutes));
app.use('/api/bitacora',    pickRouter('bitacoraRoutes', bitacoraRoutes));
app.use('/api/clientes',    pickRouter('clientesRoutes', clientesRoutes));
app.use('/api/vehiculos',   pickRouter('vehiculosRoutes', vehiculosRoutes));
app.use('/api/ordenes',     pickRouter('ordenesRoutes', ordenesRoutes));
app.use('/api',             cotizacionesRoutes);
app.use('/api/kardex',      pickRouter('kardexRoutes', kardexRoutes));
app.use('/api/productos',   pickRouter('productosRoutes', productosRoutes));
app.use('/api/items',       itemsRoutes);         // base dedicada
app.use('/api/catalogo',    catalogoRoutes);      // base dedicada
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

// Arranque DB y server
initDB();
app.set('db', getDB());

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ API Taller RCV escuchando en http://0.0.0.0:${PORT}`);
  if (FRONT_DIR) console.log(`🌐 Frontend en http://0.0.0.0:${PORT}/frontend/`);
});
