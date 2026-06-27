import { writeFileSync } from "node:fs";

const targets = [
  {
    key: "regulatory",
    source: "San Diego City Development Services",
    url: "https://www.sandiego.gov/development-services/regulatory-updates"
  },
  {
    key: "ldc",
    source: "San Diego City Planning",
    url: "https://www.sandiego.gov/planning/work/land-development-code/updates-in-process"
  },
  {
    key: "hcd",
    source: "California HCD",
    url: "https://www.hcd.ca.gov/building-standards/adu/handbook"
  }
];

function nowParts() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return { now, window: `${yyyy}-${mm}` };
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeAbsolute(base, maybeUrl) {
  try {
    return new URL(maybeUrl, base).toString();
  } catch {
    return null;
  }
}

function extractMonthlyLinks(html, baseUrl, monthWindow) {
  const out = [];
  const matches = html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);

  for (const match of matches) {
    const href = match[1];
    const text = stripTags(match[2]);
    if (!text || text.length < 6) continue;

    const abs = normalizeAbsolute(baseUrl, href);
    if (!abs) continue;

    const haystack = `${abs} ${text}`.toLowerCase();
    if (!haystack.includes(monthWindow)) continue;

    const isRelevant = /(adu|jadu|housing|land development code|ldc|regulatory|permit|ordinance|code|bill|legislative)/i.test(
      haystack
    );
    if (!isRelevant) continue;

    out.push({ title: text, url: abs });
  }

  return out.slice(0, 8);
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ADUWidgetBot/1.0; +https://sandiegoadubuilder.com/)"
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

async function main() {
  const { now, window } = nowParts();
  const items = [];

  for (const target of targets) {
    try {
      const html = await fetchHtml(target.url);
      const links = extractMonthlyLinks(html, target.url, window);
      for (const link of links) {
        items.push({ ...link, source: target.source });
      }
    } catch (error) {
      items.push({
        title: `Auto-check could not parse ${target.source} updates this run`,
        url: target.url,
        source: target.source
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = `${item.url}|${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  const fallback = [
    {
      title: "Review current San Diego City ADU and JADU rules",
      url: "https://www.sandiego.gov/development-services/news-programs/programs/companion-junior-units",
      source: "San Diego City Development Services"
    },
    {
      title: "Review San Diego City Regulatory Updates",
      url: "https://www.sandiego.gov/development-services/regulatory-updates",
      source: "San Diego City Development Services"
    },
    {
      title: "Review 2026 Land Development Code Update materials",
      url: "https://www.sandiego.gov/planning/work/land-development-code/updates-in-process",
      source: "San Diego City Planning"
    }
  ];

  const payload = {
    generatedAt: now.toISOString(),
    window,
    items: unique.length > 0 ? unique.slice(0, 12) : fallback
  };

  writeFileSync("adu-updates.json", `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Updated adu-updates.json with ${payload.items.length} items for ${window}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
