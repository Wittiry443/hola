// js/products.js
// Lógica de productos, categorías, render y búsqueda

import { API_URL } from "./config.js";
import {
  firstKeyValue,
  fmtPrice,
  makeImgEl,
  observeLazyImages,
  escapeHtml,
} from "./utils.js";

import {
  lastProductsCache,
  setLastProductsCache,
  lastLoadedSheetKey,
  setLastLoadedSheetKey,
  availableSheetKeys,
  setAvailableSheetKeys,
} from "./state.js";

import { mapToAvailableSheetKey } from "./stock.js";

import {
  addToCartFromCard,
  getReservedQty,
  getOriginalStock,
  refreshCardStockDisplay,
} from "./cart.js";

import { populateCarouselFromProducts } from "./carousel.js";
import { openImageModal } from "./modals.js";

// Elementos principales del DOM
const tabsRow = document.getElementById("tabsRow");
const productsGrid = document.getElementById("productsGrid");

// -----------------------------------------------------
// RENDERIZADO DE PRODUCTOS
// -----------------------------------------------------

export function renderProducts(products, sheetKey) {
  if (!products || !products.length) {
    productsGrid.innerHTML =
      '<div style="text-align:center;width:100%;padding:40px;color:#aaa">No hay productos</div>';
    populateCarouselFromProducts(lastProductsCache, 6, openImageModal);
    return;
  }

  // Normalizamos cache local
  const normalizedCache = (products || []).map((p) => ({
    row: p.row,
    sheetKey: (
      p.sheetKey ||
      (p.data && (p.data.Categoria || p.data.categoria)) ||
      sheetKey ||
      "UNKNOWN"
    ).toString(),
    data: p.data || {},
  }));
  setLastProductsCache(normalizedCache);

  productsGrid.innerHTML = "";
  const frag = document.createDocumentFragment();

  normalizedCache.forEach((p) => {
    const d = p.data || {};

    const name =
      firstKeyValue(d, ["name", "nombre", "producto", "Nombre"]) ||
      d.Nombre ||
      "Sin nombre";

    const price =
      firstKeyValue(d, ["price", "precio", "Precio"]) || d.Precio || "";

    const stock = Number(
      firstKeyValue(d, ["stock", "cantidad", "Stock"]) || d.Stock || 0
    );

    const imgUrl =
      firstKeyValue(d, ["img", "Img", "imagen", "image", "url", "Imagen"]) ||
      d.Img ||
      "";

    const description =
      firstKeyValue(d, [
        "descripcion",
        "Descripcion",
        "description",
        "desc",
        "nota",
        "Nota",
      ]) ||
      d.descripcion ||
      "";

    const productSheetKey =
      mapToAvailableSheetKey(
        p.sheetKey || d.Categoria || d.categoria || "UNKNOWN"
      ) || (p.sheetKey || d.Categoria || d.categoria || "UNKNOWN");

    const pk = `${String(productSheetKey).trim().toLowerCase()}::${String(
      p.row
    )}`;

    const card = document.createElement("div");
    card.className = "product-card";
    card.dataset.origStock = String(stock);
    card.dataset.price = price;
    card.dataset.row = String(p.row);
    card.dataset.sheetKey = String(productSheetKey);
    card.dataset.productKey = pk;

    // 👇 guardamos también la URL original de la imagen en el dataset,
    // para que el carrito pueda recuperarla
    if (imgUrl) {
      card.dataset.imgUrl = imgUrl;
    }

    if (d.Stock !== undefined) {
      card.dataset.serverStock = String(Number(d.Stock || 0));
    }

    card.innerHTML = `
      <div class="image-wrap" style="min-height:320px; display:flex; align-items:center; justify-content:center; background:#020617; border-radius:14px;">
        <div class="prod-img-placeholder" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#888">🖼️</div>
      </div>
      <div class="product-info">
        <div class="product-title">${escapeHtml(name)}</div>
        <div>
          <div class="product-price">
            ${price ? "$ " + fmtPrice(price) : "-"}
          </div>
        </div>
        <div style="margin-top:8px">
          <span class="stock-badge">
            Stock:
            <span class="stockval">
              ${Math.max(
                0,
                stock - getReservedQty(productSheetKey, p.row)
              )}
            </span>
          </span>
        </div>
        <div style="margin-top:10px;color:#cbd5f5;font-size:0.9rem;max-height:60px;overflow:hidden">
          ${escapeHtml(String(description || "Sin descripción"))}
        </div>
        <div class="product-actions" style="margin-top:12px">
          <button class="qty-btn minus">−</button>
          <div class="qty-display">1</div>
          <button class="qty-btn plus">+</button>
          <button class="product-btn">Agregar</button>
        </div>
      </div>
    `;

    // --- Imagen: implementación igual al carousel.js ---
    const wrap = card.querySelector(".image-wrap");
    if (imgUrl && /^https?:\/\//i.test(imgUrl)) {
      // Creamos la imagen forzando eager (makeImgEl debe aplicar proxy si está implementado allí)
      const imgEl = makeImgEl(imgUrl, name, "product-image", true);
      imgEl.loading = "eager";
      imgEl.style.maxHeight = "320px";
      imgEl.style.width = "auto";
      wrap.innerHTML = "";
      wrap.appendChild(imgEl);

      // Modal con la URL original (igual que en carousel)
      imgEl.addEventListener("click", () => openImageModal(imgUrl, name));
    }
    // -------------------------------------------------------

    frag.appendChild(card);
  });

  productsGrid.appendChild(frag);

  // Delegación de eventos (una sola vez)
  if (!productsGrid._hasDelegation) {
    productsGrid.addEventListener("click", (e) => {
      const plus = e.target.closest(".plus");
      if (plus) {
        e.preventDefault();
        const card = plus.closest(".product-card");
        if (!card) return;
        const qtySpan = card.querySelector(".qty-display");
        const current = Number(qtySpan?.innerText || "1");
        const orig = getOriginalStock(
          card.dataset.sheetKey,
          card.dataset.row,
          lastProductsCache
        );
        const maxQty = Math.max(
          0,
          orig - getReservedQty(card.dataset.sheetKey, card.dataset.row)
        );
        if (current < maxQty) qtySpan.innerText = current + 1;
        return;
      }

      const minus = e.target.closest(".minus");
      if (minus) {
        e.preventDefault();
        const card = minus.closest(".product-card");
        if (!card) return;
        const qtySpan = card.querySelector(".qty-display");
        const current = Number(qtySpan?.innerText || "1");
        if (current > 1) qtySpan.innerText = current - 1;
        return;
      }

      const orderBtn = e.target.closest(".product-btn");
      if (orderBtn) {
        e.preventDefault();
        const card = orderBtn.closest(".product-card");
        if (!card) return;
        const qty = Number(
          card.querySelector(".qty-display")?.innerText || "1"
        );
        addToCartFromCard(card, qty, lastProductsCache, lastLoadedSheetKey);
        return;
      }
    });

    productsGrid._hasDelegation = true;
  }

  // Actualizar stocks visibles en las tarjetas
  document.querySelectorAll(".product-card").forEach((c) =>
    refreshCardStockDisplay(c.dataset.sheetKey, c.dataset.row, lastProductsCache)
  );

  // Carrusel con los mismos productos
  populateCarouselFromProducts(normalizedCache, 6, openImageModal);
  observeLazyImages(productsGrid);
}

// -----------------------------------------------------
// CATEGORÍAS / TABS
// -----------------------------------------------------

export async function loadCategories() {
  try {
    const r = await fetch(`${API_URL}?_=${Date.now()}`, {
      cache: "no-store",
    });
    const data = await r.json();
    if (!data.sheets) throw new Error("Respuesta inválida de sheets");

    const keys = (data.sheets || []).map((s) => s.key).filter(Boolean);
    setAvailableSheetKeys(keys);
    renderTabs(data.sheets);
  } catch (e) {
    if (tabsRow) {
      tabsRow.innerHTML =
        '<div style="color:#f88">Error cargando categorías</div>';
    }
  }
}

function renderTabs(sheets) {
  if (!tabsRow) return;
  tabsRow.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.className = "tab active";
  allBtn.innerText = "Todos";
  allBtn.onclick = () => {
    document
      .querySelectorAll(".tab")
      .forEach((t) => t.classList.remove("active"));
    allBtn.addClass?.("active");
    loadProductsAll();
  };
  tabsRow.appendChild(allBtn);

  (sheets || []).forEach((s) => {
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.innerText = s.key;
    btn.dataset.key = s.key;
    btn.onclick = () => {
      document
        .querySelectorAll(".tab")
        .forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      loadProductsFor(s.key);
    };
    tabsRow.appendChild(btn);
  });

  // Cargamos todos por defecto
  loadProductsAll();
}

// -----------------------------------------------------
// LOAD POR CATEGORÍA / TODOS
// -----------------------------------------------------

export async function loadProductsFor(sheetKey) {
  setLastLoadedSheetKey(sheetKey);
  productsGrid.innerHTML =
    '<div id="loadingMessage" style="text-align:center;width:100%;padding:40px;color:#aaa">Cargando productos...</div>';

  try {
    const r = await fetch(
      `${API_URL}?sheetKey=${encodeURIComponent(sheetKey)}&_=${Date.now()}`,
      { cache: "no-store" }
    );
    const data = await r.json();
    if (data.error) {
      productsGrid.innerHTML =
        '<div style="text-align:center;color:#f88">Error: ' +
        escapeHtml(data.message || "") +
        "</div>";
      return;
    }
    const products = (data.products || []).map((p) => {
      if (!p.sheetKey) p.sheetKey = sheetKey;
      p.data = p.data || {};
      return p;
    });

    setLastProductsCache(
      products.map((p) => ({
        row: p.row,
        sheetKey: p.sheetKey || sheetKey,
        data: p.data || {},
      }))
    );

    renderProducts(products, sheetKey);
  } catch (e) {
    productsGrid.innerHTML =
      '<div style="text-align:center;color:#f88">Error cargando productos</div>';
  }
}

export async function loadProductsAll() {
  setLastLoadedSheetKey("ALL");
  productsGrid.innerHTML =
    '<div style="text-align:center;width:100%;padding:40px;color:#aaa">Cargando todos los productos...</div>';

  try {
    const r = await fetch(`${API_URL}?all=1&_=${Date.now()}`, {
      cache: "no-store",
    });
    const data = await r.json();
    if (data.error) {
      productsGrid.innerHTML =
        '<div style="text-align:center;color:#f88">Error: ' +
        escapeHtml(data.message || "") +
        "</div>";
      return;
    }

    let products = (data.products || []).map((p) => {
      p.data = p.data || {};
      return p;
    });

    products.forEach((p) => {
      const d = p.data || {};
      const cat = d.Categoria || d.categoria || p.sheetKey || "UNKNOWN";
      p.sheetKey = mapToAvailableSheetKey(cat) || String(cat);
    });

    setLastProductsCache(
      products.map((p) => ({
        row: p.row,
        sheetKey:
          (p.sheetKey ||
            (p.data && (p.data.Categoria || p.data.categoria)) ||
            "UNKNOWN"
          ).toString(),
        data: p.data || {},
      }))
    );

    renderProducts(products, "ALL");
  } catch (e) {
    productsGrid.innerHTML =
      '<div style="text-align:center;color:#f88">Error cargando productos</div>';
  }
}

// -----------------------------------------------------
// BÚSQUEDA EN EL CATÁLOGO
// -----------------------------------------------------

export function searchProducts() {
  const input = document.getElementById("searchInput");
  if (!input) return;

  const term = (input.value || "").trim().toLowerCase();
  if (!term) {
    if (lastLoadedSheetKey === "ALL" || !lastLoadedSheetKey) {
      loadProductsAll();
    } else {
      loadProductsFor(lastLoadedSheetKey);
    }
    return;
  }

  const cache = lastProductsCache || [];
  const filtered = cache.filter((p) => {
    const d = p.data || {};
    const name =
      firstKeyValue(d, ["name", "nombre", "producto", "Nombre"]) ||
      d.Nombre ||
      "";
    const description =
      firstKeyValue(d, [
        "descripcion",
        "Descripcion",
        "description",
        "desc",
        "nota",
        "Nota",
      ]) || d.descripcion || "";
    return (
      String(name).toLowerCase().includes(term) ||
      String(description).toLowerCase().includes(term)
    );
  });

  renderProducts(filtered, lastLoadedSheetKey || "ALL");
}

// -----------------------------------------------------
// LOAD MORE (placeholder)
// -----------------------------------------------------

export function loadMore() {
  alert("La opción 'Ver más' aún no está implementada. 😅");
}

