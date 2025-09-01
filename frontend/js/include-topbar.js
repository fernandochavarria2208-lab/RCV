// frontend/js/include-topbar.js
(function () {
  async function injectTopbar() {
    const slot = document.getElementById('topbarSlot');
    if (!slot) return; // nada que hacer

    // Evita doble inyección si ya existe un header .topbar
    if (document.querySelector('header.topbar')) return;

    // Carga el parcial
    const url = 'partials/topbar.html';
    let html = '';
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      html = await res.text();
    } catch (e) {
      console.error('No se pudo cargar el topbar:', e);
      return;
    }

    // Inserta
    slot.innerHTML = html;

    // Marca activo según página
    try {
      const path = (location.pathname || '').toLowerCase();
      const isServicios = path.endsWith('/servicios.html');
      const isIndex = path.endsWith('/index.html') || path.endsWith('/frontend/') || path.endsWith('/frontend');
      const hash = (location.hash || '').toLowerCase();

      const links = document.querySelectorAll('header.topbar nav a[data-page]');
      links.forEach(a => a.classList.remove('active'));

      if (isServicios) {
        document.querySelector('a[data-page="servicios"]')?.classList.add('active');
      } else if (hash.includes('consulta')) {
        document.querySelector('a[data-page="consulta"]')?.classList.add('active');
      } else if (hash.includes('contacto')) {
        document.querySelector('a[data-page="contacto"]')?.classList.add('active');
      } else if (isIndex) {
        document.querySelector('a[data-page="inicio"]')?.classList.add('active');
      }
    } catch {}

    // Drawer wiring
    (function(){
      const drawer   = document.getElementById('drawer');
      const backdrop = document.getElementById('drawerBackdrop');
      const openBtn  = document.getElementById('btnHamb');
      const closeBtn = document.getElementById('btnCloseDrawer');

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
      window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeDrawer(); });
    })();
  }

  // Ejecutar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectTopbar);
  } else {
    injectTopbar();
  }
})();
