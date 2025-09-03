// backend/src/controllers/authController.js
"use strict";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getDB } = require("../db/database");

const JWT_SECRET = process.env.JWT_SECRET || "rcv_dev_secret";

function login(req, res) {
  let { usuario, password } = req.body || {};
  usuario = (usuario ?? "").toString().trim();
  password = (password ?? "").toString();

  if (!usuario || !password) {
    return res.status(400).json({ ok: false, error: "usuario y password requeridos" });
  }

  const db = getDB();
  db.get(
    // ⬇️ OJO: NO pedimos "email" aquí para no depender de esa columna en el login
    `SELECT id, usuario, nombre, rol, estado, forzarCambio, permisos, password AS hash
       FROM usuarios
      WHERE lower(usuario) = lower(?)`,
    [usuario],
    async (err, row) => {
      try {
        if (err) {
          return res.status(500).json({ ok: false, error: "DB error: " + err.message });
        }

        const authFail = () =>
          res.status(401).json({ ok: false, error: "Usuario o contraseña inválidos" });

        if (!row) return authFail();
        if (!row.estado || String(row.estado).toLowerCase() !== "activo") {
          return res.status(403).json({ ok: false, error: "Usuario inactivo" });
        }

        const ok = await bcrypt.compare(password, row.hash || "");
        if (!ok) return authFail();

        // Actualiza último acceso (no bloquea la respuesta)
        const now = new Date().toISOString();
        db.run(`UPDATE usuarios SET ultimoAcceso = ? WHERE id = ?`, [now, row.id], () => {});

        // Firma JWT (8h)
        const payload = { uid: row.id, usuario: row.usuario, rol: row.rol || "usuario" };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });

        // Normaliza permisos a array
        let permisos = [];
        try {
          permisos = row.permisos
            ? (Array.isArray(row.permisos) ? row.permisos : JSON.parse(row.permisos))
            : [];
        } catch {
          permisos = [];
        }

        return res.json({
          ok: true,
          token,
          user: {
            id: row.id,
            usuario: row.usuario,
            nombre: row.nombre,
            rol: row.rol || "usuario",
            estado: row.estado,
            forzarCambio: !!row.forzarCambio,
            permisos,
            ultimoAcceso: now,
          },
        });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message || "Error interno" });
      }
    }
  );
}

module.exports = { login };
