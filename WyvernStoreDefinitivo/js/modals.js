// js/modals.js
import { parsePriceNumber } from "./utils.js";
import { cart, setCart, saveCart } from "./state.js";
import {
  finalizePurchaseOnServer,
  refreshAllCardDisplays,
  updateCartUI
} from "./cart.js";
import { WHATSAPP_NUMBER } from "./config.js";

const imgModalOverlay = document.getElementById("img-modal-overlay");
const imgModalImg = document.getElementById("img-modal-img");
const imgModalClose = document.getElementById("img-modal-close");

export function openImageModal(url, alt) {
  if (!url) return;
  imgModalImg.src = url;
  imgModalImg.alt = alt || "";
  if (imgModalOverlay) imgModalOverlay.style.display = "flex";
  document.body.style.overflow = "hidden";
}

export function closeImageModal() {
  if (imgModalOverlay) imgModalOverlay.style.display = "none";
  if (imgModalImg) imgModalImg.src = "";
  document.body.style.overflow = "";
}

if (imgModalClose) imgModalClose.addEventListener("click", closeImageModal);
if (imgModalOverlay)
  imgModalOverlay.addEventListener("click", e => {
    if (e.target === imgModalOverlay) closeImageModal();
  });

/* ==== Pago con tarjeta + OTP ==== */

function ensureCardModalBase() {
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
}
ensureCardModalBase();

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
  const number =
    document.getElementById("card-number")?.value.replace(/\s+/g, "") || "";
  const exp = document.getElementById("card-exp")?.value || "";
  const cvv = document.getElementById("card-cvv")?.value || "";

  if (!name || !email || !phone || !addr)
    return "Completa tus datos personales.";
  if (!number || number.length < 12) return "Número de tarjeta inválido.";
  if (!luhnCheck(number)) return "Número de tarjeta no pasa Luhn.";
  if (!exp || !/^(0[1-9]|1[0-2])\/(\d{2})$/.test(exp))
    return "Formato MM/AA inválido.";
  const [mmStr, yyStr] = exp.split("/");
  const mm = Number(mmStr);
  const yy = Number(yyStr);
  const now = new Date();
  const yearFull = 2000 + yy;
  const expDate = new Date(yearFull, mm - 1, 1);
  if (
    expDate.getFullYear() < now.getFullYear() ||
    (expDate.getFullYear() === now.getFullYear() && mm - 1 < now.getMonth())
  )
    return "La tarjeta está vencida.";
  if (!cvv || cvv.length < 3) return "CVV inválido.";

  return null;
}

export function openCardPaymentModal() {
  if (!cart.length) {
    alert("El carrito está vacío");
    return;
  }
  const errEl = document.getElementById("card-errors");
  if (errEl) errEl.innerText = "";
  ["card-name", "card-email", "card-phone", "card-address", "card-number", "card-exp", "card-cvv"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const overlay = document.getElementById("card-modal-overlay");
  if (overlay) overlay.style.display = "flex";
  document.body.style.overflow = "hidden";
}

export function closeCardPaymentModal() {
  const overlay = document.getElementById("card-modal-overlay");
  if (overlay) overlay.style.display = "none";
  document.body.style.overflow = "";
}

document.addEventListener("click", e => {
  if (e.target && e.target.id === "card-submit") {
    const err = validateCardInputs();
    const errEl = document.getElementById("card-errors");
    if (err) {
      if (errEl) errEl.innerText = err;
      return;
    }
    const amount = cart.reduce(
      (s, i) =>
        s +
        parsePriceNumber(
          i._priceNum !== undefined ? i._priceNum : i.price
        ) *
          Number(i.qty || 0),
      0
    );
    const customer = {
      name: document.getElementById("card-name").value.trim(),
      email: document.getElementById("card-email").value.trim(),
      phone: document.getElementById("card-phone").value.trim(),
      address: document.getElementById("card-address").value.trim()
    };
    window._pendingPayment = {
      items: JSON.parse(JSON.stringify(cart)),
      customer,
      amount
    };
    const otp = document.getElementById("otp-modal-overlay");
    if (otp) otp.style.display = "flex";
  }
  if (e.target && e.target.id === "card-cancel") {
    closeCardPaymentModal();
  }
});

document.addEventListener("click", async e => {
  if (e.target && e.target.id === "otp-confirm") {
    const code = document.getElementById("otp-input")?.value || "";
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
    let failures = [];
    try {
      failures = await finalizePurchaseOnServer(items, []);
    } catch (err) {
      failures = items.slice();
    }

    if (failures.length === 0) {
      alert("Pago confirmado. Gracias por tu compra.");
      setCart([]);
      saveCart();
      updateCartUI();
      refreshAllCardDisplays([]);
      if (otpOverlay) otpOverlay.style.display = "none";
      if (cardOverlay) cardOverlay.style.display = "none";
      document.body.style.overflow = "";
    } else {
      alert(
        "Hubo un problema actualizando stock para algunos productos. Se sincronizará la página."
      );
      if (otpOverlay) otpOverlay.style.display = "none";
      if (cardOverlay) cardOverlay.style.display = "none";
      document.body.style.overflow = "";
    }
  }

  if (e.target && e.target.id === "otp-cancel") {
    const otpOverlay = document.getElementById("otp-modal-overlay");
    const cardOverlay = document.getElementById("card-modal-overlay");
    if (otpOverlay) otpOverlay.style.display = "none";
    if (cardOverlay) cardOverlay.style.display = "none";
    document.body.style.overflow = "";
  }
});

/* WhatsApp */
export async function sendToWhatsApp(lastProductsCache) {
  if (!cart.length) {
    alert("El carrito está vacío");
    return;
  }

  let message = "*Nuevo Pedido - WyvernStore*%0A%0A";
  let total = 0;
  cart.forEach(item => {
    const itemTotal =
      parsePriceNumber(
        item._priceNum !== undefined ? item._priceNum : item.price
      ) * Number(item.qty || 0);
    total += itemTotal;
    message += `*${item.name}*%0A   Cantidad: ${
      item.qty
    }%0A   Precio: ${Number(itemTotal).toLocaleString("de-DE")}%0A%0A`;
  });
  message += `*TOTAL: ${Number(total).toLocaleString(
    "de-DE"
  )}*%0A%0A`;

  let failures = [];
  try {
    failures = await finalizePurchaseOnServer(cart, lastProductsCache);
  } catch (e) {
    failures = cart.slice();
  }

  if (!failures.length) {
    window.open(
      `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
        decodeURIComponent(message)
      )}`,
      "_blank"
    );
  } else {
    const proceed = confirm(
      "No fue posible actualizar el stock en el servidor para algunos productos. ¿Deseas enviar el pedido de todas maneras?"
    );
    if (!proceed) return;
    window.open(
      `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
        decodeURIComponent(message)
      )}`,
      "_blank"
    );
  }

  setCart([]);
  saveCart();
  updateCartUI();
}
