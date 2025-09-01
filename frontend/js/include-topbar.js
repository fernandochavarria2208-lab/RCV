// frontend/js/include-topbar.js
(function () {
  // Intenta varias rutas relativas para encontrar el parcial sin importar
  // si la página vive en /, /repo/, /frontend/, subcarpetas, etc.
  function candidatePaths() {
    const here = location.href;
    const paths = [
      'partials/topbar.html',
      '../partials/topbar.html',
      '../../partials/topbar.html',
      'frontend/partials/topbar.html',
      '../frontend/partials/topbar.html'
    ];
    // Convierte a rutas absolutas seguras basadas en la URL actual
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

      const byPage = {
        'servicios': 'a[data-page="servicios"]',
        'inicio': 'a[data-page="inicio"]',
        'consulta': 'a[data-page="consulta"]',
        'contacto': 'a[data-page="contacto"]'
      };

      if (path.endsWith('/servicios.html')) {
        document.querySelector(byPage.servicios)?.classList.add('active');
      } else if (hash.includes('consulta')) {
        document.querySelector(byPage.consulta)?.classList.add('active');
      } else if (hash.includes('contacto')) {
        document.querySelector(byPage.contacto)?.classList.add('active');
      } else {
        // Por defecto, Inicio (index.html o carpeta)
        if (path.endsWith('/index.html') || /\/$/.test(path)) {
          document.querySelector(byPage.inicio)?.classList.add('active');
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
    // Si tus páginas guardaron el href en window.__waHref o __waHrefCTA, aplícalo ahora
    const cta = document.getElementById('ctaWhatsApp');
    if (cta) {
      const href = window.__waHrefCTA || window.__waHref;
      if (href) cta.href = href;
    }
  }

  async function injectTopbar() {
    const slot = document.getElementById('topbarSlot');
    if (!slot) return;

    // Evita doble inyección si ya existe
    if (document.querySelector('header.topbar')) return;

    // Carga el parcial desde la primera ruta válida
    let html = '';
    try {
      html = await fetchFirstOk(candidatePaths());
    } catch (e) {
      console.error('[topbar] No se pudo cargar el topbar:', e);
      return;
    }

    // Inserta en el slot
    slot.innerHTML = html;

    // Marca enlace activo, conecta el drawer y aplica CTA
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
