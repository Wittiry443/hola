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
  get
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
// re-export funciones auth que usas en otros módulos
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
 * Devuelve la key (string) del pedido en /orders.
 *
 * Uso: const key = await createOrderInDB(order, auth.currentUser);
 */
export async function createOrderInDB(order, user = null) {
  try {
    const now = Date.now();
    // Normaliza payload (no sobreescribir createdAt si ya viene)
    const payload = {
      ...order,
      createdAt: order.createdAt || now,
      uid: user?.uid || null,
      userEmail: user?.email || null
    };

    // Push en /orders
    const ordersRef = ref(db, "orders");
    const newRef = push(ordersRef);
    await set(newRef, payload);

    // Copia en /users/{uid}/orders/{key} para facilitar "Mis pedidos"
    if (user?.uid) {
      await set(ref(db, `users/${user.uid}/orders/${newRef.key}`), payload);
    }

    console.log("[firebase] createOrderInDB -> saved, key:", newRef.key);
    return newRef.key;
  } catch (err) {
    console.error("[firebase] createOrderInDB ERROR:", err);
    throw err; // el caller puede capturar el error
  }
}

/**
 * Crea/actualiza el registro público del usuario en /users/{uid}
 * - Guarda email, displayName, lastLogin y role ("admin" si existe /admins/{uid}, "client" por defecto)
 * - Usa update para no borrar children existentes (como orders)
 *
 * Nota de seguridad: role escrito aquí es para UX; no uses role del cliente para reglas de seguridad.
 * Para reglas seguras, usa /admins/{uid} marcado desde servidor o Admin SDK.
 */
export async function ensureUserRecord(user) {
  if (!user || !user.uid) return { ok: false, error: "no_user" };
  try {
    const uid = user.uid;
    const email = user.email || null;

    // Chequea si existe /admins/{uid} (marcado desde servidor/script)
    let isAdmin = false;
    try {
      const adminSnap = await get(ref(db, `admins/${uid}`));
      isAdmin = adminSnap.exists() && adminSnap.val() === true;
    } catch (e) {
      // no crítico, solo logueamos
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
