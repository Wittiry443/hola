// js/stock.js
import { API_URL } from "./config.js";
import {
  lastProductsCache,
  availableSheetKeys,
  normalizeProductKey
} from "./state.js";
import { firstKeyValue } from "./utils.js";

export function mapToAvailableSheetKey(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (availableSheetKeys && availableSheetKeys.length) {
    const found = availableSheetKeys.find(
      k => String(k).toLowerCase() === s.toLowerCase()
    );
    if (found) return found;
  }
  return s || null;
}

async function safeParseJsonText(resp) {
  const text = await resp.text().catch(() => null);
  if (!text) return { text: null, json: null };
  try {
    return { text, json: JSON.parse(text) };
  } catch (e) {
    // not JSON
    return { text, json: null };
  }
}

export async function fetchServerStock(sheetKeyRaw, row) {
  const mapped = mapToAvailableSheetKey(sheetKeyRaw) || sheetKeyRaw;
  if (!mapped) return null;

  try {
    const resp = await fetch(
      API_URL + "?sheetKey=" + encodeURIComponent(mapped) + "&_=" + Date.now(),
      { cache: "no-store" }
    );
    if (!resp.ok) {
      console.warn("fetchServerStock non-ok response", mapped, row, resp.status);
      return null;
    }
    const { json } = await safeParseJsonText(resp);
    if (!json || !Array.isArray(json.products)) {
      console.warn("fetchServerStock invalid json shape", mapped, row, json);
      return null;
    }
    const found = json.products.find(p => String(p.row) === String(row));
    if (!found) return null;
    const data = found.data || {};
    const stockVal =
      firstKeyValue(data, ["stock", "cantidad", "Stock"]) || data.Stock || 0;
    return Number(stockVal || 0);
  } catch (e) {
    console.error("fetchServerStock exception", e, sheetKeyRaw, row);
    return null;
  }
}

export function applyNewStockToDOM(mappedKey, row, newStock, getReservedQtyCb) {
  const reservedLocal = getReservedQtyCb
    ? getReservedQtyCb(mappedKey, row)
    : 0;
  const pk = normalizeProductKey(mappedKey, row);

  document.querySelectorAll(".product-card").forEach(card => {
    const cardKey =
      card.dataset.productKey ||
      normalizeProductKey(card.dataset.sheetKey, card.dataset.row);
    if (cardKey === pk) {
      card.dataset.serverStock = String(Number(newStock));
      card.dataset.origStock = String(
        Math.max(0, Number(newStock) + Number(reservedLocal || 0))
      );
    }
  });

  lastProductsCache.forEach(p => {
    if (
      String(p.row) === String(row) &&
      (p.sheetKey || "").toString().trim().toLowerCase() ===
        mappedKey.toString().trim().toLowerCase()
    ) {
      p.data = p.data || {};
      p.data.Stock = Number(newStock);
      p.data.stock = Number(newStock);
    }
  });
}

export async function updateStockOnServer_decrement(
  sheetKeyRaw,
  row,
  qty,
  getReservedQtyCb,
  refreshCardStockDisplayCb
) {
  if (!qty || qty <= 0) return { ok: false };
  // allow fallback to raw key if map fails
  const mapped = mapToAvailableSheetKey(sheetKeyRaw) || sheetKeyRaw;
  if (!mapped) return { ok: false };

  async function applyAndRefresh(newStock) {
    applyNewStockToDOM(mapped, row, newStock, getReservedQtyCb);
    if (refreshCardStockDisplayCb)
      refreshCardStockDisplayCb(mapped, row);
  }

  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "decrement",
        sheetKey: mapped,
        row: String(row),
        qty: Number(qty)
      })
    });

    const { text, json } = await safeParseJsonText(resp);

    if (!resp.ok) {
      console.warn("decrement single non-ok", mapped, row, qty, resp.status, text);
    } else {
      // robust detection of returned stock
      if (json && !json.error) {
        const newStock =
          json.newStock ?? json.new_stock ?? json.stock ?? json.quantity ?? null;
        if (newStock !== null && newStock !== undefined) {
          await applyAndRefresh(Number(newStock));
          return { ok: true, newStock: Number(newStock) };
        }
        // if json ok but no stock field, still consider ok if worker signals success (optional)
        if (json.ok === true || json.success === true) {
          // try to refresh from server to get definitive stock
          const srv = await fetchServerStock(mapped, row);
          if (srv !== null) {
            await applyAndRefresh(Number(srv));
            return { ok: true, newStock: Number(srv) };
          }
          return { ok: true, newStock: null };
        }
      } else {
        console.warn("decrement single unexpected json", mapped, row, qty, json);
      }
    }
  } catch (e) {
    console.error("updateStockOnServer_decrement error (single)", e, mapped, row, qty);
    // fallback will attempt per-unit
  }

  // fallback: parallel singles (one request per qty)
  const promises = [];
  for (let i = 0; i < qty; i++) {
    promises.push(
      fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "decrement",
          sheetKey: mapped,
          row: String(row)
        })
      })
        .then(async r => {
          const { text, json } = await safeParseJsonText(r);
          return { ok: r.ok, json, status: r.status, text };
        })
        .catch(err => ({ ok: false, error: String(err) }))
    );
  }

  const results = await Promise.all(promises);
  let successCount = 0;
  let lastNewStock;

  for (const res of results) {
    if (res && res.ok && res.json && !res.json.error) {
      successCount++;
      const candidate =
        res.json.newStock ?? res.json.new_stock ?? res.json.stock ?? res.json.quantity ?? undefined;
      if (candidate !== undefined) lastNewStock = Number(candidate);
    }
  }

  if (lastNewStock !== undefined) {
    await applyAndRefresh(lastNewStock);
  } else if (successCount > 0) {
    const server = await fetchServerStock(mapped, row);
    if (server !== null) await applyAndRefresh(Number(server));
  } else {
    // nothing succeeded: attempt to log for debugging
    console.warn("updateStockOnServer_decrement: no successful responses", mapped, row, qty, results.slice(0,5));
  }

  return { ok: successCount === qty, newStock: lastNewStock };
}

export async function updateStockOnServer_set(sheetKeyRaw, row, newStock) {
  const mapped = mapToAvailableSheetKey(sheetKeyRaw) || sheetKeyRaw;
  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set",
        sheetKey: mapped,
        row: String(row),
        value: String(newStock)
      })
    });
    const { text, json } = await safeParseJsonText(resp);
    if (!resp.ok) {
      console.warn("updateStockOnServer_set non-ok", mapped, row, resp.status, text);
      return false;
    }
    if (json && !json.error) {
      return true;
    }
    // if no json but 200, still return true (best-effort)
    return resp.ok;
  } catch (e) {
    console.error("updateStockOnServer_set exception", e, sheetKeyRaw, row, newStock);
  }
  return false;
}
