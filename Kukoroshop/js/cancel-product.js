// js/cancel-product.js
// Separado: cancel (cancelproduct/cancel) y refund (cancelproduct/refund)
// Cada flujo tiene su propio modal y guardado en DB.
// Requiere ./firebase.js que exporte `auth` y `db`.

import { auth } from "./firebase.js";
import { db } from "./firebase.js";
import { ref as dbRef, push, set } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// ----- Config -----
const ROOT_NODE = "cancelproduct";
const CANCEL_NODE = `${ROOT_NODE}/cancel`;
const REFUND_NODE = `${ROOT_NODE}/refund`;

// ----- Styles (single injection) -----
(function injectStyles() {
  if (document.getElementById("cp-styles")) return;
  const s = document.createElement("style");
  s.id = "cp-styles";
  s.textContent = `
    .cp-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:120000;padding:12px}
    .cp-modal{width:100%;max-width:720px;background:#020617;border-radius:10px;padding:16px;border:1px solid rgba(148,163,184,0.06);color:#e5e7eb;box-shadow:0 12px 50px rgba(2,6,23,0.7);font-family:system-ui,Segoe UI,Roboto}
    .cp-field{width:100%;padding:10px;border-radius:8px;background:rgba(15,23,42,0.6);border:1px solid rgba(148,163,184,0.04);color:#e5e7eb}
    .cp-label{font-size:13px;color:#9ca3af;margin-bottom:6px}
    .cp-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
    .cp-btn{padding:8px 12px;border-radius:8px;border:none;cursor:pointer}
    .cp-cancel{background:transparent;border:1px solid rgba(148,163,184,0.06);color:#e5e7eb}
    .cp-submit{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff}
    .cp-note{font-size:13px;color:#9ca3af;margin-top:6px}
    .cp-preview{margin-top:8px;max-width:160px;border-radius:6px;border:1px solid rgba(148,163,184,0.03)}
    .cp-small{font-size:12px;color:#9ca3af}
  `;
  document.head.appendChild(s);
})();

// ----- Create two modals: cancel and refund -----
(function createModals() {
  if (document.getElementById("cp-cancel-overlay")) return;

  // Cancel modal (no reason required, minimal)
  const cancelHtml = `
    <div id="cp-cancel-overlay" class="cp-overlay" aria-hidden="true">
      <div class="cp-modal" role="dialog" aria-modal="true" aria-labelledby="cp-cancel-title">
        <h3 id="cp-cancel-title" style="margin:0 0 8px 0">Solicitar cancelación</h3>
        <div id="cp-cancel-context" class="cp-small" style="margin-bottom:8px"></div>

        <div>
          <div class="cp-label">Cantidad a cancelar</div>
          <input id="cp-cancel-qty" type="number" min="1" class="cp-field" />
        </div>

        <div style="margin-top:8px">
          <div class="cp-label">Notas (opcional)</div>
          <textarea id="cp-cancel-note" class="cp-field" rows="3" placeholder="Detalles adicionales (opcional)"></textarea>
        </div>

        <div id="cp-cancel-status" class="cp-small" style="margin-top:8px"></div>

        <div class="cp-actions" style="margin-top:12px">
          <button id="cp-cancel-close" class="cp-btn cp-cancel">Cerrar</button>
          <button id="cp-cancel-submit" class="cp-btn cp-submit">Enviar cancelación</button>
        </div>
      </div>
    </div>
  `;

  // Refund modal (evidence upload)
  const refundHtml = `
    <div id="cp-refund-overlay" class="cp-overlay" aria-hidden="true">
      <div class="cp-modal" role="dialog" aria-modal="true" aria-labelledby="cp-refund-title">
        <h3 id="cp-refund-title" style="margin:0 0 8px 0">Solicitar reembolso</h3>
        <div id="cp-refund-context" class="cp-small" style="margin-bottom:8px"></div>

        <div>
          <div class="cp-label">Cantidad para reembolso</div>
          <input id="cp-refund-qty" type="number" min="1" class="cp-field" />
        </div>

        <div style="margin-top:8px">
          <div class="cp-label">Notas (opcional)</div>
          <textarea id="cp-refund-note" class="cp-field" rows="3" placeholder="Describe el problema (producto dañado, faltante, etc.)"></textarea>
        </div>

        <div style="margin-top:8px">
          <div class="cp-label">Evidencia (imagen)</div>
          <input id="cp-refund-file" type="file" accept="image/*" class="cp-field" />
          <img id="cp-refund-preview" class="cp-preview" src="" alt="Preview" style="display:none" />
          <div class="cp-note">Sube foto del producto dañado o del paquete si aplica (recomendado).</div>
        </div>

        <div id="cp-refund-status" class="cp-small" style="margin-top:8px"></div>

        <div class="cp-actions" style="margin-top:12px">
          <button id="cp-refund-close" class="cp-btn cp-cancel">Cerrar</button>
          <button id="cp-refund-submit" class="cp-btn cp-submit">Enviar reembolso</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", cancelHtml + refundHtml);

  // handlers for cancel modal
  const cancelOverlay = document.getElementById("cp-cancel-overlay");
  document.getElementById("cp-cancel-close").addEventListener("click", () => {
    closeCancelModal();
  });
  cancelOverlay.addEventListener("click", (e) => {
    if (e.target === cancelOverlay) closeCancelModal();
  });

  // handlers for refund modal
  const refundOverlay = document.getElementById("cp-refund-overlay");
  document.getElementById("cp-refund-close").addEventListener("click", () => {
    closeRefundModal();
  });
  refundOverlay.addEventListener("click", (e) => {
    if (e.target === refundOverlay) closeRefundModal();
  });

  // file preview for refund
  const refundFile = document.getElementById("cp-refund-file");
  const refundPreview = document.getElementById("cp-refund-preview");
  refundFile.addEventListener("change", () => {
    const f = refundFile.files && refundFile.files[0];
    if (!f) { refundPreview.src = ""; refundPreview.style.display = "none"; return; }
    const r = new FileReader();
    r.onload = (ev) => { refundPreview.src = ev.target.result; refundPreview.style.display = "block"; };
    r.readAsDataURL(f);
  });
})();

// ----- Helpers: open/close modals -----
function openCancelModalUI(orderKey, product) {
  const overlay = document.getElementById("cp-cancel-overlay");
  if (!overlay) return;
  const ctx = document.getElementById("cp-cancel-context");
  const qtyEl = document.getElementById("cp-cancel-qty");
  const noteEl = document.getElementById("cp-cancel-note");
  const status = document.getElementById("cp-cancel-status");

  ctx.textContent = `Producto: ${product.name || product.productKey || "Producto"} · Pedido: ${orderKey || "—"}`;
  qtyEl.value = product.qty || product.quantity || 1;
  noteEl.value = "";
  status.textContent = "";

  overlay.style.display = "flex";
  overlay.setAttribute("aria-hidden", "false");

  // bind submit
  const submit = document.getElementById("cp-cancel-submit");
  submit.onclick = async () => {
    await submitCancel(orderKey, product);
  };
}

function closeCancelModal() {
  const overlay = document.getElementById("cp-cancel-overlay");
  if (!overlay) return;
  overlay.style.display = "none";
  overlay.setAttribute("aria-hidden", "true");
  // clear
  document.getElementById("cp-cancel-qty").value = "";
  document.getElementById("cp-cancel-note").value = "";
  document.getElementById("cp-cancel-status").textContent = "";
  document.getElementById("cp-cancel-context").textContent = "";
}

function openRefundModalUI(orderKey, product) {
  const overlay = document.getElementById("cp-refund-overlay");
  if (!overlay) return;
  const ctx = document.getElementById("cp-refund-context");
  const qtyEl = document.getElementById("cp-refund-qty");
  const noteEl = document.getElementById("cp-refund-note");
  const status = document.getElementById("cp-refund-status");
  const preview = document.getElementById("cp-refund-preview");
  const fileEl = document.getElementById("cp-refund-file");

  ctx.textContent = `Producto: ${product.name || product.productKey || "Producto"} · Pedido: ${orderKey || "—"}`;
  qtyEl.value = product.qty || product.quantity || 1;
  noteEl.value = "";
  status.textContent = "";
  preview.src = "";
  preview.style.display = "none";
  fileEl.value = "";

  overlay.style.display = "flex";
  overlay.setAttribute("aria-hidden", "false");

  // bind submit
  const submit = document.getElementById("cp-refund-submit");
  submit.onclick = async () => {
    await submitRefund(orderKey, product);
  };
}

function closeRefundModal() {
  const overlay = document.getElementById("cp-refund-overlay");
  if (!overlay) return;
  overlay.style.display = "none";
  overlay.setAttribute("aria-hidden", "true");
  document.getElementById("cp-refund-qty").value = "";
  document.getElementById("cp-refund-note").value = "";
  document.getElementById("cp-refund-status").textContent = "";
  document.getElementById("cp-refund-preview").src = "";
  document.getElementById("cp-refund-preview").style.display = "none";
  document.getElementById("cp-refund-file").value = "";
  document.getElementById("cp-refund-context").textContent = "";
}

// ----- Storage helper (try upload, fallback to base64) -----
async function uploadEvidenceFile(file, uid) {
  if (!file) return { uploaded: false, reason: "no_file" };
  try {
    const storage = getStorage(); // may throw if not initialized
    const ts = Date.now();
    const safeName = (file.name || `evidence_${ts}`).replace(/\s+/g, "_");
    const path = `${ROOT_NODE}/evidence/${uid}/${ts}_${safeName}`;
    const sRef = storageRef(storage, path);
    const arrayBuffer = await file.arrayBuffer();
    await uploadBytes(sRef, new Uint8Array(arrayBuffer), { contentType: file.type || "image/jpeg" });
    const url = await getDownloadURL(sRef);
    return { uploaded: true, url, storagePath: path };
  } catch (err) {
    console.warn("Storage upload failed, falling back to base64:", err);
    try {
      const base64 = await readFileAsDataURL(file);
      return { uploaded: false, fallbackBase64: base64, reason: "storage_failed" };
    } catch (e2) {
      console.error("Fallback base64 failed", e2);
      return { uploaded: false, reason: "both_failed" };
    }
  }
}

function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = (e) => rej(e);
    r.readAsDataURL(file);
  });
}

// ----- DB save helpers -----
async function saveCancelEntry(payload) {
  const node = dbRef(db, CANCEL_NODE);
  const p = push(node);
  await set(p, payload);
  return p.key;
}
async function saveRefundEntry(payload) {
  const node = dbRef(db, REFUND_NODE);
  const p = push(node);
  await set(p, payload);
  return p.key;
}

// ----- Submit handlers (separated flows) -----
async function submitCancel(orderKey, product) {
  const statusEl = document.getElementById("cp-cancel-status");
  try {
    const user = auth.currentUser;
    if (!user) { alert("Debes iniciar sesión para cancelar."); return; }

    let qty = Number(document.getElementById("cp-cancel-qty").value || 0);
    if (!qty || qty < 1) qty = (product.qty || 1);
    const note = String(document.getElementById("cp-cancel-note").value || "").trim();

    statusEl.textContent = "Enviando solicitud de cancelación...";

    const payload = {
      user: { uid: user.uid, email: user.email || "" },
      product: {
        key: product.productKey || product.key || product.id || String(product.name || ""),
        name: product.name || product.productName || "",
        qtyRequested: qty,
        price: product.price || null,
        raw: product.raw || product
      },
      orderKey: orderKey || "",
      // NO reason required for cancel per request
      note,
      createdAt: Date.now()
    };

    const cancelKey = await saveCancelEntry(payload);

    statusEl.textContent = "Cancelación registrada.";
    setTimeout(() => { closeCancelModal(); }, 900);
    return { ok: true, cancelKey };
  } catch (err) {
    console.error("submitCancel error", err);
    statusEl.textContent = "Error al enviar cancelación. Revisa la consola.";
    return { ok: false, error: err };
  }
}

async function submitRefund(orderKey, product) {
  const statusEl = document.getElementById("cp-refund-status");
  try {
    const user = auth.currentUser;
    if (!user) { alert("Debes iniciar sesión para solicitar reembolso."); return; }

    let qty = Number(document.getElementById("cp-refund-qty").value || 0);
    if (!qty || qty < 1) qty = (product.qty || 1);
    const note = String(document.getElementById("cp-refund-note").value || "").trim();
    const fileEl = document.getElementById("cp-refund-file");
    const file = fileEl && fileEl.files && fileEl.files[0];

    statusEl.textContent = "Enviando solicitud de reembolso...";

    const basePayload = {
      user: { uid: user.uid, email: user.email || "" },
      product: {
        key: product.productKey || product.key || product.id || String(product.name || ""),
        name: product.name || product.productName || "",
        qtyRequested: qty,
        price: product.price || null,
        raw: product.raw || product
      },
      orderKey: orderKey || "",
      note,
      refundRequested: true,
      status: "requested",
      createdAt: Date.now()
    };

    // Save a cancel record first (optional linking) — keep a cancel entry to track the cancellation itself
    // If you don't want this, you can remove this block. I keep it to keep a cancel record in cancel node.
    let cancelKey = null;
    try {
      cancelKey = await saveCancelEntry({
        ...basePayload,
        // mark that this cancel entry originated from refund request
        refundOrigin: true
      });
    } catch (e) {
      console.warn("Could not save cancel entry before refund, continuing:", e);
    }

    // upload evidence if provided
    let evidenceUrl = null;
    let evidenceBase64 = null;
    if (file) {
      statusEl.textContent = "Subiendo evidencia (si aplica)...";
      const uploadResult = await uploadEvidenceFile(file, user.uid);
      if (uploadResult.uploaded && uploadResult.url) evidenceUrl = uploadResult.url;
      else if (uploadResult.fallbackBase64) evidenceBase64 = uploadResult.fallbackBase64;
      else console.warn("No evidence saved", uploadResult);
    }

    const refundPayload = {
      ...basePayload,
      cancelRef: cancelKey || null,
      evidenceUrl: evidenceUrl || null,
      evidenceBase64: evidenceBase64 || null,
      createdAt: Date.now()
    };

    const refundKey = await saveRefundEntry(refundPayload);

    statusEl.textContent = "Solicitud de reembolso registrada.";
    setTimeout(() => { closeRefundModal(); }, 900);
    return { ok: true, refundKey, cancelKey };
  } catch (err) {
    console.error("submitRefund error", err);
    statusEl.textContent = "Error al enviar reembolso. Revisa la consola.";
    return { ok: false, error: err };
  }
}

// ----- Public API: open functions and attach helpers -----
export async function openCancelModalFor(orderKey, product = {}) {
  openCancelModalUI(orderKey, product);
}

export async function openRefundModalFor(orderKey, product = {}) {
  openRefundModalUI(orderKey, product);
}

// attach buttons by selector for convenience
export function attachCancelButtons(selector = ".btn-cancel-order") {
  const els = document.querySelectorAll(selector);
  els.forEach(el => {
    el.addEventListener("click", (e) => {
      const orderKey = el.dataset.orderKey || el.getAttribute("data-order-key");
      const productKey = el.dataset.productKey || el.getAttribute("data-product-key");
      const productName = el.dataset.productName || el.getAttribute("data-product-name");
      const productQty = el.dataset.productQty || el.getAttribute("data-product-qty");
      const productPrice = el.dataset.productPrice || el.getAttribute("data-product-price");

      const productObj = {
        productKey,
        name: productName,
        qty: productQty ? Number(productQty) : undefined,
        price: productPrice ? Number(productPrice) : undefined
      };
      openCancelModalFor(orderKey, productObj);
    });
  });
}

export function attachRefundButtons(selector = ".btn-refund-order") {
  const els = document.querySelectorAll(selector);
  els.forEach(el => {
    el.addEventListener("click", (e) => {
      const orderKey = el.dataset.orderKey || el.getAttribute("data-order-key");
      const productKey = el.dataset.productKey || el.getAttribute("data-product-key");
      const productName = el.dataset.productName || el.getAttribute("data-product-name");
      const productQty = el.dataset.productQty || el.getAttribute("data-product-qty");
      const productPrice = el.dataset.productPrice || el.getAttribute("data-product-price");

      const productObj = {
        productKey,
        name: productName,
        qty: productQty ? Number(productQty) : undefined,
        price: productPrice ? Number(productPrice) : undefined
      };
      openRefundModalFor(orderKey, productObj);
    });
  });
}

// default export convenience
export default {
  openCancelModalFor,
  openRefundModalFor,
  attachCancelButtons,
  attachRefundButtons
};
