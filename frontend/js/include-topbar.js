// frontend/js/include-topbar.js
(function () {
  // --- Rutas candidatas al parcial (con bust de caché) ---
  function candidatePaths() {
    const here = location.href;
    const raw = [
      'partials/topbar.html',
      '../partials/topbar.html',
      '../../partials/topbar.html',
      'frontend/partials/topbar.html',
      '../frontend/partials/topbar.html'
    ];
    return raw.map(p => {
      const u = new URL(p, here);
      u.searchParams.set('v', '3'); // cache-bust sencillo
      return u.href;
    });
  }

  async function fetchFirstOk(urls) {
    for (const u of urls) {
      try {
        const res = await fetch(u, { cache: 'no-cache' });
        if (res.ok) {
          console.info('[topbar] cargado desde:', u);
          return await res.text();
        } else {
          console.warn('[topbar] intento fallido:', u, res.status);
        }
      } catch (e) {
        console.warn('[topbar] error al intentar:', u, e);
      }
    }
    throw new Error('No se encontró partials/topbar.html en rutas candidatas.');
  }

  function markActiveLink() {
    try {
      const path = (location.pathname || '').toLowerCase();
      const hash = (location.hash || '').toLowerCase();
      document.querySelectorAll('header.topbar nav a[data-page]')
        .forEach(a => a.classList.remove('active'));

      if (path.endsWith('/servicios.html')) {
        document.querySelector('a[data-page="servicios"]')?.classList.add('active');
      } else if (hash.includes('consulta')) {
        document.querySelector('a[data-page="consulta"]')?.classList.add('active');
      } else if (hash.includes('contacto')) {
        document.querySelector('a[data-page="contacto"]')?.classList.add('active');
      } else if (path.endsWith('/index.html') || /\/$/.test(path)) {
        document.querySelector('a[data-page="inicio"]')?.classList.add('active');
      }
    } catch (e) {
      console.warn('[topbar] no se pudo marcar el link activo:', e);
    }
  }

  function applyWhatsAppCTA() {
    const cta = document.getElementById('ctaWhatsApp');
    if (cta) {
      const href = window.__waHrefCTA || window.__waHref;
      if (href) cta.href = href;
    }
  }

  function removeDuplicates(keepHeader) {
    // Elimina otros headers.topbar que no sean el nuevo
    const headers = Array.from(document.querySelectorAll('header.topbar'));
    headers.forEach(h => { if (h !== keepHeader) h.remove(); });

    // Deja un solo drawer/backdrop
    const drawers = Array.from(document.querySelectorAll('#drawer'));
    const backs   = Array.from(document.querySelectorAll('#drawerBackdrop'));
    drawers.slice(1).forEach(n => n.remove());
    backs.slice(1).forEach(n => n.remove());
  }

  // --- Delegación global para el Drawer (funciona aunque se reinyecte) ---
  function getDrawerEls() {
    return {
      drawer:   document.getElementById('drawer'),
      backdrop: document.getElementById('drawerBackdrop')
    };
  }
  function openDrawer(){
    const { drawer, backdrop } = getDrawerEls();
    if (!drawer || !backdrop) return;
    drawer.classList.add('open');
    backdrop.classList.add('open');
    drawer.setAttribute('aria-hidden','false');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer(){
    const { drawer, backdrop } = getDrawerEls();
    if (!drawer || !backdrop) return;
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    drawer.setAttribute('aria-hidden','true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  // Un solo listener global para todos los clics relevantes
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#btnHamb')) { e.preventDefault(); openDrawer(); }
    if (t.closest('#btnCloseDrawer') || t.closest('#drawerBackdrop')) {
      e.preventDefault(); closeDrawer();
    }
  }, true);

  // Escape cierra el drawer
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  // --- Inyección segura del topbar (sin perder eventos) ---
  async function injectTopbar() {
    // Punto de anclaje: si hay header.topbar viejo, lo usaremos como referencia
    let anchor = document.querySelector('header.topbar')
              || document.getElementById('topbarSlot');

    // Si no hay, creamos un marcador al principio del body
    let created = false;
    if (!anchor) {
      anchor = document.createElement('div');
      anchor.id = 'topbarSlotAuto';
      document.body.insertBefore(anchor, document.body.firstChild);
      created = true;
    }

    let html = '';
    try {
      html = await fetchFirstOk(candidatePaths());
    } catch (e) {
      console.error('[topbar] No se pudo cargar:', e);
      return;
    }

    // Inserta el nuevo topbar ANTES del ancla
    anchor.insertAdjacentHTML('beforebegin', html);

    // Obtiene el header recién insertado (el primero en el DOM)
    const newHeader = document.querySelector('header.topbar');

    // Elimina el ancla (si era un header viejo o placeholder)
    if (created || anchor.matches('header.topbar') || anchor.id === 'topbarSlot') {
      anchor.remove();
    }

    // Limpia duplicados (si quedaron)
    if (newHeader) removeDuplicates(newHeader);

    // Ajustes finales
    markActiveLink();
    applyWhatsAppCTA();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectTopbar);
  } else {
    injectTopbar();
  }
})();
