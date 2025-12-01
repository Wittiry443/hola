// js/firebase.js
// Inicializa Firebase y exporta helpers de Auth

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ⬇⬇⬇ Pega aquí tu config real de Firebase ⬇⬇⬇
const firebaseConfig = {
 apiKey: "AIzaSyDRj60t21mA7eb2s6N3cgqtMGBwc3BU1b4",
  authDomain: "wyvernstore-11f0e.firebaseapp.com",
  projectId: "wyvernstore-11f0e",
  storageBucket: "wyvernstore-11f0e.firebasestorage.app",
  messagingSenderId: "81806961108",
  appId: "1:81806961108:web:8ae2d5b1980244d5220e41",
  measurementId: "G-CKFZSD52SY"
};
// ⬆⬆⬆ NO dejes los valores de ejemplo ⬆⬆⬆

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Helpers para usar en main.js
export {
  auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
};
