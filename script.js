const menuBtn = document.querySelector(".menu-btn");
const nav = document.querySelector(".site-nav");
const year = document.getElementById("year");
const estimator = document.getElementById("estimator");
const estimateResult = document.getElementById("estimate-result");

if (menuBtn && nav) {
  menuBtn.addEventListener("click", () => {
    const expanded = menuBtn.getAttribute("aria-expanded") === "true";
    menuBtn.setAttribute("aria-expanded", String(!expanded));
    nav.classList.toggle("open");
  });
}

if (year) {
  year.textContent = new Date().getFullYear();
}

if (estimator && estimateResult) {
  estimator.addEventListener("submit", event => {
    event.preventDefault();

    const size = Number(document.getElementById("size").value);
    const multiplier = Number(document.getElementById("type").value);

    const base = size * 410 * multiplier;
    const low = Math.round(base * 0.9 / 1000) * 1000;
    const high = Math.round(base * 1.2 / 1000) * 1000;

    const f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    });

    estimateResult.textContent = `Estimated range: ${f.format(low)} - ${f.format(high)}`;
  });
}

const observer = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
      }
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll(".reveal").forEach(node => observer.observe(node));
