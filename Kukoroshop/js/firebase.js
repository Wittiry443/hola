// js/firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  getDatabase,
  ref,
  push,
  set,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

// 🔥 Configuración de tu proyecto Firebase
const firebaseConfig = {
  apiKey: "AIzaSyD8AG_aIUYEMLiXy3WvZaa5qnPoucC4Uu4",
  authDomain: "kukoroshop.firebaseapp.com",
  projectId: "kukoroshop",
  storageBucket: "kukoroshop.firebasestorage.app",
  messagingSenderId: "477164151404",
  appId: "1:477164151404:web:f85dcf08c657fd544c6e49",
  measurementId: "G-KNJ9282F1Z"
  // IMPORTANT: si usas Realtime Database, añade aquí la URL desde la consola:
};

const app = initializeApp(firebaseConfig);

// ---------- AUTH ----------
export const auth = getAuth(app);
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
};

// ---------- REALTIME DATABASE ----------
export const db = getDatabase(app);

/**
 * Guarda un pedido en /orders en la Realtime Database.
 * Devuelve un objeto { ok: boolean, key: string|null, error: string|null }
 */
export async function createOrderInDB(order, user = null) {
  try {
    const ordersRef = ref(db, "orders");
    const newRef = push(ordersRef);
    const now = Date.now();
    const payload = {
      ...order,
      createdAt: now,
      uid: user?.uid || null,
      userEmail: user?.email || null
    };

    // Guardar en /orders
    await set(newRef, payload);

    // Guardar copia bajo /users/{uid}/orders/{orderKey} (si tenemos uid)
    if (user?.uid) {
      const userOrderRef = ref(db, `users/${user.uid}/orders/${newRef.key}`);
      await set(userOrderRef, payload);
    }

    return { ok: true, key: newRef.key, error: null };
  } catch (err) {
    return { ok: false, key: null, error: String(err) };
  }
}
