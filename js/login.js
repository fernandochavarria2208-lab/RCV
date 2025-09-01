// js/login.js
(function () {
  const form = document.getElementById('loginForm');
  const inputUsuario = document.getElementById('usuario');
  const inputPassword = document.getElementById('password');
  const mensajeError = document.getElementById('mensajeError');
  const chkMostrar = document.getElementById('mostrarPassword');

  // ==== CONFIG ====
  // Define la base de la API desde localStorage o usa localhost por defecto.
  // Puedes cambiarla en consola del navegador:
  //   localStorage.setItem('API_BASE','http://localhost:3001/api')
  const API_BASE = localStorage.getItem('API_BASE') || 'http://localhost:3001/api';

  // --- NUEVO: helper para modo admin ---
  function esAdmin(user) {
    // Acepta múltiples variantes de rol/permisos
    const rol = (user?.rol || '').toString().toLowerCase().trim();
    const perms = Array.isArray(user?.permisos) ? user.permisos.map(p => (p || '').toString().toLowerCase()) : [];

    // Rol que contenga "admin" (administrador, admin, superadmin)
    const porRol = rol.includes('admin');

    // Permisos comunes para panel de administración
    const clavesAdmin = ['admin', 'superadmin', 'panel_admin', 'dashboard_admin'];
    const porPermiso = perms.some(p => clavesAdmin.includes(p));

    return porRol || porPermiso;
  }

  function aplicarAdminMode(user) {
    if (esAdmin(user)) {
      localStorage.setItem('adminMode', 'true'); // <-- activa modo admin
    } else {
      localStorage.removeItem('adminMode');      // <-- asegura que no quede activo
    }
  }
  // --- FIN NUEVO ---

  // Toggle mostrar/ocultar contraseña
  if (chkMostrar) {
    chkMostrar.addEventListener('change', function () {
      inputPassword.type = this.checked ? 'text' : 'password';
    });
  }

  function mostrarError(msg) {
    if (mensajeError) {
      mensajeError.textContent = msg || 'Ocurrió un error.';
      mensajeError.style.color = 'red';
    } else {
      alert(msg || 'Ocurrió un error.');
    }
  }

  // Normaliza paginaDestino (puede ser archivo o URL absoluta)
  function obtenerDestino() {
    const dest = localStorage.getItem('paginaDestino') || '';
    if (!dest) return 'admin.html';
    if (/^https?:\/\//i.test(dest)) return dest; // URL absoluta
    return dest; // relativa
  }

  // === LOGIN contra API (JWT) ===
  async function loginBD(usuario, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No mandamos X-Actor aquí; JWT será devuelto por el backend
      body: JSON.stringify({ usuario, password })
    });

    let data = null;
    try { data = await res.json(); } catch {}

    if (!res.ok || !data?.ok) {
      const msg = (data && (data.error || data.message)) || `Error de autenticación (HTTP ${res.status})`;
      throw new Error(msg);
    }

    // data esperado: { ok: true, token, user: { id, usuario, nombre, rol, ... } }
    if (!data.token || !data.user) {
      throw new Error('Respuesta de login incompleta (falta token o user)');
    }

    // Guarda token para que api.js lo envíe en Authorization: Bearer ...
    localStorage.setItem('token', data.token);
    localStorage.setItem('authToken', data.token); // compatibilidad

    return data;
  }

  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const usuario = (inputUsuario.value || '').trim();
    const password = (inputPassword.value || '').trim();

    if (!usuario || !password) {
      mostrarError('Por favor, complete todos los campos.');
      return;
    }

    try {
      // 1) Autenticar contra la API (obtiene JWT y datos de usuario)
      const r = await loginBD(usuario, password);
      const u = r.user;

      // 2) Guardar sesión para el resto del sistema
      const usuarioActual = {
        id: u.id,
        usuario: u.usuario,
        nombre: u.nombre,
        rol: u.rol,
        estado: u.estado,
        forzarCambio: !!u.forzarCambio,
        ultimoAcceso: u.ultimoAcceso || null,
        permisos: Array.isArray(u.permisos) ? u.permisos : (u.permisos || [])
      };
      localStorage.setItem('usuarioActual', JSON.stringify(usuarioActual));

      // --- NUEVO: activar/desactivar adminMode automáticamente según el usuario ---
      aplicarAdminMode(usuarioActual);
      // --- FIN NUEVO ---

      // 3) Redirecciones
      if (usuarioActual.forzarCambio) {
        window.location.href = 'cambiar-clave.html';
        return;
      }

      const destino = obtenerDestino();
      localStorage.removeItem('paginaDestino'); // evitar bucles
      window.location.href = destino || 'admin.html';
    } catch (err) {
      mostrarError(err.message || 'Usuario o contraseña incorrectos.');
    }
  });
})();

