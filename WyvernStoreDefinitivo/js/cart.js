// js/cart.js
import {
  cart,
  setCart,
  saveCart,
  normalizeProductKey,
  lastProductsCache,      // <- lo usamos en varias funciones
} from "./state.js";

import {
  parsePriceNumber,
  escapeHtml
} from "./utils.js";

import {
  updateStockOnServer_decrement,
  updateStockOnServer_set,
  fetchServerStock,
  applyNewStockToDOM,
  mapToAvailableSheetKey
} from "./stock.js";

const cartIconBtn = document.getElementById("cart-icon-btn");
const cartPopupOverlay = document.getElementById("cart-popup-overlay");
const cartPopup = document.getElementById("cart-popup");
const cartItemsContainer = document.getElementById("cart-items-container");
const cartTotalEl = document.getElementById("cart-total");
let cartActionsContainer = document.getElementById("cart-actions");

// ======================================
// HELPERS DE STOCK
// ======================================

export function getReservedQty(sheetKey, row) {
  return cart
    .filter(
      i =>
        (i.sheetKey || "").toString().trim().toLowerCase() ===
          (sheetKey || "").toString().trim().toLowerCase() &&
        String(i.row) === String(row)
    )
    .reduce((s, i) => s + Number(i.qty || 0), 0);
}

export function getOriginalStock(sheetKey, row, cache = lastProductsCache) {
  const pk = normalizeProductKey(sheetKey, row);

  // 1) intentar desde la tarjeta en DOM
  const card = Array.from(document.querySelectorAll(".product-card")).find(
    c =>
      c.dataset.productKey === pk ||
      normalizeProductKey(c.dataset.sheetKey, c.dataset.row) === pk
  );

  if (card) {
    if (card.dataset.serverStock !== undefined && card.dataset.serverStock !== "")
      return Number(card.dataset.serverStock || 0);
    if (card.dataset.origStock !== undefined && card.dataset.origStock !== "")
      return Number(card.dataset.origStock || 0);
  }

  // 2) intentar desde cache de productos
  const p =
    (cache || []).find(
      pp =>
        String(pp.row) === String(row) &&
        String(pp.sheetKey || "").toLowerCase() ===
          String(sheetKey || "").toLowerCase()
    ) || null;

  if (p) {
    const d = p.data || {};
    const stock =
      d.Stock || d.stock || d.cantidad || d.Cantidad || d.cantidadDisponible || 0;
    return Number(stock || 0);
  }

  return 0;
}

export function refreshCardStockDisplay(sheetKey, row, cache = lastProductsCache) {
  const pk = normalizeProductKey(sheetKey, row);
  const cards = Array.from(document.querySelectorAll(".product-card")).filter(
    c =>
      (c.dataset.productKey ||
        normalizeProductKey(c.dataset.sheetKey, c.dataset.row)) === pk
  );

  const origStock = getOriginalStock(sheetKey, row, cache);
  const reserved = getReservedQty(sheetKey, row);
  const avail = Math.max(0, origStock - reserved);

  cards.forEach(card => {
    const stockSpan = card.querySelector(".stockval");
    if (stockSpan) stockSpan.innerText = avail;
    const btn = card.querySelector(".product-btn");
    if (avail <= 0) {
      card.classList.add("out");
      card.style.opacity = "0.45";
      if (btn) btn.disabled = true;
    } else {
      card.classList.remove("out");
      card.style.opacity = "";
      if (btn) btn.disabled = false;
    }
  });
}

export function refreshAllCardDisplays() {
  document
    .querySelectorAll(".product-card")
    .forEach(c =>
      refreshCardStockDisplay(c.dataset.sheetKey, c.dataset.row, lastProductsCache)
    );
}

// ======================================
// CARRITO EN MEMORIA + ICONO
// ======================================

export function getCartItems() {
  return cart;
}

export function updateCartUI() {
  const count = cart.reduce((s, i) => s + Number(i.qty || 0), 0);
  const total = cart.reduce(
    (s, i) =>
      s +
      parsePriceNumber(
        i._priceNum !== undefined ? i._priceNum : i.price
      ) *
        Number(i.qty || 0),
    0
  );
  if (cartIconBtn) cartIconBtn.innerText = `Carrito (${count})`;
  saveCart();
  return total;
}

// Añadir desde tarjeta de producto
export async function addToCartFromCard(card, qty, cache = lastProductsCache, lastLoadedSheetKey) {
  const sheetKeyRaw = card.dataset.sheetKey || lastLoadedSheetKey || "UNKNOWN";
  const sheetKey = mapToAvailableSheetKey(sheetKeyRaw) || sheetKeyRaw;
  const row = card.dataset.row;
  const name =
    card.querySelector(".product-title")?.innerText || "Sin nombre";

  const priceRaw =
    card.dataset.price !== undefined
      ? card.dataset.price
      : card.querySelector(".product-price")?.innerText || "";
  const priceNum = parsePriceNumber(priceRaw);

  // 👇 NUEVO: obtenemos la URL de imagen asociada a la tarjeta
  const imgUrl = card.dataset.imgUrl || "";

  const origStock = getOriginalStock(sheetKey, row, cache);
  const reserved = getReservedQty(sheetKey, row);
  const available = Math.max(0, origStock - reserved);
  if (qty > available) {
    alert("No hay suficiente stock disponible.");
    return;
  }

  const key = `${sheetKey}::${row}`;
  const existing = cart.find(
    i => `${i.sheetKey}::${i.row}` === key
  );
  if (existing) {
    existing.qty = Math.min(origStock, existing.qty + qty);
  } else {
    cart.push({
      sheetKey,
      row,
      name,
      price: priceRaw,
      _priceNum: priceNum,
      qty,
      // 👇 guardamos la imagen en el carrito
      image: imgUrl
    });
  }
  setCart(cart);
  refreshCardStockDisplay(sheetKey, row, cache);
  updateCartUI();

  // intento de decremento en servidor
  updateStockOnServer_decrement(
    sheetKey,
    row,
    qty,
    getReservedQty,
    (sk, r) => refreshCardStockDisplay(sk, r, cache)
  ).catch(() => {});
}

// ======================================
// ELIMINAR DEL CARRITO
// ======================================

export function removeFromCart(idx) {
  if (idx < 0 || idx >= cart.length) return;
  const item = cart[idx];
  const sheetKey = item.sheetKey;
  const row = item.row;
  const removedQty = Number(item.qty || 0);

  cart.splice(idx, 1);
  setCart(cart);
  refreshCardStockDisplay(sheetKey, row, lastProductsCache);
  updateCartUI();
  openCartPopup(); // re-render popup

  // devolver stock al servidor
  (async () => {
    const mapped = mapToAvailableSheetKey(sheetKey) || sheetKey;
    const serverStock = await fetchServerStock(mapped, row);
    if (serverStock !== null) {
      const newStock = serverStock + removedQty;
      await updateStockOnServer_set(mapped, row, newStock);
      applyNewStockToDOM(mapped, row, newStock, getReservedQty);
      refreshCardStockDisplay(mapped, row, lastProductsCache);
    }
  })().catch(() => {});
}

// ======================================
// FINALIZAR COMPRA
// ======================================

export async function finalizePurchaseOnServer(items, cache = lastProductsCache) {
  const failures = [];
  if (!Array.isArray(items) || items.length === 0) return failures;

  const promises = items.map(async it => {
    const qty = Number(it.qty || 0);
    if (!qty) return { ok: true, item: it };
    const res = await updateStockOnServer_decrement(
      it.sheetKey,
      it.row,
      qty,
      getReservedQty,
      (sk, r) => refreshCardStockDisplay(sk, r, cache)
    );
    return { ok: !!res.ok, item: it };
  });

  const results = await Promise.all(promises);
  results.forEach(r => {
    if (!r.ok) failures.push(r.item);
  });
  return failures;
}

// ======================================
// POPUP DEL CARRITO
// ======================================

export function openCartPopup() {
  if (!cartPopupOverlay) return;

  if (cart.length === 0) {
    cartItemsContainer.innerHTML =
      '<p style="text-align:center;color:#999">Carrito vacío</p>';
    cartTotalEl.innerHTML = "";
    ensureCartActions();
    cartPopupOverlay.style.display = "flex";
    cartPopupOverlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    return;
  }

  let html = "";
  cart.forEach((item, idx) => {
    const itemTotal =
      parsePriceNumber(
        item._priceNum !== undefined ? item._priceNum : item.price
      ) * Number(item.qty || 0);

    // 👇 armamos la URL segura de imagen usando la función global
    const imgSrc = window.getSafeImageUrl
      ? window.getSafeImageUrl(item.image || "")
      : (item.image || "");

    html += `
      <div class="cart-item">
        <div class="cart-item-thumb" style="width:64px;height:64px;flex-shrink:0;margin-right:10px;border-radius:10px;overflow:hidden;background:#020617;display:flex;align-items:center;justify-content:center;">
          ${
            imgSrc
              ? `<img src="${imgSrc}" alt="${escapeHtml(item.name)}" style="width:100%;height:100%;object-fit:cover;" />`
              : `<span style="font-size:1.4rem;opacity:0.6">🖼️</span>`
          }
        </div>
        <div style="flex:1">
          <div style="font-weight:800">${escapeHtml(item.name)}</div>
          <div style="font-size:0.9rem;color:#aaa">
            x${item.qty} — ${Number(itemTotal).toLocaleString("de-DE")}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button
            title="Eliminar"
            style="background:transparent;border:none;color:#f66;cursor:pointer;font-weight:800"
            onclick="window._removeFromCart(${idx})"
          >
            ✕
          </button>
        </div>
      </div>
    `;
  });

  cartItemsContainer.innerHTML = html;
  const total = updateCartUI();
  cartTotalEl.innerHTML = `💰 Total: <span style="color:#9D4EDD">${Number(
    total
  ).toLocaleString("de-DE")}</span>`;

  ensureCartActions();
  cartPopupOverlay.style.display = "flex";
  cartPopupOverlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

export function closeCartPopup() {
  if (cartPopupOverlay) {
    cartPopupOverlay.style.display = "none";
    cartPopupOverlay.setAttribute("aria-hidden", "true");
  }
  document.body.style.overflow = "";
}

function ensureCartActions() {
  if (!cartActionsContainer) {
    cartActionsContainer =
      cartPopup.querySelector("#cart-actions") || document.createElement("div");
    cartActionsContainer.id = "cart-actions";
    cartPopup.appendChild(cartActionsContainer);
  }
  cartActionsContainer.innerHTML = "";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn-small btn-ghost";
  closeBtn.innerText = "Cerrar";
  closeBtn.onclick = closeCartPopup;
  cartActionsContainer.appendChild(closeBtn);

  const waBtn = document.createElement("button");
  waBtn.id = "cart-wa-btn-generated";
  waBtn.className = "btn-small btn-primary";
  waBtn.innerText = "Enviar por WhatsApp";
  waBtn.onclick = () => window._sendToWhatsApp();
  cartActionsContainer.appendChild(waBtn);

  const payBtn = document.createElement("button");
  payBtn.id = "cart-paycard";
  payBtn.className = "btn-small";
  payBtn.style.cssText =
    "background:#3b82f6;color:#fff;border-radius:8px;border:none;font-weight:700;padding:8px 12px;margin-left:6px;";
  payBtn.innerText = "Pagar con tarjeta";
  payBtn.onclick = () => window._openCardPaymentModal();
  cartActionsContainer.appendChild(payBtn);
}

// listeners básicos
if (cartIconBtn) cartIconBtn.addEventListener("click", openCartPopup);
if (cartPopupOverlay)
  cartPopupOverlay.addEventListener("click", e => {
    if (e.target === cartPopupOverlay) closeCartPopup();
  });

// ======================================
// 🔥 FUNCIÓN PARA ENVIAR CARRITO A WHATSAPP
// ======================================

export function sendToWhatsApp() {
  const items = getCartItems();
  if (!items.length) return alert("Tu carrito está vacío 🛒");

  let message = "🛒 *Pedido desde WyvernStore*\n\n";
  let total = 0;

  items.forEach(p => {
    message += `• ${p.qty} x ${p.name} - $${p.price}\n`;
    total += parsePriceNumber(p.price) * p.qty;
  });

  message += `\nTotal: *$${total}*\n`;

  const phone = "573207378992"; // cambia por tu número real
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

// ======================================
// EXPONER FUNCIONES AL ÁMBITO GLOBAL
// (para los onclick inline)
// ======================================

window._removeFromCart = (idx) => removeFromCart(idx);
window._sendToWhatsApp = () => sendToWhatsApp();
