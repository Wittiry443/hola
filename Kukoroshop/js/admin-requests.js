// js/admin-requests.js
import { auth, onAuthStateChanged, db } from "./firebase.js";
import { escapeHtml, fmtPrice } from "./utils.js";
import { ref, onValue, get, remove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

// Elementos en admin.html
const tbody = document.getElementById("refunds-table-body");

// simple search/filter UI (creamos y colocamos encima de la tabla)
function ensureFiltersUI() {
  const panel = document.querySelector("#tab-refunds .admin-card-body");
  if (!panel) return;
  if (panel._filtersAdded) return;

  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.gap = "8px";
  wrapper.style.margin = "8px 0 12px 0";
  wrapper.innerHTML = `
    <select id="req-type-filter" class="select-small">
      <option value="all">Todos</option>
      <option value="cancel">Cancelaciones</option>
      <option value="refund">Reembolsos</option>
    </select>
    <input id="req-search-input" class="search-bar small" placeholder="Buscar por ID pedido / cliente / producto..." />
    <button id="req-refresh-btn" class="btn-small" style="margin-left:auto">Refrescar</button>
  `;

  // Intentamos insertar antes de un .table-wrapper que sea hijo directo de panel
  let directTableWrapper = panel.querySelector(":scope > .table-wrapper");

  if (directTableWrapper) {
    // caso ideal: la .table-wrapper es hijo directo -> insertar antes
    panel.insertBefore(wrapper, directTableWrapper);
  } else {
    // la .table-wrapper puede estar anidada; buscamos la primera .table-wrapper en el subtree
    const nestedTableWrapper = panel.querySelector(".table-wrapper");

    if (nestedTableWrapper) {
      // buscamos el ancestro inmediato de esa tabla que sea hijo directo de panel
      let ancestor = nestedTableWrapper;
      while (ancestor && ancestor.parentNode !== panel) {
        ancestor = ancestor.parentNode;
      }
      if (ancestor && ancestor.parentNode === panel) {
        panel.insertBefore(wrapper, ancestor);
      } else {
        // fallback: si no encontramos un ancestro que sea hijo directo, añadimos al final
        panel.appendChild(wrapper);
      }
    } else {
      // si no hay ninguna .table-wrapper dentro del panel -> simplemente append
      panel.appendChild(wrapper);
    }
  }

  // marca como añadido (solo después de insertar correctamente)
  panel._filtersAdded = true;

  // listeners del UI de filtros
  document.getElementById("req-type-filter").addEventListener("change", renderMerged);
  document.getElementById("req-search-input").addEventListener("input", debounce(renderMerged, 220));
  document.getElementById("req-refresh-btn").addEventListener("click", () => { loadAll(); });
}

// debounce helper
function debounce(fn, wait=200){
  let t;
  return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), wait); };
}

// local caches
let cancelsMap = {}; // id -> payload
let refundsMap = {};  // id -> payload

// ensure auth is admin
async function isAdmin() {
  try {
    const u = auth.currentUser;
    if (!u) return false;
    const snap = await get(ref(db, `admins/${u.uid}`));
    return snap.exists() && snap.val() === true;
  } catch(e){ console.warn("isAdmin err", e); return false; }
}

// load listeners
let cancelsUnsub = null;
let refundsUnsub = null;
function attachListeners() {
  // listen cancels
  const cancRef = ref(db, "cancelproduct/cancel");
  try {
    cancelsUnsub = onValue(cancRef, (snap) => {
      const val = snap.val() || {};
      cancelsMap = val;
      renderMerged();
    }, (err) => {
      console.error("Error leyendo cancelproduct/cancel", err);
      showEmpty(`Error cargando cancelaciones: ${err && err.message ? escapeHtml(err.message) : 'ver consola'}`);
    });
  } catch (e) {
    console.error("attachListeners cancels error", e);
  }

  // listen refunds
  const refRef = ref(db, "cancelproduct/refund");
  try {
    refundsUnsub = onValue(refRef, (snap) => {
      const val = snap.val() || {};
      refundsMap = val;
      renderMerged();
    }, (err) => {
      console.error("Error leyendo cancelproduct/refund", err);
      showEmpty(`Error cargando reembolsos: ${err && err.message ? escapeHtml(err.message) : 'ver consola'}`);
    });
  } catch (e) {
    console.error("attachListeners refunds error", e);
  }
}

function showEmpty(msg = "No hay solicitudes.") {
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#999;padding:18px">${escapeHtml(msg)}</td></tr>`;
}

// build rows from maps
function buildRows(filterType='all', q='') {
  const rows = [];
  const ql = String(q || '').trim().toLowerCase();

  function pushFromMap(map, type) {
    for (const id in map) {
      try {
        const p = map[id] || {};
        // derive common fields
        const orderKey = p.orderKey || p.order || p.order_id || "";
        const userEmail = (p.user && p.user.email) ? p.user.email : (p.userEmail || "");
        const product = (p.product && (p.product.name || p.product.key)) ? (p.product.name || p.product.key) : (p.productName || "");
        const amount = p.amount || p.price || (p.product && p.product.price) || "";
        const status = p.status || (type === "refund" ? (p.refundRequested ? 'requested' : '') : '') || (p.state || "");
        const created = p.createdAt ? (new Date(Number(p.createdAt)).toLocaleString()) : "";
        // quick search filter
        const hay = [id, orderKey, userEmail, product].map(s=>String(s||'').toLowerCase()).join('|');
        if (ql && !hay.includes(ql)) continue;
        rows.push({ id, type, orderKey, userEmail, product, amount, status, created, raw: p });
      } catch (e) { console.warn("buildRows item skip", e); continue; }
    }
  }

  if (filterType === 'all' || filterType === 'cancel') pushFromMap(cancelsMap, 'cancel');
  if (filterType === 'all' || filterType === 'refund') pushFromMap(refundsMap, 'refund');

  // sort by created desc (if available)
  rows.sort((a,b)=> {
    const ta = a.raw && a.raw.createdAt ? Number(a.raw.createdAt) : 0;
    const tb = b.raw && b.raw.createdAt ? Number(b.raw.createdAt) : 0;
    return tb - ta;
  });

  return rows;
}

function renderMerged() {
  ensureFiltersUI();
  if (!tbody) return;
  const type = document.getElementById("req-type-filter")?.value || 'all';
  const q = document.getElementById("req-search-input")?.value || '';

  const rows = buildRows(type, q);
  if (!rows.length) return showEmpty("No hay solicitudes que cumplan ese filtro.");

  tbody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(String(r.orderKey || '—'))}</td>
      <td>${escapeHtml(String(r.userEmail || (r.raw && r.raw.user && r.raw.user.email) || '—'))}</td>
      <td style="max-width:340px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(String(r.product || r.raw?.product?.key || '—'))}</td>
      <td>${r.amount ? ('$' + (Number(r.amount)||0).toLocaleString()) : '—'}</td>
      <td>${escapeHtml(String(r.status || (r.type==='refund'?'reembolso':'cancelación')))}</td>
      <td style="white-space:nowrap">
        <button class="btn-small btn-view" data-type="${r.type}" data-id="${escapeHtml(r.id)}">Ver</button>
        <button class="btn-small btn-delete" style="background:#E53935;color:#fff" data-type="${r.type}" data-id="${escapeHtml(r.id)}">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // attach click handlers (delegación pequeña)
  tbody.querySelectorAll(".btn-view").forEach(b => {
    b.onclick = (ev) => {
      ev.preventDefault();
      const id = b.dataset.id;
      const type = b.dataset.type;
      const payload = (type === 'cancel') ? cancelsMap[id] : refundsMap[id];
      // abrir modal simple con JSON (puedes mejorar UI)
      alert(`Tipo: ${type}\nID: ${id}\n\n` + JSON.stringify(payload, null, 2));
    };
  });

  tbody.querySelectorAll(".btn-delete").forEach(b => {
    b.onclick = async (ev) => {
      ev.preventDefault();
      const id = b.dataset.id;
      const type = b.dataset.type;
      if (!confirm(`Eliminar solicitud ${type} ${id} de forma permanente?`)) return;
      try {
        await remove(ref(db, `cancelproduct/${type}/${id}`));
        alert("Solicitud eliminada.");
      } catch (err) {
        console.error("Error eliminando", err);
        alert("No se pudo eliminar. Revisa la consola.");
      }
    };
  });
}

// initial load (after auth)
async function loadAll() {
  // sanity: verify admin
  const ok = await isAdmin();
  if (!ok) {
    showEmpty("No eres admin o no tienes permisos para ver solicitudes.");
    return;
  }
  // ensure listeners active
  attachListeners();
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    showEmpty("No has iniciado sesión.");
    return;
  }
  loadAll();
});

// export nothing
export {};
