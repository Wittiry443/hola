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
  // databaseURL: "https://<tu-proyecto>.firebaseio.com",
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
export async function createOrderInDB(order) {
  try {
    console.log("[firebase] createOrderInDB -> saving order", order);

    const ordersRef = ref(db, "orders");
    const newRef = push(ordersRef);  // genera una key única
    await set(newRef, order);

    console.log("[firebase] createOrderInDB -> saved, key:", newRef.key);
    return { ok: true, key: newRef.key, error: null };
  } catch (err) {
    console.error("[firebase] createOrderInDB ERROR:", err);
    // Devolvemos el error en forma segura para que el cliente lo loguee/decida qué hacer
    return { ok: false, key: null, error: String(err) };
  }
}

