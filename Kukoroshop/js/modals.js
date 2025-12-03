// js/modals.js
import { parsePriceNumber } from "./utils.js";
import { cart, setCart, saveCart } from "./state.js";
import {
  finalizePurchaseOnServer,
  refreshAllCardDisplays,
  updateCartUI,
  closeCartPopup,
  createOrderFromItems, // <-- ahora importado
} from "./cart.js";
import { WHATSAPP_NUMBER, API_URL } from "./config.js";

console.log('[modals.js] LOADED');

/* -------------------------
   Elementos del DOM (pueden ser null si el script corre antes del DOM)
   ------------------------- */
const imgModalOverlay =
  typeof document !== "undefined" ? document.getElementById("img-modal-overlay") : null;
const imgModalImg =
  typeof document !== "undefined" ? document.getElementById("img-modal-img") : null;
const imgModalClose =
  typeof document !== "undefined" ? document.getElementById("img-modal-close") : null;

/* -------------------------
   Helpers de proxificación (evitar doble proxy)
   ------------------------- */
function isAlreadyProxied(url) {
  if (!url) return false;
  try {
    const s = String(url);
    return s.startsWith(API_URL) || s.indexOf("image-proxy?url=") !== -1;
  } catch (e) {
    return false;
  }
}
function getProxiedIfNeeded(url) {
  if (!url) return "";
  const s = String(url);
  if (isAlreadyProxied(s)) return s;
  return API_URL.replace(/\/$/, "") + "/image-proxy?url=" + encodeURIComponent(s);
}

/* -------------------------
   Modal de imagen
   ------------------------- */
export function openImageModal(url, alt) {
  if (!url) return;
  if (!imgModalImg || !imgModalOverlay) {
    createImageModalNodes();
  }
  const final = getProxiedIfNeeded(url);
  const imgEl = document.getElementById("img-modal-img");
  const overlayEl = document.getElementById("img-modal-overlay");
  if (imgEl) {
    imgEl.alt = alt || "";
    imgEl.loading = "eager";
    imgEl.src = final;
    const onErr = function onErr() {
      imgEl.removeEventListener("error", onErr);
      let ph = document.querySelector(".img-modal-placeholder");
      if (!ph) {
        ph = document.createElement("div");
        ph.className = "img-modal-placeholder";
        ph.style.cssText = "color:#f88;padding:12px;font-size:1rem;background:transparent";
        ph.innerText = "Imagen no disponible";
        imgEl.parentNode && imgEl.parentNode.appendChild(ph);
      }
    };
    imgEl.addEventListener("error", onErr, { once: true });
  }
  if (overlayEl) {
    overlayEl.style.display = "flex";
    document.body.style.overflow = "hidden";
  }
}

export function closeImageModal() {
  const overlayEl = document.getElementById("img-modal-overlay");
  const imgEl = document.getElementById("img-modal-img");
  if (overlayEl) overlayEl.style.display = "none";
  if (imgEl) {
    imgEl.src = "";
    imgEl.alt = "";
    const ph = document.querySelector(".img-modal-placeholder");
    if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
  }
  document.body.style.overflow = "";
}

/* Si por alguna razón los nodos no existen al importar, los creamos (mínimo) */
function createImageModalNodes() {
  if (typeof document === "undefined") return;
  if (!document.getElementById("img-modal-overlay")) {
    const overlay = document.createElement("div");
    overlay.id = "img-modal-overlay";
    overlay.style =
      "display:none;position:fixed;inset:0;background:rgba(15,23,42,0.9);align-items:center;justify-content:center;z-index:20000";
    overlay.innerHTML =
      `<div style="position:relative;max-width:90vw;max-height:90vh;">
         <img id="img-modal-img" style="max-width:90vw;max-height:90vh;border-radius:12px;display:block" alt="" />
         <button id="img-modal-close" style="position:absolute;top:-8px;right:-8px;background:#111;border-radius:999px;border:1px solid #333;color:#fff;font-size:1.2rem;padding:6px 8px;cursor:pointer">×</button>
       </div>`;
    document.body.appendChild(overlay);
  }
  // refresh references and listeners
  const overlay = document.getElementById("img-modal-overlay");
  const img = document.getElementById("img-modal-img");
  const close = document.getElementById("img-modal-close");
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeImageModal();
    });
  }
  if (close) close.addEventListener("click", closeImageModal);
}

/* conectar listeners si existen nodos */
if (imgModalClose) imgModalClose.addEventListener("click", closeImageModal);
if (imgModalOverlay) {
  imgModalOverlay.addEventListener("click", (e) => {
    if (e.target === imgModalOverlay) closeImageModal();
  });
}

/* -------------------------
   Pago con tarjeta + OTP (crear modales si faltan)
   ------------------------- */

function ensureCardModalBase() {
  if (typeof document === "undefined") return;
  if (!document.getElementById("card-modal-overlay")) {
    const div = document.createElement("div");
    div.id = "card-modal-overlay";
    div.style =
      "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:20000";
    div.innerHTML = `
      <div style="background:#0b0b0b;padding:16px;border-radius:12px;width:520px;max-width:96%;color:#eee">
        <h3>Pagar con tarjeta</h3>
        <div id="card-errors" style="color:#f66;margin-bottom:8px"></div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label>Nombre completo<input id="card-name" style="width:100%;padding:8px;border-radius:6px;background:#111;border:1px solid #222;color:#fff" /></label>
          <label>Correo<input id="card-email" type="email" style="width:100%;padding:8px;border-radius:6px;background:#111;border:1px solid #222;color:#fff" /></label>
          <label>Teléfono<input id="card-phone" style="width:100%;padding:8px;border-radius:6px;background:#111;border:1px solid #222;color:#fff" /></label>
          <label>Dirección<textarea id="card-address" rows="2" style="width:100%;padding:8px;border-radius:6px;background:#111;border:1px solid #222;color:#fff"></textarea></label>
          <hr style="border:none;border-top:1px solid #222" />
          <label>Número de tarjeta<input id="card-number" placeholder="4242 4242 4242 4242" style="width:100%;padding:8px;border-radius:6px;background:#111;border:1px solid #222;color:#fff" /></label>
          <div style="display:flex;gap:8px">
            <label style="flex:1">MM/AA<input id="card-exp" placeholder="08/28" style="width:100%;padding:8px;border-radius:6px;background:#111;border:1px solid #222;color:#fff" /></label>
            <label style="width:120px">CVV<input id="card-cvv" placeholder="123" style="width:100%;padding:8px;border-radius:6px;background:#111;border:1px solid #222;color:#fff" /></label>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="card-cancel" style="padding:8px;border-radius:6px;background:transparent;border:1px solid #333;color:#ddd">Cancelar</button>
            <button id="card-submit" style="padding:8px;border-radius:6px;background:#9D4EDD;color:#fff">Pagar ahora</button>
          </div>
          <div style="font-size:0.85rem;color:#aaa">En producción integra Stripe/Adyen y nunca almacenes CVV.</div>
        </div>
      </div>
    `;
    document.body.appendChild(div);
  }

  if (!document.getElementById("otp-modal-overlay")) {
    const o = document.createElement("div");
    o.id = "otp-modal-overlay";
    o.style =
      "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:21000";
    o.innerHTML = `
      <div style="background:#0b0b0b;padding:16px;border-radius:12px;width:360px;color:#eee">
        <h4>3D Secure — Código OTP</h4>
        <p style="color:#aaa">Ingresa el código OTP (para pruebas usa <strong>123456</strong>).</p>
        <input id="otp-input" placeholder="Código OTP" style="padding:8px;border-radius:6px;background:#111;border:1px solid #222;color:#fff;width:100%" />
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button id="otp-cancel" style="padding:8px;border-radius:6px;background:transparent;border:1px solid #333;color:#ddd">Cancelar</button>
          <button id="otp-confirm" style="padding:8px;border-radius:6px;background:#9D4EDD;color:#fff">Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(o);
  }

  const cardCancel = document.getElementById("card-cancel");
  if (cardCancel) cardCancel.addEventListener("click", closeCardPaymentModal);
}
ensureCardModalBase();

/* -------------------------
   Validaciones de tarjeta (Luhn + campos)
   ------------------------- */
function luhnCheck(num) {
  const s = String(num).replace(/\D/g, "");
  if (!s) return false;
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    const d = Number(s.charAt(i));
    if (Number.isNaN(d)) return false;
    let v = d;
    if (alt) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function validateCardInputs() {
  const name = document.getElementById("card-name")?.value || "";
  const email = document.getElementById("card-email")?.value || "";
  const phone = document.getElementById("card-phone")?.value || "";
  const addr = document.getElementById("card-address")?.value || "";
  const number = document.getElementById("card-number")?.value.replace(/\s+/g, "") || "";
  const exp = document.getElementById("card-exp")?.value || "";
  const cvv = document.getElementById("card-cvv")?.value || "";

  if (!name || !email || !phone || !addr) return "Completa tus datos personales.";
  if (!number || number.length < 12) return "Número de tarjeta inválido.";
  if (!luhnCheck(number)) return "Número de tarjeta no pasa Luhn.";
  if (!exp || !/^(0[1-9]|1[0-2])\/(\d{2})$/.test(exp)) return "Formato MM/AA inválido.";
  const [mmStr, yyStr] = exp.split("/");
  const mm = Number(mmStr);
  const yy = Number(yyStr);
  const now = new Date();
  const yearFull = 2000 + yy;
  const expDate = new Date(yearFull, mm - 1, 1);
  if (expDate.getFullYear() < now.getFullYear() || (expDate.getFullYear() === now.getFullYear() && mm - 1 < now.getMonth()))
    return "La tarjeta está vencida.";
  if (!cvv || cvv.length < 3) return "CVV inválido.";

  return null;
}

/* -------------------------
   Apertura/Cierre modal de pago
   ------------------------- */
export function openCardPaymentModal() {
  if (!Array.isArray(cart) || cart.length === 0) {
    alert("El carrito está vacío");
    return;
  }
  const errEl = document.getElementById("card-errors");
  if (errEl) errEl.innerText = "";
  ["card-name", "card-email", "card-phone", "card-address", "card-number", "card-exp", "card-cvv"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const overlay = document.getElementById("card-modal-overlay");
  if (overlay) {
    overlay.style.display = "flex";
    document.body.style.overflow = "hidden";
  }
}

export function closeCardPaymentModal() {
  const overlay = document.getElementById("card-modal-overlay");
  if (overlay) overlay.style.display = "none";
  document.body.style.overflow = "";
}

/* -------------------------
   Document-level listeners (pagar / OTP / enviar WhatsApp)
   ------------------------- */
document.addEventListener("click", (e) => {
  if (!e.target) return;

  // Pagar: abrir OTP luego de validar
  if (e.target.id === "card-submit") {
    const err = validateCardInputs();
    const errEl = document.getElementById("card-errors");
    if (err) {
      if (errEl) errEl.innerText = err;
      return;
    }
    const amount = (Array.isArray(cart) ? cart : []).reduce((s, i) => s + parsePriceNumber(i._priceNum !== undefined ? i._priceNum : i.price) * Number(i.qty || 0), 0);
    const customer = {
      name: (document.getElementById("card-name") || {}).value?.trim() || "",
      email: (document.getElementById("card-email") || {}).value?.trim() || "",
      phone: (document.getElementById("card-phone") || {}).value?.trim() || "",
      address: (document.getElementById("card-address") || {}).value?.trim() || "",
    };
    window._pendingPayment = { items: JSON.parse(JSON.stringify(cart || [])), customer, amount };
    console.log('[modals] pendingPayment creado:', window._pendingPayment);
    const otp = document.getElementById("otp-modal-overlay");
    if (otp) otp.style.display = "flex";
  }

  if (e.target.id === "card-cancel") {
    closeCardPaymentModal();
  }
});

document.addEventListener("click", async (e) => {
  if (!e.target) return;

  // OTP Confirm
  if (e.target.id === "otp-confirm") {
    const code = (document.getElementById("otp-input") || {}).value || "";
    const otpOverlay = document.getElementById("otp-modal-overlay");
    const cardOverlay = document.getElementById("card-modal-overlay");

    if (!code) {
      alert("Ingresa el código OTP");
      return;
    }
    if (code !== "123456") {
      alert("Pago fallido: OTP incorrecto.");
      if (otpOverlay) otpOverlay.style.display = "none";
      if (cardOverlay) cardOverlay.style.display = "none";
      document.body.style.overflow = "";
      return;
    }

    const items = (window._pendingPayment && window._pendingPayment.items) || [];
    console.log('[modals] OTP confirm - items:', items);

    let result = { successes: [], failures: [] };
    try {
      const res = await finalizePurchaseOnServer(items);
      // compatibilidad con distintas formas de retorno
      if (Array.isArray(res)) {
        result.failures = res;
      } else if (res && Array.isArray(res.failures) && Array.isArray(res.successes)) {
        result = res;
      } else if (res && Array.isArray(res.failures)) {
        result.failures = res.failures;
      } else {
        result.successes = res.successes || [];
        result.failures = res.failures || [];
      }
      console.log('[modals] finalizePurchaseOnServer result:', result);
    } catch (err) {
      console.error('[modals] finalizePurchaseOnServer threw:', err);
      result = { successes: [], failures: items.map(it => ({ item: it, reason: String(err) })) };
    }

    // Si hubo éxitos, eliminarlos del carrito local y actualizar UI
    try {
      if (Array.isArray(result.successes) && result.successes.length > 0) {
        const successKeys = result.successes.map(s => `${s.item.sheetKey}::${s.item.row}`);
        for (let i = cart.length - 1; i >= 0; i--) {
          const key = `${cart[i].sheetKey}::${cart[i].row}`;
          if (successKeys.includes(key)) cart.splice(i, 1);
        }
        setCart(cart);
        saveCart();
        updateCartUI();
        refreshAllCardDisplays();
      }
    } catch (e) {
      console.error('[modals] error processing successes:', e);
    }

    // Manejo final según fallos
    const failures = result.failures || [];
    if (failures.length === 0) {
      // ----------------------------------------------------------------
      // TODO: crear orden en Firebase con los items pagados (siempre que haya)
      // ----------------------------------------------------------------
      const paidItems = (result.successes && result.successes.length) ? result.successes.map(s => s.item) : items;
      try {
        console.log('[modals] intentando crear orden en Firebase (card) con paidItems:', paidItems);
        const createRes = await createOrderFromItems(paidItems);
        if (createRes && createRes.ok) {
          console.log('[modals] orden creada OK en Firebase (card):', createRes.firebaseKey);
          window._lastFirebaseOrderKey = createRes.firebaseKey;
          try { localStorage.setItem('wyvern_pending_order', createRes.firebaseKey); } catch(e){}
        } else {
          console.warn('[modals] createOrderFromItems devolvió error (card):', createRes && createRes.error);
        }
      } catch (err) {
        console.error('[modals] fallo creando orden en Firebase (card):', err);
      }

      alert("Pago confirmado. Gracias por tu compra.");
      // limpiar pendientes y cerrar UI
      window._pendingPayment = null;
      if (otpOverlay) otpOverlay.style.display = "none";
      if (cardOverlay) cardOverlay.style.display = "none";
      document.body.style.overflow = "";
      try { closeCartPopup(); } catch (e) {}
      return;
    }

    // Hay fallos (parciales o totales)
    const paidCount = (result.successes || []).length;
    const failedCount = failures.length;
    if (paidCount > 0) {
      const proceed = confirm(`Se completaron ${paidCount} productos, pero fallaron ${failedCount}. ¿Deseas enviar los productos reservados por WhatsApp ahora?`);
      if (proceed) {
        const paidItems = result.successes.map(s => s.item);

        // intentamos crear orden parcial en Firebase antes de abrir WA
        try {
          console.log('[modals] intentando crear orden parcial en Firebase (card) con paidItems:', paidItems);
          const createResPartial = await createOrderFromItems(paidItems);
          if (createResPartial && createResPartial.ok) {
            console.log('[modals] orden parcial creada OK en Firebase (card):', createResPartial.firebaseKey);
            window._lastFirebaseOrderKey = createResPartial.firebaseKey;
            try { localStorage.setItem('wyvern_pending_order', createResPartial.firebaseKey); } catch(e){}
          } else {
            console.warn('[modals] createOrderFromItems partial devolvió error (card):', createResPartial && createResPartial.error);
          }
        } catch (err) {
          console.error('[modals] fallo creando orden parcial en Firebase (card):', err);
        }

        let message = "*Pedido (parcial) - WyvernStore*%0A%0A";
        let total = 0;
        paidItems.forEach(p => {
          const itemTotal = parsePriceNumber(p._priceNum !== undefined ? p._priceNum : p.price) * Number(p.qty || 0);
          total += itemTotal;
          message += `*${p.name}*%0A   Cantidad: ${p.qty}%0A   Precio: ${Number(itemTotal).toLocaleString("de-DE")}%0A%0A`;
        });
        message += `*TOTAL: ${Number(total).toLocaleString("de-DE")}*%0A%0A`;
        window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(decodeURIComponent(message))}`, "_blank");
      } else {
        alert("Se sincronizará la página para mostrar los stocks reales de los productos que fallaron.");
      }
    } else {
      alert("Hubo un problema actualizando stock para todos los productos. Se sincronizará la página.");
    }

    // cerrar modales OTP y pago
    if (otpOverlay) otpOverlay.style.display = "none";
    if (cardOverlay) cardOverlay.style.display = "none";
    document.body.style.overflow = "";
    window._pendingPayment = null;
    try { refreshAllCardDisplays(); } catch (e) {}
    try { updateCartUI(); } catch (e) {}
    try { if (!cart.length) closeCartPopup(); } catch(e){}
  }

  // OTP cancel
  if (e.target.id === "otp-cancel") {
    const otpOverlay = document.getElementById("otp-modal-overlay");
    const cardOverlay = document.getElementById("card-modal-overlay");
    if (otpOverlay) otpOverlay.style.display = "none";
    if (cardOverlay) cardOverlay.style.display = "none";
    document.body.style.overflow = "";
  }
});

/* -------------------------
   WhatsApp (finalizar pedido y abrir WA) - ahora maneja éxitos parciales
   ------------------------- */
export async function sendToWhatsApp(lastProductsCache) {
  if (!Array.isArray(cart) || cart.length === 0) {
    alert("El carrito está vacío");
    return;
  }

  const buildMessageFromItems = (items) => {
    let message = "*Nuevo Pedido - WyvernStore*%0A%0A";
    let total = 0;
    items.forEach((item) => {
      const itemTotal = parsePriceNumber(item._priceNum !== undefined ? item._priceNum : item.price) * Number(item.qty || 0);
      total += itemTotal;
      message += `*${item.name}*%0A   Cantidad: ${item.qty}%0A   Precio: ${Number(itemTotal).toLocaleString("de-DE")}%0A%0A`;
    });
    message += `*TOTAL: ${Number(total).toLocaleString("de-DE")}*%0A%0A`;
    return message;
  };

  let result = { successes: [], failures: [] };
  try {
    const res = await finalizePurchaseOnServer(cart, lastProductsCache);
    if (Array.isArray(res)) {
      result.failures = res;
    } else if (res && Array.isArray(res.failures) && Array.isArray(res.successes)) {
      result = res;
    } else if (res && Array.isArray(res.failures)) {
      result.failures = res.failures;
    } else {
      result.successes = res.successes || [];
      result.failures = res.failures || [];
    }
  } catch (e) {
    result = { successes: [], failures: cart.map(it => ({ item: it, reason: String(e) })) };
  }

  if (Array.isArray(result.successes) && result.successes.length > 0) {
    const successKeys = result.successes.map(s => `${s.item.sheetKey}::${s.item.row}`);
    for (let i = cart.length - 1; i >= 0; i--) {
      const key = `${cart[i].sheetKey}::${cart[i].row}`;
      if (successKeys.includes(key)) cart.splice(i, 1);
    }
    setCart(cart);
    saveCart();
    updateCartUI();
    refreshAllCardDisplays();
  }

  const failures = result.failures || [];
  if (!failures.length) {
    const paidItems = result.successes.length ? result.successes.map(s => s.item) : (Array.isArray(cart) ? cart : []);
    const msgItems = paidItems.length ? paidItems : (result.successes.length ? [] : (Array.isArray(cart) ? cart : []));
    const message = buildMessageFromItems(msgItems.length ? msgItems : (result.successes.length ? msgItems : []));
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(decodeURIComponent(message))}`, "_blank");
    try { saveCart(); } catch(e){}
    try { updateCartUI(); } catch(e){}
    try { refreshAllCardDisplays(); } catch(e){}
    if (!cart.length) try { closeCartPopup(); } catch(e){}
    return;
  }

  const paidCount = (result.successes || []).length;
  const failedCount = failures.length;
  if (paidCount > 0) {
    const proceed = confirm(`Se reservaron ${paidCount} productos correctamente, pero fallaron ${failedCount}. ¿Deseas enviar por WhatsApp solo los reservados ahora?`);
    if (proceed) {
      const paidItems = result.successes.map(s => s.item);
      const message = buildMessageFromItems(paidItems);
      window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(decodeURIComponent(message))}`, "_blank");
      saveCart();
      updateCartUI();
      refreshAllCardDisplays();
      if (!cart.length) try { closeCartPopup(); } catch(e){}
      return;
    } else {
      alert("Se sincronizará la página para mostrar stocks reales de los productos fallidos.");
      refreshAllCardDisplays();
      return;
    }
  }

  const proceedAll = confirm("No fue posible actualizar el stock en el servidor para algunos productos. ¿Deseas enviar el pedido de todas maneras?");
  if (!proceedAll) {
    refreshAllCardDisplays();
    return;
  }
  const fallbackMessage = buildMessageFromItems(cart);
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(decodeURIComponent(fallbackMessage))}`, "_blank");
  saveCart();
  updateCartUI();
  refreshAllCardDisplays();
}
