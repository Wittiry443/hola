// js/pedidos.js
import { auth, onAuthStateChanged, db } from "./firebase.js";
import { fmtPrice, escapeHtml } from "./utils.js";
import { ref, onValue, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

// UI elements
const loadingEl = document.getElementById("orders-loading");
const listEl = document.getElementById("orders-list");
const userLabel = document.getElementById("user-label");
const cartBtn = document.getElementById("cart-icon-btn");
const adminBtn = document.getElementById("admin-panel-btn");

// INYECTAR ESTILOS Y MODAL PARA LA FACTURA (Auto-ejecutable)
(function setupInvoiceUI() {
  // 1. Inyectar CSS para el modal
  const style = document.createElement('style');
  style.innerHTML = `
    .invoice-modal-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.6); z-index: 1000; display: none;
      justify-content: center; align-items: center; padding: 20px;
    }
    .invoice-modal {
      background: white; width: 100%; max-width: 600px; max-height: 90vh;
      border-radius: 12px; display: flex; flex-direction: column;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2); overflow: hidden;
    }
    .invoice-header { padding: 20px; background: #f8f9fa; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
    .invoice-body { padding: 20px; overflow-y: auto; }
    .invoice-footer { padding: 15px 20px; border-top: 1px solid #eee; text-align: right; background: #fff; }
    .invoice-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
    .invoice-items-table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px; }
    .invoice-items-table th { text-align: left; border-bottom: 2px solid #eee; padding: 8px; color: #666; }
    .invoice-items-table td { border-bottom: 1px solid #eee; padding: 8px; vertical-align: top; }
    .btn-close-invoice { background: none; border: none; font-size: 24px; cursor: pointer; color: #555; }
    .btn-invoice-action { background: #333; color: #fff; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
    .btn-invoice-action:hover { background: #000; }
    .btn-view-invoice {
        background-color: #fff; border: 1px solid #ccc; padding: 6px 12px;
        border-radius: 6px; cursor: pointer; font-size: 13px; margin-top: 8px; transition: all 0.2s;
    }
    .btn-view-invoice:hover { background-color: #f0f0f0; border-color: #bbb; }
  `;
  document.head.appendChild(style);

  // 2. Crear estructura HTML del modal
  const modalHTML = `
    <div id="invoice-overlay" class="invoice-modal-overlay">
      <div class="invoice-modal">
        <div class="invoice-header">
          <h3 style="margin:0">Detalle de Factura</h3>
          <button id="close-invoice-btn" class="btn-close-invoice">&times;</button>
        </div>
        <div id="invoice-content" class="invoice-body">
          </div>
        <div class="invoice-footer">
          <button class="btn-invoice-action" onclick="window.print()">Imprimir / Guardar PDF</button>
        </div>
        </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // 3. Evento cerrar
  document.getElementById('close-invoice-btn').onclick = () => {
    document.getElementById('invoice-overlay').style.display = 'none';
  };
  // Cerrar al hacer clic fuera
  document.getElementById('invoice-overlay').onclick = (e) => {
    if (e.target.id === 'invoice-overlay') {
        document.getElementById('invoice-overlay').style.display = 'none';
    }
  };
})();

// Safety: ensure required nodes exist
if (!loadingEl || !listEl) {
  console.warn("Elementos de UI de pedidos no encontrados.");
}

// Optional handlers
cartBtn?.addEventListener("click", () => { /* abrir carrito */ });
adminBtn?.addEventListener("click", () => location.href = "admin.html");

// Escuchar estado de autenticación
onAuthStateChanged(auth, async (user) => {
  if (!user) return window.location.href = "index.html";

  if (userLabel) userLabel.textContent = user.email || "";

  try { await auth.currentUser.getIdToken(true); } catch (err) { console.warn("No se pudo refrescar token:", err); }

  listenUserOrders(user.uid, user.email || "");
});

function getCurrentUserInfo() {
  const u = auth.currentUser;
  if (!u) return { uid: null, email: null, displayName: null };
  return { uid: u.uid || null, email: u.email || null, displayName: u.displayName || null };
}

function listenUserOrders(uid, email) {
  loadingEl && (loadingEl.style.display = "block");
  listEl && (listEl.style.display = "none");
  if (listEl) listEl.innerHTML = "";

  const userOrdersRef = ref(db, `users/${uid}/orders`);

  onValue(userOrdersRef, async (snap) => {
    try {
      const val = snap.val();
      if (val && Object.keys(val).length) {
        renderOrdersObject(val);
        return;
      }

      // Fallback a /orders
      const ordersRef = ref(db, "orders");
      const ordersSnap = await get(ordersRef);
      const all = ordersSnap.val() || {};

      const filtered = Object.fromEntries(
        Object.entries(all).filter(([k, o]) => {
          if (!o) return false;
          if (o.uid && String(o.uid) === String(uid)) return true;
          if (o.userEmail && String(o.userEmail).toLowerCase() === String(email).toLowerCase()) return true;
          return false;
        })
      );

      if (Object.keys(filtered).length) {
        renderOrdersObject(filtered);
      } else {
        renderEmpty();
      }
    } catch (err) {
      const ctx = getCurrentUserInfo();
      console.error("Error leyendo orders (fallback):", err, "requesting user:", ctx);
      renderError(err, ctx);
    }
  }, (err) => {
    const ctx = getCurrentUserInfo();
    console.error("Error listening user orders:", err, "requesting user:", ctx);
    renderError(err, ctx);
  });
}

// Renderiza pedidos
function renderOrdersObject(obj) {
  loadingEl && (loadingEl.style.display = "none");
  listEl && (listEl.style.display = "block");
  if (!listEl) return;

  const entries = Object.entries(obj).sort((a, b) => {
    const ta = a[1]?.createdAt || 0;
    const tb = b[1]?.createdAt || 0;
    return tb - ta;
  });

  if (!entries.length) {
    return renderEmpty();
  }

  listEl.innerHTML = "";
  
  entries.forEach(([key, order]) => {
    const idPedido = order.idPedido || key;
    const cliente  = order.cliente || order.userEmail || "Sin cliente";
    const resumen  = order.resumen || summarizeOrder(order) || "Sin resumen";
    const estado   = order.estado || order.status || "pendiente";
    const total    = Number(order.total || 0);

    const createdAt = order.createdAt ? new Date(order.createdAt) : null;
    const createdTxt = createdAt && !isNaN(createdAt.getTime()) ? createdAt.toLocaleString() : "—";

    // ID único para el botón
    const btnId = `btn-invoice-${key}`;

    const html = `
      <article class="order-card" style="border-radius:10px;padding:12px;margin-bottom:12px;box-shadow:0 6px 18px rgba(0,0,0,0.06);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:600">Pedido: ${escapeHtml(String(idPedido))}</div>
            <div style="color:#666;font-size:13px;margin-top:4px">Fecha: ${escapeHtml(createdTxt)} · Cliente: ${escapeHtml(cliente)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:700">${fmtPrice(total)}</div>
            <div style="margin-top:6px">
                <span class="estado" style="padding:6px 10px;border-radius:999px;background:#f0f0f0;font-size:12px;">${escapeHtml(estado)}</span>
            </div>
            </div>
        </div>
        <div style="margin-top:10px;color:#444;font-size:14px;">${escapeHtml(resumen)}</div>
        
        <div style="margin-top:12px; border-top:1px solid #eee; padding-top:8px; text-align:right;">
            <button id="${btnId}" class="btn-view-invoice">📄 Ver Factura</button>
        </div>
      </article>
    `;

    listEl.insertAdjacentHTML("beforeend", html);

    // Asignar evento al botón recién creado
    const btn = document.getElementById(btnId);
    
    // 💡 CONSOLE.LOGS DE VERIFICACIÓN DE ASIGNACIÓN
    console.log(`Intentando asignar evento a ID: ${btnId}. Botón encontrado: ${!!btn}`); 
    
    if(btn) {
        // 🛑 CORRECCIÓN CRÍTICA: Debes llamar a la función showInvoiceDetails
        btn.addEventListener('click', () => showInvoiceDetails(order, idPedido, createdTxt)); 
        console.log(`🎉 Evento asignado correctamente a: ${btnId}`); 
    } else {
        console.error(`❌ ERROR CRÍTICO: Botón ${btnId} no encontrado inmediatamente después de renderizar.`);
    }
  });
}

// LÓGICA PARA LLENAR Y MOSTRAR EL MODAL DE FACTURA
function showInvoiceDetails(order, idDisplay, dateDisplay) {
    // Si la orden es inválida, no hacemos nada
    if (!order || typeof order !== 'object') {
        console.error("El objeto 'order' es inválido o está vacío. No se puede mostrar la factura.", order);
        return;
    }

    const modalOverlay = document.getElementById('invoice-overlay');
    const contentEl = document.getElementById('invoice-content');
    
    // 1. OBTENER ITEMS DETALLADOS (ARRAY)
    const items = Array.isArray(order.items) ? order.items : (Array.isArray(order.cart) ? order.cart : []);
    
    // 2. GENERAR CONTENIDO DE LOS ARTÍCULOS (TABLA O RESUMEN)
    let itemDetailContent = '';
    
    if (items.length > 0) {
        // Opción A: Tenemos la lista detallada de items (ARRAY)
        const itemsHtml = items.map(item => {
            const name = item.name || item.title || item.id || 'Producto (Sin nombre)';
            const qty = item.qty || item.quantity || 1;
            
            return `
                <tr>
                    <td>
                        <strong style="display:block;color:#333;">${escapeHtml(name)}</strong>
                        <span style="font-size:12px;color:#888;">Ref: ${item.id || '-'}</span>
                    </td>
                    <td style="text-align:center;">${qty}</td>
                    <td style="text-align:right;">—</td>
                    <td style="text-align:right;">—</td>
                </tr>
            `;
        }).join('');

        itemDetailContent = `
            <table class="invoice-items-table">
                <thead>
                    <tr>
                        <th style="width:70%">Producto</th>
                        <th style="text-align:center;">Cant.</th>
                        <th style="text-align:right;">Precio</th>
                        <th style="text-align:right;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>
        `;

    } else if (order.resumen) {
        // Opción B: Solo tenemos el resumen (STRING)
        itemDetailContent = `
            <div style="margin: 15px 0; padding: 15px; border: 1px dashed #ccc; border-radius: 8px; background: #f9f9f9;">
                <strong style="display: block; margin-bottom: 5px; color: #444;">Resumen de Artículos (Detalle Completo No Disponible):</strong>
                <p style="margin: 0; font-size: 14px; color: #555;">${escapeHtml(order.resumen)}</p>
            </div>
        `;
    } else {
        // Opción C: No hay detalle ni resumen
        itemDetailContent = `<div style="text-align:center;padding:20px;color:#777;">No hay items ni resumen detallado disponible para esta orden.</div>`;
    }

    // Extracción de Cliente/Dirección
    const clienteNameDisplay = order.cliente || order.userEmail || "Cliente no especificado";
    const direccionDisplay = order.shipping?.address || order.shipping?.addressLine || order.address || order.direccion || "No especificada";
    const telefonoDisplay = order.shipping?.phone || order.phone || order.telefono || "—";
    
    // CORRECCIÓN CLAVE: Definición de costo de envío
    const shippingCost = Number(order.shipping?.cost || order.shippingCost || 0);


    const html = `
        <div style="margin-bottom:20px; border-bottom:1px solid #eee; padding-bottom:10px;">
            <h4 style="margin:0 0 5px 0; color:#444;">Kukoro-shop</h4>
            <div style="font-size:13px; color:#666;">Confirmación de Orden</div>
        </div>

        <div style="display:flex; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:20px;">
            <div style="flex:1; min-width:200px;">
                <strong style="color:#333; display:block; margin-bottom:4px;">Facturar a:</strong>
                <div style="color:#555; font-size:14px;">
                    Cliente: ${escapeHtml(clienteNameDisplay)}<br>
                    Dirección: ${escapeHtml(direccionDisplay)}<br>
                    Teléfono: ${escapeHtml(telefonoDisplay)}
                </div>
            </div>
            <div style="flex:1; min-width:200px; text-align:right;">
                 <strong style="color:#333; display:block; margin-bottom:4px;">Detalles:</strong>
                 <div style="color:#555; font-size:14px;">
                    ID: <strong>${escapeHtml(String(idDisplay))}</strong><br>
                    Fecha: ${escapeHtml(dateDisplay)}<br>
                    Estado: ${escapeHtml(order.estado || order.status || 'Pendiente')}
                 </div>
            </div>
        </div>

        ${itemDetailContent}

        <div style="border-top:2px solid #eee; padding-top:15px;">
            <div class="invoice-row">
                <span>Subtotal:</span>
                <span>${fmtPrice(order.subtotal || (order.total - shippingCost) || 0)}</span>
            </div>
            ${shippingCost > 0 ? `
            <div class="invoice-row">
                <span>Envío:</span>
                <span>${fmtPrice(shippingCost)}</span>
            </div>` : ''}
            <div class="invoice-row" style="font-size:18px; font-weight:bold; color:#000; margin-top:10px;">
                <span>TOTAL:</span>
                <span>${fmtPrice(order.total || 0)}</span>
            </div>
        </div>
    `;

  contentEl.innerHTML = html;
    // 💡 CONSOLE.LOG DE EJECUCIÓN DEL MODAL
    console.log(`✅ Modal de factura generado y listo para mostrar para ID: ${idDisplay}`); 
    modalOverlay.style.display = 'flex';
}

function summarizeOrder(order) {
  if (!order) return "";
  if (order.resumen) return order.resumen;
  if (Array.isArray(order.items) && order.items.length) {
    return order.items.slice(0,4).map(it => `${it.name || it.title || it.id || 'item'} x${it.qty||it.quantity||1}`).join(", ");
  }
  if (Array.isArray(order.cart) && order.cart.length) {
    return order.cart.slice(0,4).map(it => `${it.name || it.id || 'item'} x${it.qty||1}`).join(", ");
  }
  return "";
}

function renderEmpty() {
  loadingEl && (loadingEl.style.display = "none");
  listEl && (listEl.style.display = "block");
  if (listEl) listEl.innerHTML = `<div style="padding:18px;color:#777;text-align:center">No tienes pedidos registrados todavía.</div>`;
}

function renderError(err, userCtx = null) {
  loadingEl && (loadingEl.style.display = "none");
  listEl && (listEl.style.display = "block");
  const msg = (err && err.message) ? escapeHtml(err.message) : "Error desconocido";

  let userInfoHtml = "";
  if (userCtx) {
    const u = escapeHtml(String(userCtx.uid || "null"));
    const e = escapeHtml(String(userCtx.email || "null"));
    const d = escapeHtml(String(userCtx.displayName || "null"));
    userInfoHtml = `<div style="margin-top:8px;font-size:12px;color:#999">Request user — uid: ${u} · email: ${e} · name: ${d}</div>`;
  }

  if (listEl) listEl.innerHTML = `<div style="padding:18px;color:#f55;text-align:center">No se pudieron cargar tus pedidos: ${msg}${userInfoHtml}</div>`;
}
