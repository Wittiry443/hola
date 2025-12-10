// js/admin-requests.js
// Muestra y administra (admin) solicitudes de cancelación y reembolso.
// Requiere ./firebase.js que exporte `auth` y `db`.

import { auth, onAuthStateChanged, db } from "./firebase.js";
import {
  ref as dbRef,
  onValue,
  get,
  remove
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

// CONFIG
const ROOT_NODE = "cancelproduct";
const CANCEL_NODE = `${ROOT_NODE}/cancel`;
const REFUND_NODE = `${ROOT_NODE}/refund`;

// Inyecta UI si no existe un contenedor con id 'cancel-requests-root'
(function injectUI() {
  if (document.getElementById("cancel-requests-root")) return;

  const wrapper = document.createElement("div");
  wrapper.id = "cancel-requests-root";
  wrapper.innerHTML = `
    <style id="admin-requests-styles">
      /* simple styles, adaptables al tema oscuro */
      #requests-panel { background:#020617;border:1px solid rgba(148,163,184,0.04);border-radius:10px;padding:12px;color:#e5e7eb;font-family:system-ui,Segoe UI,Roboto; }
      #requests-panel header { display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:12px; }
      #requests-panel .controls { display:flex;gap:8px;align-items:center; }
      #requests-filter { padding:8px;border-radius:8px;background:rgba(15,23,42,0.6);border:1px solid rgba(148,163,184,0.04);color:#e5e7eb }
      #requests-search { padding:8px;border-radius:8px;background:rgba(15,23,42,0.6);border:1px solid rgba(148,163,184,0.04);color:#e5e7eb;min-width:220px }
      #requests-table { width:100%; border-collapse:collapse; margin-top:8px; font-size:13px; }
      #requests-table th { text-align:left;padding:8px;color:#9ca3af;border-bottom:1px solid rgba(148,163,184,0.03) }
      #requests-table td { padding:8px;border-bottom:1px solid rgba(148,163,184,0.02); vertical-align:top; color:#e9e9eb }
      .small-muted { color:#9ca3af;font-size:12px }
      .btn { padding:6px 8px;border-radius:8px;border:none;cursor:pointer;font-weight:600 }
      .btn-delete { background:#ef4444;color:#111 }
      .btn-refresh { background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff }
      .evidence-img { max-width:120px;max-height:80px;border-radius:6px;border:1px solid rgba(148,163,184,0.03) }
      .no-access { padding:18px;color:#f97373 }
      @media(max-width:900px){ #requests-panel header { flex-direction:column;align-items:stretch;gap:10px } #requests-search{min-width:120px} }
    </style>

    <div id="requests-panel">
      <header>
        <div style="display:flex;align-items:center;gap:12px;">
          <strong>Solicitudes (cancelaciones / reembolsos)</strong>
          <div class="small-muted">Admin dashboard</div>
        </div>
        <div class="controls">
          <select id="requests-filter" title="Filtrar por tipo">
            <option value="all">Todas</option>
            <option value="cancel">Cancelaciones</option>
            <option value="refund">Reembolsos</option>
          </select>
          <input id="requests-search" placeholder="Buscar por orderKey / productKey / usuario / producto" />
          <button id="requests-refresh" class="btn btn-refresh">Actualizar</button>
        </div>
      </header>

      <div id="requests-body">
        <div id="requests-loading" class="small-muted">Esperando autenticar...</div>
        <div id="requests-table-wrap" style="display:none;overflow:auto;">
          <table id="requests-table" role="table" aria-label="Solicitudes">
            <thead>
              <tr>
                <th>ID</th>
                <th>Tipo</th>
                <th>Order</th>
                <th>Producto</th>
                <th>Usuario</th>
                <th>Cantidad</th>
                <th>Nota</th>
                <th>Evidencia</th>
                <th>Creado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="requests-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // insertar en el body (o antes del cierre main si existe)
  const main = document.querySelector("main") || document.body;
  main.insertAdjacentElement("afterbegin", wrapper);
})();

// Estado local
let allRequests = []; // array de { id, type, path, data }
let listenersAttached = false;
let currentUserIsAdmin = false;

// util fecha legible
function fmtDate(ts) {
  try {
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return String(ts || "—");
    return d.toLocaleString();
  } catch {
    return String(ts || "—");
  }
}

// leer both nodes en tiempo real y mantener allRequests
function attachRealtimeListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  const cancelRef = dbRef(db, CANCEL_NODE);
  onValue(cancelRef, (snap) => {
    const val = snap.val() || {};
    const arr = Object.entries(val).map(([k, v]) => ({
      id: k,
      type: "cancel",
      path: `${CANCEL_NODE}/${k}`,
      data: v
    }));
    // merge with refunds
    mergeRequests(arr, "cancel");
  }, (err) => {
    console.error("error cancelRef onValue:", err);
  });

  const refundRef = dbRef(db, REFUND_NODE);
  onValue(refundRef, (snap) => {
    const val = snap.val() || {};
    const arr = Object.entries(val).map(([k, v]) => ({
      id: k,
      type: "refund",
      path: `${REFUND_NODE}/${k}`,
      data: v
    }));
    mergeRequests(arr, "refund");
  }, (err) => {
    console.error("error refundRef onValue:", err);
  });
}

// fusionar incoming arrays con allRequests (mantener únicas por path)
function mergeRequests(arr, type) {
  // remove existing of that type
  allRequests = allRequests.filter(r => r.type !== type);
  // concat new
  allRequests = allRequests.concat(arr);
  // ordenar por fecha descendente (createdAt)
  allRequests.sort((a, b) => {
    const ta = a.data?.createdAt ? Number(a.data.createdAt) : 0;
    const tb = b.data?.createdAt ? Number(b.data.createdAt) : 0;
    return tb - ta;
  });
  renderTable();
}

// render tabla según filtros
function renderTable() {
  const tbody = document.getElementById("requests-tbody");
  const wrap = document.getElementById("requests-table-wrap");
  const loading = document.getElementById("requests-loading");
  if (!tbody || !wrap || !loading) return;

  // aplicar filtro de tipo
  const typeFilter = document.getElementById("requests-filter").value || "all";
  const q = (document.getElementById("requests-search").value || "").trim().toLowerCase();

  let list = allRequests.slice();
  if (typeFilter !== "all") list = list.filter(r => r.type === typeFilter);

  if (q) {
    list = list.filter(r => {
      const d = r.data || {};
      const orderKey = String(d.orderKey || d.order || d.order_id || "").toLowerCase();
      const productKey = String(d.product?.key || d.productKey || d.product?.key || "").toLowerCase();
      const productName = String(d.product?.name || d.productName || d.product?.name || "").toLowerCase();
      const userEmail = String(d.user?.email || d.userEmail || "").toLowerCase();
      const note = String(d.note || d.notes || d.message || "").toLowerCase();
      return orderKey.includes(q) || productKey.includes(q) || productName.includes(q) || userEmail.includes(q) || note.includes(q);
    });
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#9ca3af;padding:18px">No hay solicitudes que coincidan con el filtro.</td></tr>`;
    wrap.style.display = "block";
    loading.style.display = "none";
    return;
  }

  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();

  list.forEach(req => {
    const d = req.data || {};
    const id = req.id;
    const tipo = req.type;
    const orderKey = escapeHtml(String(d.orderKey || d.order || d.order_id || ""));
    const productKey = escapeHtml(String(d.product?.key || d.productKey || d.product?.id || ""));
    const productName = escapeHtml(String(d.product?.name || d.productName || d.product?.title || ""));
    const qty = escapeHtml(String(d.product?.qtyRequested || d.qtyRequested || d.product?.qty || d.qty || ""));
    const userEmail = escapeHtml(String(d.user?.email || d.userEmail || ""));
    const note = escapeHtml(String(d.note || d.notes || d.message || ""));
    const created = fmtDate(d.createdAt || d.created || "");

    // evidencia (refund)
    let evidenceHtml = "";
    if (tipo === "refund") {
      const url = d.evidenceUrl || d.evidence || null;
      const base64 = d.evidenceBase64 || null;
      if (url) {
        // enlace externo
        evidenceHtml = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="small-muted">Ver imagen</a>`;
      } else if (base64 && typeof base64 === "string" && base64.startsWith("data:")) {
        evidenceHtml = `<img src="${escapeHtml(base64)}" class="evidence-img" alt="Evidencia" />`;
      } else {
        evidenceHtml = `<div class="small-muted">—</div>`;
      }
    } else {
      evidenceHtml = `<div class="small-muted">—</div>`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="max-width:140px;word-break:break-all">${escapeHtml(id)}</td>
      <td>${escapeHtml(tipo)}</td>
      <td style="max-width:140px;word-break:break-all">${orderKey}</td>
      <td style="max-width:180px;word-break:break-all"><strong>${productName}</strong><div class="small-muted">${productKey}</div></td>
      <td style="max-width:160px;word-break:break-all">${userEmail}</td>
      <td style="text-align:center">${qty}</td>
      <td style="max-width:220px;word-break:break-all">${note || '<div class="small-muted">—</div>'}</td>
      <td>${evidenceHtml}</td>
      <td class="small-muted" style="white-space:nowrap">${escapeHtml(created)}</td>
      <td>
        <button class="btn btn-delete" data-path="${escapeHtml(req.path)}" data-id="${escapeHtml(id)}">Borrar</button>
      </td>
    `;
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  wrap.style.display = "block";
  loading.style.display = "none";

  // attach delete handlers (delegation)
  tbody.querySelectorAll(".btn-delete").forEach(b => {
    b.onclick = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const path = b.dataset.path;
      const id = b.dataset.id;
      if (!path) return alert("Ruta inválida");
      if (!confirm(`Borrar solicitud ${id}?\nEsta acción es irreversible.`)) return;
      try {
        await remove(dbRef(db, path));
        // feedback visual
        b.textContent = "Borrando…";
        b.disabled = true;
        // la escucha en tiempo real actualizará la tabla
      } catch (err) {
        console.error("Error borrando request:", err);
        alert("Error al borrar. Revisa la consola.");
      }
    };
  });
}

// small escapeHtml util
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// revisa si usuario es admin leyendo /admins/{uid}
async function checkIsAdmin(uid) {
  if (!uid) return false;
  try {
    const snap = await get(dbRef(db, `admins/${uid}`));
    return !!(snap && snap.val());
  } catch (e) {
    console.warn("checkIsAdmin error:", e);
    return false;
  }
}

// iniciar flujo cuando user auth cambia
onAuthStateChanged(auth, async (user) => {
  const loading = document.getElementById("requests-loading");
  const tableWrap = document.getElementById("requests-table-wrap");
  if (!loading || !tableWrap) return;

  if (!user) {
    loading.innerHTML = `<div class="no-access">No autenticado. Inicia sesión.</div>`;
    tableWrap.style.display = "none";
    return;
  }

  loading.innerHTML = "Verificando privilegios...";
  tableWrap.style.display = "none";

  currentUserIsAdmin = await checkIsAdmin(user.uid);
  if (!currentUserIsAdmin) {
    loading.innerHTML = `<div class="no-access">Acceso denegado. Solo administradores pueden ver estas solicitudes.</div>`;
    tableWrap.style.display = "none";
    return;
  }

  // es admin -> configurar listeners
  loading.innerHTML = "Cargando solicitudes...";
  attachRealtimeListeners();

  // show table area
  tableWrap.style.display = "block";
  loading.style.display = "none";
});

// bind controles
document.addEventListener("click", (ev) => {
  const t = ev.target;
  if (!t) return;
  if (t.id === "requests-refresh") {
    // Forzar re-render (allRequests ya viene por onValue)
    renderTable();
  }
});

// filtros / search triggers
const filterEl = document.getElementById("requests-filter");
const searchEl = document.getElementById("requests-search");
if (filterEl) filterEl.addEventListener("change", () => renderTable());
if (searchEl) {
  let debounceTimer = null;
  searchEl.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderTable(), 220);
  });
}

// Export (opcional) - permite reusar desde consola si se importa como módulo
export default {
  attachRealtimeListeners,
  renderTable
};
