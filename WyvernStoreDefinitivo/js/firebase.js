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
  apiKey: "AIzaSyDRj60t21mA7eb2s6N3cgqtMGBwc3BU1b4",
  authDomain: "wyvernstore-11f0e.firebaseapp.com",
  projectId: "wyvernstore-11f0e",
  storageBucket: "wyvernstore-11f0e.firebasestorage.app",
  messagingSenderId: "81806961108",
  appId: "1:81806961108:web:8ae2d5b1980244d5220e41",
  measurementId: "G-CKFZSD52SY",
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
