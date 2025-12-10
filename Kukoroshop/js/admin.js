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

async function isAdminUser(user) {
  if (!user) return false;
  try {
    // 1) revisar /admins/{uid}
    const snap = await get(ref(db, `admins/${user.uid}`));
    if (snap.exists() && snap.val() === true) return true;

    const uSnap = await get(ref(db, `users/${user.uid}/role`));
    if (uSnap.exists() && String(uSnap.val()) === "admin") return true;
  } catch (e) {
    console.warn("isAdminUser error:", e);
  }
  
  if (ADMIN_EMAILS && ADMIN_EMAILS.includes(user.email)) return true;

  return false;
}
onAuthStateChanged(auth, async (user) => {
  const label = document.getElementById("admin-user-label");
  if (!user) return (window.location.href = "index.html");
  try {
    if (typeof ensureUserRecord === "function") await ensureUserRecord(user);
  } catch (e) {
    console.warn("ensureUserRecord fail", e);
  }

  // comprobar si el usuario es administrador
  const isAdmin = await isAdminUser(user);
  if (!isAdmin) {
    alert("No tienes permisos de administrador.");
    return (window.location.href = "index.html");
  }

  if (label) label.textContent = user.email || "";
  initAdminUI();
});

// Inicializar UI
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
  generarDashboardPedidos();
}

// -----------------------------------------------------------
// 📦 DASHBOARD DE PEDIDOS (lee users/{uid}/orders)
// -----------------------------------------------------------
function generarDashboardPedidos() {
  const tbody = document.getElementById("orders-table-body");
  if (!tbody) return;

  const ventasDiaEl = document.getElementById("ventasDia");
  const ventasMesEl = document.getElementById("ventasMes");
  const pedidosEl   = document.getElementById("pedidosCount");

  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#999">Cargando pedidos desde Firebase...</td></tr>`;

  const today  = new Date();
  const year   = today.getFullYear();
  const month  = today.getMonth();
  const day    = today.getDate();

  const usersRef = ref(db, "users");

  // Escuchar todos los usuarios
  onValue(usersRef, (snapshot) => {
    const users = snapshot.val() || {};
    const flatOrders = {}; // key -> { order, uid }

    Object.entries(users).forEach(([uid, udata]) => {
      const uOrders = udata.orders || {};
      Object.entries(uOrders).forEach(([k, o]) => {
        // guardamos copia plana con uid para saber dónde actualizar/eliminar
        flatOrders[k] = { order: o, uid };
      });
    });

    // renderizar la tabla a partir de flatOrders
    const entries = Object.entries(flatOrders).sort((a, b) => {
      const ta = a[1].order?.createdAt || 0;
      const tb = b[1].order?.createdAt || 0;
      return tb - ta;
    });

    let totalDia = 0;
    let totalMes = 0;
    let totalPedidos = 0;

    tbody.innerHTML = "";

    if (!entries.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#aaa">No hay pedidos registrados todavía.</td></tr>`;
    } else {
      entries.forEach(([key, meta]) => {
        totalPedidos++;
        const order = meta.order || {};
        const uid = meta.uid;

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
        const cliente  = order.cliente || order.userEmail || "Sin cliente";
        const resumen  = order.resumen || "Sin resumen";
        const estadoClass = estadoLower.replace(/\s+/g, "-");

        const optionsHtml = ORDER_STATUSES.map(st => `\n          <option value="${st}" ${st === estadoLower ? "selected" : ""}>${st}</option>\n        `).join("");

        tbody.innerHTML += `\n<tr data-order-key="${escapeHtml(key)}" data-order-uid="${escapeHtml(uid)}">\n  <td>${escapeHtml(String(idPedido))}</td>\n  <td>${escapeHtml(String(cliente))}</td>\n  <td>${escapeHtml(String(resumen))}</td>\n  <td>$${Number(total || 0).toLocaleString()}</td>\n  <td><span class="estado ${estadoClass}">${escapeHtml(estado)}</span></td>\n  <td>\n    <div class="order-actions">\n      <select class="order-status-select" data-order-key="${key}" data-order-uid="${uid}">\n        ${optionsHtml}\n      </select>\n      <button class="order-edit-btn" data-order-key="${key}" data-order-uid="${uid}" title="Editar pedido">✎</button>\n      <button class="order-delete-btn" data-order-key="${key}" data-order-uid="${uid}" title="Eliminar pedido">🗑</button>\n    </div>\n  </td>\n</tr>\n`;
      });
    }

    if (ventasDiaEl) ventasDiaEl.textContent = totalDia.toLocaleString();
    if (ventasMesEl) ventasMesEl.textContent = totalMes.toLocaleString();
    if (pedidosEl)   pedidosEl.textContent   = totalPedidos;

    // Listeners para selects de estado
    tbody.querySelectorAll(".order-status-select").forEach(sel => {
      sel.onchange = async () => {
        const key = sel.dataset.orderKey;
        const uid = sel.dataset.orderUid;
        const newStatus = sel.value;
        try { await updateOrderStatus_forUser(key, uid, newStatus); }
        catch (e) { console.error("Error actualizando estado:", e); alert("No se pudo actualizar el estado. Revisa la consola."); }
      };
    });

    // Botones de editar
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

    // Botones de eliminar
    tbody.querySelectorAll(".order-delete-btn").forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.orderKey;
        const uid = btn.dataset.orderUid;
        if (!confirm("¿Eliminar este pedido de forma permanente?")) return;
        try { await deleteOrder_forUser(key, uid); }
        catch (e) { console.error("Error eliminando pedido:", e); alert("No se pudo eliminar el pedido. Revisa la consola."); }
      };
    });

  }, (error) => {
    console.error("Error leyendo users/*/orders:", error);
    tbody.innerHTML = `\n      <tr>\n        <td colspan="6" style="text-align:center;color:#f55">\n          Error cargando pedidos desde Firebase. ${error && error.message ? escapeHtml(error.message) : ""}\n        </td>\n      </tr>\n    `;
  });
}

// Actualizar estado en users/{uid}/orders/{orderKey}
async function updateOrderStatus_forUser(orderKey, uid, newStatus) {
  if (!uid) throw new Error("No UID provided for order");
  await update(ref(db, `users/${uid}/orders/${orderKey}`), { estado: newStatus });
  console.log(`[admin] users/${uid}/orders/${orderKey} estado -> ${newStatus}`);
}

// Eliminar en users/{uid}/orders/{orderKey}
async function deleteOrder_forUser(orderKey, uid) {
  if (!uid) throw new Error("No UID provided for order");
  await remove(ref(db, `users/${uid}/orders/${orderKey}`));
  console.log(`[admin] users/${uid}/orders/${orderKey} eliminado`);
}

// Modal de edición de pedido (esquema shipping)
function ensureOrderEditModalExists() {
  if (document.getElementById("order-edit-modal-overlay")) return;

  const sId = "order-edit-modal-styles";
  if (!document.getElementById(sId)) {
    const style = document.createElement("style");
    style.id = sId;
    style.innerHTML = `
/* Estilos modal de edición */
#order-edit-modal-overlay {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(2,6,23,0.7);
  z-index: 40000;
  padding: 20px;
}
#order-edit-modal {
  width: 100%;
  max-width: 760px;
  background: radial-gradient(circle at 20% 0%, rgba(37,99,235,0.03), transparent 55%), #020617;
  border: 1px solid rgba(148,163,184,0.04);
  color: #e5e7eb;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(2,6,23,0.9);
  padding: 18px;
  font-family: "Poppins", system-ui, -apple-system, "Segoe UI", sans-serif;
}
#order-edit-modal h3 { margin:0 0 8px 0; color:#e5e7eb; font-size:1.1rem; }
#order-edit-body { max-height:60vh; overflow:auto; color:#cbd5e1; font-size:14px; }
#order-edit-modal .form-row { display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px; }
#order-edit-modal label { display:block; font-weight:700; margin-bottom:6px; color:#cbd5e1; font-size:0.9rem; }
#order-edit-modal input, #order-edit-modal textarea, #order-edit-modal select {
  width:100%; padding:8px; border-radius:8px; border:1px solid rgba(31,41,55,0.8);
  background:#0f172a; color:#e5e7eb; font-size:0.95rem;
}
#order-edit-modal textarea[readonly], #order-edit-modal input[readonly] { opacity:0.9; background:#071025; }
#order-edit-modal .modal-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }
#order-edit-modal .btn-primary { background: linear-gradient(135deg,#4f46e5,#7c3aed); color:#fff; border:none; padding:8px 12px; border-radius:999px; cursor:pointer; font-weight:700; }
#order-edit-modal .btn-ghost { background:transparent; border:1px solid rgba(148,163,184,0.12); color:#e5e7eb; padding:8px 12px; border-radius:999px; cursor:pointer; }
@media (max-width:720px){ #order-edit-modal .form-row { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement("div");
  overlay.id = "order-edit-modal-overlay";
  overlay.innerHTML = `
    <div id="order-edit-modal" role="dialog" aria-modal="true" aria-labelledby="order-edit-title">
      <h3 id="order-edit-title">Editar pedido</h3>
      <div id="order-edit-body" tabindex="0"></div>
      <div class="modal-actions">
        <button id="order-edit-cancel" class="btn-ghost">Cancelar</button>
        <button id="order-edit-save" class="btn-primary">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.style.display = "none"; });

  overlay.querySelector("#order-edit-cancel").addEventListener("click", () => {
    overlay.style.display = "none";
  });
}

function openEditOrderModal(uid, orderKey, order) {
  ensureOrderEditModalExists();
  const overlay = document.getElementById("order-edit-modal-overlay");
  const body = document.getElementById("order-edit-body");
  if (!overlay || !body) return;

  // Normalizar shipping legacy/new
  const shippingRaw = order.shipping || order.direccion || order.delivery || {};
  const fullName =
    shippingRaw.fullName ||
    shippingRaw.name ||
    shippingRaw.cliente ||
    shippingRaw.contactName ||
    order.cliente || "";
  const phone =
    shippingRaw.phone ||
    shippingRaw.telefono ||
    shippingRaw.contactPhone ||
    shippingRaw.mobile || "";
  const address =
    shippingRaw.address ||
    shippingRaw.addressLine ||
    shippingRaw.calle ||
    shippingRaw.fullAddress ||
    shippingRaw.direccion || "";
  const notes =
    shippingRaw.notes || shippingRaw.notas || shippingRaw.info || "";

  const optionsHtml = ORDER_STATUSES.map(st => `<option value="${st}" ${st === (order.estado || "pendiente") ? "selected" : ""}>${st}</option>`).join("");

  // Contenido del modal
  body.innerHTML = `
    <div class="form-row">
      <div>
        <label>ID Pedido</label>
        <input readonly value="${escapeHtml(order.idPedido || orderKey)}" />
      </div>
      <div>
        <label>Cliente</label>
        <input readonly value="${escapeHtml(order.cliente || order.userEmail || "")}" />
      </div>
    </div>

    <div style="margin-top:8px">
      <label>Resumen</label>
      <textarea id="order-edit-resumen" rows="3" readonly style="resize:vertical">${escapeHtml(order.resumen || "")}</textarea>
    </div>

    <div class="form-row" style="margin-top:10px">
      <div>
        <label>Estado</label>
        <select id="order-edit-estado">${optionsHtml}</select>
      </div>
      <div>
        <label>Total</label>
        <input readonly value="$${Number(order.total || 0).toLocaleString()}" />
      </div>
    </div>

    <div style="margin-top:10px">
      <h4 style="margin:8px 0 6px 0;color:#e5e7eb;font-size:0.95rem">Dirección de envío (editable)</h4>
      <div style="display:grid;grid-template-columns:1fr;gap:8px">
        <div>
          <label>Nombre completo</label>
          <input id="order-edit-fullName" value="${escapeHtml(fullName)}" />
        </div>
        <div>
          <label>Teléfono</label>
          <input id="order-edit-phone" value="${escapeHtml(phone)}" />
        </div>
        <div>
          <label>Dirección</label>
          <input id="order-edit-address" value="${escapeHtml(address)}" />
        </div>
        <div>
          <label>Notas / indicaciones</label>
          <textarea id="order-edit-notes" rows="3" style="resize:vertical">${escapeHtml(notes)}</textarea>
        </div>
      </div>
    </div>
  `;

  // mostrar modal
  overlay.style.display = "flex";
  body.focus();

  // Asignar handler de guardar (remueve handler previo para evitar duplicados)
  const saveBtn = document.getElementById("order-edit-save");
  const newSave = async () => {
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
      // intentar actualizar copia en /orders/{orderKey} si existe (no fatal)
      try {
        const legacySnap = await get(ref(db, `orders/${orderKey}`));
        if (legacySnap.exists()) {
          await update(ref(db, `orders/${orderKey}`), { estado: newEstado, shipping: shippingObj });
        }
      } catch (e) { /* no fatal */ }

      overlay.style.display = "none";
      generarDashboardPedidos();
      alert("Pedido actualizado correctamente.");
    } catch (err) {
      console.error("Error guardando cambios del pedido:", err);
      alert("No se pudo guardar el pedido. Revisa la consola para más detalles.");
    }
  };

  // evitar múltiples asignaciones: reemplazar y reasignar
  saveBtn.replaceWith(saveBtn.cloneNode(true));
  const freshSaveBtn = document.getElementById("order-edit-save");
  freshSaveBtn.addEventListener("click", newSave);
}

// Cargar productos desde Sheets
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

// Filtros + Tabla de productos
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

// CREAR / EDITAR PRODUCTO
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

// GUARDAR / ELIMINAR PRODUCTOS
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

// FIN
// -----------------------------------------------------------
