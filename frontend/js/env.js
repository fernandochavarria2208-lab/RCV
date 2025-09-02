"use strict";

// Fuerza la base de la API a Cloud Run en todo el sitio
(function () {
  const PROD_API = "https://rcv-api-nulp72qabq-uc.a.run.app/api";
  localStorage.setItem("API_BASE", PROD_API);
  window.API_BASE = PROD_API;
  // console.log("[API_BASE]", PROD_API);
})();