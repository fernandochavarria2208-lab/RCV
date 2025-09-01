// js/logout.js
(function () {
  // Intenta notificar al backend (opcional). No bloquea el logout local.
  async function logoutBackend() {
    const API_BASE = localStorage.getItem('API_BASE') || 'http://localhost:3001/api';
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    if (!token) return;

    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
    } catch (_) {
      // Silencio: aunque falle, seguimos con el logout local
    }
  }

  // ===== Función de cierre de sesión =====
  async function logout() {
    try {
      await logoutBackend(); // opcional, no detiene el flujo si falla
    } finally {
      // Borra datos de sesión (local)
      localStorage.removeItem('usuarioActual');
      localStorage.removeItem('paginaDestino');
      localStorage.removeItem('token');
      localStorage.removeItem('authToken');
      localStorage.removeItem('adminMode'); // <-- importante para ocultar enlaces admin

      // (Si guardas otros flags de sesión, límpialos aquí)
      // localStorage.removeItem('otraCosaDeSesion');
    }

    // Redirige siempre al login
    window.location.href = 'login.html';
  }

  // ===== Enganchar evento de logout =====
  function initLogoutButton() {
    const btn = document.getElementById('btnLogout');
    if (btn && !btn.dataset.logoutWired) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        logout();
      });
      btn.dataset.logoutWired = 'true'; // evita doble binding
    }
  }

  // Conecta cuando el DOM esté listo
  document.addEventListener('DOMContentLoaded', initLogoutButton);
  // Y vuelve a intentar cuando la ventana cargue todo
  window.addEventListener('load', initLogoutButton);

  // Exponer si te sirve llamarlo manualmente: window.rcvLogout()
  window.rcvLogout = logout;
})();

