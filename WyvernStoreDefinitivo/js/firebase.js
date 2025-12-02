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

// 🔥 PON AQUÍ TUS DATOS REALES DE FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyDRj60t21mA7eb2s6N3cgqtMGBwc3BU1b4",
  authDomain: "wyvernstore-11f0e.firebaseapp.com",
  projectId: "wyvernstore-11f0e",
  storageBucket: "wyvernstore-11f0e.firebasestorage.app",
  messagingSenderId: "81806961108",
  appId: "1:81806961108:web:8ae2d5b1980244d5220e41",
  measurementId: "G-CKFZSD52SY"
};

const app = initializeApp(firebaseConfig);

// Auth
export const auth = getAuth(app);
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
};

// Realtime Database
export const db = getDatabase(app);

/**
 * Guarda un pedido en /orders en la Realtime Database.
 * Devuelve la key generada para el pedido.
 */
export async function createOrderInDB(order) {
  const ordersRef = ref(db, "orders");
  const newRef = push(ordersRef);  // genera una key única
  await set(newRef, order);
  return newRef.key;               // esta será tu "id real" en la DB
}
