// frontend/js/env.js
(function(){
  const prodHost = 'serviciosmecanicosrcv.duckdns.org';
  const host = window.location.hostname;
  const target = (host === prodHost) ? '/api' : 'http://localhost:3001/api';
  const current = localStorage.getItem('API_BASE');
  if (current !== target) {
    localStorage.setItem('API_BASE', target);
  }
})();

