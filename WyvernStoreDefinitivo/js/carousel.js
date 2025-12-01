// js/carousel.js
import { makeImgEl, escapeHtml, fmtPrice } from "./utils.js";
import { observeLazyImages } from "./utils.js";

let currentSlide = 0;
let totalSlides = 0;

const carouselEl = document.querySelector(".carousel");
const carouselDots = document.getElementById("carouselDots");

export function populateCarouselFromProducts(products, maxSlides = 6, openImageModalCb) {
  if (!carouselEl) return;
  const slides = [];

  for (let i = 0; i < (products || []).length && slides.length < maxSlides; i++) {
    const p = products[i];
    const d = p.data || {};
    const img =
      d.Img ||
      d.img ||
      d.imagen ||
      d.image ||
      d.url ||
      d.Imagen ||
      null;
    if (img && /^https?:\/\//i.test(img)) {
      slides.push({
        img,
        title:
          d.Nombre ||
          d.nombre ||
          d.name ||
          d.producto ||
          "Producto",
        price: d.Precio || d.precio || d.price || ""
      });
    }
  }

  if (!slides.length) {
    carouselEl.innerHTML = "";
    if (carouselDots) carouselDots.innerHTML = "";
    totalSlides = 0;
    return;
  }

  carouselEl.innerHTML = "";
  slides.forEach(s => {
    const item = document.createElement("div");
    item.className = "carousel-item";

    const wrap = document.createElement("div");
    wrap.className = "carousel-img-wrap";

    const imgEl = makeImgEl(s.img, s.title, "carousel-img", true);
    imgEl.loading = "eager";
    wrap.appendChild(imgEl);

    const caption = document.createElement("div");
    caption.className = "carousel-caption";
    caption.innerHTML = `
      <h3>${escapeHtml(s.title || "")}</h3>
      <p>${s.price ? "$ " + fmtPrice(s.price) : ""}</p>
    `;

    item.appendChild(wrap);
    item.appendChild(caption);
    carouselEl.appendChild(item);

    if (openImageModalCb) {
      imgEl.addEventListener("click", () => openImageModalCb(s.img, s.title));
    }
  });

  totalSlides =
    document.querySelectorAll(".carousel .carousel-item").length || 1;
  initDots();
  goToSlide(0);
  observeLazyImages(carouselEl);
}

function initDots() {
  if (!carouselDots) return;
  carouselDots.innerHTML = "";
  for (let i = 0; i < totalSlides; i++) {
    const dot = document.createElement("div");
    dot.className = "dot";
    if (i === 0) dot.classList.add("active");
    dot.addEventListener("click", () => goToSlide(i));
    carouselDots.appendChild(dot);
  }
}

export function moveCarousel(direction) {
  if (totalSlides <= 1) return;
  currentSlide += direction;
  if (currentSlide < 0) currentSlide = totalSlides - 1;
  if (currentSlide >= totalSlides) currentSlide = 0;
  updateCarousel();
}

export function goToSlide(idx) {
  currentSlide = idx;
  updateCarousel();
}

function updateCarousel() {
  if (!carouselEl) return;
  carouselEl.style.transform = `translateX(-${currentSlide * 100}%)`;
  const dots = document.querySelectorAll(".dot");
  dots.forEach((d, i) => d.classList.toggle("active", i === currentSlide));
}

// autoplay
setInterval(() => {
  if (totalSlides > 1) moveCarousel(1);
}, 5000);
