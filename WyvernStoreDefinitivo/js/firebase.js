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
  // ⚠️ Opcional pero recomendado si usan Realtime Database:
  // databaseURL: "PEGAS_AQUÍ_LA_URL_DE_LA_RTDB_DESDE_LA_CONSOLA",
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
 * Devuelve la key generada para el pedido.
 *
 * Estructura esperada del "order" que le manda cart.js:
 * {
 *   idPedido: string,
 *   cliente: string,
 *   resumen: string,
 *   total: number,
 *   estado: "pendiente" | "pagado" | lo que definan,
 *   createdAt: ISOString,
 *   items: [
 *     { nombre, cantidad, precioUnitario },
 *     ...
 *   ]
 * }
 */
export async function createOrderInDB(order) {
  const ordersRef = ref(db, "orders");
  const newRef = push(ordersRef);  // genera una key única
  await set(newRef, order);
  return newRef.key;               // esta será tu "id real" en la DB (para el dashboard)
}
