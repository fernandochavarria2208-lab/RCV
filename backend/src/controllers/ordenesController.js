// backend/src/controllers/ordenesController.js
const { getDB } = require('../db/database');

function nowISO(){ return new Date().toISOString(); }
function thisYear(){ return new Date().getFullYear(); }
function genNumeroFromRowCount(count){ const y=thisYear(); return `${y}-${String(count+1).padStart(4,'0')}`; }

function getOrdenes(req, res){
  const db = getDB();
  const q = String((req.query.q||'').trim().toLowerCase());
  let sql = `
    SELECT o.id, o.numero, o.estado, o.total, o.fechaRegistro,
           o.prioridad, o.asignado_a, o.cita,
           v.id AS vehiculo_id, v.placa, v.marca, v.modelo,
           c.id AS cliente_id, c.nombre AS cliente_nombre,
           u.nombre AS asignado_nombre
    FROM ordenes o
    LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
    LEFT JOIN clientes  c ON c.id = v.cliente_id
    LEFT JOIN usuarios  u ON u.id = o.asignado_a
  `;
  const params = [];
  if (q) {
    sql += ` WHERE LOWER(o.numero) LIKE ? OR LOWER(v.placa) LIKE ? OR LOWER(c.nombre) LIKE ? `;
    params.push(`%${q}%`,`%${q}%`,`%${q}%`);
  }
  sql += ` ORDER BY o.id DESC`;
  db.all(sql, params, (err, rows)=>{
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
}

function getOrden(req, res){
  const db = getDB();
  const id = req.params.id;
  const sql = `
    SELECT o.*, v.placa, v.marca, v.modelo, v.cliente_id,
           c.nombre AS cliente_nombre,
           u.nombre AS asignado_nombre
    FROM ordenes o
    LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
    LEFT JOIN clientes  c ON c.id = v.cliente_id
    LEFT JOIN usuarios  u ON u.id = o.asignado_a
    WHERE o.id = ?`;
  db.get(sql, [id], (err, row)=>{
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Orden no encontrada' });

    const orden = {
      id: row.id, numero: row.numero, estado: row.estado,
      descripcion: row.descripcion, mano_obra: row.mano_obra, total: row.total,
      prioridad: row.prioridad, asignado_a: row.asignado_a, cita: row.cita,
      recepcion: row.recepcion_json ? JSON.parse(row.recepcion_json) : null,
      fotos: row.fotos_json ? JSON.parse(row.fotos_json) : [],
      fechaRegistro: row.fechaRegistro, actualizado: row.actualizado,
      vehiculo_id: row.vehiculo_id, placa: row.placa, marca: row.marca, modelo: row.modelo,
      cliente_id: row.cliente_id, asignado_nombre: row.asignado_nombre
    };
    const vehiculo = { id: row.vehiculo_id, placa: row.placa, marca: row.marca, modelo: row.modelo, cliente_id: row.cliente_id };
    const cliente  = { id: row.cliente_id, nombre: row.cliente_nombre };
    res.json({ orden, vehiculo, cliente });
  });
}

function crearOrden(req, res){
  const db = getDB();
  const {
    vehiculo_id, estado='abierta', descripcion='',
    mano_obra=null, total=null,
    prioridad=null, asignado_a=null, cita=null,
    recepcion=null, tecnico=null, items=null
  } = req.body || {};
  if (!vehiculo_id) return res.status(400).json({ error: 'vehiculo_id requerido' });

  const ahora = nowISO();
  const recepJSON = recepcion ? JSON.stringify(recepcion) : null;
  // (técnico e ítems se podrían guardar en tablas aparte; por ahora ignoramos o anexamos a descripción)
  const extraDesc = [];
  if (tecnico?.diagnostico) extraDesc.push(`Diagnóstico: ${tecnico.diagnostico}`);
  if (tecnico?.trabajos)    extraDesc.push(`Trabajos: ${tecnico.trabajos}`);
  if (tecnico?.aprobacion)  extraDesc.push(`Aprobación: ${tecnico.aprobacion}`);
  const fullDesc = [descripcion, extraDesc.join(' | ')].filter(Boolean).join(' — ');

  // Número de orden
  const genNumero = (cb)=>{
    db.get(`SELECT COUNT(*) AS c FROM ordenes WHERE substr(fechaRegistro,1,4)=?`, [String(thisYear())], (e,r)=>{
      if (e) return cb(e);
      cb(null, genNumeroFromRowCount(r?.c|0));
    });
  };

  genNumero((e,num)=>{
    if (e) return res.status(500).json({ error: e.message });
    db.run(
      `INSERT INTO ordenes (numero, vehiculo_id, estado, descripcion, mano_obra, total, prioridad, asignado_a, cita, recepcion_json, fechaRegistro, actualizado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [num, vehiculo_id, estado, fullDesc, mano_obra, total, prioridad, asignado_a, cita, recepJSON, ahora, ahora],
      function(err){
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, numero: num });
      }
    );
  });
}

function actualizarOrden(req, res){
  const db = getDB();
  const id = req.params.id;
  const { vehiculo_id, estado, descripcion, mano_obra, total, prioridad, asignado_a, cita } = req.body || {};
  const ahora = nowISO();

  db.run(
    `UPDATE ordenes SET
      vehiculo_id = COALESCE(?, vehiculo_id),
      estado = COALESCE(?, estado),
      descripcion = COALESCE(?, descripcion),
      mano_obra = COALESCE(?, mano_obra),
      total = COALESCE(?, total),
      prioridad = COALESCE(?, prioridad),
      asignado_a = COALESCE(?, asignado_a),
      cita = COALESCE(?, cita),
      actualizado = ?
     WHERE id = ?`,
    [vehiculo_id ?? null, estado ?? null, descripcion ?? null, mano_obra ?? null, total ?? null, prioridad ?? null, asignado_a ?? null, cita ?? null, ahora, id],
    function(err){
      if (err) return res.status(500).json({ error: err.message });
      if (!this.changes) return res.status(404).json({ error: 'Orden no encontrada' });
      res.json({ ok:true, id });
    }
  );
}

function eliminarOrden(req, res){
  const db = getDB();
  db.run(`DELETE FROM ordenes WHERE id = ?`, [req.params.id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    if (!this.changes) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json({ ok:true });
  });
}

function guardarFotosOrden(req, res){
  // `req.files` viene de multer. Guardamos lista relativa en columna fotos_json.
  const db = getDB();
  const id = req.params.id;
  const paths = (req.files||[]).map(f => `/uploads/ordenes/${id}/${f.filename}`);
  db.get(`SELECT fotos_json FROM ordenes WHERE id=?`, [id], (err,row)=>{
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Orden no encontrada' });
    const prev = row.fotos_json ? JSON.parse(row.fotos_json) : [];
    const next = [...prev, ...paths];
    db.run(`UPDATE ordenes SET fotos_json = ?, actualizado = ? WHERE id = ?`,
      [JSON.stringify(next), nowISO(), id],
      function(eu){
        if (eu) return res.status(500).json({ error: eu.message });
        res.json({ ok:true, archivos: next });
      }
    );
  });
}

module.exports = { getOrdenes, getOrden, crearOrden, actualizarOrden, eliminarOrden, guardarFotosOrden };
