// frontend/js/include-topbar.v9.js
(function () {
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
      u.searchParams.set('v', '9');
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

  // ========= Drawer (forzando estilos para ganar a cualquier CSS) =========
  function getDrawerEls() {
    return {
      drawer:   document.getElementById('drawer'),
      backdrop: document.getElementById('drawerBackdrop')
    };
  }

  function ensureDrawer() {
    let { drawer, backdrop } = getDrawerEls();
    if (!drawer || !backdrop) {
      document.body.insertAdjacentHTML('beforeend', `
<div id="drawerBackdrop"></div>
<aside id="drawer" aria-hidden="true" aria-labelledby="drawerTitle" role="dialog">
  <div class="drawer-header">
    <div id="drawerTitle" class="drawer-title">Área interna</div>
    <button class="btn btn-ghost" id="btnCloseDrawer" aria-label="Cerrar">✕</button>
  </div>
  <div class="drawer-body">
    <div class="drawer-note"><strong>Espacio único para empleados</strong><br/>Acceso a panel, kardex, órdenes, facturación y más.</div>
    <p class="muted" style="margin:0">Si eres parte del equipo, inicia sesión para continuar.</p>
  </div>
  <div class="drawer-actions"><a class="btn btn-primary" href="login.html">Iniciar sesión</a></div>
</aside>`);
      ({ drawer, backdrop } = getDrawerEls());
    }

    try { document.body.appendChild(backdrop); } catch {}
    try { document.body.appendChild(drawer); } catch {}

    const s = (el, prop, val) => el && el.style.setProperty(prop, val, 'important');

    if (backdrop) {
      s(backdrop,'position','fixed');
      s(backdrop,'inset','0');
      s(backdrop,'background','rgba(0,0,0,.35)');
      s(backdrop,'opacity','0');
      s(backdrop,'pointer-events','none');
      s(backdrop,'transition','opacity .2s ease');
      s(backdrop,'z-index','2147483646');
    }
    if (drawer) {
      s(drawer,'position','fixed');
      s(drawer,'top','0'); s(drawer,'right','0');
      s(drawer,'height','100%'); s(drawer,'width','min(92vw,360px)');
      s(drawer,'background','#fff');
      s(drawer,'box-shadow','-8px 0 24px rgba(15,23,42,.18)');
      s(drawer,'transform','translateX(100%)');
      s(drawer,'transition','transform .25s ease');
      s(drawer,'z-index','2147483647');
      s(drawer,'display','flex'); s(drawer,'flex-direction','column');

      const header = drawer.querySelector('.drawer-header');
      const actions = drawer.querySelector('.drawer-actions');
      const note = drawer.querySelector('.drawer-note');
      const body = drawer.querySelector('.drawer-body');
      const closeBtn = drawer.querySelector('#btnCloseDrawer');
      const primary = drawer.querySelector('.btn.btn-primary');

      if (header) { s(header,'display','flex'); s(header,'align-items','center'); s(header,'justify-content','space-between'); s(header,'padding','14px 16px'); s(header,'border-bottom','1px solid #f1f5f9'); }
      if (actions){ s(actions,'margin-top','auto'); s(actions,'padding','16px'); s(actions,'border-top','1px solid #f1f5f9'); }
      if (note)   { s(note,'color','#6b7280'); s(note,'background','#f8fafc'); s(note,'padding','12px'); s(note,'border-radius','12px'); s(note,'border','1px dashed #e5e7eb'); }
      if (body)   { s(body,'padding','16px'); s(body,'display','flex'); s(body,'flex-direction','column'); s(body,'gap','12px'); }
      if (closeBtn){ s(closeBtn,'background','#fff'); s(closeBtn,'border','1px solid #e5e7eb'); s(closeBtn,'border-radius','12px'); s(closeBtn,'padding','8px 12px'); s(closeBtn,'cursor','pointer'); }
      if (primary){ s(primary,'display','inline-block'); s(primary,'border','none'); s(primary,'border-radius','12px'); s(primary,'padding','10px 14px'); s(primary,'cursor','pointer'); s(primary,'background','#245C8D'); s(primary,'color','#fff'); s(primary,'text-decoration','none'); }
    }
  }

  function openDrawer(){
    ensureDrawer();
    const { drawer, backdrop } = getDrawerEls();
    if (!drawer || !backdrop) return;
    const s = (el, prop, val) => el && el.style.setProperty(prop, val, 'important');

    s(drawer,'transform','none');
    s(backdrop,'opacity','1');
    s(backdrop,'pointer-events','auto');
    drawer.setAttribute('aria-hidden','false');

    document.documentElement.style.setProperty('overflow','hidden','important');
    document.body.style.setProperty('overflow','hidden','important');

    requestAnimationFrame(()=>{ s(drawer,'transform','none'); s(backdrop,'opacity','1'); s(backdrop,'pointer-events','auto'); });
    setTimeout(()=>{ s(drawer,'transform','none'); s(backdrop,'opacity','1'); s(backdrop,'pointer-events','auto'); }, 60);
  }

  function closeDrawer(){
    const { drawer, backdrop } = getDrawerEls();
    if (!drawer || !backdrop) return;
    const s = (el, prop, val) => el && el.style.setProperty(prop, val, 'important');

    s(drawer,'transform','translateX(100%)');
    s(backdrop,'opacity','0');
    s(backdrop,'pointer-events','none');
    drawer.setAttribute('aria-hidden','true');

    document.documentElement.style.removeProperty('overflow');
    document.body.style.removeProperty('overflow');
  }

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

  function removeDuplicates(keepHeader) {
    const headers = Array.from(document.querySelectorAll('header.topbar'));
    headers.forEach(h => { if (h !== keepHeader) h.remove(); });

    const drawers = Array.from(document.querySelectorAll('#drawer'));
    const backs   = Array.from(document.querySelectorAll('#drawerBackdrop'));
    drawers.slice(1).forEach(n => n.remove());
    backs.slice(1).forEach(n => n.remove());
  }

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

    ensureDrawer();
    markActiveLink();
    applyWhatsAppCTA();

    setTimeout(ensureDrawer, 0);
  }

  function boot() {
    ensureDrawer();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectTopbar);
    } else {
      injectTopbar();
    }
  }
  boot();

  window.__openDrawer  = openDrawer;
  window.__closeDrawer = closeDrawer;
})();
