import { CART_STORAGE_KEY } from "./config.js";

export let lastProductsCache = [];
export let availableSheetKeys = [];
export let lastLoadedSheetKey = null;
export let cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");

export function setLastProductsCache(arr) {
  lastProductsCache = arr || [];
}
export function setAvailableSheetKeys(arr) {
  availableSheetKeys = arr || [];
}
export function setLastLoadedSheetKey(key) {
  lastLoadedSheetKey = key;
}
export function setCart(newCart) {
  cart = newCart || [];
}

export function saveCart() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

export function normalizeProductKey(sheetKey, row) {
  return `${String(sheetKey || "").trim().toLowerCase()}::${String(row)}`;
}

