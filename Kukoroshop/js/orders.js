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
(function setupInvoiceUI() {// ====== setupInvoiceUI (reemplaza la existente) ======
(function setupInvoiceUI() {
  // quitar si ya existe (evita duplicados en hot-reload)
  if (document.getElementById('invoice-overlay')) return;

  const style = document.createElement('style');
  style.innerHTML = `
    .invoice-modal-overlay {
      position: fixed; inset: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.6); z-index: 99999; display: none;
      justify-content: center; align-items: center; padding: 20px;
    }
    .invoice-modal { background: white; width: 100%; max-width: 720px; max-height: 90vh;
      border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      overflow: hidden;
    }
    .invoice-header { padding: 16px 20px; background: #f8f9fa; border-bottom: 1px solid #eee; display:flex;justify-content:space-between;align-items:center;}
    .invoice-body { padding: 18px; overflow-y:auto; max-height:calc(90vh - 160px); }
    .invoice-footer { padding: 12px 18px; border-top:1px solid #eee; text-align:right; background:#fff; }
    .invoice-items-table { width:100%; border-collapse:collapse; margin:12px 0; font-size:14px; }
    .invoice-items-table th{ text-align:left; border-bottom:2px solid #eee; padding:8px; color:#666; }
    .invoice-items-table td{ border-bottom:1px solid #eee; padding:8px; vertical-align:top; }
    .btn-close-invoice { background:none; border:none; font-size:24px; cursor:pointer; color:#555; }
    .btn-invoice-action { background:#111; color:#fff; padding:8px 14px; border-radius:8px; border:none; cursor:pointer; }
  `;
  document.head.appendChild(style);

  const modalHTML = `
    <div id="invoice-overlay" class="invoice-modal-overlay" aria-hidden="true" role="dialog" aria-modal="true">
      <div class="invoice-modal" role="document">
        <div class="invoice-header">
          <h3 style="margin:0;font-size:18px">Detalle de Factura</h3>
          <div>
            <button id="close-invoice-btn" class="btn-close-invoice" aria-label="Cerrar factura">&times;</button>
          </div>
        </div>
        <div id="invoice-content" class="invoice-body"></div>
        <div class="invoice-footer">
          <button id="print-invoice-btn" class="btn-invoice-action">Imprimir / Guardar PDF</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // wiring seguro de eventos
  const overlay = document.getElementById('invoice-overlay');
  const closeBtn = document.getElementById('close-invoice-btn');
  const printBtn = document.getElementById('print-invoice-btn');

  if (closeBtn) closeBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    window.removeEventListener('keydown', handleEsc);
  });

  // click fuera para cerrar
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      document.documentElement.style.overflow = '';
      window.removeEventListener('keydown', handleEsc);
    }
  });

  // print
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  // escape key
  function handleEsc(ev) {
    if (ev.key === 'Escape') { overlay.style.display = 'none'; overlay.setAttribute('aria-hidden','true'); document.documentElement.style.overflow = ''; window.removeEventListener('keydown', handleEsc); }
  }
})();

// ====== showInvoiceDetails robusta (reemplaza la existente) ======
function showInvoiceDetails(order, idDisplay, dateDisplay) {
  try {
    // checks rápidos
    if (!order || typeof order !== 'object') {
      console.error("showInvoiceDetails: order inválido", order);
      return;
    }

    const overlay = document.getElementById('invoice-overlay');
    const contentEl = document.getElementById('invoice-content');
    if (!overlay || !contentEl) {
      console.error("showInvoiceDetails: elementos del modal no encontrados", { overlay: !!overlay, contentEl: !!contentEl });
      return;
    }

    // DEBUG: log de contexto
    console.log("showInvoiceDetails called — id:", idDisplay, "orderKey sample:", order.idPedido || "(no id)","user:", (auth.currentUser && auth.currentUser.email) || null);

    // construir items (igual que antes)
    const items = Array.isArray(order.items) ? order.items : (Array.isArray(order.cart) ? order.cart : []);
    let itemsHtml = '';
    if (items.length) {
      itemsHtml = items.map(it => {
        const nm = escapeHtml(it.nombre || it.name || it.title || 'Producto');
        const qty = Number(it.cantidad || it.qty || it.quantity || 1);
        const price = (it.precioUnitario !== undefined ? Number(it.precioUnitario) : (it.price || 0));
        const lineTotal = (price * qty) || 0;
        return `<tr><td><strong>${nm}</strong><div style="font-size:12px;color:#888;">Ref: ${escapeHtml(it.id || '-')}</div></td><td style="text-align:center;">${qty}</td><td style="text-align:right;">${fmtPrice(price)}</td><td style="text-align:right;">${fmtPrice(lineTotal)}</td></tr>`;
      }).join('');
      itemsHtml = `<table class="invoice-items-table"><thead><tr><th style="width:60%">Producto</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">Precio</th><th style="text-align:right;">Total</th></tr></thead><tbody>${itemsHtml}</tbody></table>`;
    } else if (order.resumen) {
      itemsHtml = `<div style="margin:12px 0;padding:12px;border:1px dashed #ddd;border-radius:8px;background:#fafafa"><strong>Resumen:</strong><div style="margin-top:6px">${escapeHtml(order.resumen)}</div></div>`;
    } else {
      itemsHtml = `<div style="text-align:center;padding:18px;color:#777">No hay detalle de items.</div>`;
    }

    const clienteNameDisplay = escapeHtml(order.cliente || order.userEmail || "Cliente no especificado");
    const direccionDisplay = escapeHtml(order.shipping?.address || order.address || order.direccion || 'No especificada');
    const telefonoDisplay = escapeHtml(order.shipping?.phone || order.phone || order.telefono || '—');
    const shippingCost = Number(order.shipping?.cost || order.shippingCost || 0);
    const subtotal = Number(order.subtotal || (order.total - shippingCost) || 0);
    const total = Number(order.total || 0);

    const html = `
      <div style="margin-bottom:14px;border-bottom:1px solid #eee;padding-bottom:8px;">
        <h4 style="margin:0 0 6px 0;color:#222">Kukoro-shop</h4>
        <div style="font-size:13px;color:#666">Confirmación de Orden</div>
      </div>

      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:14px;">
        <div style="flex:1;min-width:180px;">
          <strong style="display:block;margin-bottom:6px;color:#333">Facturar a:</strong>
          <div style="color:#555;font-size:14px">
            ${clienteNameDisplay}<br>
            ${direccionDisplay}<br>
            ${telefonoDisplay}
          </div>
        </div>
        <div style="flex:1;min-width:180px;text-align:right;">
          <strong style="display:block;margin-bottom:6px;color:#333">Detalles:</strong>
          <div style="color:#555;font-size:14px">
            ID: <strong>${escapeHtml(String(idDisplay))}</strong><br>
            Fecha: ${escapeHtml(String(dateDisplay))}<br>
            Estado: ${escapeHtml(order.estado || order.status || 'Pendiente')}
          </div>
        </div>
      </div>

      ${itemsHtml}

      <div style="border-top:2px solid #eee;padding-top:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Subtotal:</span><span>${fmtPrice(subtotal)}</span></div>
        ${shippingCost > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Envío:</span><span>${fmtPrice(shippingCost)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-weight:700;font-size:16px;margin-top:6px"><span>TOTAL:</span><span>${fmtPrice(total)}</span></div>
      </div>
    `;

    contentEl.innerHTML = html;

    // mostrar modal: set display y bloquear scroll de fondo
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    // forzar repaint y scroll to top del modal body
    overlay.scrollTop = 0;
    contentEl.scrollTop = 0;

    // add ESC handler once
    const escHandler = (e) => { if (e.key === 'Escape') { overlay.style.display='none'; overlay.setAttribute('aria-hidden','true'); document.documentElement.style.overflow=''; window.removeEventListener('keydown', escHandler); } };
    window.addEventListener('keydown', escHandler);

    console.log(`✅ Modal mostrado para ID: ${idDisplay}`, { overlayVisible: overlay.style.display, contentLength: contentEl.innerHTML.length });
  } catch (err) {
    console.error("showInvoiceDetails EXCEPTION:", err);
  }
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
