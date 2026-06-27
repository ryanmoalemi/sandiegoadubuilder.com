const menuBtn = document.querySelector(".menu-btn");
const nav = document.querySelector(".site-nav");
const year = document.getElementById("year");
const estimator = document.getElementById("estimator");
const estimateResult = document.getElementById("estimate-result");
const estimateBreakdown = document.getElementById("estimate-breakdown");

const COST_MODEL = {
  hardCostPerSqFt: {
    detached: { low: 430, high: 560 },
    attached: { low: 390, high: 515 },
    garage: { low: 300, high: 430 }
  },
  finishMultiplier: {
    standard: 1,
    premium: 1.12,
    luxury: 1.25
  },
  softCostPercent: { low: 0.18, high: 0.24 },
  siteCost: {
    clear: { low: 15000, high: 30000 },
    typical: { low: 30000, high: 55000 },
    constrained: { low: 55000, high: 90000 }
  },
  utilityAllowance: {
    none: { low: 0, high: 8000 },
    possible: { low: 8000, high: 25000 },
    likely: { low: 25000, high: 55000 }
  },
  bathAdjustment: {
    one: { low: 0, high: 0 },
    two: { low: 15000, high: 30000 }
  },
  contingencyPercent: { low: 0.05, high: 0.1 }
};

function roundToThousand(value) {
  return Math.round(value / 1000) * 1000;
}

function toCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function calculateEstimate() {
  const size = Number(document.getElementById("size").value);
  const type = document.getElementById("type").value;
  const finish = document.getElementById("finish").value;
  const site = document.getElementById("site").value;
  const utility = document.getElementById("utility").value;
  const bathrooms = document.getElementById("bathrooms").value;

  const hard = COST_MODEL.hardCostPerSqFt[type];
  const finishFactor = COST_MODEL.finishMultiplier[finish];
  const siteCost = COST_MODEL.siteCost[site];
  const utilityCost = COST_MODEL.utilityAllowance[utility];
  const bathCost = COST_MODEL.bathAdjustment[bathrooms];

  const hardLow = size * hard.low * finishFactor;
  const hardHigh = size * hard.high * finishFactor;

  const softLow = hardLow * COST_MODEL.softCostPercent.low;
  const softHigh = hardHigh * COST_MODEL.softCostPercent.high;

  const preContingencyLow = hardLow + softLow + siteCost.low + utilityCost.low + bathCost.low;
  const preContingencyHigh =
    hardHigh + softHigh + siteCost.high + utilityCost.high + bathCost.high;

  const totalLow =
    preContingencyLow + preContingencyLow * COST_MODEL.contingencyPercent.low;
  const totalHigh =
    preContingencyHigh + preContingencyHigh * COST_MODEL.contingencyPercent.high;

  const roundedLow = roundToThousand(totalLow);
  const roundedHigh = roundToThousand(totalHigh);

  return {
    size,
    roundedLow,
    roundedHigh,
    hardLow: roundToThousand(hardLow),
    hardHigh: roundToThousand(hardHigh),
    softLow: roundToThousand(softLow),
    softHigh: roundToThousand(softHigh),
    siteLow: siteCost.low,
    siteHigh: siteCost.high,
    utilityLow: utilityCost.low,
    utilityHigh: utilityCost.high
  };
}

function renderEstimate() {
  if (!estimateResult || !estimateBreakdown) {
    return;
  }

  const estimate = calculateEstimate();
  estimateResult.textContent = `Estimated range: ${toCurrency(estimate.roundedLow)} - ${toCurrency(estimate.roundedHigh)}`;
  estimateBreakdown.textContent = `${estimate.size} sq ft model: hard costs ${toCurrency(estimate.hardLow)}-${toCurrency(estimate.hardHigh)}, soft costs ${toCurrency(estimate.softLow)}-${toCurrency(estimate.softHigh)}, sitework ${toCurrency(estimate.siteLow)}-${toCurrency(estimate.siteHigh)}, utilities ${toCurrency(estimate.utilityLow)}-${toCurrency(estimate.utilityHigh)}.`;
}

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

if (estimator && estimateResult && estimateBreakdown) {
  estimator.addEventListener("submit", event => {
    event.preventDefault();
    renderEstimate();
  });

  renderEstimate();
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
