// frontend/js/include-topbar.js
(function () {
  // --- Rutas candidatas al parcial (con cache-bust) ---
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
      u.searchParams.set('v', '5'); // cache-bust
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

  // --- Marcado de link activo ---
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

  // --- CTA de WhatsApp (si la página ya calculó __waHref / __waHrefCTA) ---
  function applyWhatsAppCTA() {
    const cta = document.getElementById('ctaWhatsApp');
    if (cta) {
      const href = window.__waHrefCTA || window.__waHref;
      if (href) cta.href = href;
    }
  }

  // --- Utilidades Drawer ---
  function getDrawerEls() {
    return {
      drawer:   document.getElementById('drawer'),
      backdrop: document.getElementById('drawerBackdrop')
    };
  }

  function ensureDrawer() {
    let { drawer, backdrop } = getDrawerEls();
    if (drawer && backdrop) return;

    // Fallback: crear un drawer mínimo autoconclusivo
    const tpl = `
<div class="drawer-backdrop" id="drawerBackdrop"
     style="position:fixed;inset:0;background:rgba(0,0,0,.35);opacity:0;pointer-events:none;transition:opacity .2s ease;z-index:70"></div>
<aside class="drawer" id="drawer" aria-hidden="true" aria-labelledby="drawerTitle" role="dialog"
       style="position:fixed;top:0;right:0;height:100%;width:min(92vw,360px);background:#fff;box-shadow:-8px 0 24px rgba(15,23,42,.18);
              transform:translateX(100%);transition:transform .25s ease;z-index:80;display:flex;flex-direction:column">
  <div class="drawer-header" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #f1f5f9">
    <div id="drawerTitle" class="drawer-title" style="font-weight:800">Área interna</div>
    <button class="btn btn-ghost" id="btnCloseDrawer" aria-label="Cerrar"
            style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:8px 12px;cursor:pointer">✕</button>
  </div>
  <div class="drawer-body" style="padding:16px;display:flex;flex-direction:column;gap:12px">
    <div class="drawer-note" style="color:#6b7280;background:#f8fafc;padding:12px;border-radius:12px;border:1px dashed #e5e7eb">
      <strong>Espacio único para empleados</strong><br/>
      Acceso a panel, kardex, órdenes, facturación y más.
    </div>
    <p class="muted" style="color:#6b7280;margin:0">
      Si eres parte del equipo, inicia sesión para continuar.
    </p>
  </div>
  <div class="drawer-actions" style="margin-top:auto;padding:16px;border-top:1px solid #f1f5f9">
    <a class="btn btn-primary" href="login.html"
       style="display:inline-block;border:none;border-radius:12px;padding:10px 14px;cursor:pointer;background:#245C8D;color:#fff;text-decoration:none">Iniciar sesión</a>
  </div>
</aside>
<style>
  .drawer-backdrop.open{opacity:1;pointer-events:auto}
  .drawer.open{transform:none}
  /* Por si quedara algún .nav-login viejo en el topbar: ocultarlo */
  .nav-login{display:none !important}
</style>`;
    document.body.insertAdjacentHTML('beforeend', tpl);
  }

  function openDrawer(){
    const { drawer, backdrop } = getDrawerEls();
    if (!drawer || !backdrop) return;
    drawer.classList.add('open');
    backdrop.classList.add('open');
    drawer.setAttribute('aria-hidden','false');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    console.info('[drawer] open');
  }
  function closeDrawer(){
    const { drawer, backdrop } = getDrawerEls();
    if (!drawer || !backdrop) return;
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    drawer.setAttribute('aria-hidden','true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    console.info('[drawer] close');
  }

  // --- Delegación global (soporta #btnHamb, cualquier .hamb y data-drawer-open) ---
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#btnHamb') || t.closest('.hamb') || t.closest('[data-drawer-open]')) {
      e.preventDefault();
      ensureDrawer();   // garantiza que exista
      openDrawer();
    }
    if (t.closest('#btnCloseDrawer') || t.closest('#drawerBackdrop') || t.closest('[data-drawer-close]')) {
      e.preventDefault();
      closeDrawer();
    }
  }, true);

  // Escape cierra el drawer
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  // Exponer utilidades en consola por si quieres probar manualmente
  window.__openDrawer = openDrawer;
  window.__closeDrawer = closeDrawer;

  // --- Limpia duplicados (si quedaron 2 headers / 2 drawers por inyección previa) ---
  function removeDuplicates(keepHeader) {
    const headers = Array.from(document.querySelectorAll('header.topbar'));
    headers.forEach(h => { if (h !== keepHeader) h.remove(); });

    const drawers = Array.from(document.querySelectorAll('#drawer'));
    const backs   = Array.from(document.querySelectorAll('#drawerBackdrop'));
    drawers.slice(1).forEach(n => n.remove());
    backs.slice(1).forEach(n => n.remove());
  }

  // --- Inyección segura del topbar ---
  async function injectTopbar() {
    // Punto de anclaje: header.topbar existente o slot explícito
    let anchor = document.querySelector('header.topbar') || document.getElementById('topbarSlot');

    // Si no hay nada, creamos un marcador
    let created = false;
    if (!anchor) {
      anchor = document.createElement('div');
      anchor.id = 'topbarSlotAuto';
      document.body.insertBefore(anchor, document.body.firstChild);
      created = true;
    }

    // Carga del parcial
    let html = '';
    try {
      html = await fetchFirstOk(candidatePaths());
    } catch (e) {
      console.error('[topbar] No se pudo cargar parcial. Uso sólo fallback de drawer.', e);
      ensureDrawer();   // al menos que el drawer funcione
      return;
    }

    // Inserta nuevo topbar antes del ancla y luego retira el ancla si corresponde
    anchor.insertAdjacentHTML('beforebegin', html);
    const newHeader = document.querySelector('header.topbar');

    if (created || anchor.matches('header.topbar') || anchor.id === 'topbarSlot') {
      try { anchor.remove(); } catch {}
    }

    if (newHeader) removeDuplicates(newHeader);

    // Asegura que haya drawer (por si el parcial no lo trae)
    ensureDrawer();

    markActiveLink();
    applyWhatsAppCTA();

    // Re-asegurar tras microtask (por si el DOM cambia justo después)
    setTimeout(() => {
      ensureDrawer();
    }, 0);
  }

  // Garantiza que el drawer exista incluso si falla la carga del parcial
  function boot() {
    ensureDrawer();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectTopbar);
    } else {
      injectTopbar();
    }
  }
  boot();
})();
