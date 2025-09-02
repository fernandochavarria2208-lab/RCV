// frontend/js/include-topbar.js (v7)
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
      u.searchParams.set('v', '7');
      return u.href;
    });
  }

  async function fetchFirstOk(urls) {
    for (const u of urls) {
      try {
        const res = await fetch(u, { cache: 'no-cache' });
        if (res.ok) return await res.text();
        console.warn('[topbar] intento fallido:', u, res.status);
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

  // ----- Drawer helpers -----
  function getDrawerEls() {
    return {
      drawer:   document.getElementById('drawer'),
      backdrop: document.getElementById('drawerBackdrop')
    };
  }

  function ensureDrawer() {
    let { drawer, backdrop } = getDrawerEls();
    if (drawer && backdrop) return;

    const tpl = `
<div class="drawer-backdrop" id="drawerBackdrop"></div>
<aside class="drawer" id="drawer" aria-hidden="true" aria-labelledby="drawerTitle" role="dialog">
  <div class="drawer-header">
    <div id="drawerTitle" class="drawer-title">Área interna</div>
    <button class="btn btn-ghost" id="btnCloseDrawer" aria-label="Cerrar">✕</button>
  </div>
  <div class="drawer-body">
    <div class="drawer-note">
      <strong>Espacio único para empleados</strong><br/>
      Acceso a panel, kardex, órdenes, facturación y más.
    </div>
    <p class="muted" style="margin:0">Si eres parte del equipo, inicia sesión para continuar.</p>
  </div>
  <div class="drawer-actions">
    <a class="btn btn-primary" href="login.html">Iniciar sesión</a>
  </div>
</aside>`;
    document.body.insertAdjacentHTML('beforeend', tpl);

    // Estilos base inline (evita depender de CSS externo)
    ({ drawer, backdrop } = getDrawerEls());
    if (backdrop) {
      Object.assign(backdrop.style, {
        position:'fixed', inset:'0px', background:'rgba(0,0,0,.35)',
        opacity:'0', pointerEvents:'none', transition:'opacity .2s ease',
        zIndex:'9998'
      });
    }
    if (drawer) {
      Object.assign(drawer.style, {
        position:'fixed', top:'0', right:'0', height:'100%',
        width:'min(92vw,360px)', background:'#fff',
        boxShadow:'-8px 0 24px rgba(15,23,42,.18)',
        transform:'translateX(100%)', transition:'transform .25s ease',
        zIndex:'9999', display:'flex', flexDirection:'column'
      });
      // Subpartes mínimas
      const header = drawer.querySelector('.drawer-header');
      const actions = drawer.querySelector('.drawer-actions');
      const note = drawer.querySelector('.drawer-note');
      if (header) {
        Object.assign(header.style, {
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'14px 16px', borderBottom:'1px solid #f1f5f9'
        });
      }
      if (actions) {
        Object.assign(actions.style, {
          marginTop:'auto', padding:'16px', borderTop:'1px solid #f1f5f9'
        });
      }
      if (note) {
        Object.assign(note.style, {
          color:'#6b7280', background:'#f8fafc', padding:'12px',
          borderRadius:'12px', border:'1px dashed #e5e7eb'
        });
      }
      const body = drawer.querySelector('.drawer-body');
      if (body) Object.assign(body.style, { padding:'16px', display:'flex', flexDirection:'column', gap:'12px' });
      const closeBtn = drawer.querySelector('#btnCloseDrawer');
      if (closeBtn) Object.assign(closeBtn.style, { background:'#fff', border:'1px solid #e5e7eb', borderRadius:'12px', padding:'8px 12px', cursor:'pointer' });
      const primary = drawer.querySelector('.btn.btn-primary');
      if (primary) Object.assign(primary.style, { display:'inline-block', border:'none', borderRadius:'12px', padding:'10px 14px', cursor:'pointer', background:'#245C8D', color:'#fff', textDecoration:'none' });
    }
  }

  // Fuerza visibilidad con estilos inline (gana ante cualquier CSS)
  function openDrawer(){
    ensureDrawer();
    const { drawer, backdrop } = getDrawerEls();
    if (!drawer || !backdrop) return;
    drawer.classList.add('open');    // por compatibilidad
    backdrop.classList.add('open');  // por compatibilidad
    drawer.style.transform = 'none';
    backdrop.style.opacity = '1';
    backdrop.style.pointerEvents = 'auto';
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
    drawer.style.transform = 'translateX(100%)';
    backdrop.style.opacity = '0';
    backdrop.style.pointerEvents = 'none';
    drawer.setAttribute('aria-hidden','true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    console.info('[drawer] close');
  }

  // Delegación global: #btnHamb, .hamb, [data-drawer-open]
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#btnHamb') || t.closest('.hamb') || t.closest('[data-drawer-open]')) {
      e.preventDefault(); openDrawer();
    }
    if (t.closest('#btnCloseDrawer') || t.closest('#drawerBackdrop') || t.closest('[data-drawer-close]')) {
      e.preventDefault(); closeDrawer();
    }
  }, true);

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  // Limpia duplicados (si quedaron 2 headers / 2 drawers por inyección previa)
  function removeDuplicates(keepHeader) {
    const headers = Array.from(document.querySelectorAll('header.topbar'));
    headers.forEach(h => { if (h !== keepHeader) h.remove(); });

    const drawers = Array.from(document.querySelectorAll('#drawer'));
    const backs   = Array.from(document.querySelectorAll('#drawerBackdrop'));
    drawers.slice(1).forEach(n => n.remove());
    backs.slice(1).forEach(n => n.remove());
  }

  // Inyección segura del topbar
  async function injectTopbar() {
    let anchor = document.querySelector('header.topbar') || document.getElementById('topbarSlot');
    let created = false;
    if (!anchor) {
      anchor = document.createElement('div');
      anchor.id = 'topbarSlotAuto';
      document.body.insertBefore(anchor, document.body.firstChild);
      created = true;
    }

    let html = '';
    try { html = await fetchFirstOk(candidatePaths()); }
    catch (e) {
      console.error('[topbar] No se pudo cargar parcial. Continúo sólo con drawer.', e);
      ensureDrawer();
      return;
    }

    anchor.insertAdjacentHTML('beforebegin', html);
    const newHeader = document.querySelector('header.topbar');
    if (created || anchor.matches('header.topbar') || anchor.id === 'topbarSlot') {
      try { anchor.remove(); } catch {}
    }

    if (newHeader) removeDuplicates(newHeader);

    ensureDrawer();   // asegura que exista
    markActiveLink();
    applyWhatsAppCTA();

    // re-asegurar tras microtask
    setTimeout(ensureDrawer, 0);
  }

  function boot() {
    ensureDrawer(); // como mínimo
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectTopbar);
    } else {
      injectTopbar();
    }
  }
  boot();

  // Helpers de consola
  window.__openDrawer  = openDrawer;
  window.__closeDrawer = closeDrawer;
})();
