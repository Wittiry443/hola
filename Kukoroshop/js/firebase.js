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
      // normalizamos createdAt a timestamp numérico para consistencia
      createdAt: now,
      uid: user?.uid || null,
      userEmail: user?.email || null
    };

    // 1) push en /orders (índice central)
    const ordersRef = push(ref(db, "orders"));
    await set(ordersRef, payload);
    const key = ordersRef.key;

    // 2) si tenemos usuario, guardar copia en users/{uid}/orders/{key}
    if (user?.uid) {
      try {
        await set(ref(db, `users/${user.uid}/orders/${key}`), payload);
      } catch (e) {
        // no abortamos si falla la copia en users, pero lo logueamos
        console.warn("[firebase] createOrderInDB: fallo al escribir users/{uid}/orders copy:", e);
      }
    }

    return { ok: true, key };
  } catch (err) {
    console.error("createOrderInDB error:", err);
    return { ok: false, error: String(err) };
  }
}

/**
 * Crea/actualiza el registro público del usuario en /users/{uid}
 * - Guarda email, displayName, lastLogin y role ("admin" si existe /admins/{uid}, "client" por defecto)
 * - Usa update para no borrar children existentes (como orders)
 *
 * Retorna { ok: true } o { ok: false, error }
 */
export async function ensureUserRecord(user) {
  if (!user || !user.uid) return { ok: false, error: "no_user" };
  try {
    const uid = user.uid;
    const email = user.email || null;

    // Chequea si existe /admins/{uid} (marcado desde servidor/Admin SDK)
    let isAdmin = false;
    try {
      const adminSnap = await get(ref(db, `admins/${uid}`));
      isAdmin = adminSnap.exists() && adminSnap.val() === true;
    } catch (e) {
      console.warn("[firebase] ensureUserRecord: error leyendo /admins:", e);
      isAdmin = false;
    }

    const payload = {
      email,
      displayName: user.displayName || null,
      lastLogin: Date.now(),
      role: isAdmin ? "admin" : "client"
    };

    // update para no borrar orders si existen
    await update(ref(db, `users/${uid}`), payload);

    console.log("[firebase] ensureUserRecord OK for", uid);
    return { ok: true };
  } catch (err) {
    console.error("[firebase] ensureUserRecord ERROR:", err);
    return { ok: false, error: String(err) };
  }
}

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



