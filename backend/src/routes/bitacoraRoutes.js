// backend/src/routes/bitacoraRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/bitacoraController');

// ✅ Nuevo middleware estándar de permisos
const { requirePermission } = require('../middleware/requirePermission');

// ✅ Toda la sección de bitácora requiere al menos permiso de lectura
router.use(requirePermission('bitacora.view'));

// GET /api/bitacora  → ver bitácora
router.get('/', ctrl.getBitacora);

// POST /api/bitacora → crear/registrar en bitácora (escritura)
router.post('/', requirePermission('bitacora.edit'), ctrl.crearBitacora);

// Si más adelante agregas PUT/DELETE, protégelos también con 'bitacora.edit'
// router.put('/:id', requirePermission('bitacora.edit'), ctrl.actualizarEntrada);
// router.delete('/:id', requirePermission('bitacora.edit'), ctrl.eliminarEntrada);

module.exports = router;
