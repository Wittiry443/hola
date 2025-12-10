import { auth, onAuthStateChanged, db } from "./firebase.js";
import { escapeHtml, fmtPrice } from "./utils.js";
import { ref, onValue, get, remove, update } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

// Elementos en admin.html
const tbody = document.getElementById("refunds-table-body");

// simple search/filter UI
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
      let ancestor = nestedTableWrapper;
      while (ancestor && ancestor.parentNode !== panel) {
        ancestor = ancestor.parentNode;
      }
      if (ancestor && ancestor.parentNode === panel) {
        panel.insertBefore(wrapper, ancestor);
      } else {
        panel.appendChild(wrapper);
      }
    } else {
      panel.appendChild(wrapper);
    }
  }

  // marca como añadido
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
let cancelsMap = {};
let refundsMap = {};  

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

/* ------------------ Detail modal ------------------ */
function ensureDetailModal() {
  if (document.getElementById("request-detail-modal")) return;

  // css minimal para modal
  const css = `
  .rr-overlay { position:fixed; inset:0;background:rgba(0,0,0,0.45);display:none;align-items:center;justify-content:center;z-index:1200 }
  .rr-overlay[aria-hidden="false"] { display:flex; }
  .rr-modal { background:var(--panel,#0b1220); color:var(--text,#e6eef8); width:min(820px,92%); border-radius:12px; box-shadow:0 12px 40px rgba(2,6,23,0.6); padding:18px; font-family:system-ui,-apple-system,Segoe UI,Roboto,"Helvetica Neue",Arial; }
  .rr-modal h3 { margin:0 0 10px 0; font-size:20px; }
  .rr-grid { display:grid; grid-template-columns: 1fr 240px; gap:12px; align-items:start; }
  .rr-left { min-width:0; }
  .rr-right { background:rgba(255,255,255,0.02); padding:10px; border-radius:8px; font-size:13px; color:#cbd5e1; }
  .rr-row { margin-bottom:8px; }
  .rr-label { display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; }
  .rr-value { font-size:14px; word-wrap:break-word; }
  .rr-note { white-space:pre-wrap; background:rgba(0,0,0,0.04); padding:8px; border-radius:6px; color:#e6eef8; }
  .rr-product { border:1px solid rgba(255,255,255,0.03); padding:8px; border-radius:6px; margin-bottom:8px; }
  .rr-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }
  .rr-btn { padding:8px 10px; border-radius:8px; cursor:pointer; font-weight:600; border:1px solid rgba(255,255,255,0.06); background:transparent; color:inherit; }
  .rr-btn.rr-close { background:transparent; }
  .rr-btn.rr-delete { background:#E53935; color:white; border:none; }
  .rr-btn.rr-proc { background:#16a34a; color:white; border:none; }
  .rr-meta { font-size:12px; color:#9aa6b6; }
  .badge-processed { display:inline-block; padding:4px 8px; border-radius:999px; font-size:12px; background:rgba(34,197,94,0.12); color:#22c55e; border:1px solid rgba(34,197,94,0.18); }
  `;

  const style = document.createElement("style");
  style.id = "rr-modal-styles";
  style.textContent = css;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "request-detail-modal";
  overlay.className = "rr-overlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="rr-modal" role="dialog" aria-modal="true" aria-labelledby="rr-title">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 id="rr-title">Solicitud</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="rr-btn rr-close" id="rr-close-btn">Cerrar ✕</button>
        </div>
      </div>
      <div class="rr-grid" style="margin-top:8px">
        <div class="rr-left">
          <div class="rr-row">
            <div class="rr-label">Tipo</div>
            <div class="rr-value" id="rr-type"></div>
          </div>
          <div class="rr-row">
            <div class="rr-label">ID (nodo)</div>
            <div class="rr-value" id="rr-id"></div>
          </div>
          <div class="rr-row">
            <div class="rr-label">Pedido</div>
            <div class="rr-value" id="rr-orderKey"></div>
          </div>
          <div class="rr-row">
            <div class="rr-label">Usuario (email)</div>
            <div class="rr-value" id="rr-userEmail"></div>
          </div>
          <div class="rr-row">
            <div class="rr-label">Nota</div>
            <div class="rr-note" id="rr-note">—</div>
          </div>

          <div class="rr-row" id="rr-products-wrap">
            <div class="rr-label">Producto(s)</div>
            <div id="rr-products-list"></div>
          </div>

        </div>

        <aside class="rr-right">
          <div class="rr-row">
            <div class="rr-label">Importe</div>
            <div class="rr-value" id="rr-amount">—</div>
          </div>
          <div class="rr-row">
            <div class="rr-label">Estado</div>
            <div class="rr-value" id="rr-status">—</div>
          </div>
          <div class="rr-row rr-meta" id="rr-meta-block">
            <div>Creado: <span id="rr-created">—</span></div>
            <div>refundOrigin: <span id="rr-refundOrigin">—</span></div>
            <div>refundRequested: <span id="rr-refundRequested">—</span></div>
          </div>
          <div class="rr-actions">
            <button class="rr-btn rr-proc" id="rr-proc-btn">Marcar como procesado</button>
            <button class="rr-btn rr-delete" id="rr-delete-btn">Eliminar</button>
          </div>
        </aside>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // eventos
  document.getElementById("rr-close-btn").addEventListener("click", ()=> {
    overlay.setAttribute("aria-hidden", "true");
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.setAttribute("aria-hidden", "true");
  });
}

async function markAsProcessed(type, id) {
  try {
    // write status processed
    await update(ref(db, `cancelproduct/${type}/${id}`), { status: 'processed' });
    return true;
  } catch (err) {
    console.error("markAsProcessed error", err);
    return false;
  }
}

function showDetailModal({ id, type, payload }) {
  ensureDetailModal();
  const overlay = document.getElementById("request-detail-modal");
  if (!overlay) return;

  const get = (k, def='—') => {
    try { const v = k(); return (v === undefined || v === null || v === '') ? def : v; } catch { return def; }
  };
  let status = get(()=> payload.status || '');
  if (type === 'refund') {
    status = status ? `Reembolso — ${status}` : 'Reembolso';
  } else {
    status = status || 'Cancelación';
  }

  // rellenar campos
  document.getElementById("rr-type").innerText = type === 'refund' ? 'Reembolso' : 'Cancelación';
  document.getElementById("rr-id").innerText = id;
  document.getElementById("rr-orderKey").innerText = get(()=> payload.orderKey || payload.order || payload.order_id, '—');
  document.getElementById("rr-userEmail").innerText = get(()=> (payload.user && payload.user.email) ? payload.user.email : (payload.userEmail), '—');
  document.getElementById("rr-note").innerText = get(()=> payload.note, '—');
  const amt = payload.amount || payload.price || (payload.product && payload.product.price);
  document.getElementById("rr-amount").innerText = amt ? ('$' + (Number(amt)||0).toLocaleString()) : '—';
  document.getElementById("rr-status").innerText = status;
  document.getElementById("rr-created").innerText = payload.createdAt ? (new Date(Number(payload.createdAt)).toLocaleString()) : '—';
  document.getElementById("rr-refundOrigin").innerText = String(payload.refundOrigin === true);
  document.getElementById("rr-refundRequested").innerText = String(payload.refundRequested === true);

  // productos:
  const productsList = document.getElementById("rr-products-list");
  productsList.innerHTML = '';
  if (payload.product) {
    if (Array.isArray(payload.product)) {
      payload.product.forEach(pr => {
        const el = document.createElement("div");
        el.className = "rr-product";
        el.innerHTML = `<div style="font-weight:700">${escapeHtml(String(pr.name || pr.key || '—'))}</div>
                        <div style="font-size:13px;color:#9aa6b6">${escapeHtml(String(pr.key || ''))} ${pr.qty ? '· x'+pr.qty : ''}</div>
                        <div style="margin-top:6px">${escapeHtml(String(pr.description || ''))}</div>`;
        productsList.appendChild(el);
      });
    } else if (typeof payload.product === 'object') {
      const pr = payload.product;
      const el = document.createElement("div");
      el.className = "rr-product";
      el.innerHTML = `<div style="font-weight:700">${escapeHtml(String(pr.name || pr.key || '—'))}</div>
                      <div style="font-size:13px;color:#9aa6b6">${escapeHtml(String(pr.key || ''))} ${pr.qty ? '· x'+pr.qty : ''}</div>
                      <div style="margin-top:6px">${escapeHtml(String(pr.description || ''))}</div>`;
      productsList.appendChild(el);
    } else {
      const el = document.createElement("div");
      el.className = "rr-product";
      el.textContent = String(payload.product);
      productsList.appendChild(el);
    }
  } else if (payload.productName) {
    const el = document.createElement("div");
    el.className = "rr-product";
    el.innerHTML = `<div style="font-weight:700">${escapeHtml(String(payload.productName))}</div>`;
    productsList.appendChild(el);
  } else {
    productsList.innerHTML = '<div class="rr-meta">No hay detalles del producto</div>';
  }

  // delete button dentro del modal
  const delBtn = document.getElementById("rr-delete-btn");
  delBtn.onclick = async () => {
    if (!confirm(`Eliminar solicitud ${type} ${id} de forma permanente?`)) return;
    try {
      await remove(ref(db, `cancelproduct/${type}/${id}`));
      overlay.setAttribute("aria-hidden", "true");
      alert("Solicitud eliminada.");
    } catch (err) {
      console.error("Error eliminando desde modal", err);
      alert("No se pudo eliminar. Revisa la consola.");
    }
  };

  const procBtn = document.getElementById("rr-proc-btn");
  procBtn.onclick = async () => {
    if (!confirm(`Marcar solicitud ${type} ${id} como procesada?`)) return;
    const ok = await markAsProcessed(type, id);
    if (ok) {
      overlay.setAttribute("aria-hidden", "true");
      alert("Solicitud marcada como procesada.");
    } else {
      alert("No se pudo marcar como procesada. Revisa la consola.");
    }
  };

  overlay.setAttribute("aria-hidden", "false");
}

/* ------------------ Renderizado principal ------------------ */
function renderMerged() {
  ensureFiltersUI();
  if (!tbody) return;
  const type = document.getElementById("req-type-filter")?.value || 'all';
  const q = document.getElementById("req-search-input")?.value || '';

  const rows = buildRows(type, q);
  if (!rows.length) return showEmpty("No hay solicitudes que cumplan ese filtro.");

  tbody.innerHTML = "";
  rows.forEach(r => {
    // status display:
    const rawStatus = r.raw && r.raw.status ? String(r.raw.status) : '';
    let statusDisplay = '';
    if (r.type === 'refund') {
      statusDisplay = rawStatus ? `Reembolso — ${rawStatus}` : 'Reembolso';
    } else {
      statusDisplay = rawStatus || 'Cancelación';
    }

    const processedBadge = rawStatus === 'processed' ? `<span class="badge-processed" style="margin-left:8px">Procesado</span>` : '';

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(String(r.orderKey || '—'))}</td>
      <td>${escapeHtml(String(r.userEmail || (r.raw && r.raw.user && r.raw.user.email) || '—'))}</td>
      <td style="max-width:340px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(String(r.product || r.raw?.product?.key || '—'))}</td>
      <td>${r.amount ? ('$' + (Number(r.amount)||0).toLocaleString()) : '—'}</td>
      <td>${escapeHtml(String(statusDisplay))}${processedBadge}</td>
      <td style="white-space:nowrap">
        <button class="btn-small btn-view" data-type="${r.type}" data-id="${escapeHtml(r.id)}">Ver</button>
        <button class="btn-small btn-delete" style="background:#E53935;color:#fff" data-type="${r.type}" data-id="${escapeHtml(r.id)}">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll(".btn-view").forEach(b => {
    b.onclick = (ev) => {
      ev.preventDefault();
      const id = b.dataset.id;
      const type = b.dataset.type;
      const payload = (type === 'cancel') ? cancelsMap[id] : refundsMap[id];
      showDetailModal({ id, type, payload });
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

/* ------------------ Inicialización ------------------ */
async function loadAll() {
  // verifica admin
  const ok = await isAdmin();
  if (!ok) {
    showEmpty("No eres admin o no tienes permisos para ver solicitudes.");
    return;
  }
  attachListeners();
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    showEmpty("No has iniciado sesión.");
    return;
  }
  loadAll();
});
export {};
