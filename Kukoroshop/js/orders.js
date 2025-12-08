// js/pedidos.js
import { auth, onAuthStateChanged, db } from "./firebase.js";
import { fmtPrice, escapeHtml } from "./utils.js";
import { ref, onValue, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import { getIdTokenResult } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

const loadingEl = document.getElementById("orders-loading");
const listEl = document.getElementById("orders-list");
const userLabel = document.getElementById("user-label");
const cartBtn = document.getElementById("cart-icon-btn");
const adminBtn = document.getElementById("admin-panel-btn");

// Asegura que existan elementos
if (!loadingEl || !listEl) {
  console.warn("Elementos de UI de pedidos no encontrados.");
}

// Mantener botones (si vienen del index)
cartBtn?.addEventListener("click", () => { /* tu lógica de carrito */ });
adminBtn?.addEventListener("click", () => location.href = "admin.html");

// Manejo de estado auth
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // si no está logueado, redirigir al index (o mostrar mensaje)
    window.location.href = "index.html";
    return;
  }

  userLabel.textContent = user.email || "";

  // refrescar token por si se acaban de setear claims (no necesario aquí pero útil)
  try { await auth.currentUser.getIdToken(true); } catch(e){/* ignore */ }

  // Intentamos primero leer /users/{uid}/orders (recomendado)
  listenUserOrders(user.uid, user.email);
});

// función principal: escucha orders del usuario
function listenUserOrders(uid, email) {
  // Limpia UI
  loadingEl.style.display = "block";
  listEl.style.display = "none";
  listEl.innerHTML = "";

  const userOrdersRef = ref(db, `users/${uid}/orders`);
  // Si el usuario existe en users/{uid}/orders, onValue actualizará en vivo
  onValue(userOrdersRef, async (snap) => {
    const val = snap.val();
    if (val) {
      renderOrdersObject(val);
      return;
    }

    // Si no hay orders en users/{uid}/orders, hacemos fallback a /orders y filtramos por uid o email
    try {
      const ordersRef = ref(db, "orders");
      const ordersSnap = await get(ordersRef);
      const all = ordersSnap.val() || {};
      // Filtrado robusto: uid preferido, si no existe, por userEmail
      const arr = Object.entries(all).filter(([key, o]) => {
        if (!o) return false;
        if (o.uid && String(o.uid) === String(uid)) return true;
        if (o.userEmail && String(o.userEmail).toLowerCase() === String(email).toLowerCase()) return true;
        return false;
      }).reduce((acc, [k,v]) => { acc[k]=v; return acc; }, {});

      if (Object.keys(arr).length) {
        renderOrdersObject(arr);
      } else {
        renderEmpty();
      }
    } catch (err) {
      console.error("Error leyendo orders fallback:", err);
      renderError(err);
    }
  }, (err) => {
    console.error("Error listening user orders:", err);
    // Permission denied seguramente: mostrar mensaje útil
    renderError(err);
  });
}

// Renderiza la lista (obj es un objeto { key: order })
function renderOrdersObject(obj) {
  loadingEl.style.display = "none";
  listEl.style.display = "block";
  listEl.innerHTML = "";

  const entries = Object.entries(obj).sort((a,b) => {
    const ta = a[1].createdAt || 0;
    const tb = b[1].createdAt || 0;
    return tb - ta; // más recientes primero
  });

  if (!entries.length) {
    return renderEmpty();
  }

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
  // intenta leer una propiedad resumen, si no, genera uno breve desde items
  if (order.resumen) return order.resumen;
  if (order.items && Array.isArray(order.items)) {
    return order.items.slice(0,4).map(it => `${it.name || it.title || it.id || 'item'} x${it.qty||it.quantity||1}`).join(", ");
  }
  if (order.cart && Array.isArray(order.cart)) {
    return order.cart.slice(0,4).map(it => `${it.name || it.id || 'item'} x${it.qty||1}`).join(", ");
  }
  return "";
}

function renderEmpty() {
  loadingEl.style.display = "none";
  listEl.style.display = "block";
  listEl.innerHTML = `<div style="padding:18px;color:#777;text-align:center">No tienes pedidos registrados todavía.</div>`;
}

function renderError(err) {
  loadingEl.style.display = "none";
  listEl.style.display = "block";
  const msg = (err && err.message) ? escapeHtml(err.message) : "Error desconocido";
  listEl.innerHTML = `<div style="padding:18px;color:#f55;text-align:center">No se pudieron cargar tus pedidos: ${msg}</div>`;
}
