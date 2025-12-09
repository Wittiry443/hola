// js/admin.js (versión mejorada)
// importaciones
import { auth, onAuthStateChanged, db } from "./firebase.js";
import { ADMIN_EMAILS } from "./auth.js";
import { API_URL } from "./config.js";
import { fmtPrice, escapeHtml } from "./utils.js";
import {
  ref,
  onValue,
  update,
  remove,
  get
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import { getIdTokenResult } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

// Estados disponibles para el select
const ORDER_STATUSES = ["pendiente","en proceso","enviado","entregado","cancelado"];

// Estado interno
let allProducts = [];
let filteredProducts = [];

// --- Helper: comprobar admin (claims -> /admins -> ADMIN_EMAILS)
async function isAdminUser(user) {
  if (!user) return false;

  // 1) revisar custom claims
  try {
    const token = await getIdTokenResult(user);
    if (token?.claims?.admin === true) return true;
  } catch (e) {
    console.warn("No se pudo leer claims:", e);
  }

  // 2) revisar /admins/{uid} en la Realtime DB (si lo usas)
  try {
    const snap = await get(ref(db, `admins/${user.uid}`));
    if (snap.exists() && snap.val() === true) return true;
  } catch (e) {
    console.warn("No se pudo leer /admins node:", e);
  }

  // 3) fallback UX: lista local (no segura para reglas, solo UI)
  if (ADMIN_EMAILS && ADMIN_EMAILS.includes(user.email)) return true;

  return false;
}

// Seguridad: acceso solo para admins
onAuthStateChanged(auth, async (user) => {
  const label = document.getElementById("admin-user-label");

  if (!user) return (window.location.href = "index.html");

  // comprobar admin
  const isAdmin = await isAdminUser(user);
  if (!isAdmin) {
    // si no es admin, avisar y redirigir
    alert("No tienes permisos de administrador.");
    return (window.location.href = "index.html");
  }

  // ok: mostrar email y arrancar UI
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
  generarDashboardPedidos(); // lee /orders y arma la tabla de pedidos
}

// DASHBOARD DE PEDIDOS (Firebase Realtime Database)
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

  const ordersRef = ref(db, "orders");

  onValue(ordersRef, (snapshot) => {
    const data = snapshot.val() || {};
    const entries = Object.entries(data);

    let totalDia = 0;
    let totalMes = 0;
    let totalPedidos = 0;

    tbody.innerHTML = "";

    if (!entries.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#aaa">No hay pedidos registrados todavía.</td></tr>`;
    } else {
      entries.forEach(([key, order]) => {
        totalPedidos++;

        const total = Number(order.total || 0);

        // Fecha
        let created = null;
        try { if (order.createdAt) created = new Date(order.createdAt); } catch (e) { created = null; }

        const estado   = (order.estado || "pendiente").toString();
        const estadoLower = estado.toLowerCase();

        // Contar ventas
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

        const optionsHtml = ORDER_STATUSES.map(st => `
          <option value="${st}" ${st === estadoLower ? "selected" : ""}>
            ${st}
          </option>
        `).join("");

        tbody.innerHTML += `
  <tr>
    <td>${escapeHtml(String(idPedido))}</td>
    <td>${escapeHtml(String(cliente))}</td>
    <td>${escapeHtml(String(resumen))}</td>
    <td>$${Number(total || 0).toLocaleString()}</td>
    <td><span class="estado ${estadoClass}">${escapeHtml(estado)}</span></td>
    <td>
      <div class="order-actions">
        <select class="order-status-select" data-order-key="${key}">
          ${optionsHtml}
        </select>
        <button class="order-delete-btn" data-order-key="${key}" title="Eliminar pedido">🗑</button>
      </div>
    </td>
  </tr>
`;
      });
    }

    if (ventasDiaEl) ventasDiaEl.textContent = totalDia.toLocaleString();
    if (ventasMesEl) ventasMesEl.textContent = totalMes.toLocaleString();
    if (pedidosEl)   pedidosEl.textContent   = totalPedidos;

    // Listeners para selects de estado
    tbody.querySelectorAll(".order-status-select").forEach(sel => {
      sel.onchange = async () => {
        const key = sel.dataset.orderKey;
        const newStatus = sel.value;
        try { await updateOrderStatus(key, newStatus); }
        catch (e) { console.error("Error actualizando estado:", e); alert("No se pudo actualizar el estado. Revisa la consola."); }
      };
    });

    // Listeners para eliminar
    tbody.querySelectorAll(".order-delete-btn").forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.orderKey;
        if (!confirm("¿Eliminar este pedido de forma permanente?")) return;
        try { await deleteOrder(key); }
        catch (e) { console.error("Error eliminando pedido:", e); alert("No se pudo eliminar el pedido. Revisa la consola."); }
      };
    });
  }, (error) => {
    console.error("Error leyendo orders:", error);

    // Si es permission_denied, mostrar mensaje claro con uid para debug
    if (error && error.code && error.code === "permission_denied") {
      const currentUser = auth.currentUser;
      const uid = currentUser ? currentUser.uid : "no-uid";
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;color:#f55">
            Error: permission_denied al leer /orders. UID actual: ${escapeHtml(String(uid))}. Revisa las reglas de Realtime DB o asigna admin claim/admins node.
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

// Actualizar estado en Firebase
async function updateOrderStatus(orderKey, newStatus) {
  const orderRef = ref(db, `orders/${orderKey}`);
  await update(orderRef, { estado: newStatus });
}

// Eliminar pedido en Firebase
async function deleteOrder(orderKey) {
  const orderRef = ref(db, `orders/${orderKey}`);
  await remove(orderRef);
}

//-----------------------------------------------------------
// Cargar productos desde Sheets
//-----------------------------------------------------------
async function loadProducts() {
  const tbody = document.getElementById("product-table-body");
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
    tbody.innerHTML = `<tr><td colspan="6" style="color:#f55;text-align:center;">Error cargando productos</td></tr>`;
  }
}

//-----------------------------------------------------------
// Filtros + Tabla de productos
//-----------------------------------------------------------
function fillProductCategoryFilter() {
  const select = document.getElementById("product-category-filter");
  const cats = [...new Set(allProducts.map(p => p.sheetKey))];

  select.innerHTML = `<option value="">Todas</option>`;
  cats.forEach(c => select.innerHTML += `<option value="${c}">${c}</option>`);
}

function applyProductFilters() {
  const term = document.getElementById("product-search").value.toLowerCase();
  const cat  = document.getElementById("product-category-filter").value;

  filteredProducts = allProducts.filter(p => {
    const name = (p.data.Nombre || "").toLowerCase();
    return name.includes(term) && (!cat || p.sheetKey === cat);
  });

  renderProductsTable();
}

function renderProductsTable() {
  const tbody = document.getElementById("product-table-body");

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
// CREAR / EDITAR PRODUCTO
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
// GUARDAR en Sheets (ADD / UPDATE)
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

//-----------------------------------------------------------
// ELIMINAR PRODUCTO
//-----------------------------------------------------------
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

