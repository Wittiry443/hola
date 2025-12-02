//-----------------------------------------------------------
//  WyvernStore Admin Panel + DASHBOARD de ventas y domicilios
//-----------------------------------------------------------

import { auth, onAuthStateChanged, db } from "./firebase.js";
import { ADMIN_EMAILS } from "./auth.js";
import { API_URL } from "./config.js";
import { fmtPrice, firstKeyValue, escapeHtml } from "./utils.js";
import {
  ref,
  onValue
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

//-----------------------------------------------------------
// Estado interno
//-----------------------------------------------------------
let allProducts = [];
let filteredProducts = [];
let sampleOrders = []; // ya no lo usamos, pero lo dejo por si luego simulan algo


//-----------------------------------------------------------
// Seguridad: acceso solo para admins
//-----------------------------------------------------------
onAuthStateChanged(auth, (user) => {
  const label = document.getElementById("admin-user-label");

  if (!user) return (window.location.href = "index.html");
  if (!ADMIN_EMAILS.includes(user.email)) {
    alert("No tienes permisos de administrador.");
    return (window.location.href = "index.html");
  }

  label.textContent = user.email;
  initAdminUI();
});


//-----------------------------------------------------------
// UI Inicial
//-----------------------------------------------------------
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
  generarDashboard();      // 🟢 Ahora genera el dashboard desde Firebase
}



//-----------------------------------------------------------
// 📦 DASHBOARD DE VENTAS & DOMICILIOS (Datos reales de Firebase)
//-----------------------------------------------------------
function generarDashboard() {
  const tbody = document.querySelector("#tablaDomicilios tbody");
  if (!tbody) return;

  // Mensaje inicial
  tbody.innerHTML = `
    <tr>
      <td colspan="5" style="text-align:center;color:#999">
        Cargando pedidos desde Firebase...
      </td>
    </tr>
  `;

  const ventasDiaEl  = document.getElementById("ventasDia");
  const ventasMesEl  = document.getElementById("ventasMes");
  const pedidosEl    = document.getElementById("pedidosCount");

  const today   = new Date();
  const yToday  = today.getFullYear();
  const mToday  = today.getMonth();
  const dToday  = today.getDate();

  const ordersRef = ref(db, "orders");

  // Escucha en tiempo real los cambios en /orders
  onValue(ordersRef, (snapshot) => {
    const data = snapshot.val() || {};
    const entries = Object.entries(data);

    tbody.innerHTML = "";
    let totalDia = 0;
    let totalMes = 0;
    let totalPedidos = 0;

    if (!entries.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center;color:#aaa">
            No hay pedidos registrados todavía.
          </td>
        </tr>
      `;
    } else {
      entries.forEach(([key, order]) => {
        totalPedidos++;

        const total = Number(order.total || 0);

        let created = null;
        try {
          if (order.createdAt) created = new Date(order.createdAt);
        } catch (e) {
          created = null;
        }

        if (created && !isNaN(created.getTime())) {
          const y = created.getFullYear();
          const m = created.getMonth();
          const d = created.getDate();

          if (y === yToday && m === mToday) {
            totalMes += total;
            if (d === dToday) totalDia += total;
          }
        } else {
          // Si no hay fecha válida, lo contamos en el mes actual por simplicidad
          totalMes += total;
        }

        const estadoRaw   = (order.estado || "pendiente").toString();
        const estadoClass = estadoRaw.replace(/\s+/g, "-").toLowerCase();
        const estadoLabel = estadoRaw;

        const idPedido = order.idPedido || key;
        const cliente  = order.cliente || "Sin cliente";
        const resumen  = order.resumen || "Sin resumen";

        tbody.innerHTML += `
          <tr>
            <td>${escapeHtml(String(idPedido))}</td>
            <td>${escapeHtml(String(cliente))}</td>
            <td>${escapeHtml(String(resumen))}</td>
            <td>$${Number(total || 0).toLocaleString()}</td>
            <td><span class="estado ${estadoClass}">${escapeHtml(estadoLabel)}</span></td>
          </tr>
        `;
      });
    }

    if (ventasDiaEl) ventasDiaEl.innerText = totalDia.toLocaleString();
    if (ventasMesEl) ventasMesEl.innerText = totalMes.toLocaleString();
    if (pedidosEl)   pedidosEl.innerText   = totalPedidos;
  }, (error) => {
    console.error("Error leyendo orders:", error);
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;color:#f55">
          Error cargando pedidos desde Firebase.
        </td>
      </tr>
    `;
  });
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
    return name.includes(term) && (!cat || p.sheetKey===cat);
  });

  renderProductsTable();
}

function renderProductsTable() {
  const tbody = document.getElementById("product-table-body");

  if (!filteredProducts.length)
    return tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#aaa">Sin resultados</td></tr>`;

  tbody.innerHTML = "";
  filteredProducts.forEach(p=>{
    const d=p.data;
    tbody.innerHTML+=`
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
      </tr>`
  });

  tbody.querySelectorAll("[data-edit]").forEach(b=>{
    const[s,r]=b.dataset.edit.split("::");
    b.onclick=()=>openEditProductModal(allProducts.find(p=>p.row==r && p.sheetKey==s));
  });

  tbody.querySelectorAll("[data-del]").forEach(b=>{
    const[s,r]=b.dataset.del.split("::");
    b.onclick=()=>deleteProduct(allProducts.find(p=>p.row==r && p.sheetKey==s));
  });
}



//-----------------------------------------------------------
// CREAR / EDITAR PRODUCTO
//-----------------------------------------------------------
function openCreateProductModal(){
  document.getElementById("product-modal-title").textContent="Nuevo producto";
  clearForm();
  showModal();
}

function openEditProductModal(prod){
  const d=prod.data;
  document.getElementById("product-modal-title").textContent="Editar producto";

  document.getElementById("product-row").value=prod.row;
  document.getElementById("product-sheetKey").value=prod.sheetKey;
  document.getElementById("product-name").value=d.Nombre;
  document.getElementById("product-price").value=d.Precio;
  document.getElementById("product-stock").value=d.Stock;
  document.getElementById("product-img").value=d.Img||"";
  document.getElementById("product-description").value=d.Descripcion||"";

  showModal();
}

function showModal(){document.getElementById("product-modal-overlay").style.display="flex";}
function closeProductModal(){document.getElementById("product-modal-overlay").style.display="none";}
function clearForm(){document.querySelector("#product-form").reset();}



//-----------------------------------------------------------
// GUARDAR en Sheets (ADD / UPDATE)
//-----------------------------------------------------------
async function onSubmitProductForm(e){
  e.preventDefault();

  const row=document.getElementById("product-row").value.trim();
  const isUpdate=!!row;

  const payload={
    action:isUpdate?"update":"add",
    row:isUpdate?Number(row):"",
    sheetKey:document.getElementById("product-sheetKey").value.trim(),
    name:document.getElementById("product-name").value.trim(),
    price:Number(document.getElementById("product-price").value.trim()),
    stock:Number(document.getElementById("product-stock").value.trim()),
    img:document.getElementById("product-img").value.trim(),
    description:document.getElementById("product-description").value.trim()
  };

  const res = await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const r=await res.json();

  if(r.ok){ alert("✔ Guardado correctamente"); loadProducts(); closeProductModal(); }
  else alert("❌ Error al guardar: "+JSON.stringify(r));
}



//-----------------------------------------------------------
// ELIMINAR
//-----------------------------------------------------------
async function deleteProduct(prod){
  if(!confirm("¿Eliminar producto permanentemente?")) return;

  const res = await fetch(API_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"delete",sheetKey:prod.sheetKey,row:Number(prod.row)})
  });

  const r=await res.json();
  if(r.ok){alert("🗑 Producto eliminado");loadProducts();}
  else alert("Error al borrar:\n"+JSON.stringify(r));
}



//-----------------------------------------------------------
// FIN
//-----------------------------------------------------------
