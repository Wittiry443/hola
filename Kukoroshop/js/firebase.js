// js/firebase.js (versión con logging/diagnóstico)
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
const firebaseConfig = {
  apiKey: "AIzaSyD8AG_aIUYEMLiXy3WvZaa5qnPoucC4Uu4",
  authDomain: "kukoroshop.firebaseapp.com",
  projectId: "kukoroshop",
  storageBucket: "kukoroshop.firebasestorage.app",
  messagingSenderId: "477164151404",
  appId: "1:477164151404:web:f85dcf08c657fd544c6e49",
  measurementId: "G-KNJ9282F1Z",
  databaseURL: "https://kukoroshop-default-rtdb.firebaseio.com" // importante: confirma que sea la tuya
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

/* =============
   Funciones DB
   ============= */

/**
 * Crea un pedido: guarda en /orders (maestro) y copia en users/{uid}/orders/{key} si hay user.uid.
 * Devuelve { ok: true, key } o { ok: false, error }.
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

    console.log("[firebase] createOrderInDB -> payload:", payload);

    // master record
    const masterRef = push(ref(db, "orders"));
    await set(masterRef, payload);
    console.log(`[firebase] createOrderInDB -> saved master orders/${masterRef.key}`);

    // copy into user node if possible
    if (user?.uid) {
      await set(ref(db, `users/${user.uid}/orders/${masterRef.key}`), payload);
      console.log(`[firebase] createOrderInDB -> saved users/${user.uid}/orders/${masterRef.key}`);
    } else {
      console.log("[firebase] createOrderInDB -> no user.uid, saved only to /orders");
    }

    return { ok: true, key: masterRef.key };
  } catch (err) {
    console.error("[firebase] createOrderInDB error:", err);
    return { ok: false, error: String(err) };
  }
}

/**
 * ensureUserRecord: crea/actualiza /users/{uid} sin sobreescribir orders.
 */
export async function ensureUserRecord(user) {
  if (!user || !user.uid) return { ok: false, error: "no_user" };
  try {
    const uid = user.uid;
    const email = user.email || null;

    // comprobar /admins/{uid} para role UX (no para reglas de seguridad)
    let isAdmin = false;
    try {
      const adminSnap = await get(ref(db, `admins/${uid}`));
      isAdmin = adminSnap.exists() && adminSnap.val() === true;
      console.log(`[firebase] ensureUserRecord -> /admins/${uid} =`, adminSnap.val());
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

    await update(ref(db, `users/${uid}`), payload);
    console.log("[firebase] ensureUserRecord OK for", uid, payload);
    return { ok: true };
  } catch (err) {
    console.error("[firebase] ensureUserRecord ERROR:", err);
    return { ok: false, error: String(err) };
  }
}

/**
 * setAdminFlag(uid, flag) - utilidad de desarrollo (no usar en producción sin proteger)
 */
export async function setAdminFlag(uid, flag = true) {
  if (!uid) return { ok: false, error: "no_uid" };
  try {
    await set(ref(db, `admins/${uid}`), !!flag);
    console.log(`[firebase] setAdminFlag -> admins/${uid} =`, !!flag);
    return { ok: true };
  } catch (err) {
    console.error("setAdminFlag error:", err);
    return { ok: false, error: String(err) };
  }
}

/**
 * markOrderAsPaid(uid, orderKey, paymentMeta)
 */
export async function markOrderAsPaid(uid, orderKey, paymentMeta = {}) {
  if (!orderKey) return { ok: false, error: "no_order_key" };
  try {
    const updateObj = {
      estado: "pagado",
      paidAt: Date.now(),
      paymentMeta
    };

    try {
      await update(ref(db, `orders/${orderKey}`), updateObj);
      console.log("[firebase] markOrderAsPaid -> /orders updated:", orderKey);
    } catch (e) {
      console.warn("[firebase] markOrderAsPaid: could not update /orders:", e);
    }

    if (uid) {
      try {
        await update(ref(db, `users/${uid}/orders/${orderKey}`), updateObj);
        console.log("[firebase] markOrderAsPaid -> users copy updated:", `users/${uid}/orders/${orderKey}`);
      } catch (e) {
        console.warn("[firebase] markOrderAsPaid: could not update users copy:", e);
      }
    }
    return { ok: true };
  } catch (err) {
    console.error("markOrderAsPaid error:", err);
    return { ok: false, error: String(err) };
  }
}

/* =========================
   Helpers de debugging
   =========================
   Exponen funciones a window.__KUKORO__.debug
*/

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch (e) { return text; }
}

const Debug = {
  config: firebaseConfig,

  printBasicInfo() {
    console.groupCollapsed("[KUKORO DEBUG] Basic info");
    console.log("app.options (firebase config):", app.options || firebaseConfig);
    console.log("firebaseConfig (local copy):", firebaseConfig);
    console.groupEnd();
  },

  async logCurrentUserFull() {
    console.groupCollapsed("[KUKORO DEBUG] currentUser / token / claims");
    try {
      console.log("auth.currentUser (raw):", auth.currentUser);
      if (!auth.currentUser) {
        console.warn("No hay auth.currentUser (usuario no autenticado)");
        console.groupEnd();
        return;
      }
      const token = await auth.currentUser.getIdToken();
      console.log("idToken (first 80 chars):", token ? token.substring(0,80) + "..." : null);
      try {
        const idRes = await getIdTokenResult(auth.currentUser);
        console.log("idTokenResult.claims:", idRes.claims);
      } catch (e) {
        console.warn("Could not getIdTokenResult:", e);
      }
    } catch (err) {
      console.error("logCurrentUserFull error:", err);
    }
    console.groupEnd();
  },

  /**
   * Intenta leer /admins/<uid> y /users/<uid>/orders por SDK (get) y por REST (fetch + token)
   * - Muestra errores completos
   */
  async readAdminAndUserOrdersViaSDKAndREST() {
    console.groupCollapsed("[KUKORO DEBUG] readAdminAndUserOrdersViaSDKAndREST");
    try {
      if (!auth.currentUser) {
        console.warn("No auth.currentUser - autentica primero.");
        console.groupEnd();
        return;
      }
      const uid = auth.currentUser.uid;
      console.log("current uid:", uid);

      // SDK read admins/<uid>
      try {
        const adminSnap = await get(ref(db, `admins/${uid}`));
        console.log("SDK: /admins/" + uid + " ->", adminSnap.exists() ? adminSnap.val() : null);
      } catch (e) {
        console.error("SDK read /admins error:", e);
      }

      // SDK read users/<uid>/orders
      try {
        const ordersSnap = await get(ref(db, `users/${uid}/orders`));
        console.log("SDK: /users/" + uid + "/orders ->", ordersSnap.exists() ? ordersSnap.val() : null);
      } catch (e) {
        console.error("SDK read /users/.../orders error:", e);
      }

      // Ahora REST read con token (misma ruta)
      try {
        const token = await auth.currentUser.getIdToken();
        const dbUrl = firebaseConfig.databaseURL.replace(/\/$/, "");
        console.log("Using REST DB URL:", dbUrl);

        // /admins
        try {
          const r = await fetch(`${dbUrl}/admins/${uid}.json?auth=${token}`);
          const text = await r.text();
          console.log("REST /admins/<uid> status", r.status, "body:", safeJsonParse(text));
        } catch (e) {
          console.error("REST fetch /admins error:", e);
        }

        // /users/<uid>/orders
        try {
          const r2 = await fetch(`${dbUrl}/users/${uid}/orders.json?auth=${token}`);
          const txt2 = await r2.text();
          console.log("REST /users/<uid>/orders status", r2.status, "body:", safeJsonParse(txt2));
        } catch (e) {
          console.error("REST fetch /users orders error:", e);
        }

      } catch (e) {
        console.warn("Could not fetch token for REST tests:", e);
      }

    } catch (err) {
      console.error("readAdminAndUserOrdersViaSDKAndREST error:", err);
    }
    console.groupEnd();
  },

  /**
   * Intenta leer root 'users' para provocar permission_denied si las reglas lo hacen.
   */
  async tryReadUsersRoot() {
    console.groupCollapsed("[KUKORO DEBUG] tryReadUsersRoot");
    try {
      try {
        const snap = await get(ref(db, "users"));
        console.log("SDK read /users ->", snap.exists() ? snap.val() : null);
      } catch (e) {
        console.error("SDK read /users error:", e);
      }

      // REST
      try {
        const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
        const dbUrl = firebaseConfig.databaseURL.replace(/\/$/, "");
        const r = await fetch(`${dbUrl}/users.json${token ? `?auth=${token}` : ""}`);
        const txt = await r.text();
        console.log("REST /users -> status", r.status, "body:", safeJsonParse(txt));
      } catch (e) {
        console.error("REST fetch /users error:", e);
      }
    } catch (err) {
      console.error("tryReadUsersRoot error:", err);
    }
    console.groupEnd();
  },

  /**
   * Run a battery of checks: prints user, claims, tries SDK/REST reads.
   */
  async runAll() {
    console.groupCollapsed("[KUKORO DEBUG] runAll start");
    this.printBasicInfo();
    await this.logCurrentUserFull();
    await this.readAdminAndUserOrdersViaSDKAndREST();
    await this.tryReadUsersRoot();
    console.groupEnd();
    console.log("[KUKORO DEBUG] runAll finished");
  }
};

// exposer en window para acceder desde consola
window.__KUKORO__ = window.__KUKORO__ || {};
window.__KUKORO__.auth = auth;
window.__KUKORO__.db = db;
window.__KUKORO__.debug = Debug;
window.__KUKORO__.createOrderInDB = createOrderInDB;
window.__KUKORO__.ensureUserRecord = ensureUserRecord;
window.__KUKORO__.setAdminFlag = setAdminFlag;
window.__KUKORO__.markOrderAsPaid = markOrderAsPaid;

/* ===========================
   Auto-logging on auth changes
   =========================== */
onAuthStateChanged(auth, async (user) => {
  console.groupCollapsed("[KUKORO DEBUG] onAuthStateChanged");
  if (user) {
    console.log("User signed in:", { uid: user.uid, email: user.email, providerData: user.providerData });
    // actualizar token e imprimir claims
    try {
      await user.getIdToken(true); // force refresh to pick up claims if any
      const idR = await getIdTokenResult(user);
      console.log("Token claims after refresh:", idR.claims);
    } catch (e) {
      console.warn("Could not refresh token or read claims:", e);
    }

    // run lightweight checks (no heavy fetches)
    try {
      console.log("Attempting SDK read for /admins/<uid> and /users/<uid>/orders (SDK)");
      const adminSnap = await get(ref(db, `admins/${user.uid}`)).catch(e => { throw e; });
      console.log("/admins/<uid> (SDK) =>", adminSnap.exists() ? adminSnap.val() : null);
      const ordersSnap = await get(ref(db, `users/${user.uid}/orders`)).catch(e => { throw e; });
      console.log("/users/<uid>/orders (SDK) =>", ordersSnap.exists() ? ordersSnap.val() : null);
    } catch (e) {
      console.error("Error reading admin/users orders on auth change (SDK):", e);
    }

  } else {
    console.log("User signed out.");
  }
  console.groupEnd();
});

/* ===========================
   Export functions adicionales
   =========================== */
export {
  createOrderInDB as createOrderInDBExport,
  ensureUserRecord as ensureUserRecordExport,
  setAdminFlag as setAdminFlagExport,
  markOrderAsPaid as markOrderAsPaidExport
};


