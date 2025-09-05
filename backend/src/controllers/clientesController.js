// Backend/src/controllers/clientesController.js
const { getDB } = require('../db/database');

function nowISO(){ return new Date().toISOString(); }

// Helper: arma objeto cliente con alias documento
function mapRowCliente(row){
  if (!row) return row;
  return {
    ...row,
    documento: row.documento ?? row.identificacion ?? null, // alias para frontend
  };
}

function getClientes(req, res){
  const db = getDB();
  const q = String((req.query.q||'').trim().toLowerCase());

  const base = `
    SELECT
      id, nombre,
      identificacion,
      telefono, email, direccion, ciudad, notas, estado,
      fechaRegistro, actualizado,
      identificacion AS documento   -- alias para frontend
    FROM clientes
  `;

  const sql = q
    ? `${base} WHERE lower(nombre) LIKE ? OR lower(identificacion) LIKE ? OR lower(telefono) LIKE ? OR lower(email) LIKE ? ORDER BY id DESC`
    : `${base} ORDER BY id DESC`;

  const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [];

  db.all(sql, params, (err, rows)=>{
    if (err) return res.status(500).json({ error: err.message });
    res.json((rows||[]).map(mapRowCliente));
  });
}

function getCliente(req, res){
  const db = getDB();
  const sql = `
    SELECT
      id, nombre,
      identificacion,
      telefono, email, direccion, ciudad, notas, estado,
      fechaRegistro, actualizado,
      identificacion AS documento
    FROM clientes WHERE id = ?
  `;
  db.get(sql, [req.params.id], (err, row)=>{
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(mapRowCliente(row));
  });
}

function crearCliente(req, res){
  // aceptar documento o identificacion indistintamente
  const {
    nombre,
    documento, identificacion: identificacionBody,
    telefono, email, direccion, ciudad, notas, estado
  } = req.body || {};

  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });

  const identificacion = (documento ?? identificacionBody ?? '').trim();
  const db = getDB();
  const ahora = nowISO();

  db.run(
    `INSERT INTO clientes (nombre, identificacion, telefono, email, direccion, ciudad, notas, estado, fechaRegistro, actualizado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nombre||'', identificacion, telefono||'', email||'', direccion||'', ciudad||'', notas||'', (estado||'activo'), ahora, ahora],
    function(err){
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID });
    }
  );
}

function actualizarCliente(req, res){
  const {
    nombre,
    documento, identificacion: identificacionBody,
    telefono, email, direccion, ciudad, notas, estado
  } = req.body || {};

  const identificacion = (documento ?? identificacionBody ?? '').trim();
  const db = getDB();
  const ahora = nowISO();

  db.run(
    `UPDATE clientes
       SET nombre=?,
           identificacion=?,
           telefono=?,
           email=?,
           direccion=?,
           ciudad=?,
           notas=?,
           estado=?,
           actualizado=?
     WHERE id = ?`,
    [
      (nombre ?? ''), identificacion,
      (telefono ?? ''), (email ?? ''), (direccion ?? ''), (ciudad ?? ''), (notas ?? ''),
      (estado || 'activo'), ahora, req.params.id
    ],
    function(err){
      if (err) return res.status(500).json({ error: err.message });
      if (!this.changes) return res.status(404).json({ error: 'Cliente no encontrado' });
      res.json({ ok: true });
    }
  );
}

function eliminarCliente(req, res){
  const db = getDB();
  db.run(`DELETE FROM clientes WHERE id = ?`, [req.params.id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    if (!this.changes) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ ok: true });
  });
}

module.exports = { getClientes, getCliente, crearCliente, actualizarCliente, eliminarCliente };
