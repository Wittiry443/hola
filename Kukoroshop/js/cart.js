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

/* ----------------- DOM nodes ----------------- */
const cartIconBtn = document.getElementById("cart-icon-btn");
const cartPopupOverlay = document.getElementById("cart-popup-overlay");
const cartPopup = document.getElementById("cart-popup");
const cartItemsContainer = document.getElementById("cart-items-container");
const cartTotalEl = document.getElementById("cart-total");
let cartActionsContainer = document.getElementById("cart-actions");

/* ------------- Helpers de stock --------------- */
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

/* --------------- Carrito en memoria ------------- */
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

/* ---------- Añadir / eliminar / finalizar ---------- */
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

/* -------------- Pending order helpers ------------- */
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

/* -------------- Shipping modal (dark theme) -------------- */
/*
  showShippingModal() -> Promise that resolves to shipping object or null (if cancelled)
  Required fields: fullName, phone, address (validated)
  Clicking outside overlay cancels (resolves null)
*/
function ensureShippingModalExists() {
  if (document.getElementById("shipping-modal-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "shipping-modal-overlay";
  overlay.style =
    "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:40000;";
  overlay.innerHTML = `
    <div id="shipping-modal" role="dialog" aria-modal="true" style="width:92%;max-width:540px;background:var(--panel,#0b1220);color:var(--text,#e6eef8);border-radius:10px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,0.5);">
      <h3 style="margin:0 0 8px 0">Dirección de envío</h3>
      <div style="max-height:60vh;overflow:auto" id="shipping-modal-body">
        <div style="display:grid;grid-template-columns:1fr;gap:8px">
          <label style="font-weight:700;color:#cbd5e1">Nombre completo
            <input id="shipping-fullName" style="width:100%;padding:8px;border-radius:6px;margin-top:4px;background:#071026;border:1px solid rgba(255,255,255,0.04);color:#e6eef8" />
          </label>

          <label style="font-weight:700;color:#cbd5e1">Número de teléfono
            <input id="shipping-phone" style="width:100%;padding:8px;border-radius:6px;margin-top:4px;background:#071026;border:1px solid rgba(255,255,255,0.04);color:#e6eef8" placeholder="+57 3..." />
          </label>

          <label style="font-weight:700;color:#cbd5e1">Dirección (calle / barrio / referencia)
            <input id="shipping-address" style="width:100%;padding:8px;border-radius:6px;margin-top:4px;background:#071026;border:1px solid rgba(255,255,255,0.04);color:#e6eef8" />
          </label>

          <label style="font-weight:700;color:#cbd5e1">Información adicional (para ayudar al repartidor)
            <textarea id="shipping-notes" rows="3" style="width:100%;padding:8px;border-radius:6px;margin-top:4px;background:#071026;border:1px solid rgba(255,255,255,0.04);color:#e6eef8" placeholder="Piso, puerta, cómo llegar, punto de referencia..."></textarea>
          </label>

          <label style="font-weight:700;color:#cbd5e1">
            <input type="checkbox" id="shipping-save-local" /> Guardar esta dirección en este equipo (local)
          </label>
        </div>
      </div>

      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
        <button id="shipping-cancel" class="btn-ghost btn-small" style="background:transparent;border:1px solid rgba(255,255,255,0.04);color:#e6eef8">Cancelar</button>
        <button id="shipping-save" class="btn-primary btn-small" style="background:#7c3aed;color:#fff;border:none;padding:8px 12px;border-radius:8px">Guardar y continuar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // overlay click should hide and act as cancel (we won't resolve here — showShippingModal will handle)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      // visually hide; the promise will be resolved by showShippingModal via overlay.dataset.dismiss="true"
      overlay.style.display = "none";
      overlay.dataset.dismiss = "true";
    }
  });
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

  // clear any previous dismiss flag
  delete overlay.dataset.dismiss;

  overlay.style.display = "flex";

  return new Promise((resolve) => {
    function cleanup() {
      saveBtn.onclick = null;
      cancelBtn.onclick = null;
      overlay.style.display = "none";
    }

    // cancel handler
    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };

    // we need to detect overlay click -> we set dataset.dismiss in ensureShippingModalExists
    const observer = new MutationObserver(() => {
      if (overlay.dataset.dismiss === "true") {
        observer.disconnect();
        cleanup();
        resolve(null);
      }
    });
    observer.observe(overlay, { attributes: true });

    saveBtn.onclick = () => {
      const shipping = {
        fullName: fullInp.value.trim() || null,
        phone: phoneInp.value.trim() || null,
        address: addrInp.value.trim() || null,
        notes: notesInp.value.trim() || null
      };

      // validate required fields: fullName, phone, address
      if (!shipping.fullName || !shipping.phone || !shipping.address) {
        alert("Por favor completa Nombre, Teléfono y Dirección antes de continuar.");
        return;
      }

      if (saveChk.checked) {
        try {
          localStorage.setItem("wyvern_last_shipping", JSON.stringify(shipping));
        } catch (e) {}
      }

      observer.disconnect();
      cleanup();
      resolve(shipping);
    };
  });
}

/* -------------- Card payment modal (reuses shipping fields + card) -------------- */
/*
  showCardPaymentModal() -> Promise that resolves to { shipping, card: {number, expiry, cvc}} or null if canceled
  expiry auto-formats MM/YY (inserts '/')
*/
function ensureCardPaymentModalExists() {
  if (document.getElementById("card-payment-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "card-payment-overlay";
  overlay.style =
    "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:45000;";
  overlay.innerHTML = `
    <div id="card-payment-modal" role="dialog" aria-modal="true" style="width:92%;max-width:640px;background:var(--panel,#0b1220);color:var(--text,#e6eef8);border-radius:10px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,0.5);">
      <h3 style="margin:0 0 8px 0">Pago con tarjeta</h3>
      <div style="display:grid;grid-template-columns:1fr 320px;gap:12px;align-items:start">
        <div>
          <div style="margin-bottom:8px;color:#cbd5e1;font-weight:700">Datos de envío</div>

          <div style="display:grid;grid-template-columns:1fr;gap:8px">
            <input id="card-shipping-fullName" placeholder="Nombre completo" style="padding:8px;border-radius:6px;background:#071026;border:1px solid rgba(255,255,255,0.04);color:#e6eef8" />
            <input id="card-shipping-phone" placeholder="Teléfono" style="padding:8px;border-radius:6px;background:#071026;border:1px solid rgba(255,255,255,0.04);color:#e6eef8" />
            <input id="card-shipping-address" placeholder="Dirección" style="padding:8px;border-radius:6px;background:#071026;border:1px solid rgba(255,255,255,0.04);color:#e6eef8" />
            <textarea id="card-shipping-notes" rows="2" placeholder="Notas (opcional)" style="padding:8px;border-radius:6px;background:#071026;border:1px solid rgba(255,255,255,0.04);color:#e6eef8"></textarea>
          </div>
        </div>

        <aside style="background:rgba(255,255,255,0.02);padding:10px;border-radius:8px;">
          <div style="margin-bottom:8px;color:#cbd5e1;font-weight:700">Datos de la tarjeta</div>
          <input id="card-number" placeholder="Número de tarjeta" maxlength="19" style="width:100%;padding:8px;border-radius:6px;background:#071026;border:1px solid rgba(255,255,255,0.04);color:#e6eef8;margin-bottom:8px" />
          <div style="display:flex;gap:8px">
            <input id="card-expiry" placeholder="MM/YY" maxlength="5" style="flex:1;padding:8px;border-radius:6px;background:#071026;border:1px solid rgba(255,255,255,0.04);color:#e6eef8" />
            <input id="card-cvc" placeholder="CVC" maxlength="4" style="width:80px;padding:8px;border-radius:6px;background:#071026;border:1px solid rgba(255,255,255,0.04);color:#e6eef8" />
          </div>
        </aside>
      </div>

      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
        <button id="card-cancel" class="btn-ghost btn-small" style="background:transparent;border:1px solid rgba(255,255,255,0.04);color:#e6eef8">Cancelar</button>
        <button id="card-pay" class="btn-primary btn-small" style="background:#7c3aed;color:#fff;border:none;padding:8px 12px;border-radius:8px">Pagar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // overlay click -> hide and mark dismissed (showCardPaymentModal will detect)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.style.display = "none";
      overlay.dataset.dismiss = "true";
    }
  });

  // auto format expiry input (delegated in show function to ensure element exists)
}

function showCardPaymentModal(prefillShipping = {}) {
  ensureCardPaymentModalExists();
  const overlay = document.getElementById("card-payment-overlay");
  const fullInp = document.getElementById("card-shipping-fullName");
  const phoneInp = document.getElementById("card-shipping-phone");
  const addrInp = document.getElementById("card-shipping-address");
  const notesInp = document.getElementById("card-shipping-notes");
  const saveBtn = document.getElementById("card-pay");
  const cancelBtn = document.getElementById("card-cancel");

  const cardNumberInp = document.getElementById("card-number");
  const expiryInp = document.getElementById("card-expiry");
  const cvcInp = document.getElementById("card-cvc");

  const stored = (() => {
    try { return JSON.parse(localStorage.getItem("wyvern_last_shipping") || "null"); } catch (e) { return null; }
  })();

  const fill = prefillShipping && Object.keys(prefillShipping).length ? prefillShipping : (stored || {});
  fullInp.value = fill.fullName || fill.name || "";
  phoneInp.value = fill.phone || "";
  addrInp.value = fill.address || fill.addressLine || "";
  notesInp.value = fill.notes || fill.fullAddress || "";

  delete overlay.dataset.dismiss;
  overlay.style.display = "flex";

  // expiry auto-format handler
  function formatExpiryOnInput(e) {
    const v = e.target.value.replace(/\D/g,'').slice(0,4); // allow MMYY
    let out = v;
    if (v.length >= 3) {
      out = v.slice(0,2) + '/' + v.slice(2);
    }
    e.target.value = out;
  }

  expiryInp.addEventListener('input', formatExpiryOnInput);

  return new Promise((resolve) => {
    function cleanup() {
      saveBtn.onclick = null;
      cancelBtn.onclick = null;
      overlay.style.display = "none";
      expiryInp.removeEventListener('input', formatExpiryOnInput);
    }

    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };

    const observer = new MutationObserver(() => {
      if (overlay.dataset.dismiss === "true") {
        observer.disconnect();
        cleanup();
        resolve(null);
      }
    });
    observer.observe(overlay, { attributes: true });

    saveBtn.onclick = () => {
      const shipping = {
        fullName: fullInp.value.trim() || null,
        phone: phoneInp.value.trim() || null,
        address: addrInp.value.trim() || null,
        notes: notesInp.value.trim() || null
      };
      // Validate required shipping fields
      if (!shipping.fullName || !shipping.phone || !shipping.address) {
        alert("Por favor completa Nombre, Teléfono y Dirección antes de continuar.");
        return;
      }
      // Validate card fields
      const card = {
        number: (cardNumberInp.value || "").replace(/\s+/g,''),
        expiry: (expiryInp.value || ""),
        cvc: (cvcInp.value || "")
      };
      if (!card.number || !card.expiry || !card.cvc) {
        alert("Por favor completa los datos de la tarjeta (número, fecha y CVC).");
        return;
      }
      // simple expiry format check MM/YY
      if (!/^\d{2}\/\d{2}$/.test(card.expiry)) {
        alert("Formato de fecha incorrecto. Usa MM/YY.");
        return;
      }

      // Save shipping locally if desired
      try {
        localStorage.setItem("wyvern_last_shipping", JSON.stringify(shipping));
      } catch (e) {}

      observer.disconnect();
      cleanup();
      resolve({ shipping, card });
    };
  });
}

/* -------------- Helpers de orden -------------- */
function _extractKey(res) {
  if (!res) return null;
  if (typeof res === "string") return res;
  if (typeof res === "object") return res.key || res.firebaseKey || null;
  return null;
}

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

/* --------------- POPUP del carrito --------------- */
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

/* --------------- Enviar por WhatsApp --------------- */
/*
  Flow changed:
  1) check user logged in -> if not, alert and abort
  2) show shipping modal -> if null (cancel/overlay), abort without touching stock
  3) finalizePurchaseOnServer (reserve stock)
  4) createOrderInDB (optional)
  5) open wa.me
*/
export async function sendToWhatsApp() {
  const items = getCartItems();
  if (!items.length) {
    alert("Tu carrito está vacío 🛒");
    return;
  }

  // 1) must be logged in
  if (!auth || !auth.currentUser) {
    alert("Necesitas iniciar sesión para enviar el pedido. Por favor inicia sesión e inténtalo de nuevo.");
    return;
  }

  // 2) show shipping modal and require fields
  const shipping = await showShippingModal();
  if (!shipping) {
    // user cancelled or clicked outside -> abort
    alert("Pedido cancelado.");
    return;
  }

  // 3) try reserve stock on server
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

  if (failures.length && !paidItems.length) {
    alert("No fue posible reservar stock para ninguno de los items. Pedido cancelado.");
    // rollback not needed because we didn't change DB if no successes
    return;
  }

  // 4) create order in DB for reserved items (paidItems)
  let createRes = null;
  try {
    createRes = await createOrderFromItems(paidItems, shipping || null);
    if (!createRes || !createRes.ok) {
      _savePendingOrderLocally({ items: paidItems, shipping: shipping || null, createdAt: Date.now() });
    }
  } catch (e) {
    _savePendingOrderLocally({ items: paidItems, shipping: shipping || null, createdAt: Date.now() });
  }

  // 5) build whatsapp message and open
  let message = "🛒 *Pedido desde Kukoro-shop*\n\n";
  let total = 0;
  paidItems.forEach(p => {
    const unit = (p._priceNum !== undefined) ? Number(p._priceNum) : parsePriceNumber(p.price);
    message += `• ${p.qty} x ${p.name} - $${unit}\n`;
    total += unit * Number(p.qty || 0);
  });
  message += `\nTotal: *$${total}*\n\n`;

  if (shipping) {
    message += `📦 *Datos de envío:*\n`;
    if (shipping.fullName) message += `Nombre: ${shipping.fullName}\n`;
    if (shipping.phone) message += `Tel: ${shipping.phone}\n`;
    if (shipping.address) message += `Dirección: ${shipping.address}\n`;
    if (shipping.notes) message += `Info: ${shipping.notes}\n`;
    message += `\n`;
  }

  const phone = "573207378992";
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");

  try { saveCart(); } catch (e) {}
  try { updateCartUI(); } catch (e) {}
  try { refreshAllCardDisplays(); } catch (e) {}
  try { closeCartPopup(); } catch (e) {}
}

/* --------------- Pago con tarjeta --------------- */
/*
  Replaces previous flow: show card modal (shipping + card), validate, then reserve/persist/order.
  openYourPaymentModal remains an integration point (can be swapped). For now we capture card data and pass to openYourPaymentModal.
*/
window._openCardPaymentModal = async function() {
  const items = getCartItems();
  if (!items || items.length === 0) {
    alert("Tu carrito está vacío 🛒");
    return;
  }

  // must be logged in
  if (!auth || !auth.currentUser) {
    alert("Necesitas iniciar sesión para pagar con tarjeta. Por favor inicia sesión e inténtalo de nuevo.");
    return;
  }

  // show card payment modal (shipping + card)
  const cardResult = await showCardPaymentModal();
  if (!cardResult) {
    alert("Pago cancelado.");
    return;
  }

  const { shipping, card } = cardResult;

  // Reserve stock
  let result;
  try {
    result = await finalizePurchaseOnServer(items, lastProductsCache);
  } catch (err) {
    alert("No se pudo reservar stock en el servidor. Intenta nuevamente.");
    return;
  }

  const failures = result.failures || [];
  const paidItems = result.successes.length ? result.successes.map(s => s.item) : [];

  if (failures.length && !paidItems.length) {
    alert("No se pudo reservar stock para ninguno de los artículos. Pago cancelado.");
    return;
  }

  // create order in DB
  let firebaseKey = null;
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

  // call integration gate (openYourPaymentModal) with payment payload (implement this to integrate real gateway)
  const total = updateCartUI();
  let paymentMeta = null;
  try {
    paymentMeta = await openYourPaymentModal({
      amount: total,
      items: paidItems,
      orderKey: firebaseKey,
      card, // captured card (in a real impl send to payment provider securely)
      shipping
    });
  } catch (err) {
    alert("Error al procesar pago. Intenta de nuevo.");
    return;
  }

  if (paymentMeta && paymentMeta.success) {
    // mark order paid if possible
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

    // remove reserved items from cart
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
};

/* --------------- Payment integration stub --------------- */
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
  // Implementa integración real con tu gateway.
  // Por ahora simulamos un pago exitoso tras 1s (para testing).
  // En producción, reemplaza por la implementación real.
  return new Promise((resolve) => {
    setTimeout(() => resolve({ success: true, provider: "mock", meta: {} }), 1000);
  });
}

/* --------------- Exports / helpers globales --------------- */
window._removeFromCart = (idx) => removeFromCart(idx);
window._sendToWhatsApp = () => sendToWhatsApp();

/* utilitarios debug/uso: expuestos pero sin logs */
window.__wyvern_createOrderFromItems = async (items) => {
  return await createOrderFromItems(items);
};
window.__wyvern_retryPending = async () => {
  return await _retryPendingOrderIfAny();
};

