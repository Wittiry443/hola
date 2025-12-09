// setAdmin.js
// Uso: node setAdmin.js <UID> [true|false]
// Ejemplo: node setAdmin.js J9g9pktzs6gU1t6DP0HHSw5cRLD3 true
//
// Requisitos:
// 1) Descarga el serviceAccount JSON desde Firebase Console -> Project settings -> Service accounts -> "Generate new private key"
//    y colócalo junto a este archivo con el nombre: serviceAccountKey.json
// 2) Ejecuta: npm init -y && npm i firebase-admin
// 3) Ejecuta el script con node

const admin = require('firebase-admin');
const path = require('path');

const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');

try {
  const serviceAccount = require(KEY_PATH);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    // Opcional: si necesitas interactuar con Realtime DB desde este script,
    // habilita databaseURL con tu URL real:
    // databaseURL: "https://kukoroshop-default-rtdb.firebaseio.com"
  });
} catch (err) {
  console.error("No se pudo cargar serviceAccountKey.json. Asegúrate de tener el archivo en la misma carpeta.");
  console.error(err);
  process.exit(1);
}

const uid = process.argv[2];
let value = process.argv[3];

if (!uid) {
  console.error("Uso: node setAdmin.js <UID> [true|false]");
  process.exit(1);
}

// default: true (asignar admin)
if (typeof value === 'undefined') value = 'true';
const isAdmin = String(value).toLowerCase() !== 'false';

(async () => {
  try {
    await admin.auth().setCustomUserClaims(uid, { admin: isAdmin });
    console.log(`✅ Claim set: uid=${uid} -> admin=${isAdmin}`);

    // opcional: mostrar el usuario y sus claims actuales
    const user = await admin.auth().getUser(uid);
    console.log("Usuario:", { uid: user.uid, email: user.email });
    // recuperar token no es posible desde Admin SDK aquí, pero confirmamos claims leyendo el usuario
    console.log("Claims actuales (según Auth):", user.customClaims || {});

    console.log("\nSiguiente paso (cliente): haz que el admin ejecute en el navegador o recarga su token:");
    console.log("  await auth.currentUser.getIdToken(true);");
    console.log("y luego comprobar getIdTokenResult(auth.currentUser) para ver claims.\n");

    process.exit(0);
  } catch (err) {
    console.error("Error asignando claim:", err);
    process.exit(1);
  }
})();
