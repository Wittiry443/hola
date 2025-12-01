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

export async function fetchServerStock(sheetKeyRaw, row) {
  const mapped = mapToAvailableSheetKey(sheetKeyRaw) || sheetKeyRaw;
  if (!mapped) return null;

  const resp = await fetch(
    API_URL + "?sheetKey=" + encodeURIComponent(mapped) + "&_=" + Date.now(),
    { cache: "no-store" }
  );
  if (!resp.ok) return null;
  const json = await resp.json().catch(() => null);
  if (!json || !Array.isArray(json.products)) return null;

  const found = json.products.find(p => String(p.row) === String(row));
  if (!found) return null;
  const data = found.data || {};
  const stockVal =
    firstKeyValue(data, ["stock", "cantidad", "Stock"]) || data.Stock || 0;
  return Number(stockVal || 0);
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
  const mapped = mapToAvailableSheetKey(sheetKeyRaw);
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
    const text = await resp.text().catch(() => null);
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (e) {
      json = null;
    }

    if (resp.ok && json && !json.error && json.newStock !== undefined) {
      await applyAndRefresh(Number(json.newStock));
      return { ok: true, newStock: Number(json.newStock) };
    }
  } catch (e) {
    // fallback
  }

  // fallback: varias requests individuales
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
          const t = await r.text().catch(() => null);
          let j = null;
          try {
            j = t ? JSON.parse(t) : null;
          } catch (e) {
            j = null;
          }
          return { ok: r.ok, json: j };
        })
        .catch(() => ({ ok: false }))
    );
  }

  const results = await Promise.all(promises);
  let successCount = 0;
  let lastNewStock;

  for (const res of results) {
    if (res && res.ok && res.json && !res.json.error) {
      successCount++;
      if (res.json.newStock !== undefined) {
        lastNewStock = Number(res.json.newStock);
      }
    }
  }

  if (lastNewStock !== undefined) {
    await applyAndRefresh(lastNewStock);
  } else if (successCount > 0) {
    const server = await fetchServerStock(mapped, row);
    if (server !== null) await applyAndRefresh(Number(server));
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
    const text = await resp.text().catch(() => null);
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (e) {
      json = null;
    }
    if (resp.ok && json && !json.error) {
      return true;
    }
  } catch (e) {}
  return false;
}
