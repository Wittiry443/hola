// js/cancel-product.js
// Guardar solicitudes de cancelación y reembolsos en Realtime DB under /cancelproduct/{cancel,refund}
// Usa Firebase Realtime DB y (opcional) Firebase Storage para subir evidencia (imagen).
//
// Requisitos: ./firebase.js debe exportar `auth` y `db` (compat con el resto del proyecto).
// CDN imports usan Firebase v11 (igual que en tus otros scripts).
//
// Integración: llamar openCancelModalFor(orderKey, productObj) desde la UI
// o usar attachCancelButtons(selector) para enlazar botones que tengan:
//  data-order-key, data-product-key, data-product-name, data-product-qty (opcional)
//

import { auth } from "./firebase.js";
import { db } from "./firebase.js";
import { ref as dbRef, push, set } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// ----------------- Config -----------------
const ROOT_NODE = "cancelproduct";
const CANCEL_NODE = `${ROOT_NODE}/cancel`;
const REFUND_NODE = `${ROOT_NODE}/refund`;

// estilos del modal (tema oscuro coherente con tus estilos)
(function injectCancelStyles() {
  if (document.getElementById("cancel-product-styles")) return;
  const s = document.createElement("style");
  s.id = "cancel-product-styles";
  s.textContent = `
    .cp-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:120000;padding:12px;}
    .cp-modal{width:100%;max-width:720px;background:#020617;border-radius:10px;padding:16px;border:1px solid rgba(148,163,184,0.06);color:#e5e7eb;box-shadow:0 12px 50px rgba(2,6,23,0.7);font-family:system-ui,Segoe UI,Roboto}
    .cp-row{display:flex;gap:10px;align-items:center;margin-top:8px}
    .cp-field{width:100%;padding:10px;border-radius:8px;background:rgba(15,23,42,0.6);border:1px solid rgba(148,163,184,0.04);color:#e5e7eb}
    .cp-label{font-size:13px;color:#9ca3af;margin-bottom:6px}
    .cp-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
    .cp-btn{padding:8px 12px;border-radius:8px;border:none;cursor:pointer}
    .cp-cancel{background:transparent;border:1px solid rgba(148,163,184,0.06);color:#e5e7eb}
    .cp-submit{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff}
    .cp-note{font-size:13px;color:#9ca3af;margin-top:6px}
    .cp-preview{margin-top:8px;max-width:160px;border-radius:6px;border:1px solid rgba(148,163,184,0.03)}
  `;
  document.head.appendChild(s);
})();

// Crear modal global si no existe
(function createCancelModal() {
  if (document.getElementById("cp-overlay")) return;

  const html = `
    <div id="cp-overlay" class="cp-overlay" aria-hidden="true">
      <div class="cp-modal" role="dialog" aria-modal="true" aria-labelledby="cp-title">
        <h3 id="cp-title" style="margin:0 0 6px 0">Cancelar producto / Solicitar reembolso</h3>

        <div id="cp-context" style="font-size:14px;color:#cbd5e1;margin-bottom:8px"></div>

        <div>
          <div class="cp-label">Motivo</div>
          <select id="cp-reason" class="cp-field">
            <option value="cambio">Cambio de opinión</option>
            <option value="pedido-error">Producto equivocado en el pedido</option>
            <option value="llegada-tardia">Llegada tardía</option>
            <option value="producto-danado">Producto dañado</option>
            <option value="otro">Otro</option>
          </select>
        </div>

        <div style="margin-top:8px">
          <div class="cp-label">Cantidad a cancelar</div>
          <input id="cp-qty" type="number" min="1" class="cp-field" />
        </div>

        <div style="margin-top:8px">
          <div class="cp-label">Notas (opcional)</div>
          <textarea id="cp-note" class="cp-field" rows="3" placeholder="Explica brevemente por qué deseas cancelar o pedir reembolso..."></textarea>
        </div>

        <div style="margin-top:8px;display:flex;gap:12px;align-items:center">
          <label style="display:flex;gap:8px;align-items:center;color:#cbd5e1">
            <input id="cp-refund-checkbox" type="checkbox" />
            <span>Solicitar reembolso (subir evidencia)</span>
          </label>
        </div>

        <div id="cp-evidence-area" style="display:none;margin-top:8px">
          <div class="cp-label">Evidencia (imagen opcional)</div>
          <input id="cp-evidence-file" type="file" accept="image/*" class="cp-field" />
          <img id="cp-evidence-preview" class="cp-preview" src="" alt="Preview" style="display:none" />
          <div class="cp-note">Sube una foto del producto dañado, paquete abierto, o falta del artículo (opcional).</div>
        </div>

        <div id="cp-status" style="margin-top:8px;font-size:13px;color:#9ca3af"></div>

        <div class="cp-actions">
          <button id="cp-cancel-btn" class="cp-btn cp-cancel">Cancelar</button>
          <button id="cp-submit-btn" class="cp-btn cp-submit">Enviar solicitud</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", html);

  // Handlers
  const overlay = document.getElementById("cp-overlay");
  const cancelBtn = document.getElementById("cp-cancel-btn");
  const refundCb = document.getElementById("cp-refund-checkbox");
  const evidenceArea = document.getElementById("cp-evidence-area");
  const fileInput = document.getElementById("cp-evidence-file");
  const preview = document.getElementById("cp-evidence-preview");

  cancelBtn.addEventListener("click", () => {
    overlay.style.display = "none";
    overlay.setAttribute("aria-hidden", "true");
    clearModal();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden", "true");
      clearModal();
    }
  });

  refundCb.addEventListener("change", () => {
    evidenceArea.style.display = refundCb.checked ? "block" : "none";
  });

  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) {
      preview.style.display = "none";
      preview.src = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      preview.src = ev.target.result;
      preview.style.display = "block";
    };
    reader.readAsDataURL(f);
  });
})();

// limpiar modal
function clearModal() {
  document.getElementById("cp-reason").value = "cambio";
  document.getElementById("cp-qty").value = "";
  document.getElementById("cp-note").value = "";
  document.getElementById("cp-refund-checkbox").checked = false;
  document.getElementById("cp-evidence-area").style.display = "none";
  const f = document.getElementById("cp-evidence-file");
  if (f) f.value = "";
  const p = document.getElementById("cp-evidence-preview");
  if (p) { p.src = ""; p.style.display = "none";}
  document.getElementById("cp-status").innerText = "";
  document.getElementById("cp-context").innerText = "";
}

// ---------- Helpers DB & Storage ----------
async function uploadEvidenceFile(file, uid) {
  // intenta subir a Firebase Storage si está disponible; si no, fallback a base64
  if (!file) return { uploaded: false, reason: "no_file" };

  try {
    // preferimos usar el storage por defecto (getStorage())
    const storage = getStorage(); // usa app por defecto inicializado en firebase.js
    const ts = Date.now();
    const safeName = file.name ? file.name.replace(/\s+/g, "_") : `evidence_${ts}`;
    const path = `${ROOT_NODE}/evidence/${uid}/${ts}_${safeName}`;
    const sRef = storageRef(storage, path);
    // convertir a ArrayBuffer y subir
    const arrayBuffer = await file.arrayBuffer();
    const snap = await uploadBytes(sRef, new Uint8Array(arrayBuffer), { contentType: file.type || "image/jpeg" });
    const url = await getDownloadURL(sRef);
    return { uploaded: true, storagePath: path, url };
  } catch (err) {
    console.warn("uploadEvidenceFile: Storage upload failed, will fallback to base64:", err);
    // fallback: leer base64
    try {
      const base64 = await readFileAsDataURL(file);
      return { uploaded: false, fallbackBase64: base64, reason: "storage_failed" };
    } catch (e2) {
      console.error("uploadEvidenceFile fallback error", e2);
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

// Guardar entrada de cancel y refund en DB
async function saveCancelEntry(payload) {
  const nodeRef = dbRef(db, CANCEL_NODE);
  const p = push(nodeRef);
  await set(p, payload);
  return p.key;
}
async function saveRefundEntry(payload) {
  const nodeRef = dbRef(db, REFUND_NODE);
  const p = push(nodeRef);
  await set(p, payload);
  return p.key;
}

// ---------- Modal flow: open + submit ----------
/*
 product object example (what orders.js should pass per item):
 {
   productKey: "marvel::123",
   name: "Spider-man ...",
   qty: 1,
   price: 123.45,
   raw: { ... original item ... } // optional
 }
 orderKey: string ID of the order
*/
export async function openCancelModalFor(orderKey, product = {}) {
  const overlay = document.getElementById("cp-overlay");
  if (!overlay) {
    console.error("cancel-product: modal not found in DOM");
    return;
  }

  // populate context
  const ctx = document.getElementById("cp-context");
  const productLabel = `${product.name || product.productName || product.productKey || "Producto"}`;
  const qtyDefault = product.qty || product.quantity || product.cantidad || 1;
  document.getElementById("cp-reason").value = "cambio";
  document.getElementById("cp-qty").value = qtyDefault;
  document.getElementById("cp-note").value = "";
  document.getElementById("cp-refund-checkbox").checked = false;
  document.getElementById("cp-evidence-area").style.display = "none";
  document.getElementById("cp-evidence-file").value = "";
  document.getElementById("cp-evidence-preview").style.display = "none";
  document.getElementById("cp-status").innerText = "";

  ctx.innerText = `Producto: ${productLabel} · Pedido: ${orderKey || "—"}`;
  overlay.style.display = "flex";
  overlay.setAttribute("aria-hidden", "false");

  // bind submit
  const submit = document.getElementById("cp-submit-btn");
  submit.onclick = async () => {
    await handleSubmitCancel(orderKey, product);
  };
}

// submit handler
async function handleSubmitCancel(orderKey, product) {
  const overlay = document.getElementById("cp-overlay");
  const statusEl = document.getElementById("cp-status");
  try {
    const user = auth.currentUser;
    if (!user) {
      alert("Debes iniciar sesión para solicitar cancelación o reembolso.");
      return;
    }

    const reason = String(document.getElementById("cp-reason").value || "otro");
    let qty = Number(document.getElementById("cp-qty").value || 0);
    if (!qty || qty < 1) qty = (product.qty || 1);
    const note = String(document.getElementById("cp-note").value || "").trim();
    const wantsRefund = Boolean(document.getElementById("cp-refund-checkbox").checked);
    const fileInput = document.getElementById("cp-evidence-file");
    const file = fileInput && fileInput.files && fileInput.files[0];

    statusEl.innerText = "Enviando solicitud...";

    // construir objeto base
    const basePayload = {
      user: { uid: user.uid, email: user.email || "" },
      product: {
        key: product.productKey || product.key || product.id || product.sku || product.name,
        name: product.name || product.productName || "",
        qtyRequested: qty,
        price: product.price || product.precio || null,
        raw: product.raw || product
      },
      orderKey: orderKey || "",
      reason,
      note,
      createdAt: Date.now()
    };

    // 1) guardar entrada de cancel
    const cancelKey = await saveCancelEntry(basePayload);

    // 2) si pidió reembolso, subir evidencia y guardar en refund node
    let refundKey = null;
    if (wantsRefund) {
      statusEl.innerText = "Subiendo evidencia (si proporcionada) y solicitando reembolso...";
      let evidenceUrl = null;
      let evidenceBase64 = null;
      if (file) {
        const uploadResult = await uploadEvidenceFile(file, user.uid);
        if (uploadResult.uploaded && uploadResult.url) {
          evidenceUrl = uploadResult.url;
        } else if (uploadResult.fallbackBase64) {
          evidenceBase64 = uploadResult.fallbackBase64;
        } else {
          // no evidence stored, proceed without it
          console.warn("No se pudo subir la evidencia, continuando sin ella.", uploadResult);
        }
      }

      const refundPayload = {
        ...basePayload,
        cancelRef: cancelKey,
        refundRequested: true,
        evidenceUrl: evidenceUrl || null,
        evidenceBase64: evidenceBase64 || null,
        status: "requested",
        createdAt: Date.now()
      };

      refundKey = await saveRefundEntry(refundPayload);
    }

    statusEl.innerText = "Solicitud enviada correctamente.";
    // opcional: pequeña confirmación para el usuario
    setTimeout(() => {
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden", "true");
      clearModal();
    }, 900);

    // retorno útil para quien llame la función
    return { ok: true, cancelKey, refundKey };
  } catch (err) {
    console.error("handleSubmitCancel error", err);
    document.getElementById("cp-status").innerText = "Error enviando la solicitud. Revisa la consola.";
    return { ok: false, error: err };
  }
}

// Convenience: buscar y conectar botones que disparen cancel modal
// selector: CSS selector contenedor o botón (ej. '.btn-cancel-product')
// Se espera que cada botón tenga atributos:
// data-order-key, data-product-key, data-product-name, data-product-qty (opcional)
// si tu UI tiene distinta estructura, llama openCancelModalFor manualmente.
export function attachCancelButtons(selector = ".btn-cancel-product") {
  const container = document.querySelectorAll(selector);
  container.forEach(btn => {
    btn.addEventListener("click", (e) => {
      const el = e.currentTarget;
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

// export default utilities
export default {
  openCancelModalFor,
  attachCancelButtons,
  handleSubmitCancel // exportada por si quieres llamar programáticamente
};
