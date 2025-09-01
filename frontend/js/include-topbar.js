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
      } else if (path.endsWith('/index.html') || /\/$/.test(path)) {
        document.querySelector('a[data-page="inicio"]')?.classList.add('active');
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
    // Deja solo un drawer/backdrop
    const drawers = Array.from(document.querySelectorAll('#drawer'));
    const backs   = Array.from(document.querySelectorAll('#drawerBackdrop'));
    drawers.slice(1).forEach(n => n.remove());
    backs.slice(1).forEach(n => n.remove());
  }

  async function injectTopbar() {
    // 1) Preferimos reemplazar un header.topbar existente
    let target = document.querySelector('header.topbar');
    // 2) Si no hay, probamos slot explícito
    if (!target) target = document.getElementById('topbarSlot');
    // 3) Si tampoco hay, creamos slot al principio
    let created = false;
    if (!target) {
      target = document.createElement('div');
      target.id = 'topbarSlotAuto';
      document.body.insertBefore(target, document.body.firstChild);
      created = true;
    }

    // 4) Cargar parcial
    let html = '';
    try { html = await fetchFirstOk(candidatePaths()); }
    catch (e) { console.error('[topbar] No se pudo cargar:', e); return; }

    // 5) Inyectar/reemplazar
    if (created || target.id === 'topbarSlot' || target.id === 'topbarSlotAuto') {
      target.outerHTML = html;
      target = document.querySelector('header.topbar');
    } else {
      target.outerHTML = html;
      target = document.querySelector('header.topbar');
    }

    // 6) Limpiar duplicados y conectar lógica
    if (target) removeDuplicates(target);
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
