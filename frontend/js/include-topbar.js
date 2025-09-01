// frontend/js/include-topbar.js
(function () {
  function candidatePaths() {
    const here = location.href;
    const paths = [
      'partials/topbar.html',
      '../partials/topbar.html',
      '../../partials/topbar.html',
      'frontend/partials/topbar.html',
      '../frontend/partials/topbar.html'
    ];
    return paths.map(p => new URL(p, here).href);
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
      const links = document.querySelectorAll('header.topbar nav a[data-page]');
      links.forEach(a => a.classList.remove('active'));

      if (path.endsWith('/servicios.html')) {
        document.querySelector('a[data-page="servicios"]')?.classList.add('active');
      } else if (hash.includes('consulta')) {
        document.querySelector('a[data-page="consulta"]')?.classList.add('active');
      } else if (hash.includes('contacto')) {
        document.querySelector('a[data-page="contacto"]')?.classList.add('active');
      } else {
        if (path.endsWith('/index.html') || /\/$/.test(path)) {
          document.querySelector('a[data-page="inicio"]')?.classList.add('active');
        }
      }
    } catch (e) {
      console.warn('[topbar] no se pudo marcar el link activo:', e);
    }
  }

  function wireDrawer() {
    const drawer   = document.getElementById('drawer');
    const backdrop = document.getElementById('drawerBackdrop');
    const openBtn  = document.getElementById('btnHamb');
    const closeBtn = document.getElementById('btnCloseDrawer');
    if (!drawer || !backdrop) return;

    function openDrawer(){
      drawer.classList.add('open');
      backdrop.classList.add('open');
      drawer.setAttribute('aria-hidden','false');
      document.body.style.overflow='hidden';
    }
    function closeDrawer(){
      drawer.classList.remove('open');
      backdrop.classList.remove('open');
      drawer.setAttribute('aria-hidden','true');
      document.body.style.overflow='';
    }
    openBtn?.addEventListener('click', openDrawer);
    closeBtn?.addEventListener('click', closeDrawer);
    backdrop?.addEventListener('click', closeDrawer);
    window.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeDrawer(); });
  }

  function applyWhatsAppCTA() {
    // Si tus páginas calcularon esto, úsalo
    const cta = document.getElementById('ctaWhatsApp');
    if (cta) {
      const href = window.__waHrefCTA || window.__waHref;
      if (href) cta.href = href;
    }
  }

  async function injectTopbar() {
    const slot = document.getElementById('topbarSlot');
    if (!slot) return;
    if (document.querySelector('header.topbar')) return; // evita doble

    let html = '';
    try { html = await fetchFirstOk(candidatePaths()); }
    catch (e) { console.error('[topbar] No se pudo cargar:', e); return; }

    slot.innerHTML = html;
    markActiveLink();
    wireDrawer();
    applyWhatsAppCTA();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectTopbar);
  } else {
    injectTopbar();
  }
})();
