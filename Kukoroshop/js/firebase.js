// js/firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  getIdTokenResult
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  getDatabase,
  ref,
  push,
  set,
  update,
  get,
  remove
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

/* ===========================
   CONFIG - ajusta si hace falta
   =========================== */
// Asegúrate de que databaseURL sea la URL real de tu Realtime Database
const firebaseConfig = {
  apiKey: "AIzaSyD8AG_aIUYEMLiXy3WvZaa5qnPoucC4Uu4",
  authDomain: "kukoroshop.firebaseapp.com",
  projectId: "kukoroshop",
  storageBucket: "kukoroshop.firebasestorage.app",
  messagingSenderId: "477164151404",
  appId: "1:477164151404:web:f85dcf08c657fd544c6e49",
  measurementId: "G-KNJ9282F1Z",
  databaseURL: "https://kukoroshop-default-rtdb.firebaseio.com" // <--- importante
};

const app = initializeApp(firebaseConfig);

// ---------- AUTH ----------
export const auth = getAuth(app);
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  getIdTokenResult
};

// ---------- REALTIME DATABASE ----------
export const db = getDatabase(app);

/**
 * Crea un pedido en /orders y (si hay user.uid) también en /users/{uid}/orders/{orderKey}
 * Devuelve { ok: true, key } o { ok: false, error }.
 *
 * Uso:
 *   const res = await createOrderInDB(orderObj, auth.currentUser);
 *   if (res.ok) console.log('key', res.key)
 */
export async function createOrderInDB(order, user) {
  try {
    const now = Date.now();
    const payload = {
      ...order,
      createdAt: now,
      uid: user?.uid || null,
      userEmail: user?.email || null
    };

    // 1) guardar en /orders (registro maestro)
    const masterRef = push(ref(db, "orders"));
    await set(masterRef, payload);

    // 2) si hay usuario autenticado, guardar copia en users/{uid}/orders/{key}
    if (user?.uid) {
      await set(ref(db, `users/${user.uid}/orders/${masterRef.key}`), payload);
    }

    return { ok: true, key: masterRef.key };
  } catch (err) {
    console.error("createOrderInDB error:", err);
    return { ok: false, error: String(err) };
  }
}

/**
 * ensureUserRecord: crea/actualiza /users/{uid} (no sobrescribe orders)
 */
export async function ensureUserRecord(user) {
  if (!user || !user.uid) return { ok: false, error: "no_user" };
  try {
    const uid = user.uid;
    const email = user.email || null;

    // comprobar /admins/{uid} para role UX
    let isAdmin = false;
    try {
      const adminSnap = await get(ref(db, `admins/${uid}`));
      isAdmin = adminSnap.exists() && adminSnap.val() === true;
    } catch (e) {
      console.warn("[firebase] ensureUserRecord: error reading /admins:", e);
      isAdmin = false;
    }

    const payload = {
      email,
      displayName: user.displayName || null,
      lastLogin: Date.now(),
      role: isAdmin ? "admin" : "client"
    };

    // usamos update para no borrar children (como orders)
    await update(ref(db, `users/${uid}`), payload);
    return { ok: true };
  } catch (err) {
    console.error("[firebase] ensureUserRecord ERROR:", err);
    return { ok: false, error: String(err) };
  }
}

/**
 * setAdminFlag(uid, bool) -> utilidad de desarrollo para marcar /admins/{uid}: true
 * ADVERTENCIA: en producción esto debe hacerse desde tu backend con credenciales administrativas,
 * no desde cliente abierto.
 */
export async function setAdminFlag(uid, flag = true) {
  if (!uid) return { ok: false, error: "no_uid" };
  try {
    await set(ref(db, `admins/${uid}`), !!flag);
    return { ok: true };
  } catch (err) {
    console.error("setAdminFlag error:", err);
    return { ok: false, error: String(err) };
  }
}

// Opcional: exponer auth/db para debugging en consola (solo mientras depuras)
window.__KUKORO__ = window.__KUKORO__ || {};
window.__KUKORO__.auth = auth;
window.__KUKORO__.db = db;
/**
 * Opcional: helper para marcar orden como pagada (si lo necesitas).
 * Actualiza estado y añade metadatos de pago en users/{uid}/orders/{orderKey} y en /orders/{orderKey}
 */
export async function markOrderAsPaid(uid, orderKey, paymentMeta = {}) {
  if (!orderKey) return { ok: false, error: "no_order_key" };
  try {
    const updateObj = {
      estado: "pagado",
      paidAt: Date.now(),
      paymentMeta
    };

    // Intentamos actualizar ambas rutas (si existen)
    try {
      await update(ref(db, `orders/${orderKey}`), updateObj);
    } catch (e) {
      console.warn("[firebase] markOrderAsPaid: no se pudo actualizar /orders:", e);
    }

    if (uid) {
      try {
        await update(ref(db, `users/${uid}/orders/${orderKey}`), updateObj);
      } catch (e) {
        console.warn("[firebase] markOrderAsPaid: no se pudo actualizar users/{uid}/orders:", e);
      }
    }

    return { ok: true };
  } catch (err) {
    console.error("markOrderAsPaid error:", err);
    return { ok: false, error: String(err) };
  }
}




