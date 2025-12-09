// js/reviews.js
// Módulo para que el admin vea/edite/elimine/responda reseñas
// Requiere: ./firebase.js que exporte { auth, db, onAuthStateChanged } (como en tu proyecto)
// y ./utils.js que exporte escapeHtml (opcional, para seguridad XSS)
// Firebase Database v11 imports:

import { auth, db, onAuthStateChanged } from "./firebase.js";
import { escapeHtml } from "./utils.js";
import {
  ref,
  get,
  onValue,
  update,
  remove,
  set
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const ROOT_ID = "reviews-root"; // contenedor donde inyectaremos la UI (puedes cambiarlo)
const ADMIN_NAME_FOR_RESPONSE = "Kukoro-suport"; // EXACTO según pediste

// inyectar estilos (coherentes con el admin theme)
(function injectStyles() {
  if (document.getElementById("reviews-styles")) return;
  const s = document.createElement("style");
  s.id = "reviews-styles";
  s.textContent = `
    #reviews-root { max-width:1200px;margin:20px auto;color:#e5e7eb;font-family:"Poppins",system-ui; }
    .rv-header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}
    .rv-actions{display:flex;gap:8px}
    .rv-search{padding:8px;border-radius:8px;border:1px solid rgba(148,163,184,0.06);background:rgba(15,23,42,0.6);color:#e5e7eb}
    .rv-table{width:100%;border-collapse:collapse;background:transparent}
    .rv-table th, .rv-table td{padding:10px;border-bottom:1px solid rgba(148,163,184,0.03);text-align:left;font-size:13px}
    .rv-table th{color:#9ca3af;font-weight:700}
    .rv-row-compact{background:rgba(15,23,42,0.3);border-radius:6px}
    .rv-btn{padding:6px 10px;border-radius:8px;border:none;cursor:pointer}
    .rv-btn.edit{background:transparent;border:1px solid #3b82f6;color:#93c5fd}
    .rv-btn.delete{background:#ef4444;color:#fff}
    .rv-btn.respond{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff}
    .rv-meta{font-size:12px;color:#9ca3af}
    .rv-response{margin-top:6px;padding:8px;border-radius:6px;background:rgba(15,23,42,0.5);border:1px solid rgba(148,163,184,0.03);color:#d1d5db}
    /* modal */
    .rv-modal-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:20000;padding:12px}
    .rv-modal{width:100%;max-width:760px;background:#020617;border-radius:12px;padding:14px;border:1px solid rgba(148,163,184,0.06);box-shadow:0 20px 60px rgba(2,6,23,0.8);color:#e5e7eb}
    .rv-field{width:100%;padding:8px;border-radius:8px;border:1px solid rgba(148,163,184,0.04);background:rgba(15,23,42,0.6);color:#e5e7eb;margin-top:8px}
    .rv-stars{font-size:20px;display:inline-block;margin-right:8px;color:#fbbf24}
    .rv-small{font-size:12px;color:#9ca3af}
    .rv-footer{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
    @media(max-width:800px){ .rv-header{flex-direction:column;align-items:stretch} }
  `;
  document.head.appendChild(s);
})();

// crear UI base si no existe
function ensureRoot() {
  let root = document.getElementById(ROOT_ID);
  if (root) return root;
  root = document.createElement("div");
  root.id = ROOT_ID;
  document.body.appendChild(root);
  return root;
}

const root = ensureRoot();

// HTML base
root.innerHTML = `
  <div class="rv-header">
    <h2 style="margin:0">Reseñas (Administración)</h2>
    <div class="rv-actions">
      <input id="rv-search" class="rv-search" placeholder="Buscar por producto, usuario o texto..." />
      <button id="rv-refresh" class="rv-btn" title="Refrescar">⟳</button>
    </div>
  </div>

  <div id="rv-table-wrap">
    <table class="rv-table" aria-live="polite">
      <thead>
        <tr>
          <th>Producto (key)</th>
          <th>Producto (nombre)</th>
          <th>Estrellas</th>
          <th>Comentario</th>
          <th>Usuario</th>
          <th>Fecha</th>
          <th>Respuesta</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody id="rv-tbody">
        <tr><td colspan="8" class="rv-meta">Cargando reseñas...</td></tr>
      </tbody>
    </table>
  </div>

  <!-- modal editar/responder -->
  <div id="rv-modal-overlay" class="rv-modal-overlay" aria-hidden="true">
    <div class="rv-modal" role="dialog" aria-modal="true">
      <div id="rv-modal-body"></div>
      <div class="rv-footer">
        <button id="rv-modal-cancel" class="rv-btn">Cancelar</button>
        <button id="rv-modal-save" class="rv-btn" style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff">Guardar</button>
      </div>
    </div>
  </div>
`;

// referencias UI
const tbody = document.getElementById("rv-tbody");
const searchInput = document.getElementById("rv-search");
const refreshBtn = document.getElementById("rv-refresh");
const modalOverlay = document.getElementById("rv-modal-overlay");
const modalBody = document.getElementById("rv-modal-body");
const modalCancel = document.getElementById("rv-modal-cancel");
const modalSave = document.getElementById("rv-modal-save");

// estado local
let reviewsMap = {}; // { productKey: { reviewId: reviewObj, ... }, ... }
let flatList = []; // [{ productKey, id, data }, ...]
let currentUserIsAdmin = false;
let currentAdminUid = null;

// util small
function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString();
}
function starsHtml(n) {
  const s = Number(n || 0);
  let out = "";
  for (let i = 1; i <= 5; i++) out += (i <= s) ? "★" : "☆";
  return `<span class="rv-stars">${out}</span>`;
}
function sanitize(s) { return escapeHtml ? escapeHtml(String(s || "")) : String(s || ""); }

// comprobar admin simple client-side (lee /admins/{uid})
async function checkAdmin(uid) {
  if (!uid) return false;
  try {
    const snap = await get(ref(db, `admins/${uid}`));
    return snap.exists() && snap.val() === true;
  } catch (e) {
    console.warn("checkAdmin error:", e);
    return false;
  }
}

// cargar todos los reviews: reviewsByProduct y reviewsBySlug (fusiona)
async function loadAllReviews() {
  tbody.innerHTML = `<tr><td colspan="8" class="rv-meta">Cargando reseñas...</td></tr>`;
  reviewsMap = {};
  flatList = [];

  try {
    // reviewsByProduct
    const snap1 = await get(ref(db, "reviewsByProduct"));
    if (snap1.exists()) {
      const obj = snap1.val();
      Object.keys(obj).forEach(productKey => {
        const reviews = obj[productKey] || {};
        reviewsMap[productKey] = reviewsMap[productKey] || {};
        Object.keys(reviews).forEach(rid => {
          const r = reviews[rid];
          reviewsMap[productKey][rid] = r;
          flatList.push({ productKey, id: rid, data: r });
        });
      });
    }

    // reviewsBySlug (fusionar también, pero prefiero marcar productKey con 'slug:' prefix para evitar colisiones)
    const snap2 = await get(ref(db, "reviewsBySlug"));
    if (snap2.exists()) {
      const obj2 = snap2.val();
      Object.keys(obj2).forEach(slug => {
        const reviews = obj2[slug] || {};
        const pk = `slug:${slug}`;
        reviewsMap[pk] = reviewsMap[pk] || {};
        Object.keys(reviews).forEach(rid => {
          const r = reviews[rid];
          reviewsMap[pk][rid] = r;
          flatList.push({ productKey: pk, id: rid, data: r });
        });
      });
    }

    // ordenar por createdAt desc
    flatList.sort((a, b) => (Number(b.data.createdAt || 0) - Number(a.data.createdAt || 0)));

    renderTable(flatList);
  } catch (err) {
    console.error("loadAllReviews error:", err);
    tbody.innerHTML = `<tr><td colspan="8" class="rv-meta" style="color:#f97373">Error cargando reseñas: ${sanitize(err && err.message)}</td></tr>`;
  }
}

// render tabla
function renderTable(list) {
  if (!Array.isArray(list) || !list.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="rv-meta">No hay reseñas registradas.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  list.forEach(item => {
    const r = item.data || {};
    const productKey = sanitize(item.productKey);
    const productName = sanitize(r.productName || "");
    const stars = Number(r.stars || 0);
    const comment = sanitize(r.comment || "");
    const user = (r.user && (r.user.email || r.user.uid)) ? sanitize(r.user.email || r.user.uid) : "Anon";
    const created = fmtDate(r.createdAt || r.createdAt);
    const responseObj = r.response || null;

    const tr = document.createElement("tr");
    tr.className = "rv-row-compact";
    tr.innerHTML = `
      <td style="vertical-align:top;max-width:220px">${productKey}</td>
      <td style="vertical-align:top">${productName}</td>
      <td style="vertical-align:top">${starsHtml(stars)}</td>
      <td style="vertical-align:top;max-width:360px;white-space:pre-wrap">${comment || "<span class='rv-small'>Sin comentario</span>"}</td>
      <td style="vertical-align:top">${user}</td>
      <td style="vertical-align:top">${created}</td>
      <td style="vertical-align:top">${responseObj ? `<div class="rv-response"><strong>${sanitize(responseObj.by || "")}</strong><div style="margin-top:6px">${sanitize(responseObj.message || "")}</div><div class="rv-small" style="margin-top:6px">${fmtDate(responseObj.createdAt)}</div></div>` : `<span class="rv-small">Sin respuesta</span>`}</td>
      <td style="vertical-align:top">
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="rv-btn edit" data-product-key="${sanitize(item.productKey)}" data-review-id="${sanitize(item.id)}">✎ Editar</button>
          <button class="rv-btn respond" data-product-key="${sanitize(item.productKey)}" data-review-id="${sanitize(item.id)}">💬 Responder</button>
          <button class="rv-btn delete" data-product-key="${sanitize(item.productKey)}" data-review-id="${sanitize(item.id)}">🗑 Eliminar</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// helpers para CRUD
function reviewRefPath(productKey, reviewId) {
  // si productKey fue guardado con prefix slug: lo escribimos en reviewsBySlug
  if (String(productKey).startsWith("slug:")) {
    const slug = String(productKey).slice(5);
    return `reviewsBySlug/${slug}/${reviewId}`;
  }
  // default reviewsByProduct
  return `reviewsByProduct/${productKey}/${reviewId}`;
}

// abrir modal: modo = "edit"|"respond"
async function openModal(mode, productKey, reviewId) {
  if (!currentUserIsAdmin) { alert("Sólo administradores pueden gestionar reseñas."); return; }
  modalBody.innerHTML = `<div style="color:#9ca3af">Cargando...</div>`;
  modalOverlay.style.display = "flex";
  modalOverlay.setAttribute("aria-hidden", "false");

  try {
    const snap = await get(ref(db, reviewRefPath(productKey, reviewId)));
    if (!snap.exists()) {
      modalBody.innerHTML = `<div style="color:#f97373">Reseña no encontrada.</div>`;
      return;
    }
    const rev = snap.val();

    if (mode === "edit") {
      // editar stars + comment (admin puede editar)
      modalBody.innerHTML = `
        <label class="rv-small">Producto (key)</label>
        <div class="rv-field" style="background:transparent;border:none;padding:0;margin-bottom:8px">${sanitize(productKey)}</div>

        <label class="rv-small">Producto (nombre)</label>
        <div class="rv-field" style="background:transparent;border:none;padding:0;margin-bottom:8px">${sanitize(rev.productName || "")}</div>

        <label class="rv-small">Estrellas</label>
        <input id="rv-modal-stars" type="number" min="0" max="5" class="rv-field" value="${Number(rev.stars||0)}" />

        <label class="rv-small">Comentario</label>
        <textarea id="rv-modal-comment" class="rv-field" rows="5">${sanitize(rev.comment || "")}</textarea>

        <div class="rv-small" style="margin-top:8px">Usuario: ${sanitize(rev.user?.email || rev.user?.uid || "Anon")}</div>
      `;

      modalSave.onclick = async () => {
        const stars = Number(document.getElementById("rv-modal-stars").value || 0);
        const comment = document.getElementById("rv-modal-comment").value || "";
        try {
          await update(ref(db, reviewRefPath(productKey, reviewId)), { stars, comment });
          modalOverlay.style.display = "none";
          await loadAllReviews();
          alert("Reseña actualizada.");
        } catch (e) {
          console.error("update review error", e);
          alert("No se pudo actualizar. Revisa consola.");
        }
      };

    } else if (mode === "respond") {
      // mostrar respuesta existente si la hay y permitir escribir nueva respuesta (sobrescribe)
      const existingResponse = rev.response || null;
      modalBody.innerHTML = `
        <div class="rv-small">Respondiendo como <strong>${ADMIN_NAME_FOR_RESPONSE}</strong></div>
        <label class="rv-small" style="margin-top:8px">Respuesta</label>
        <textarea id="rv-modal-response" class="rv-field" rows="5">${sanitize(existingResponse ? (existingResponse.message || "") : "")}</textarea>
        <div class="rv-small" style="margin-top:8px">La respuesta será guardada como propiedad <code>response</code> dentro de la reseña.</div>
      `;

      modalSave.onclick = async () => {
        const message = String(document.getElementById("rv-modal-response").value || "").trim();
        const responseObj = {
          by: ADMIN_NAME_FOR_RESPONSE,
          message,
          createdAt: Date.now()
        };
        try {
          await update(ref(db, reviewRefPath(productKey, reviewId)), { response: responseObj });
          modalOverlay.style.display = "none";
          await loadAllReviews();
          alert("Respuesta publicada.");
        } catch (e) {
          console.error("save response error", e);
          alert("No se pudo guardar la respuesta.");
        }
      };
    }

    // cancelar
    modalCancel.onclick = () => { modalOverlay.style.display = "none"; };
  } catch (err) {
    console.error("openModal error", err);
    modalBody.innerHTML = `<div style="color:#f97373">Error: ${sanitize(err && err.message)}</div>`;
  }
}

// eliminar reseña
async function deleteReview(productKey, reviewId) {
  if (!currentUserIsAdmin) { alert("Sólo administradores pueden eliminar reseñas."); return; }
  if (!confirm("Eliminar reseña permanentemente?")) return;
  try {
    await remove(ref(db, reviewRefPath(productKey, reviewId)));
    alert("Reseña eliminada.");
    await loadAllReviews();
  } catch (e) {
    console.error("deleteReview error", e);
    alert("No se pudo eliminar reseña. Revisa consola.");
  }
}

// delegación de botones
tbody.addEventListener("click", (ev) => {
  const edit = ev.target.closest(".edit");
  if (edit) {
    const pk = edit.dataset.productKey;
    const id = edit.dataset.reviewId;
    openModal("edit", pk, id);
    return;
  }
  const resp = ev.target.closest(".respond");
  if (resp) {
    const pk = resp.dataset.productKey;
    const id = resp.dataset.reviewId;
    openModal("respond", pk, id);
    return;
  }
  const del = ev.target.closest(".delete");
  if (del) {
    const pk = del.dataset.productKey;
    const id = del.dataset.reviewId;
    deleteReview(pk, id);
    return;
  }
});

// búsqueda + refresh
searchInput.addEventListener("input", () => {
  const q = String(searchInput.value || "").trim().toLowerCase();
  if (!q) return renderTable(flatList);
  const filtered = flatList.filter(item => {
    const d = item.data || {};
    const productKey = String(item.productKey || "").toLowerCase();
    const productName = String(d.productName || "").toLowerCase();
    const comment = String(d.comment || "").toLowerCase();
    const user = String(d.user?.email || d.user?.uid || "").toLowerCase();
    return productKey.includes(q) || productName.includes(q) || comment.includes(q) || user.includes(q);
  });
  renderTable(filtered);
});
refreshBtn.addEventListener("click", () => loadAllReviews());

// escucha cambios en realtime para mantener actualizado (opcional)
// sólo si admin: escuchamos onValue en nodos reviewsByProduct y reviewsBySlug
function attachRealtimeIfAdmin(uid) {
  if (!uid) return;
  // detach previous? simple: always call loadAllReviews once then attach onValue listeners
  onValue(ref(db, "reviewsByProduct"), () => loadAllReviews(), (e) => console.warn("rv onValue err", e));
  onValue(ref(db, "reviewsBySlug"), () => loadAllReviews(), (e) => console.warn("rv onValue err2", e));
}

// iniciar: comprobar auth y admin
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    root.querySelector("#rv-tbody").innerHTML = `<tr><td colspan="8" class="rv-meta">Inicia sesión como administrador para ver y moderar reseñas.</td></tr>`;
    return;
  }
  currentAdminUid = user.uid;
  currentUserIsAdmin = await checkAdmin(user.uid);
  if (!currentUserIsAdmin) {
    root.querySelector("#rv-tbody").innerHTML = `<tr><td colspan="8" class="rv-meta">No tienes permisos de administrador.</td></tr>`;
    // aún puedes optar por mostrar reads (si las reglas lo permiten), pero aquí no mostraremos botones
    await loadAllReviews();
    return;
  }

  // admin ok: cargar y escuchar realtime
  attachRealtimeIfAdmin(user.uid);
  await loadAllReviews();
});

// auto-load una vez (en caso de que la app admin tenga auth ya)
(async () => {
  try {
    const u = auth.currentUser;
    if (u) {
      currentAdminUid = u.uid;
      currentUserIsAdmin = await checkAdmin(u.uid);
      attachRealtimeIfAdmin(u.uid);
      loadAllReviews();
    } else {
      // no user yet; onAuthStateChanged se encargará
    }
  } catch (e) {
    console.warn("init reviews error", e);
  }
})();

// export vacío (módulo)
export {};
