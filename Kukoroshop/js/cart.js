// js/cart.js
import {
  cart,
  setCart,
  saveCart,
  normalizeProductKey,
  lastProductsCache,
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

// IMPORTS FIREBASE: auth + crear orden + asegurar registro de usuario
import { auth, createOrderInDB, ensureUserRecord } from "./firebase.js";

const cartIconBtn = document.getElementById("cart-icon-btn");
const cartPopupOverlay = document.getElementById("cart-popup-overlay");
const cartPopup = document.getElementById("cart-popup");
const cartItemsContainer = document.getElementById("cart-items-container");
const cartTotalEl = document.getElementById("cart-total");
let cartActionsContainer = document.getElementById("cart-actions");

// HELPERS DE STOCK
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

// CARRITO EN MEMORIA + ICONO
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
      image: imgUrl
    });
  }
  setCart(cart);
  refreshCardStockDisplay(sheetKey, row, cache);
  updateCartUI();
}

// ELIMINAR DEL CARRITO
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
  openCartPopup();

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

// FINALIZAR COMPRA (reservar en servidor)
export async function finalizePurchaseOnServer(items, cache = lastProductsCache) {
  const successes = [];
  const failures = [];
  if (!Array.isArray(items) || items.length === 0) return { successes: [], failures: [] };

  const promises = items.map(async it => {
    const qty = Number(it.qty || 0);
    if (!qty) return { ok: true, item: it, newStock: null };

    try {
      const res = await updateStockOnServer_decrement(
        it.sheetKey,
        it.row,
        qty,
        getReservedQty,
        (sk, r) => refreshCardStockDisplay(sk, r, cache)
      );
      if (res && res.ok) {
        return { ok: true, item: it, newStock: res.newStock !== undefined ? Number(res.newStock) : null };
      } else {
        return { ok: false, item: it, reason: (res && res.error) ? res.error : "server_error" };
      }
    } catch (err) {
      return { ok: false, item: it, reason: String(err || "exception") };
    }
  });

  const results = await Promise.all(promises);

  for (const r of results) {
    if (r.ok) {
      successes.push({ item: r.item, newStock: r.newStock });
      try {
        const mapped = mapToAvailableSheetKey(r.item.sheetKey) || r.item.sheetKey;
        if (r.newStock !== null && r.newStock !== undefined) {
          applyNewStockToDOM(mapped, r.item.row, Number(r.newStock), getReservedQty);
        } else {
          const srv = await fetchServerStock(mapped, r.item.row);
          if (srv !== null) applyNewStockToDOM(mapped, r.item.row, Number(srv), getReservedQty);
        }
        refreshCardStockDisplay(r.item.sheetKey, r.item.row, cache);
      } catch (e) {}
    } else {
      failures.push({ item: r.item, reason: r.reason || "unknown" });
      try {
        const mapped = mapToAvailableSheetKey(r.item.sheetKey) || r.item.sheetKey;
        const srv = await fetchServerStock(mapped, r.item.row);
        if (srv !== null) {
          applyNewStockToDOM(mapped, r.item.row, Number(srv), getReservedQty);
          refreshCardStockDisplay(r.item.sheetKey, r.item.row, cache);
        }
      } catch (e) {}
    }
  }

  return { successes, failures };
}

// PENDING ORDER: guardado local + retry al cargar
function _savePendingOrderLocally(obj) {
  try {
    localStorage.setItem('wyvern_pending_order', JSON.stringify(obj));
  } catch (e) {}
}

async function _retryPendingOrderIfAny() {
  try {
    const raw = localStorage.getItem('wyvern_pending_order');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const res = await createOrderFromItems(parsed.items, parsed.shipping || null);
    if (res && res.ok) {
      if (parsed.paymentMeta && typeof window._markOrderAsPaid === 'function') {
        try {
          await window._markOrderAsPaid(res.firebaseKey, parsed.paymentMeta);
        } catch (e) {}
      }
      localStorage.removeItem('wyvern_pending_order');
      return res;
    } else {
      return null;
    }
  } catch (err) {
    return null;
  }
}

window.addEventListener('load', () => {
  (async () => {
    try {
      await _retryPendingOrderIfAny();
    } catch (e) {}
  })();
});

// SHIPPING MODAL (nombre, teléfono, dirección, notas)
function ensureShippingModalExists() {
  if (document.getElementById("shipping-modal-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "shipping-modal-overlay";
  overlay.style = "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);z-index:40000;";
  overlay.innerHTML = `
    <div id="shipping-modal" style="width:92%;max-width:540px;background:#fff;border-radius:10px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,0.25);">
      <h3 style="margin:0 0 8px 0">Dirección de envío</h3>
      <div style="max-height:60vh;overflow:auto" id="shipping-modal-body">
        <div style="display:grid;grid-template-columns:1fr;gap:8px">
          <label style="font-weight:700">Nombre completo
            <input id="shipping-fullName" style="width:100%;padding:8px;border-radius:6px;margin-top:4px" />
          </label>

          <label style="font-weight:700">Número de teléfono
            <input id="shipping-phone" style="width:100%;padding:8px;border-radius:6px;margin-top:4px" placeholder="+57 3..." />
          </label>

          <label style="font-weight:700">Dirección (calle / barrio / referencia)
            <input id="shipping-address" style="width:100%;padding:8px;border-radius:6px;margin-top:4px" />
          </label>

          <label style="font-weight:700">Información adicional (para ayudar al repartidor)
            <textarea id="shipping-notes" rows="3" style="width:100%;padding:8px;border-radius:6px;margin-top:4px" placeholder="Piso, puerta, cómo llegar, punto de referencia..."></textarea>
          </label>

          <label style="font-weight:700">
            <input type="checkbox" id="shipping-save-local" /> Guardar esta dirección en este equipo (local)
          </label>
        </div>
      </div>

      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
        <button id="shipping-cancel" class="btn-ghost btn-small">Cancelar</button>
        <button id="shipping-save" class="btn-primary btn-small">Guardar y continuar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  };
}

function showShippingModal(prefill = {}) {
  ensureShippingModalExists();
  const overlay = document.getElementById("shipping-modal-overlay");
  const fullInp = document.getElementById("shipping-fullName");
  const phoneInp = document.getElementById("shipping-phone");
  const addrInp = document.getElementById("shipping-address");
  const notesInp = document.getElementById("shipping-notes");
  const saveChk = document.getElementById("shipping-save-local");
  const saveBtn = document.getElementById("shipping-save");
  const cancelBtn = document.getElementById("shipping-cancel");

  const stored = (() => {
    try { return JSON.parse(localStorage.getItem("wyvern_last_shipping") || "null"); } catch (e) { return null; }
  })();

  const fill = prefill && Object.keys(prefill).length ? prefill : (stored || {});
  fullInp.value = fill.fullName || fill.name || "";
  phoneInp.value = fill.phone || "";
  addrInp.value = fill.address || fill.addressLine || "";
  notesInp.value = fill.notes || fill.fullAddress || "";
  saveChk.checked = !!stored;

  overlay.style.display = "flex";

  return new Promise((resolve) => {
    function doClose(val) {
      saveBtn.onclick = null;
      cancelBtn.onclick = null;
      overlay.style.display = "none";
      resolve(val);
    }

    cancelBtn.onclick = () => doClose(null);

    saveBtn.onclick = () => {
      const shipping = {
        fullName: fullInp.value.trim() || null,
        phone: phoneInp.value.trim() || null,
        address: addrInp.value.trim() || null,
        notes: notesInp.value.trim() || null
      };
      if (shipping.address) shipping.addressLine = shipping.address;
      Object.keys(shipping).forEach(k => { if (shipping[k] === null || shipping[k] === "") delete shipping[k]; });

      try {
        if (saveChk.checked) {
          localStorage.setItem("wyvern_last_shipping", JSON.stringify(shipping));
        }
      } catch (e) {}

      doClose(shipping);
    };
  });
}

// HELPER: extraer key de createOrderInDB (soporta string o obj)
function _extractKey(res) {
  if (!res) return null;
  if (typeof res === "string") return res;
  if (typeof res === "object") return res.key || res.firebaseKey || null;
  return null;
}

/**
 * createOrderFromItems(items, shipping?)
 * shipping: { fullName, phone, address, notes, addressLine? }
 */
export async function createOrderFromItems(items, shipping = null) {
  if (!items || !items.length) return { ok: false, firebaseKey: null, error: "empty_items" };

  const total = items.reduce(
    (s, p) =>
      s +
      parsePriceNumber(
        p._priceNum !== undefined ? p._priceNum : p.price
      ) * Number(p.qty || 0),
    0
  );

  const resumen = items
    .map(i => `${i.qty} x ${i.name}`)
    .join(" | ");

  const user = auth?.currentUser || null;
  const cliente = user?.email || user?.uid || "Invitado";

  const idPedido = Date.now().toString();

  const order = {
    idPedido,
    cliente,
    resumen,
    total,
    estado: "pendiente",
    createdAt: new Date().toISOString(),
    items: items.map(i => ({
      nombre: i.name,
      cantidad: Number(i.qty || 0),
      precioUnitario: Number(i._priceNum !== undefined ? i._priceNum : parsePriceNumber(i.price))
    })),
  };

  if (shipping && Object.keys(shipping).length) {
    const sh = { ...shipping };
    if (sh.address && !sh.addressLine) sh.addressLine = sh.address;
    order.shipping = sh;
  }

  try {
    if (user) {
      try { await ensureUserRecord(user); } catch (e) {}
    }

    const res = await createOrderInDB(order, user);
    const key = _extractKey(res);

    if (!key) {
      _savePendingOrderLocally({ items, shipping, createdAt: Date.now() });
      return { ok: false, firebaseKey: null, error: "no_key_returned", order };
    }

    return { ok: true, firebaseKey: key, error: null, order };
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err);
    _savePendingOrderLocally({ items, shipping, createdAt: Date.now() });
    return { ok: false, firebaseKey: null, error: errMsg, order };
  }
}

// POPUP DEL CARRITO + acciones
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

if (cartIconBtn) cartIconBtn.addEventListener("click", openCartPopup);
if (cartPopupOverlay)
  cartPopupOverlay.addEventListener("click", e => {
    if (e.target === cartPopupOverlay) closeCartPopup();
  });

// ENVIAR POR WHATSAPP + REGISTRAR PEDIDO EN FIREBASE
export async function sendToWhatsApp() {
  const items = getCartItems();
  if (!items.length) {
    alert("Tu carrito está vacío 🛒");
    return;
  }

  let result = { successes: [], failures: [] };
  try {
    result = await finalizePurchaseOnServer(items, lastProductsCache);
  } catch (e) {
    result = { successes: [], failures: items.map(it => ({ item: it, reason: String(e) })) };
  }

  if (Array.isArray(result.successes) && result.successes.length > 0) {
    const successKeys = result.successes.map(s => `${s.item.sheetKey}::${s.item.row}`);
    for (let i = cart.length - 1; i >= 0; i--) {
      const key = `${cart[i].sheetKey}::${cart[i].row}`;
      if (successKeys.includes(key)) cart.splice(i, 1);
    }
    setCart(cart);
  }

  const failures = result.failures || [];
  const failedItems = failures.map(f => f.item);
  const paidItems = result.successes.length
    ? result.successes.map(s => s.item)
    : items;

  if (!failures.length) {
    try {
      const shipping = await showShippingModal();
      if (!shipping) {
        const proceed = confirm("No se ingresó dirección de envío. ¿Deseas continuar sin dirección (la orden se guardará sin dirección)?");
        if (!proceed) {
          await Promise.all(paidItems.map(p => {
            const mapped = mapToAvailableSheetKey(p.sheetKey) || p.sheetKey;
            return fetchServerStock(mapped, p.row).then(s => {
              if (s !== null) applyNewStockToDOM(mapped, p.row, Number(s), getReservedQty);
            }).catch(()=>{});
          }));
          refreshAllCardDisplays();
          return;
        }
      }

      const createRes = await createOrderFromItems(paidItems, shipping || null);
      if (!createRes || !createRes.ok) {
        _savePendingOrderLocally({ items: paidItems, shipping: shipping || null, createdAt: Date.now() });
      }

    } catch (e) {
      _savePendingOrderLocally({ items: paidItems, createdAt: Date.now() });
    }

    let shippingForMsg = null;
    try {
      shippingForMsg = JSON.parse(localStorage.getItem("wyvern_last_shipping") || "null");
    } catch (e) { shippingForMsg = null; }

    let message = "🛒 *Pedido desde Kukoro-shop*\n\n";
    let total = 0;
    paidItems.forEach(p => {
      const unit = (p._priceNum !== undefined) ? Number(p._priceNum) : parsePriceNumber(p.price);
      message += `• ${p.qty} x ${p.name} - $${unit}\n`;
      total += unit * Number(p.qty || 0);
    });
    message += `\nTotal: *$${total}*\n\n`;

    if (shippingForMsg) {
      message += `📦 *Datos de envío:*\n`;
      if (shippingForMsg.fullName) message += `Nombre: ${shippingForMsg.fullName}\n`;
      if (shippingForMsg.phone) message += `Tel: ${shippingForMsg.phone}\n`;
      if (shippingForMsg.address) message += `Dirección: ${shippingForMsg.address}\n`;
      if (shippingForMsg.notes) message += `Info: ${shippingForMsg.notes}\n`;
      message += `\n`;
    }

    const phone = "573207378992";
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");

    try { saveCart(); } catch (e) {}
    try { updateCartUI(); } catch (e) {}
    try { refreshAllCardDisplays(); } catch (e) {}
    try { closeCartPopup(); } catch (e) {}
    return;
  }

  const proceed = confirm(
    `No fue posible actualizar el stock en el servidor para ${failedItems.length} productos. ¿Deseas enviar el pedido de los demás productos (los que sí se reservaron) por WhatsApp?`
  );

  if (!proceed) {
    await Promise.all(failures.map(f => {
      const mapped = mapToAvailableSheetKey(f.item.sheetKey) || f.item.sheetKey;
      return fetchServerStock(mapped, f.item.row).then(s => {
        if (s !== null) applyNewStockToDOM(mapped, f.item.row, Number(s), getReservedQty);
      }).catch(()=>{});
    }));
    refreshAllCardDisplays();
    return;
  }

  if (paidItems.length) {
    try {
      const shipping = await showShippingModal();
      if (!shipping) {
        const ok = confirm("No ingresaste dirección. ¿Deseas continuar sin dirección?");
        if (!ok) return;
      }

      const createRes = await createOrderFromItems(paidItems, shipping || null);
      if (!createRes || !createRes.ok) {
        _savePendingOrderLocally({ items: paidItems, shipping: shipping || null, createdAt: Date.now() });
      }

      let shippingForMsg = null;
      try { shippingForMsg = JSON.parse(localStorage.getItem("wyvern_last_shipping") || "null"); } catch(e){ shippingForMsg = null; }

      let message = "🛒 *Pedido desde Kukoro-shop* (parcial)\n\n";
      let total = 0;
      paidItems.forEach(p => {
        const unit = (p._priceNum !== undefined) ? Number(p._priceNum) : parsePriceNumber(p.price);
        message += `• ${p.qty} x ${p.name} - $${unit}\n`;
        total += unit * Number(p.qty || 0);
      });
      message += `\nTotal: *$${total}*\n\n`;
      if (shippingForMsg) {
        message += `📦 *Datos de envío:*\n`;
        if (shippingForMsg.fullName) message += `Nombre: ${shippingForMsg.fullName}\n`;
        if (shippingForMsg.phone) message += `Tel: ${shippingForMsg.phone}\n`;
        if (shippingForMsg.address) message += `Dirección: ${shippingForMsg.address}\n`;
        if (shippingForMsg.notes) message += `Info: ${shippingForMsg.notes}\n`;
        message += `\n`;
      }

      const phone = "573207378992";
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      window.open(url, "_blank");
    } catch (e) {
      _savePendingOrderLocally({ items: paidItems, createdAt: Date.now() });
    }
  }

  try { saveCart(); } catch(e){}
  try { updateCartUI(); } catch(e){}
  try { refreshAllCardDisplays(); } catch(e){}
  if (cart.length === 0) try { closeCartPopup(); } catch(e){}
}

// PAGO CON TARJETA (adaptado para shipping)
window._openCardPaymentModal = async function() {
  const items = getCartItems();
  if (!items || items.length === 0) {
    alert("Tu carrito está vacío 🛒");
    return;
  }

  const payBtn = document.getElementById("cart-paycard");
  if (payBtn) { payBtn.disabled = true; payBtn.innerText = "Procesando..."; }

  let firebaseKey = null;

  try {
    let result = { successes: [], failures: [] };
    try {
      result = await finalizePurchaseOnServer(items, lastProductsCache);
    } catch (err) {
      alert("No se pudo reservar el stock. Intenta de nuevo.");
      return;
    }

    const failures = result.failures || [];
    const paidItems = result.successes.length ? result.successes.map(s => s.item) : [];

    if (failures.length) {
      const proceed = confirm(
        `No fue posible actualizar el stock en el servidor para ${failures.length} productos. ¿Deseas continuar solo con los productos que sí se reservaron?`
      );
      if (!proceed) {
        await Promise.all(failures.map(f => {
          const mapped = mapToAvailableSheetKey(f.item.sheetKey) || f.item.sheetKey;
          return fetchServerStock(mapped, f.item.row).then(s => {
            if (s !== null) applyNewStockToDOM(mapped, f.item.row, Number(s), getReservedQty);
          }).catch(()=>{});
        }));
        refreshAllCardDisplays();
        return;
      }
    }

    if (!paidItems.length) {
      alert("No hay items reservados para pagar.");
      return;
    }

    let shipping = null;
    try {
      shipping = await showShippingModal();
      if (!shipping) {
        const ok = confirm("No ingresaste dirección. ¿Deseas continuar sin dirección?");
        if (!ok) {
          await Promise.all(paidItems.map(p => {
            const mapped = mapToAvailableSheetKey(p.sheetKey) || p.sheetKey;
            return fetchServerStock(mapped, p.row).then(s => {
              if (s !== null) applyNewStockToDOM(mapped, p.row, Number(s), getReservedQty);
            }).catch(()=>{});
          }));
          refreshAllCardDisplays();
          return;
        }
      }
    } catch (e) {
      shipping = null;
    }

    try {
      const createResNow = await createOrderFromItems(paidItems, shipping || null);
      if (createResNow && createResNow.ok) {
        firebaseKey = createResNow.firebaseKey;
      } else {
        _savePendingOrderLocally({ items: paidItems, shipping: shipping || null, createdAt: Date.now() });
      }
    } catch (err) {
      _savePendingOrderLocally({ items: paidItems, shipping: shipping || null, createdAt: Date.now() });
    }

    const total = updateCartUI();
    let paymentMeta = null;
    try {
      paymentMeta = await openYourPaymentModal({
        amount: total,
        items: paidItems,
        orderKey: firebaseKey
      });
    } catch (err) {
      alert("Error al abrir la pasarela de pago.");
      return;
    }

    if (paymentMeta && paymentMeta.success) {
      if (!firebaseKey) {
        try {
          const createResAfter = await createOrderFromItems(paidItems, shipping || null);
          if (createResAfter && createResAfter.ok) {
            firebaseKey = createResAfter.firebaseKey;
            localStorage.removeItem('wyvern_pending_order');
          } else {
            _savePendingOrderLocally({ items: paidItems, paymentMeta, shipping: shipping || null, createdAt: Date.now(), firebaseKey });
          }
        } catch (err) {
          _savePendingOrderLocally({ items: paidItems, paymentMeta, shipping: shipping || null, createdAt: Date.now(), firebaseKey });
        }
      } else {
        try {
          if (typeof window._markOrderAsPaid === "function" && firebaseKey) {
            await window._markOrderAsPaid(firebaseKey, paymentMeta);
          }
          localStorage.removeItem('wyvern_pending_order');
        } catch (err) {
          _savePendingOrderLocally({ items: paidItems, paymentMeta, shipping: shipping || null, createdAt: Date.now(), firebaseKey });
        }
      }

      if (Array.isArray(result.successes) && result.successes.length > 0) {
        const successKeys = result.successes.map(s => `${s.item.sheetKey}::${s.item.row}`);
        for (let i = cart.length - 1; i >= 0; i--) {
          const key = `${cart[i].sheetKey}::${cart[i].row}`;
          if (successKeys.includes(key)) cart.splice(i, 1);
        }
        setCart(cart);
      }

      try { await saveCart(); } catch (_) {}
      try { updateCartUI(); } catch (_) {}
      try { refreshAllCardDisplays(); } catch (_) {}
      try { closeCartPopup(); } catch (_) {}

      alert("Pago procesado correctamente. ¡Gracias por tu compra!");
      return;
    } else {
      alert("Pago cancelado o fallido. Si ya se reservaron unidades contáctanos para soporte.");
      return;
    }
  } finally {
    if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pagar con tarjeta"; }
  }
};

window._onCardPaymentSuccess = async function(paymentMeta = {}) {
  try {
    const pendingRaw = localStorage.getItem('wyvern_pending_order');
    if (pendingRaw) {
      const pending = JSON.parse(pendingRaw);
      pending.paymentMeta = paymentMeta;
      localStorage.setItem('wyvern_pending_order', JSON.stringify(pending));
      await _retryPendingOrderIfAny();
    }
  } catch (e) {}
};

window._markOrderAsPaid = async function(firebaseKey, paymentMeta) {
  return true;
};

async function openYourPaymentModal(paymentPayload) {
  throw new Error("Implementa openYourPaymentModal(paymentPayload) con tu gateway.");
}

// helpers globales mínimos
window._removeFromCart = (idx) => removeFromCart(idx);
window._sendToWhatsApp = () => sendToWhatsApp();

// utilitarios debug/uso: expuestos pero sin logs
window.__wyvern_createOrderFromItems = async (items) => {
  return await createOrderFromItems(items);
};
window.__wyvern_retryPending = async () => {
  return await _retryPendingOrderIfAny();
};
