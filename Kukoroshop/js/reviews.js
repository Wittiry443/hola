import { auth, onAuthStateChanged, db } from "./firebase.js";
import { escapeHtml } from "./utils.js";
import {
  ref,
  get,
  update,
  remove,
  onValue
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const ADMIN_RESPONSE_BY = "Kukoro-suport"; // nombre fijo para las respuestas

// DOM hooks (usa el tbody ya presente en admin.html)
const tbody = document.getElementById("reviews-table-body");
if (!tbody) {
  console.warn("reviews.js: no se encontró #reviews-table-body en el DOM. Asegúrate de tenerlo en admin.html");
}

// Crear modal + estilos (si no existe)
(function createModalAndStyles() {
  if (document.getElementById("rv-modal-overlay")) return;

  const style = document.createElement("style");
  style.id = "rv-reviews-styles";
  style.textContent = `
    .rv-small { font-size:12px; color:#9ca3af; }
    .rv-stars { color:#fbbf24; font-size:18px; display:inline-block; }
    .rv-btn { padding:6px 10px; border-radius:8px; cursor:pointer; border:none }
    .rv-btn.edit { border:1px solid rgba(59,130,246,0.25); background:transparent; color:#93c5fd }
    .rv-btn.respond { background:linear-gradient(135deg,#4f46e5,#7c3aed); color:#fff }
    .rv-btn.delete { background:#ef4444; color:#fff }
    .rv-response { background:rgba(15,23,42,0.45); padding:8px; border-radius:8px; border:1px solid rgba(148,163,184,0.03); color:#d1d5db; margin-top:8px }
    .rv-modal-overlay { position:fixed; inset:0; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,0.6); z-index:120000; padding:12px; }
    .rv-modal { width:100%; max-width:840px; background:#020617; border-radius:12px; padding:14px; border:1px solid rgba(148,163,184,0.06); color:#e5e7eb; box-shadow:0 20px 60px rgba(2,6,23,0.8); }
    .rv-field { width:100%; padding:8px; border-radius:8px; border:1px solid rgba(148,163,184,0.04); background:rgba(15,23,42,0.6); color:#e5e7eb; margin-top:8px; }
    .rv-footer { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }
    @media (max-width:720px) { .rv-modal { max-width:95%; } }
  `;
  document.head.appendChild(style);

  const modalHTML = `
    <div id="rv-modal-overlay" class="rv-modal-overlay" aria-hidden="true">
      <div class="rv-modal" role="dialog" aria-modal="true">
        <div id="rv-modal-body">Cargando...</div>
        <div class="rv-footer">
          <button id="rv-modal-cancel" class="rv-btn">Cancelar</button>
          <button id="rv-modal-save" class="rv-btn" style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff">Guardar</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", modalHTML);

  // handlers básicos
  document.getElementById("rv-modal-cancel").addEventListener("click", () => {
    const ov = document.getElementById("rv-modal-overlay");
    if (ov) ov.style.display = "none";
  });
  document.getElementById("rv-modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "rv-modal-overlay") e.currentTarget.style.display = "none";
  });
})();

// Estado local
let flatList = []; // [{ productKey, id, data }]
let currentUserIsAdmin = false;
let currentAdminUid = null;
let realtimeAttached = false; // evita múltiples onValue attach

// utilidades
const fmtDate = (ts) => {
  if (!ts) return "";
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString();
};
const starsHtml = (n) => {
  const s = Number(n || 0);
  let out = "";
  for (let i=1;i<=5;i++) out += (i<=s ? "★" : "☆");
  return `<span class="rv-stars">${out}</span>`;
};
const sanitize = (v) => (typeof escapeHtml === "function" ? escapeHtml(String(v || "")) : String(v || ""));

// Decide path (reviewsByProduct vs reviewsBySlug) based on productKey string
function reviewRefPath(productKey, reviewId) {
  if (String(productKey).startsWith("slug:")) {
    const slug = String(productKey).slice(5);
    return `reviewsBySlug/${slug}/${reviewId}`;
  }
  return `reviewsByProduct/${productKey}/${reviewId}`;
}

// Cargar todas las reseñas (fusiona reviewsByProduct + reviewsBySlug)
// IMPORTANTE: usamos variables locales y Map para evitar duplicados por condiciones de carrera
async function loadAllReviews() {
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:18px">Cargando reseñas…</td></tr>`;

  // local collection — evita race conditions con llamadas concurrentes
  const newList = [];
  const seen = new Map(); // key -> true ; key = `${productKey}::${rid}`

  try {
    // reviewsByProduct
    const snap1 = await get(ref(db, "reviewsByProduct"));
    if (snap1.exists()) {
      const byProduct = snap1.val();
      Object.keys(byProduct).forEach(productKey => {
        const reviews = byProduct[productKey] || {};
        Object.keys(reviews).forEach(rid => {
          const uniq = `${productKey}::${rid}`;
          if (!seen.has(uniq)) {
            seen.set(uniq, true);
            newList.push({ productKey, id: rid, data: reviews[rid] });
          }
        });
      });
    }

    // reviewsBySlug (prefixamos productKey con 'slug:')
    const snap2 = await get(ref(db, "reviewsBySlug"));
    if (snap2.exists()) {
      const bySlug = snap2.val();
      Object.keys(bySlug).forEach(slug => {
        const reviews = bySlug[slug] || {};
        Object.keys(reviews).forEach(rid => {
          const productKey = `slug:${slug}`;
          const uniq = `${productKey}::${rid}`;
          if (!seen.has(uniq)) {
            seen.set(uniq, true);
            newList.push({ productKey, id: rid, data: reviews[rid] });
          }
        });
      });
    }

    // ordenar por createdAt desc
    newList.sort((a,b) => (Number(b.data?.createdAt || 0) - Number(a.data?.createdAt || 0)));

    // asignar al estado global sólo después de tener la lista definitiva
    flatList = newList;
    renderTable(flatList);
  } catch (e) {
    console.error("reviews.loadAllReviews error", e);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#f97373;padding:18px">Error cargando reseñas. Revisa consola.</td></tr>`;
  }
}

// Render tabla en el tbody existente
// Nota: la tabla en admin.html tiene 6 columnas: Producto (key), Usuario, Estrellas, Comentario, Fecha, Acciones
function renderTable(list) {
  if (!tbody) return;
  if (!Array.isArray(list) || !list.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:18px">No hay reseñas registradas.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  list.forEach(item => {
    const r = item.data || {};
    const productKey = sanitize(item.productKey);
    const productName = sanitize(r.productName || "");
    const stars = Number(r.stars || 0);
    const commentRaw = (r.comment === "" || r.comment === null || r.comment === undefined) ? "" : String(r.comment);
    const comment = sanitize(commentRaw);
    const user = (r.user && (r.user.email || r.user.uid)) ? sanitize(r.user.email || r.user.uid) : "Anon";
    const created = fmtDate(r.createdAt || r.createdAt);
    const responseObj = r.response || null;

    // Comentario: incluir también la respuesta admin (si existe) dentro de la misma celda para mantener 6 cols
    let commentCellHtml = comment !== "" ? comment : `<span style="color:#9ca3af">Sin comentario</span>`;
    if (responseObj) {
      commentCellHtml += `<div class="rv-response"><strong>${sanitize(responseObj.by||"")}</strong><div style="margin-top:6px">${sanitize(responseObj.message||"")}</div><div class="rv-small" style="margin-top:6px">${fmtDate(responseObj.createdAt)}</div></div>`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="vertical-align:top;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${productKey}</td>
      <td style="vertical-align:top">${user}</td>
      <td style="vertical-align:top">${starsHtml(stars)}</td>
      <td style="vertical-align:top;max-width:360px;white-space:pre-wrap">${commentCellHtml}</td>
      <td style="vertical-align:top">${created}</td>
      <td style="vertical-align:top">
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="rv-btn edit" data-product-key="${sanitize(item.productKey)}" data-review-id="${sanitize(item.id)}">✎ Editar</button>
          <button class="rv-btn respond" data-product-key="${sanitize(item.productKey)}" data-review-id="${sanitize(item.id)}">💬 Responder</button>
          <button class="rv-btn delete" data-product-key="${sanitize(item.productKey)}" data-review-id="${sanitize(item.id)}">🗑 Eliminar</button>
        </div>
      </td>
    `;

    // Si usuario no admin ocultamos acciones
    if (!currentUserIsAdmin) {
      const actionsCell = tr.querySelector("td:last-child");
      actionsCell.innerHTML = `<span class="rv-small">Sin permisos</span>`;
    }

    tbody.appendChild(tr);
  });
}

// Abrir modal para editar o responder
async function openModal(mode, productKey, reviewId) {
  const overlay = document.getElementById("rv-modal-overlay");
  const body = document.getElementById("rv-modal-body");
  const saveBtn = document.getElementById("rv-modal-save");
  const cancelBtn = document.getElementById("rv-modal-cancel");
  if (!overlay || !body) return;

  overlay.style.display = "flex";
  overlay.setAttribute("aria-hidden", "false");
  body.innerHTML = "Cargando...";

  try {
    const snap = await get(ref(db, reviewRefPath(productKey, reviewId)));
    if (!snap.exists()) {
      body.innerHTML = `<div style="color:#f97373">Reseña no encontrada.</div>`;
      return;
    }
    const rev = snap.val();

    // Preparar UI según modo
    if (mode === "edit") {
      body.innerHTML = `
        <div><strong>Producto:</strong> ${sanitize(productKey)}</div>
        <div style="margin-top:8px"><strong>Nombre:</strong> ${sanitize(rev.productName || "")}</div>
        <label class="rv-small" style="display:block;margin-top:10px">Estrellas (0-5)</label>
        <input id="rv-modal-stars" type="number" min="0" max="5" class="rv-field" value="${Number(rev.stars||0)}" />
        <label class="rv-small" style="display:block;margin-top:8px">Comentario</label>
        <textarea id="rv-modal-comment" class="rv-field" rows="6">${sanitize(rev.comment||"")}</textarea>
        <div class="rv-small" style="margin-top:8px">Usuario: ${sanitize(rev.user?.email || rev.user?.uid || "Anon")}</div>
      `;

      saveBtn.onclick = async () => {
        const stars = Number(document.getElementById("rv-modal-stars").value || 0);
        const comment = document.getElementById("rv-modal-comment").value || "";
        try {
          await update(ref(db, reviewRefPath(productKey, reviewId)), { stars, comment });
          overlay.style.display = "none";
          await loadAllReviews();
          alert("Reseña actualizada.");
        } catch (e) {
          console.error("update review error", e);
          alert("No se pudo actualizar la reseña. Revisa la consola.");
        }
      };

    } else if (mode === "respond") {
      const existing = rev.response || null;
      body.innerHTML = `
        <div class="rv-small">Respondiendo como <strong>${ADMIN_RESPONSE_BY}</strong></div>
        <label class="rv-small" style="display:block;margin-top:8px">Respuesta</label>
        <textarea id="rv-modal-response" class="rv-field" rows="6">${sanitize(existing ? (existing.message || "") : "")}</textarea>
        <div class="rv-small" style="margin-top:8px">La respuesta se guardará como <code>response</code> dentro de la reseña.</div>
      `;

      saveBtn.onclick = async () => {
        const message = String(document.getElementById("rv-modal-response").value || "").trim();
        const responseObj = { by: ADMIN_RESPONSE_BY, message, createdAt: Date.now() };
        try {
          await update(ref(db, reviewRefPath(productKey, reviewId)), { response: responseObj });
          overlay.style.display = "none";
          await loadAllReviews();
          alert("Respuesta guardada.");
        } catch (e) {
          console.error("save response error", e);
          alert("No se pudo guardar la respuesta. Revisa la consola.");
        }
      };
    }

    // Cancel handler (rebind)
    cancelBtn.onclick = () => {
      overlay.style.display = "none";
    };

  } catch (err) {
    console.error("openModal error", err);
    body.innerHTML = `<div style="color:#f97373">Error: ${sanitize(err && err.message)}</div>`;
  }
}

// Eliminar reseña
async function deleteReview(productKey, reviewId) {
  if (!currentUserIsAdmin) { alert("Solo administradores pueden eliminar reseñas."); return; }
  if (!confirm("Eliminar reseña permanentemente?")) return;
  try {
    await remove(ref(db, reviewRefPath(productKey, reviewId)));
    alert("Reseña eliminada.");
    await loadAllReviews();
  } catch (e) {
    console.error("deleteReview error", e);
    alert("No se pudo eliminar la reseña. Revisa la consola.");
  }
}

// Delegación de botones en la tabla
if (tbody) {
  tbody.addEventListener("click", (ev) => {
    const editBtn = ev.target.closest(".edit");
    if (editBtn) {
      const pk = editBtn.dataset.productKey;
      const id = editBtn.dataset.reviewId;
      if (!currentUserIsAdmin) return alert("No tienes permisos.");
      openModal("edit", pk, id);
      return;
    }
    const respBtn = ev.target.closest(".respond");
    if (respBtn) {
      const pk = respBtn.dataset.productKey;
      const id = respBtn.dataset.reviewId;
      if (!currentUserIsAdmin) return alert("No tienes permisos.");
      openModal("respond", pk, id);
      return;
    }
    const delBtn = ev.target.closest(".delete");
    if (delBtn) {
      const pk = delBtn.dataset.productKey;
      const id = delBtn.dataset.reviewId;
      if (!currentUserIsAdmin) return alert("No tienes permisos.");
      deleteReview(pk, id);
      return;
    }
  });
}

// Realtime: si admin, attach listeners para refrescar automáticamente (sólo una vez)
function attachRealtimeIfAdmin(uid) {
  if (!uid || realtimeAttached) return;
  realtimeAttached = true;
  try {
    onValue(ref(db, "reviewsByProduct"), () => loadAllReviews(), (e) => console.warn("onValue reviewsByProduct err", e));
    onValue(ref(db, "reviewsBySlug"), () => loadAllReviews(), (e) => console.warn("onValue reviewsBySlug err", e));
  } catch (e) {
    console.warn("attachRealtimeIfAdmin error", e);
  }
}

// Auth state: comprobar admin simple (lee /admins/{uid})
async function checkAdminClient(uid) {
  if (!uid) return false;
  try {
    const snap = await get(ref(db, `admins/${uid}`));
    return snap.exists() && snap.val() === true;
  } catch (e) {
    console.warn("checkAdminClient error", e);
    return false;
  }
}

// onAuthStateChanged: inicializa vista
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUserIsAdmin = false;
    currentAdminUid = null;
    await loadAllReviews(); // intentamos cargar en modo sólo lectura
    return;
  }
  currentAdminUid = user.uid;
  currentUserIsAdmin = await checkAdminClient(user.uid);
  if (currentUserIsAdmin) attachRealtimeIfAdmin(user.uid);
  await loadAllReviews();
});

// auto-load once on module import (in case auth already ready)
(async () => {
  try {
    const u = auth.currentUser;
    if (u) {
      currentAdminUid = u.uid;
      currentUserIsAdmin = await checkAdminClient(u.uid);
      if (currentUserIsAdmin) attachRealtimeIfAdmin(u.uid);
    }
  } catch (e) {
    console.warn("init reviews module error", e);
  } finally {
    // attempt initial fetch even if no auth yet (rules may allow read)
    await loadAllReviews();
  }
})();

export {}; // módulo
