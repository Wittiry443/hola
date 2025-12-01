// js/main.js
// ORIGINAL + buscador arreglado + admin habilitado

import {
  loadCategories,
  searchProducts,
  loadMore,
} from "./products.js";

import { moveCarousel } from "./carousel.js";
import {
  openCartPopup,
  closeCartPopup,
  sendToWhatsApp,
  refreshAllCardDisplays,
} from "./cart.js";

import { openCardPaymentModal } from "./modals.js";

// --- FIREBASE AUTH ---
import {
  auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "./firebase.js";

import { ADMIN_EMAILS } from "./auth.js";


// =====================================================
//  CONFIG IMÁGENES (PROXY + CARPETA LOCAL)
// =====================================================

const WORKER_BASE = "https://a.thepersonmrt.workers.dev";
const LOCAL_IMAGE_BASE = "./uploads/";     // si usas archivos locales
const PLACEHOLDER_IMAGE = "assets/placeholder.png";

/**
 * Normaliza la URL de imagen para evitar:
 * - doble proxy (workers.dev/image-proxy?url=workers.dev/image-proxy?url=...)
 * - rutas mal formadas con //image-proxy
 * - nombres de archivo locales sin carpeta
 * - productos sin imagen
 */
export function getSafeImageUrl(raw) {
  if (!raw) {
    return PLACEHOLDER_IMAGE;
  }

  let url = String(raw).trim();

  // Arreglar workers.dev//image-proxy -> workers.dev/image-proxy
  url = url.replace("workers.dev//image-proxy", "workers.dev/image-proxy");

  // Si YA es una URL del proxy, la devolvemos tal cual
  if (url.startsWith(`${WORKER_BASE}/image-proxy`)) {
    return url;
  }

  // Si es una URL completa (Google, etc.), la pasamos por el proxy UNA sola vez
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return `${WORKER_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
  }

  // Si llega aquí, asumimos que es un nombre de archivo local (ej: "prod_123.png")
  return `${LOCAL_IMAGE_BASE}${url}`;
}

// Exponer para que otros scripts (products.js, cart.js) puedan usarlo vía window
window.getSafeImageUrl = getSafeImageUrl;


// ---------- UI Ready ----------
document.addEventListener("DOMContentLoaded", () => {
  // cargar categorías / productos
  loadCategories();

  // --- BUSCADOR ---
  const searchInput = document.getElementById("searchInput");
  const searchBtn   = document.getElementById("search-btn");

  if (searchInput) {
    // Enter en el input
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        searchProducts();
      }
    });
  }

  if (searchBtn) {
    // Click en el botón 🔍
    searchBtn.addEventListener("click", (e) => {
      e.preventDefault();
      searchProducts();
    });
  }

  initAuthUI();
  setupAdminListener();
});

// ---------------------------
//  AUTH UI
// ---------------------------
function initAuthUI() {
  const loginBtn  = document.getElementById("login-btn");
  const userLabel = document.getElementById("user-label");
  const overlay   = document.getElementById("auth-overlay");
  const authForm  = document.getElementById("auth-form");
  const authTitle = document.getElementById("auth-title");
  const authToggle= document.getElementById("auth-toggle");
  const authClose = document.getElementById("auth-close");
  const emailInput= document.getElementById("auth-email");
  const passInput = document.getElementById("auth-password");
  const errorEl   = document.getElementById("auth-error");

  let mode = "login";

  function openModal() {
    overlay.style.display = "flex";
    errorEl.textContent = "";
  }

  function closeModal() {
    overlay.style.display = "none";
    authForm.reset();
    errorEl.textContent = "";
  }

  loginBtn.onclick = () => {
    if (auth.currentUser) {
      if (confirm("¿Cerrar sesión?")) signOut(auth);
      return;
    }
    mode = "login";
    authTitle.textContent = "Iniciar sesión";
    authToggle.textContent = "¿No tienes cuenta? Regístrate";
    openModal();
  };

  authClose.onclick = closeModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

  authToggle.onclick = () => {
    if (mode === "login") {
      mode = "register";
      authTitle.textContent = "Crear cuenta";
      authToggle.textContent = "¿Ya tienes cuenta? Inicia sesión";
    } else {
      mode = "login";
      authTitle.textContent = "Iniciar sesión";
      authToggle.textContent = "¿No tienes cuenta? Regístrate";
    }
    errorEl.textContent = "";
  };

  authForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, emailInput.value, passInput.value);
      } else {
        await createUserWithEmailAndPassword(auth, emailInput.value, passInput.value);
      }
      closeModal();
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Error al autenticar. Revisa tus datos.";
    }
  };

  onAuthStateChanged(auth, (user) => {
    loginBtn.textContent = user ? "Cerrar sesión" : "Iniciar sesión";
    userLabel.textContent = user?.email || "";
  });
}

// ---------------------------
//  ADMIN habilitado
// ---------------------------
function setupAdminListener() {
  const adminBtn = document.getElementById("admin-panel-btn");

  onAuthStateChanged(auth, (user) => {
    if (user && ADMIN_EMAILS.includes(user.email)) {
      adminBtn.style.display = "inline-flex";
    } else {
      adminBtn.style.display = "none";
    }
  });
}

// ---------------------------
//  PUBLIC FUNCTIONS (para onclick del HTML)
// ---------------------------
window.searchProducts = searchProducts;
window.moveCarousel = moveCarousel;
window.loadMore = loadMore;
window.openCartPopup = openCartPopup;
window.closeCartPopup = closeCartPopup;
window.sendToWhatsApp = sendToWhatsApp;
window.refreshAllCardDisplays = refreshAllCardDisplays;
window._openCardPaymentModal = openCardPaymentModal;
