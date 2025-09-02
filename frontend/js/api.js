/* eslint-env browser */
"use strict";

// ===============================
//  API BASE (Cloud Run por defecto)
// ===============================
(function resolveApiBase() {
  const DEFAULT_CLOUD_RUN = "https://rcv-api-nulp72qabq-uc.a.run.app/api";

  const fromEnv =
    typeof window !== "undefined" && window.API_BASE
      ? String(window.API_BASE).trim()
      : "";
  const fromStore = (localStorage.getItem("API_BASE") || "").trim();

  const decided = fromEnv || fromStore || DEFAULT_CLOUD_RUN;

  // Persistimos para que el resto del sitio use el mismo endpoint
  if (decided && decided !== fromStore) {
    localStorage.setItem("API_BASE", decided);
  }
  // Exponer también en window por si otras partes lo leen
  window.API_BASE = decided;
})();

// Queda resuelta arriba
const API_BASE = window.API_BASE;

// ===============================
//  AUTH TOKEN (JWT)
// ===============================
let authToken =
  localStorage.getItem("authToken") || localStorage.getItem("token") || null;

function setAuthToken(token) {
  authToken = token || null;
  if (authToken) {
    localStorage.setItem("authToken", authToken);
    localStorage.setItem("token", authToken); // compatibilidad con otras partes
  } else {
    localStorage.removeItem("authToken");
    localStorage.removeItem("token");
  }
}

// ===============================
//  UTILS
// ===============================
function joinUrl(base, path) {
  if (/^https?:\/\//i.test(path)) return path; // ya es absoluta
  const b = String(base || "").replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  return `${b}/${p}`;
}

// ===============================
//  CORE FETCH
// ===============================
async function apiFetch(
  path,
  { method = "GET", body, headers = {}, timeoutMs = 12000 } = {}
) {
  const h = { Accept: "application/json", ...headers };
  const url = joinUrl(API_BASE, path);

  // Auth
  const token =
    authToken ||
    localStorage.getItem("authToken") ||
    localStorage.getItem("token");
  if (token) h.Authorization = `Bearer ${token}`;

  // Actor headers (opcionales pero útiles)
  let actorNombre = "sistema";
  let actorRol = "usuario";
  try {
    const ua = JSON.parse(localStorage.getItem("usuarioActual") || "{}");
    actorNombre = ua.usuario || ua.nombre || actorNombre;
    actorRol = ua.rol || actorRol;
  } catch (e) { /* noop */ }
  h["X-Actor"] = actorNombre;
  h["X-Actor-Usuario"] = actorNombre;
  h["X-Actor-Rol"] = actorRol;

  const isFormLike =
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer);

  if (body != null && !h["Content-Type"] && !isFormLike) {
    h["Content-Type"] = "application/json";
  }

  const payload =
    body == null
      ? undefined
      : isFormLike
      ? body
      : typeof body === "string"
      ? body
      : JSON.stringify(body);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: h,
      body: payload,
      mode: "cors",
      credentials: "omit",
      signal: ctrl.signal,
    });
  } catch (netErr) {
    clearTimeout(t);
    if (netErr && netErr.name === "AbortError") {
      throw new Error("La solicitud tardó demasiado (timeout).");
    }
    throw new Error("No se pudo conectar con el servidor");
  } finally {
    clearTimeout(t);
  }

  const text = await res.text();
  const contentType = (res.headers.get("Content-Type") || "").toLowerCase();

  let data;
  if (!text) {
    data = {};
  } else if (contentType.includes("application/json")) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  } else {
    data = text;
  }

  if (!res.ok) {
    const msgFromBody = (data && (data.error || data.message)) || null;
    const msg = msgFromBody || `Error ${res.status} en ${path}`;
    throw new Error(msg);
  }

  // Si no es JSON, devuelve envoltorio
  if (typeof data === "string" && !contentType.includes("application/json")) {
    return { raw: data };
  }
  return data;
}

// ===============================
//  ENDPOINTS
// ===============================
const AuthAPI = {
  async login(usuario, password) {
    const out = await apiFetch("/auth/login", {
      method: "POST",
      body: { usuario, password },
    });
    if (out && out.token) setAuthToken(out.token);
    if (out && out.user) {
      localStorage.setItem("usuarioActual", JSON.stringify(out.user));
    }
    return out;
  },
  async verify() {
    try {
      return await apiFetch("/auth/verify", { method: "GET" });
    } catch (e) {
      const msg = String(e && e.message ? e.message : "");
      if (msg.includes("Error 404") || msg.toLowerCase().includes("not found"))
        return null;
      throw e;
    }
  },
  logout() {
    setAuthToken(null);
  },
};

const UsuariosAPI = {
  listar(q = "") {
    return apiFetch(`/usuarios${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  },
  obtener(id) {
    return apiFetch(`/usuarios/${id}`);
  },
  crear(data) {
    return apiFetch(`/usuarios`, { method: "POST", body: data });
  },
  actualizar(id, data) {
    return apiFetch(`/usuarios/${id}`, { method: "PUT", body: data });
  },
  estado(id, estado) {
    return apiFetch(`/usuarios/${id}/estado`, {
      method: "PATCH",
      body: { estado },
    });
  },
  resetPass(id, nueva) {
    const body =
      nueva === undefined || nueva === null ? {} : { nueva: String(nueva) };
    return apiFetch(`/usuarios/${id}/reset-password`, {
      method: "POST",
      body,
    });
  },
  eliminar(id) {
    return apiFetch(`/usuarios/${id}`, { method: "DELETE" });
  },
  actualizarPermisos(id, permisos) {
    return apiFetch(`/usuarios/${id}/permisos`, {
      method: "PUT",
      body: { permisos },
    });
  },
};

const BitacoraAPI = {
  listar(usuario = "") {
    const qs = usuario ? `?usuario=${encodeURIComponent(usuario)}` : "";
    return apiFetch(`/bitacora${qs}`);
  },
};

// Salud de la API (útil para diagnósticos)
function health() {
  return apiFetch("/health", { method: "GET" });
}

// Exponer
window.API = {
  AuthAPI,
  UsuariosAPI,
  BitacoraAPI,
  setAuthToken,
  health,
};
window.API_BASE = API_BASE;
