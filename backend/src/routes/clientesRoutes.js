// backend/src/routes/clientesRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/clientesController');
const { requirePermission } = require('../middleware/requirePermission');

// Toda la sección requiere permiso de VER clientes
router.use(requirePermission('clientes.view'));

// Lecturas
router.get('/', ctrl.getClientes);
router.get('/:id', ctrl.getCliente);

// Escrituras (crear/editar/eliminar) requieren permiso de EDITAR clientes
router.post('/', requirePermission('clientes.edit'), ctrl.crearCliente);
router.put('/:id', requirePermission('clientes.edit'), ctrl.actualizarCliente);
router.delete('/:id', requirePermission('clientes.edit'), ctrl.eliminarCliente);

module.exports = router;
