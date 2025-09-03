// backend/src/routes/usuariosRoutes.js
"use strict";

const express = require("express");
const router = express.Router();

// ==== Controllers (ya existentes en tu proyecto) ====
const ctrl = require("../controllers/usuariosController");

// ==== Middlewares de auth/permiso ====
// Intentamos cargar tus middlewares reales. Si no existen aún (p.ej. antes de pushearlos),
// aplicamos un fallback que deniega, para no dejar estas rutas expuestas por accidente.
let requireAuth;
let requirePermissionFactory;

try {
  // Debe exportar: { requireAuth }
  ({ requireAuth } = require("../middleware/requireAuth"));
} catch (e) {
  console.error("⚠️  No se pudo cargar middleware/requireAuth:", e.message);
  requireAuth = (_req, res, _next) =>
    res.status(503).json({ ok: false, error: "Auth middleware no disponible" });
}

try {
  // Debe exportar: { requirePermission } que recibe un slug y devuelve un middleware
  ({ requirePermission: requirePermissionFactory } = require("../middleware/requirePermission"));
} catch (e) {
  console.error("⚠️  No se pudo cargar middleware/requirePermission:", e.message);
  requirePermissionFactory = (_slug) => (_req, res, _next) =>
    res.status(503).json({ ok: false, error: "Permissions middleware no disponible" });
}

// Helper para encadenar auth + permiso de forma consistente
const mustBeAdmin = [requireAuth, requirePermissionFactory("usuarios.admin")];

// Wrapper para controllers async (captura throw/rechazos y pasa a error handler de Express)
const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    // Si el controller devuelve una Promise, se encadena el catch:
    if (out && typeof out.then === "function") out.catch(next);
  } catch (err) {
    next(err);
  }
};

// --- Health del módulo (sin auth, útil para monitoreo/router discovery) ---
router.get("/_alive", (_req, res) => res.json({ ok: true, mod: "usuarios" }));

// --- Rutas protegidas: requieren JWT válido + permiso 'usuarios.admin' ---

// Listado / creación
router.get("/",        mustBeAdmin, wrap(ctrl.getUsuarios));
router.post("/",       mustBeAdmin, wrap(ctrl.crearUsuario));

// Permisos / estado / reseteo de contraseña / último acceso
router.put("/:id/permisos",         mustBeAdmin, wrap(ctrl.actualizarPermisos));
router.patch("/:id/estado",         mustBeAdmin, wrap(ctrl.actualizarEstado));
router.post("/:id/reset-password",  mustBeAdmin, wrap(ctrl.resetPassword));
router.post("/:id/ultimo-acceso",   mustBeAdmin, wrap(ctrl.marcarUltimoAcceso));

// CRUD individual
router.get("/:id",     mustBeAdmin, wrap(ctrl.getUsuarioPorId));
router.put("/:id",     mustBeAdmin, wrap(ctrl.actualizarUsuario));
router.delete("/:id",  mustBeAdmin, wrap(ctrl.eliminarUsuario));

module.exports = router;
