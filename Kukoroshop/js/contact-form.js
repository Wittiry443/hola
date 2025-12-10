document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contact-form");
  const statusEl = document.getElementById("contact-status");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Limpiar mensaje previo
    statusEl.textContent = "";
    statusEl.className = "contact-status";

    const formData = new FormData(form);
    const nombre = formData.get("nombre");
    const email = formData.get("email");
    const mensaje = formData.get("mensaje");

    // Validación muy básica en front
    if (!nombre || !email || !mensaje) {
      statusEl.textContent = "Por favor completa todos los campos.";
      statusEl.classList.add("contact-status-error");
      return;
    }

    // Deshabilitar botón mientras se envía
    const submitBtn = form.querySelector("button[type='submit']");
    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando...";

    try {
      const res = await fetch(CONTACT_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nombre,
          email,
          mensaje,
          // Puedes enviar también fecha y origen
          createdAt: new Date().toISOString(),
          source: "WyvernStore/contacto",
        }),
      });

      if (!res.ok) {
        throw new Error("Error en el servidor");
      }

      // Si el backend devuelve JSON con mensaje
      // const data = await res.json();

      statusEl.textContent = "Mensaje enviado correctamente. ¡Gracias por escribirnos!";
      statusEl.classList.add("contact-status-success");

      form.reset();
    } catch (err) {
      console.error(err);
      statusEl.textContent =
        "Ocurrió un error al enviar el mensaje. Intenta nuevamente más tarde.";
      statusEl.classList.add("contact-status-error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar mensaje";
    }
  });
});


