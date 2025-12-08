// js/pedidos.js
import { auth, onAuthStateChanged, db } from "./firebase.js";
import { fmtPrice, escapeHtml } from "./utils.js";
import { ref, onValue, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

// UI elements
const loadingEl = document.getElementById("orders-loading");
const listEl = document.getElementById("orders-list");
const userLabel = document.getElementById("user-label");
const cartBtn = document.getElementById("cart-icon-btn");
const adminBtn = document.getElementById("admin-panel-btn");

// Safety: ensure required nodes exist
if (!loadingEl || !listEl) {
  console.warn("Elementos de UI de pedidos no encontrados.");
}

// Optional handlers for buttons (no-op placeholder si no implementado)
cartBtn?.addEventListener("click", () => { /* abrir carrito */ });
adminBtn?.addEventListener("click", () => location.href = "admin.html");

// Escuchar estado de autenticación una sola vez y manejar lógica
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // no autenticado -> redirigir
    return window.location.href = "index.html";
  }

  // Mostrar email en la UI (si existe)
  if (userLabel) userLabel.textContent = user.email || "";

  // Forzar refresh del token por si cambió algún claim (no crítico)
  try {
    await auth.currentUser.getIdToken(true);
  } catch (err) {
    // no fatal; solo logueamos
    console.warn("No se pudo refrescar token:", err);
  }

  // Iniciar la escucha de los pedidos del usuario
  listenUserOrders(user.uid, user.email || "");
});

// Función que escucha/lee los pedidos del usuario
function listenUserOrders(uid, email) {
  loadingEl && (loadingEl.style.display = "block");
  listEl && (listEl.style.display = "none");
  if (listEl) listEl.innerHTML = "";

  const userOrdersRef = ref(db, `users/${uid}/orders`);

  // Intentamos escuchar /users/{uid}/orders en vivo
  onValue(userOrdersRef, async (snap) => {
    try {
      const val = snap.val();
      if (val && Object.keys(val).length) {
        renderOrdersObject(val);
        return;
      }

      // Si no hay pedidos en users/{uid}/orders, fallback a /orders y filtrado
      const ordersRef = ref(db, "orders");
      const ordersSnap = await get(ordersRef);
      const all = ordersSnap.val() || {};

      const filtered = Object.fromEntries(
        Object.entries(all).filter(([k, o]) => {
          if (!o) return false;
          if (o.uid && String(o.uid) === String(uid)) return true;
          if (o.userEmail && String(o.userEmail).toLowerCase() === String(email).toLowerCase()) return true;
          return false;
        })
      );

      if (Object.keys(filtered).length) {
        renderOrdersObject(filtered);
      } else {
        renderEmpty();
      }
    } catch (err) {
      console.error("Error leyendo orders (fallback):", err);
      renderError(err);
    }
  }, (err) => {
    // onValue error (p.ej. permission_denied)
    console.error("Error listening user orders:", err);
    renderError(err);
  });
}

// Renderiza pedidos (obj: { key: order })
function renderOrdersObject(obj) {
  loadingEl && (loadingEl.style.display = "none");
  listEl && (listEl.style.display = "block");
  if (!listEl) return;

  const entries = Object.entries(obj).sort((a, b) => {
    const ta = a[1]?.createdAt || 0;
    const tb = b[1]?.createdAt || 0;
    return tb - ta;
  });

  if (!entries.length) {
    return renderEmpty();
  }

  listEl.innerHTML = "";
  entries.forEach(([key, order]) => {
    const idPedido = order.idPedido || key;
    const cliente  = order.cliente || order.userEmail || "Sin cliente";
    const resumen  = order.resumen || summarizeOrder(order) || "Sin resumen";
    const estado   = order.estado || order.status || "pendiente";
    const total    = Number(order.total || 0);

    const createdAt = order.createdAt ? new Date(order.createdAt) : null;
    const createdTxt = createdAt && !isNaN(createdAt.getTime()) ? createdAt.toLocaleString() : "—";

    const html = `
      <article class="order-card" style="border-radius:10px;padding:12px;margin-bottom:12px;box-shadow:0 6px 18px rgba(0,0,0,0.06);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:600">Pedido: ${escapeHtml(String(idPedido))}</div>
            <div style="color:#666;font-size:13px;margin-top:4px">Fecha: ${escapeHtml(createdTxt)} · Cliente: ${escapeHtml(cliente)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:700">${fmtPrice(total)}</div>
            <div style="margin-top:6px"><span class="estado" style="padding:6px 10px;border-radius:999px;background:#f0f0f0">${escapeHtml(estado)}</span></div>
          </div>
        </div>
        <div style="margin-top:10px;color:#444">${escapeHtml(resumen)}</div>
      </article>
    `;

    listEl.insertAdjacentHTML("beforeend", html);
  });
}

function summarizeOrder(order) {
  if (!order) return "";
  if (order.resumen) return order.resumen;
  if (Array.isArray(order.items) && order.items.length) {
    return order.items.slice(0,4).map(it => `${it.name || it.title || it.id || 'item'} x${it.qty||it.quantity||1}`).join(", ");
  }
  if (Array.isArray(order.cart) && order.cart.length) {
    return order.cart.slice(0,4).map(it => `${it.name || it.id || 'item'} x${it.qty||1}`).join(", ");
  }
  return "";
}

function renderEmpty() {
  loadingEl && (loadingEl.style.display = "none");
  listEl && (listEl.style.display = "block");
  if (listEl) listEl.innerHTML = `<div style="padding:18px;color:#777;text-align:center">No tienes pedidos registrados todavía.</div>`;
}

function renderError(err) {
  loadingEl && (loadingEl.style.display = "none");
  listEl && (listEl.style.display = "block");
  const msg = (err && err.message) ? escapeHtml(err.message) : "Error desconocido";
  if (listEl) listEl.innerHTML = `<div style="padding:18px;color:#f55;text-align:center">No se pudieron cargar tus pedidos: ${msg}</div>`;
}
