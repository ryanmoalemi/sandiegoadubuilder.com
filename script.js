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
  const sizeInput = document.getElementById("size");
  const typeInput = document.getElementById("type");
  const finishInput = document.getElementById("finish");
  const siteInput = document.getElementById("site");
  const utilityInput = document.getElementById("utility");
  const bathroomsInput = document.getElementById("bathrooms");

  const size = Number(sizeInput?.value || 650);
  const type = typeInput?.value || "detached";
  const finish = finishInput?.value || "standard";
  const site = siteInput?.value || "typical";
  const utility = utilityInput?.value || "possible";
  const bathrooms = bathroomsInput?.value || "one";

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
  if (!estimateResult) {
    return;
  }

  const estimate = calculateEstimate();
  estimateResult.textContent = `Estimated range: ${toCurrency(estimate.roundedLow)} - ${toCurrency(estimate.roundedHigh)}`;
  if (estimateBreakdown) {
    estimateBreakdown.textContent = `${estimate.size} sq ft model: hard costs ${toCurrency(estimate.hardLow)}-${toCurrency(estimate.hardHigh)}, soft costs ${toCurrency(estimate.softLow)}-${toCurrency(estimate.softHigh)}, sitework ${toCurrency(estimate.siteLow)}-${toCurrency(estimate.siteHigh)}, utilities ${toCurrency(estimate.utilityLow)}-${toCurrency(estimate.utilityHigh)}.`;
  }
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

if (estimator && estimateResult) {
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

async function renderAduMonthlyUpdates() {
  const list = document.getElementById("adu-updates-list");
  const meta = document.getElementById("adu-updates-meta");
  const chip = document.getElementById("adu-sync-chip");
  if (!list) {
    return;
  }

  try {
    const response = await fetch(`adu-updates.json?v=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items.slice(0, 8) : [];

    if (items.length === 0) {
      list.innerHTML = "<li>No confirmed updates were detected for this month yet.</li>";
    } else {
      list.innerHTML = items
        .map(
          item =>
            `<li><a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.title}</a> <span>(${item.source})</span></li>`
        )
        .join("");
    }

    if (meta) {
      const generated = payload.generatedAt ? new Date(payload.generatedAt) : null;
      const generatedText = generated && !Number.isNaN(generated.getTime())
        ? generated.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
        : "Unknown";
      meta.textContent = `Last widget refresh: ${generatedText}`;
      if (chip) {
        chip.textContent = `Updated ${generatedText}`;
      }
    }
  } catch (error) {
    list.innerHTML =
      "<li>Widget temporarily unavailable. Please use the official source links below.</li>";
    if (meta) {
      meta.textContent = "Last widget refresh: unavailable";
    }
    if (chip) {
      chip.textContent = "Update unavailable";
    }
  }
}

renderAduMonthlyUpdates();

function initHandbookLeadForm() {
  const form = document.getElementById("handbook-lead-form");
  const status = document.getElementById("handbook-form-status");
  if (!form || !status) {
    return;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const email = String(form.elements.email?.value || "").trim();
    const consent = form.elements.consent?.checked;
    const submitButton = form.querySelector('button[type="submit"]');

    if (!email || !consent) {
      status.textContent = "Please enter a valid email and accept updates to get the handbook.";
      return;
    }

    status.textContent = "Submitting your request...";
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Sending...";
    }

    try {
      const endpoint = form.dataset.endpoint || form.action;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json"
        },
        body: new FormData(form)
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (String(payload.success).toLowerCase() !== "true") {
        const activationMessage =
          "Form activation is still pending. Please open the activation email sent by FormSubmit and click Activate Form.";
        status.textContent = payload.message ? `${activationMessage}` : activationMessage;
        return;
      }

      form.reset();
      status.textContent = "Thank you. Your request is in and we will send your ADU Handbook details soon.";
    } catch (error) {
      status.textContent = "We could not submit right now. Please try again in a moment.";
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Send Me The ADU Handbook";
      }
    }
  });
}

initHandbookLeadForm();
