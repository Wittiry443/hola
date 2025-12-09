// js/admin.js (usa users/{uid}/orders como fuente única)
// importaciones
import { auth, onAuthStateChanged, db, ensureUserRecord } from "./firebase.js";
import { ADMIN_EMAILS } from "./auth.js";
import { API_URL } from "./config.js";
import { fmtPrice, escapeHtml } from "./utils.js";
import {
  ref,
  onValue,
  update,
  remove,
  get,
  set
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import { getIdTokenResult } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

// Estados disponibles para el select
const ORDER_STATUSES = ["pendiente", "en proceso", "enviado", "entregado", "cancelado"];

// Estado interno
let allProducts = [];
let filteredProducts = [];

// --- Helper: comprobar admin (claims -> /admins -> ADMIN_EMAILS)
async function isAdminUser(user) {
  if (!user) return false;
  try {
    // 1) revisar /admins/{uid}
    const snap = await get(ref(db, `admins/${user.uid}`));
    if (snap.exists() && snap.val() === true) return true;

    // 2) fallback: revisar users/{uid}.role == 'admin' (útil si migraste)
    const uSnap = await get(ref(db, `users/${user.uid}/role`));
    if (uSnap.exists() && String(uSnap.val()) === "admin") return true;
  } catch (e) {
    console.warn("isAdminUser error:", e);
  }

  // 3) fallback UI-only: ADMIN_EMAILS (solo para mostrar UI, no para reglas)
  if (ADMIN_EMAILS && ADMIN_EMAILS.includes(user.email)) return true;

  return false;
}

// onAuthStateChanged: comprobar y guardar user record (usa ensureUserRecord)
onAuthStateChanged(auth, async (user) => {
  const label = document.getElementById("admin-user-label");
  if (!user) return (window.location.href = "index.html");

  // Guardar/actualizar registro base del usuario (client) - no crítico
  try {
    if (typeof ensureUserRecord === "function") await ensureUserRecord(user);
  } catch (e) {
    console.warn("ensureUserRecord fail", e);
  }

  // comprobar admin real
  const isAdmin = await isAdminUser(user);
  if (!isAdmin) {
    alert("No tienes permisos de administrador.");
    return (window.location.href = "index.html");
  }

  if (label) label.textContent = user.email || "";
  initAdminUI();
});

// UI Inicial
function initAdminUI() {
  document.getElementById("admin-logout-btn").onclick = () => auth.signOut();
  document.getElementById("admin-back-btn").onclick = () => (window.location.href = "index.html");
  document.getElementById("new-product-btn").onclick = openCreateProductModal;
  document.getElementById("product-modal-close").onclick = closeProductModal;
  document.getElementById("product-modal-overlay").onclick = (e) => {
    if (e.target.id === "product-modal-overlay") closeProductModal();
  };
  document.getElementById("product-form").onsubmit = onSubmitProductForm;

  document.getElementById("product-search").oninput = applyProductFilters;
  document.getElementById("product-category-filter").onchange = applyProductFilters;

  loadProducts();
  generarDashboardPedidos(); // lee users/*/orders y arma la tabla de pedidos
}

// -----------------------------------------------------------
// 📦 DASHBOARD DE PEDIDOS (lee users/{uid}/orders)
// -----------------------------------------------------------
function generarDashboardPedidos() {
  const tbody = document.getElementById("orders-table-body");
  if (!tbody) return;

  const ventasDiaEl = document.getElementById("ventasDia");
  const ventasMesEl = document.getElementById("ventasMes");
  const pedidosEl = document.getElementById("pedidosCount");

  tbody.innerHTML = `
    <tr>
      <td colspan="6" style="text-align:center;color:#999">
        Cargando pedidos desde Firebase (users/*/orders)...
      </td>
    </tr>
  `;

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();

  const usersRef = ref(db, "users");

  // Escuchamos usuarios completos y extraemos orders de cada uno
  onValue(usersRef, (snapshot) => {
    const users = snapshot.val() || {};
    const entries = []; // { key, order, uid, userEmail }

    Object.entries(users).forEach(([uid, udata]) => {
      const orders = udata.orders || {};
      Object.entries(orders).forEach(([key, order]) => {
        entries.push({
          key,
          order,
          uid,
          userEmail: udata.email || order.userEmail || udata.email || ""
        });
      });
    });

    // ordenar por createdAt (desc)
    entries.sort((a, b) => {
      const ta = a.order?.createdAt || 0;
      const tb = b.order?.createdAt || 0;
      return Number(tb) - Number(ta);
    });

    let totalDia = 0;
    let totalMes = 0;
    let totalPedidos = 0;

    tbody.innerHTML = "";

    if (!entries.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;color:#aaa">
            No hay pedidos registrados todavía.
          </td>
        </tr>
      `;
    } else {
      entries.forEach(({ key, order, uid }) => {
        totalPedidos++;
        const total = Number(order.total || 0);

        let created = null;
        try { if (order.createdAt) created = new Date(order.createdAt); } catch (e) { created = null; }

        const estado = (order.estado || "pendiente").toString();
        const estadoLower = estado.toLowerCase();

        if (created && !isNaN(created.getTime())) {
          const y = created.getFullYear();
          const m = created.getMonth();
          const d = created.getDate();
          if (estadoLower !== "cancelado") {
            if (y === year && m === month) {
              totalMes += total;
              if (d === day) totalDia += total;
            }
          }
        } else {
          if (estadoLower !== "cancelado") totalMes += total;
        }

        const idPedido = order.idPedido || key;
        const cliente = order.cliente || order.userEmail || "Sin cliente";
        const resumen = order.resumen || "Sin resumen";
        const estadoClass = estadoLower.replace(/\s+/g, "-");

        const optionsHtml = ORDER_STATUSES.map(st => `
          <option value="${st}" ${st === estadoLower ? "selected" : ""}>${st}</option>
        `).join("");

        // añadimos data-order-uid para poder actualizar / borrar la orden correctamente
        tbody.innerHTML += `
<tr data-order-key="${escapeHtml(key)}" data-order-uid="${escapeHtml(uid)}">
  <td>${escapeHtml(String(idPedido))}</td>
  <td>${escapeHtml(String(cliente))}</td>
  <td>${escapeHtml(String(resumen))}</td>
  <td>$${Number(total || 0).toLocaleString()}</td>
  <td><span class="estado ${estadoClass}">${escapeHtml(estado)}</span></td>
  <td>
    <div class="order-actions">
      <select class="order-status-select" data-order-key="${key}" data-order-uid="${uid}">
        ${optionsHtml}
      </select>
      <button class="order-edit-btn" data-order-key="${key}" data-order-uid="${uid}" title="Editar pedido">✎</button>
      <button class="order-delete-btn" data-order-key="${key}" data-order-uid="${uid}" title="Eliminar pedido">🗑</button>
    </div>
  </td>
</tr>
`;
      });
    }

    if (ventasDiaEl) ventasDiaEl.textContent = totalDia.toLocaleString();
    if (ventasMesEl) ventasMesEl.textContent = totalMes.toLocaleString();
    if (pedidosEl) pedidosEl.textContent = totalPedidos;

    // Listeners para selects de estado
    tbody.querySelectorAll(".order-status-select").forEach(sel => {
      sel.onchange = async () => {
        const key = sel.dataset.orderKey;
        const uid = sel.dataset.orderUid;
        const newStatus = sel.value;
        try {
          await updateOrderStatus(uid, key, newStatus);
        } catch (e) {
          console.error("Error actualizando estado:", e);
          alert("No se pudo actualizar el estado. Revisa la consola.");
        }
      };
    });

    // Listeners para editar pedido
    tbody.querySelectorAll(".order-edit-btn").forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.orderKey;
        const uid = btn.dataset.orderUid;
        try {
          const snap = await get(ref(db, `users/${uid}/orders/${key}`));
          const order = snap.val();
          if (!order) return alert("Pedido no encontrado.");
          openEditOrderModal(uid, key, order);
        } catch (e) {
          console.error("Error cargando pedido para editar:", e);
          alert("No se pudo cargar el pedido. Revisa la consola.");
        }
      };
    });

    // Listeners para eliminar
    tbody.querySelectorAll(".order-delete-btn").forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.orderKey;
        const uid = btn.dataset.orderUid;
        if (!confirm("¿Eliminar este pedido de forma permanente?")) return;
        try {
          await deleteOrder(uid, key);
          alert("Pedido eliminado.");
        } catch (e) {
          console.error("Error eliminando pedido:", e);
          alert("No se pudo eliminar el pedido. Revisa la consola.");
        }
      };
    });
  }, (error) => {
    console.error("Error leyendo users/*/orders:", error);

    if (error && error.code && error.code === "permission_denied") {
      const currentUser = auth.currentUser;
      const uid = currentUser ? currentUser.uid : "no-uid";
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;color:#f55">
            Error: permission_denied al leer users/*/orders. UID actual: ${escapeHtml(String(uid))}. Revisa las reglas de Realtime DB.
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;color:#f55">
            Error cargando pedidos desde Firebase.
          </td>
        </tr>
      `;
    }
  });
}

// Actualizar estado en Firebase (se opera sobre users/{uid}/orders/{key})
async function updateOrderStatus(uid, orderKey, newStatus) {
  const orderPath = `users/${uid}/orders/${orderKey}`;
  try {
    await update(ref(db, orderPath), { estado: newStatus });
    console.log(`[admin] order ${orderKey} status updated -> ${newStatus}`);

    // (Opcional) Si existiera una copia en /orders/{orderKey} y quieres eliminarla, descomenta:
    // try { await remove(ref(db, `orders/${orderKey}`)); } catch(e){ /* no fatal */ }

  } catch (err) {
    console.error("updateOrderStatus error:", err);
    throw err;
  }
}

// Eliminar pedido en Firebase (borra users/{uid}/orders/{key})
async function deleteOrder(uid, orderKey) {
  try {
    await remove(ref(db, `users/${uid}/orders/${orderKey}`));
    console.log("[admin] order deleted (users node):", orderKey);

    // (Opcional) Si existiera la copia legacy en /orders, intenta eliminarla también (no obligatorio)
    try {
      const legacySnap = await get(ref(db, `orders/${orderKey}`));
      if (legacySnap.exists()) {
        await remove(ref(db, `orders/${orderKey}`));
        console.log("[admin] removed legacy /orders copy:", orderKey);
      }
    } catch (e) {
      console.warn("No se pudo limpiar legacy /orders:", e);
    }

  } catch (err) {
    console.error("deleteOrder error:", err);
    throw err;
  }
}

// ----------------------------------------------------
// Modal de edición de pedido (dinámico) - nuevo esquema shipping
// ----------------------------------------------------
function ensureOrderEditModalExists() {
  if (document.getElementById("order-edit-modal-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "order-edit-modal-overlay";
  overlay.style = "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);z-index:30000;";
  overlay.innerHTML = `
    <div id="order-edit-modal" style="width:92%;max-width:720px;background:#fff;border-radius:10px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,0.25);">
      <h3 id="order-edit-title" style="margin:0 0 8px 0">Editar pedido</h3>
      <div id="order-edit-body" style="max-height:60vh;overflow:auto"></div>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
        <button id="order-edit-cancel" class="btn-ghost btn-small">Cancelar</button>
        <button id="order-edit-save" class="btn-primary btn-small">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#order-edit-cancel").onclick = () => {
    overlay.style.display = "none";
  };
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  };
}

// abre modal con datos de orden (acepta uid y key)
function openEditOrderModal(uid, orderKey, order) {
  ensureOrderEditModalExists();
  const overlay = document.getElementById("order-edit-modal-overlay");
  const body = document.getElementById("order-edit-body");

  // Normalizar shipping: soporta esquema nuevo y legacy
  const shippingRaw = order.shipping || order.direccion || order.delivery || {};
  const fullName =
    shippingRaw.fullName ||
    shippingRaw.name ||
    shippingRaw.cliente ||
    shippingRaw.contactName ||
    order.cliente ||
    "";
  const phone =
    shippingRaw.phone ||
    shippingRaw.telefono ||
    shippingRaw.contactPhone ||
    shippingRaw.mobile ||
    "";
  const address =
    shippingRaw.address ||
    shippingRaw.addressLine ||
    shippingRaw.calle ||
    shippingRaw.fullAddress ||
    shippingRaw.direccion ||
    "";
  const notes =
    shippingRaw.notes ||
    shippingRaw.notas ||
    shippingRaw.info ||
    shippingRaw.fullAddress ||
    "";

  const optionsHtml = ORDER_STATUSES.map(st => `<option value="${st}" ${st === (order.estado || "pendiente") ? "selected" : ""}>${st}</option>`).join("");

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label style="display:block;font-weight:700;margin-bottom:6px">ID Pedido</label>
        <div style="padding:8px;border-radius:6px;background:#f7f7f7">${escapeHtml(order.idPedido || orderKey)}</div>
      </div>
      <div>
        <label style="display:block;font-weight:700;margin-bottom:6px">Cliente</label>
        <div style="padding:8px;border-radius:6px;background:#f7f7f7">${escapeHtml(order.cliente || order.userEmail || "")}</div>
      </div>
    </div>

    <div style="margin-top:10px">
      <label style="display:block;font-weight:700;margin-bottom:6px">Resumen</label>
      <textarea id="order-edit-resumen" rows="3" style="width:100%;padding:8px;border-radius:6px" readonly>${escapeHtml(order.resumen || "")}</textarea>
    </div>

    <div style="margin-top:10px;display:flex;gap:10px;">
      <div style="flex:1">
        <label style="display:block;font-weight:700;margin-bottom:6px">Estado</label>
        <select id="order-edit-estado" style="width:100%;padding:8px;border-radius:6px">${optionsHtml}</select>
      </div>
      <div style="width:160px">
        <label style="display:block;font-weight:700;margin-bottom:6px">Total</label>
        <div style="padding:8px;border-radius:6px;background:#f7f7f7">$${Number(order.total || 0).toLocaleString()}</div>
      </div>
    </div>

    <div style="margin-top:12px">
      <h4 style="margin:0 0 8px 0">Dirección de envío (editable)</h4>
      <div style="display:grid;grid-template-columns:1fr;gap:8px">
        <div>
          <label style="display:block;font-weight:700;margin-bottom:6px">Nombre completo</label>
          <input id="order-edit-fullName" style="width:100%;padding:8px;border-radius:6px" value="${escapeHtml(fullName)}" />
        </div>

        <div>
          <label style="display:block;font-weight:700;margin-bottom:6px">Número de teléfono</label>
          <input id="order-edit-phone" style="width:100%;padding:8px;border-radius:6px" value="${escapeHtml(phone)}" />
        </div>

        <div>
          <label style="display:block;font-weight:700;margin-bottom:6px">Dirección</label>
          <input id="order-edit-address" style="width:100%;padding:8px;border-radius:6px" value="${escapeHtml(address)}" />
        </div>

        <div>
          <label style="display:block;font-weight:700;margin-bottom:6px">Información adicional / notas para el repartidor</label>
          <textarea id="order-edit-notes" rows="3" style="width:100%;padding:8px;border-radius:6px">${escapeHtml(notes)}</textarea>
        </div>
      </div>
    </div>
  `;

  // show overlay
  overlay.style.display = "flex";

  // save handler
  const saveBtn = overlay.querySelector("#order-edit-save");
  const cancelBtn = overlay.querySelector("#order-edit-cancel");

  // remove previous handlers to avoid duplicates
  saveBtn.onclick = null;
  cancelBtn.onclick = null;

  saveBtn.onclick = async () => {
    const newEstado = document.getElementById("order-edit-estado").value;
    const fullNameNew = document.getElementById("order-edit-fullName").value.trim();
    const phoneNew = document.getElementById("order-edit-phone").value.trim();
    const addressNew = document.getElementById("order-edit-address").value.trim();
    const notesNew = document.getElementById("order-edit-notes").value.trim();

    const shippingObj = {
      ...(fullNameNew ? { fullName: fullNameNew } : {}),
      ...(phoneNew ? { phone: phoneNew } : {}),
      ...(addressNew ? { address: addressNew, addressLine: addressNew } : {}),
      ...(notesNew ? { notes: notesNew, fullAddress: notesNew } : {})
    };

    try {
      // actualizar users/{uid}/orders/{orderKey}
      await update(ref(db, `users/${uid}/orders/${orderKey}`), { estado: newEstado, shipping: shippingObj });

      // (Si queda alguna copia legacy en /orders/{orderKey}, opcionalmente actualizamos/limpiamos)
      try {
        const legacySnap = await get(ref(db, `orders/${orderKey}`));
        if (legacySnap.exists()) {
          // opcional: actualizar la copia legacy también (o eliminar)
          await update(ref(db, `orders/${orderKey}`), { estado: newEstado, shipping: shippingObj });
        }
      } catch (e) {
        // no fatal
        console.warn("No se pudo actualizar/limpiar legacy /orders:", e);
      }

      overlay.style.display = "none";
      // re-render tabla (simple)
      generarDashboardPedidos();
      alert("Pedido actualizado correctamente.");
    } catch (err) {
      console.error("Error guardando cambios del pedido:", err);
      alert("No se pudo guardar el pedido. Revisa la consola para detalles.");
    }
  };

  cancelBtn.onclick = () => {
    overlay.style.display = "none";
  };
}

// -----------------------------------------------------------
// Cargar productos desde Sheets (sin cambios)
// -----------------------------------------------------------
async function loadProducts() {
  const tbody = document.getElementById("product-table-body");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center">Cargando...</td></tr>`;

  try {
    const res = await fetch(`${API_URL}?all=1&_=${Date.now()}`);
    const data = await res.json();

    allProducts = (data.products || []).map(p => ({
      row: p.row,
      sheetKey: p.data.Categoria,
      data: p.data,
    }));

    filteredProducts = [...allProducts];
    fillProductCategoryFilter();
    renderProductsTable();
  } catch (err) {
    console.error(err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:#f55;text-align:center;">Error cargando productos</td></tr>`;
  }
}

// -----------------------------------------------------------
// Filtros + Tabla de productos (sin cambios)
// -----------------------------------------------------------
function fillProductCategoryFilter() {
  const select = document.getElementById("product-category-filter");
  const cats = [...new Set(allProducts.map(p => p.sheetKey))];

  select.innerHTML = `<option value="">Todas</option>`;
  cats.forEach(c => select.innerHTML += `<option value="${c}">${c}</option>`);
}

function applyProductFilters() {
  const term = document.getElementById("product-search").value.toLowerCase();
  const cat = document.getElementById("product-category-filter").value;

  filteredProducts = allProducts.filter(p => {
    const name = (p.data.Nombre || "").toLowerCase();
    return name.includes(term) && (!cat || p.sheetKey === cat);
  });

  renderProductsTable();
}

function renderProductsTable() {
  const tbody = document.getElementById("product-table-body");
  if (!tbody) return;

  if (!filteredProducts.length)
    return tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#aaa">Sin resultados</td></tr>`;

  tbody.innerHTML = "";
  filteredProducts.forEach(p => {
    const d = p.data;
    tbody.innerHTML += `
      <tr>
        <td>${p.row}</td>
        <td>${p.sheetKey}</td>
        <td>${escapeHtml(d.Nombre)}</td>
        <td>$${fmtPrice(d.Precio)}</td>
        <td>${d.Stock}</td>
        <td>
          <button class="btn-ghost btn-small" data-edit="${p.sheetKey}::${p.row}">Editar</button>
          <button class="btn-small" style="background:#E53935;color:#fff" data-del="${p.sheetKey}::${p.row}">Eliminar</button>
        </td>
      </tr>`;
  });

  tbody.querySelectorAll("[data-edit]").forEach(b => {
    const [s, r] = b.dataset.edit.split("::");
    b.onclick = () => openEditProductModal(allProducts.find(p => p.row == r && p.sheetKey == s));
  });

  tbody.querySelectorAll("[data-del]").forEach(b => {
    const [s, r] = b.dataset.del.split("::");
    b.onclick = () => deleteProduct(allProducts.find(p => p.row == r && p.sheetKey == s));
  });
}

//-----------------------------------------------------------
// CREAR / EDITAR PRODUCTO (sin cambios)
//-----------------------------------------------------------
function openCreateProductModal() {
  document.getElementById("product-modal-title").textContent = "Nuevo producto";
  clearForm();
  showModal();
}

function openEditProductModal(prod) {
  const d = prod.data;
  document.getElementById("product-modal-title").textContent = "Editar producto";

  document.getElementById("product-row").value = prod.row;
  document.getElementById("product-sheetKey").value = prod.sheetKey;
  document.getElementById("product-name").value = d.Nombre;
  document.getElementById("product-price").value = d.Precio;
  document.getElementById("product-stock").value = d.Stock;
  document.getElementById("product-img").value = d.Img || "";
  document.getElementById("product-description").value = d.Descripcion || "";

  showModal();
}

function showModal() {
  document.getElementById("product-modal-overlay").style.display = "flex";
}
function closeProductModal() {
  document.getElementById("product-modal-overlay").style.display = "none";
}
function clearForm() {
  document.querySelector("#product-form").reset();
}

//-----------------------------------------------------------
// GUARDAR / ELIMINAR PRODUCTOS (sin cambios)
//-----------------------------------------------------------
async function onSubmitProductForm(e) {
  e.preventDefault();

  const row = document.getElementById("product-row").value.trim();
  const isUpdate = !!row;

  const payload = {
    action: isUpdate ? "update" : "add",
    row: isUpdate ? Number(row) : "",
    sheetKey: document.getElementById("product-sheetKey").value.trim(),
    name: document.getElementById("product-name").value.trim(),
    price: Number(document.getElementById("product-price").value.trim()),
    stock: Number(document.getElementById("product-stock").value.trim()),
    img: document.getElementById("product-img").value.trim(),
    description: document.getElementById("product-description").value.trim()
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const r = await res.json();

  if (r.ok) {
    alert("✔ Guardado correctamente");
    loadProducts();
    closeProductModal();
  } else {
    alert("❌ Error al guardar: " + JSON.stringify(r));
  }
}

async function deleteProduct(prod) {
  if (!confirm("¿Eliminar producto permanentemente?")) return;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", sheetKey: prod.sheetKey, row: Number(prod.row) })
  });

  const r = await res.json();
  if (r.ok) {
    alert("🗑 Producto eliminado");
    loadProducts();
  } else {
    alert("Error al borrar:\n" + JSON.stringify(r));
  }
}

//-----------------------------------------------------------
// FIN
//-----------------------------------------------------------







