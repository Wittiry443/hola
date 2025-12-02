// js/cart.js
import {
  cart,
  setCart,
  saveCart,
  normalizeProductKey,
  lastProductsCache, // <- lo usamos en varias funciones
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

// 🔥 IMPORTAMOS AUTH + HELPER PARA GUARDAR PEDIDOS EN FIREBASE
import { auth, createOrderInDB } from "./firebase.js";

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

  // URL de imagen asociada a la tarjeta
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
  // Nota: NO decretemos en servidor al añadir al carrito para evitar doble decremento.
  // La actualización definitiva se realiza en finalizePurchaseOnServer (pagos/whatsapp).
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
// FINALIZAR COMPRA (ya lo tenías, sin tocarlo)
// ======================================

/*
  Devuelve: { successes: [{ item, newStock }], failures: [{ item, reason }] }
*/
export async function finalizePurchaseOnServer(items, cache = lastProductsCache) {
  const successes = [];
  const failures = [];
  if (!Array.isArray(items) || items.length === 0) return { successes: [], failures: [] };

  // Ejecutar todos los decrementos (en paralelo)
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

// ======================================
// 🧾 HELPER: CREAR PEDIDO EN FIREBASE
// ======================================

async function createOrderFromItems(items) {
  if (!items || !items.length) return null;

  // total
  const total = items.reduce(
    (s, p) =>
      s +
      parsePriceNumber(
        p._priceNum !== undefined ? p._priceNum : p.price
      ) * Number(p.qty || 0),
    0
  );

  // resumen corto: "2 x Espada | 1 x Escudo"
  const resumen = items
    .map(i => `${i.qty} x ${i.name}`)
    .join(" | ");

  // cliente desde Firebase Auth (si hay), si no, Invitado
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
      precioUnitario: parsePriceNumber(
        i._priceNum !== undefined ? i._priceNum : i.price
      ),
    })),
  };

  // guardar en /orders
  const firebaseKey = await createOrderInDB(order);
  return firebaseKey;
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
//    + REGISTRAR PEDIDO EN FIREBASE
// ======================================

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

  // quitar del carrito los que se pudieron reservar
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
    : items; // fallback

  // ✅ CASO 1: todo OK, sin fallos
  if (!failures.length) {
    try {
      await createOrderFromItems(paidItems); // guardamos pedido en Firebase
    } catch (e) {
      console.error("Error guardando pedido en Firebase:", e);
      // no rompemos el flujo de WhatsApp por esto
    }

    let message = "🛒 *Pedido desde WyvernStore*\n\n";
    let total = 0;
    paidItems.forEach(p => {
      message += `• ${p.qty} x ${p.name} - $${p.price}\n`;
      total += parsePriceNumber(p.price) * p.qty;
    });
    message += `\nTotal: *$${total}*\n`;
    const phone = "573207378992";
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");

    try { saveCart(); } catch (e) {}
    try { updateCartUI(); } catch (e) {}
    try { refreshAllCardDisplays(); } catch (e) {}
    try { closeCartPopup(); } catch (e) {}
    return;
  }

  // ❗ CASO 2: hay fallos (stock desactualizado, etc.)
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

  // Usuario acepta enviar pedido parcial: guardamos pedido solo con los items pagados
  if (paidItems.length) {
    try {
      await createOrderFromItems(paidItems);
    } catch (e) {
      console.error("Error guardando pedido parcial en Firebase:", e);
    }

    let message = "🛒 *Pedido desde WyvernStore* (parcial)\n\n";
    let total = 0;
    paidItems.forEach(p => {
      message += `• ${p.qty} x ${p.name} - $${p.price}\n`;
      total += parsePriceNumber(p.price) * p.qty;
    });
    message += `\nTotal: *$${total}*\n`;
    const phone = "573207378992";
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  }

  try { saveCart(); } catch(e){}
  try { updateCartUI(); } catch(e){}
  try { refreshAllCardDisplays(); } catch(e){}
  if (cart.length === 0) try { closeCartPopup(); } catch(e){}
}

// ======================================
// PAGO CON TARJETA: flujo robusto (reemplaza la versión anterior)
// ======================================

window._openCardPaymentModal = async function() {
  console.log("[checkout] starting card checkout flow");
  const items = getCartItems();
  if (!items || items.length === 0) {
    alert("Tu carrito está vacío 🛒");
    return;
  }

  const payBtn = document.getElementById("cart-paycard");
  if (payBtn) { payBtn.disabled = true; payBtn.innerText = "Procesando..."; }

  // Variable que guardará la clave del pedido en Firebase (si se creó)
  let firebaseKey = null;

  try {
    // 1) intentar reservar/decrementar stock (igual que en WA)
    console.log("[checkout] calling finalizePurchaseOnServer", { items });
    let result = { successes: [], failures: [] };
    try {
      result = await finalizePurchaseOnServer(items, lastProductsCache);
      console.log("[checkout] finalizePurchaseOnServer result:", result);
    } catch (err) {
      console.error("[checkout] finalizePurchaseOnServer threw:", err);
      alert("No se pudo reservar el stock. Intenta de nuevo.");
      return;
    }

    const failures = result.failures || [];
    const paidItems = result.successes.length ? result.successes.map(s => s.item) : [];

    // 2) Si hay fallos: preguntar al usuario (igual que WA)
    if (failures.length) {
      console.warn("[checkout] some items failed to reserve:", failures);
      const proceed = confirm(
        `No fue posible actualizar el stock en el servidor para ${failures.length} productos. ¿Deseas continuar solo con los productos que sí se reservaron?`
      );
      if (!proceed) {
        // sincronizamos stocks fallidos en UI y abortamos
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

    // 3) Si no hay items reservados -> nada que pagar
    if (!paidItems.length) {
      console.log("[checkout] no paidItems after finalize -> nothing to pay");
      alert("No hay items reservados para pagar.");
      return;
    }

    // 4) Intentar crear pedido en Firebase AHORA (pendiente)
    try {
      console.log("[checkout] creating firebase order (pendiente) for paidItems:", paidItems);
      firebaseKey = await createOrderFromItems(paidItems);
      console.log("[checkout] firebase order created (pending) key:", firebaseKey);
    } catch (err) {
      console.error("[checkout] createOrderFromItems failed (pending):", err);
      // continuamos al pago aunque falle la creación: si sucede, la fallback creare después del pago
    }

    // 5) Abrir la pasarela de pago — reemplaza openYourPaymentModal por tu integración real
    const total = updateCartUI();
    let paymentMeta = null;
    try {
      console.log("[checkout] opening payment modal", { total, paidItems, firebaseKey });
      paymentMeta = await openYourPaymentModal({
        amount: total,
        items: paidItems,
        orderKey: firebaseKey
      });
      console.log("[checkout] payment modal result:", paymentMeta);
    } catch (err) {
      console.error("[checkout] openYourPaymentModal threw:", err);
      alert("Error al abrir la pasarela de pago.");
      return;
    }

    // 6) Si pago OK -> asegurarse de que exista el pedido en Firebase (si no se creó antes)
    if (paymentMeta && paymentMeta.success) {
      console.log("[checkout] payment success:", paymentMeta);

      if (!firebaseKey) {
        try {
          console.log("[checkout] firebaseKey faltante -> crear pedido después del pago");
          firebaseKey = await createOrderFromItems(paidItems);
          console.log("[checkout] firebase order created after payment:", firebaseKey);
        } catch (err) {
          console.error("[checkout] createOrderFromItems AFTER payment failed:", err);
          // Aquí podrías notificar al usuario / enviar la info a soporte
        }
      }

      // 7) Marcar pedido como pagado si tienes implementación para ello
      try {
        if (typeof window._markOrderAsPaid === "function" && firebaseKey) {
          await window._markOrderAsPaid(firebaseKey, paymentMeta);
        }
      } catch (err) {
        console.warn("[checkout] markOrderAsPaid failed (non-fatal):", err);
      }

      // 8) eliminar del carrito los items pagados (igual que en WA)
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
      console.warn("[checkout] payment not successful or cancelled:", paymentMeta);
      alert("Pago cancelado o fallido. Si ya se reservaron unidades contáctanos para soporte.");
      return;
    }
  } finally {
    if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pagar con tarjeta"; }
  }
};

// OPTIONAL: helper que tu pasarela puede llamar si necesita notificar desde otro contexto
window._onCardPaymentSuccess = async function(paymentMeta = {}) {
  console.log("Pago OK:", paymentMeta);
  // Si tu gateway notifica el éxito desde otro contexto, puedes procesarlo aquí.
};

// OPTIONAL: marcar orden como pagada en Firebase (implementa según tu esquema DB)
window._markOrderAsPaid = async function(firebaseKey, paymentMeta) {
  // Implementa actualización en tu DB: set estado='pagado', guardar transactionId, paidAt, paymentMeta...
  // Ejemplo (pseudocódigo, sustituye por la función real que actualice tu order):
  // await updateOrderInDB(firebaseKey, { estado: 'pagado', transactionId: paymentMeta.transactionId, paidAt: new Date().toISOString(), paymentMeta });
  return true;
};

// -----------------------------
// PLACEHOLDER: implementar tu gateway real aquí
// -----------------------------
async function openYourPaymentModal(paymentPayload) {
  // EJEMPLO SIMULADO (para pruebas locales) — reemplaza por integración real:
  // return new Promise(resolve => setTimeout(() => resolve({ success: true, transactionId: 'tx123' }), 1000));
  throw new Error("Implementa openYourPaymentModal(paymentPayload) con tu gateway.");
}

// ======================================
// EXPONER FUNCIONES AL ÁMBITO GLOBAL
// ======================================

window._removeFromCart = (idx) => removeFromCart(idx);
window._sendToWhatsApp = () => sendToWhatsApp();
