//-----------------------------------------------------------
//  WyvernStore Admin Panel + DASHBOARD de ventas y domicilios
//-----------------------------------------------------------

import { auth, onAuthStateChanged } from "./firebase.js";
import { ADMIN_EMAILS } from "./auth.js";
import { API_URL } from "./config.js";
import { fmtPrice, firstKeyValue, escapeHtml } from "./utils.js";

//-----------------------------------------------------------
// Estado interno
//-----------------------------------------------------------
let allProducts = [];
let filteredProducts = [];
let sampleOrders = [];


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
  generarDashboard();      // 🟢 Se genera el dashboard al entrar
}



//-----------------------------------------------------------
// 📦 DASHBOARD DE VENTAS & DOMICILIOS (Simulación visual realista)
//-----------------------------------------------------------
function generarDashboard() {
  const clientes=["Juan","Ana","Carlos","Laura","Pedro","Sofía","Valentina","Esteban","Miguel","Camila"];
  const ciudades=["Bogotá","Medellín","Cali","Cartagena","Barranquilla","Bucaramanga","Manizales","Armenia"];
  const estados=["en-proceso","pagado","entregado"];

  const tbody=document.querySelector("#tablaDomicilios tbody");

  let totalDia=0,totalMes=0,totalPedidos=16;

  for(let i=1;i<=totalPedidos;i++){
    let valor=Math.floor(Math.random()*85000)+18000;
    totalDia += i>10 ? valor : 0;
    totalMes += valor;

    const cliente = clientes[Math.floor(Math.random()*clientes.length)];
    const estado = estados[Math.floor(Math.random()*3)];
    const ciudad = ciudades[Math.floor(Math.random()*ciudades.length)];

    tbody.innerHTML += `
      <tr>
        <td>#W${1000+i}</td>
        <td>${cliente}</td>
        <td>${ciudad}</td>
        <td>$${valor.toLocaleString()}</td>
        <td><span class="estado ${estado}">${estado.replace("-"," ")}</span></td>
      </tr>
    `;
  }

  document.getElementById("ventasDia").innerText = totalDia.toLocaleString();
  document.getElementById("ventasMes").innerText = totalMes.toLocaleString();
  document.getElementById("pedidosCount").innerText = totalPedidos;
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
    const name = p.data.Nombre.toLowerCase();
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
