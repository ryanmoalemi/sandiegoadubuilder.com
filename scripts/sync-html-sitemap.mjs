import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;

const LABELS = {
  "/": "Home",
  "/index.html": "Home",
  "/san-diego-adus.html": "San Diego ADUs",
  "/adu-handbook.html": "ADU Handbook",
  "/detached-adus.html": "Detached",
  "/attached-adus.html": "Attached",
  "/adu-garage-conversions.html": "Garage conversions",
  "/jadus.html": "JADUs",
  "/adu-permitting.html": "Permitting",
  "/adu-feasibility-studies.html": "Feasibility studies",
  "/pre-approved-adu-plans.html": "Pre-approved plans",
  "/adu-cost.html": "Cost",
  "/adu-financing.html": "Financing",
  "/adu-rental-income.html": "Rental income",
  "/about.html": "About",
  "/authors/joe-mark.html": "Joe Mark author page",
  "/sitemap.html": "Site map"
};

const GROUPS = {
  "/": "start",
  "/index.html": "start",
  "/san-diego-adus.html": "start",
  "/adu-handbook.html": "start",
  "/detached-adus.html": "types",
  "/attached-adus.html": "types",
  "/adu-garage-conversions.html": "types",
  "/jadus.html": "types",
  "/adu-permitting.html": "plans",
  "/adu-feasibility-studies.html": "plans",
  "/pre-approved-adu-plans.html": "plans",
  "/adu-cost.html": "money",
  "/adu-financing.html": "money",
  "/adu-rental-income.html": "money",
  "/about.html": "about",
  "/authors/joe-mark.html": "about",
  "/sitemap.html": "about"
};

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizePath(href) {
  if (!href || href.startsWith("#") || href.startsWith("mailto:")) return "";
  try {
    if (/^https?:/i.test(href)) {
      const url = new URL(href);
      if (url.hostname.replace(/^www\./, "") !== "sandiegoadubuilder.com") return "";
      href = url.pathname;
    }
  } catch {
    return "";
  }
  const path = href.split("#")[0].split("?")[0];
  if (path === "" || path === "/" || path === "/index.html" || path === "index.html") return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function groupMarkup(html) {
  return [...html.matchAll(/<ul\b[^>]*data-sitemap-group="[^"]+"[^>]*>[\s\S]*?<\/ul>/gi)]
    .map((match) => match[0])
    .join("\n");
}

function linkedPaths(html) {
  const paths = new Set();
  for (const match of groupMarkup(html).matchAll(/href\s*=\s*(["'])(.*?)\1/gi)) {
    const path = normalizePath(match[2]);
    if (path) paths.add(path);
  }
  return paths;
}

function cityLabel(filename) {
  const slug = filename.replace(/-adu-builder\.html$/i, "");
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pageTitle(pathname) {
  if (LABELS[pathname]) return LABELS[pathname];
  const local = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  try {
    const html = readFileSync(join(root, local), "utf8");
    const title = html.match(/<title>([^<]*)<\/title>/i);
    if (title) return title[1].replace(/\s+/g, " ").trim();
  } catch {
    // fall through to the filename
  }
  const base = local.replace(/\.html$/, "").split("/").pop() || "Page";
  return base
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isNoindex(pathname) {
  const local = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  try {
    const html = readFileSync(join(root, local), "utf8");
    const robots = html.match(/<meta[^>]*name=["']robots["'][^>]*>/i);
    return robots ? /noindex/i.test(robots[0]) : false;
  } catch {
    return false;
  }
}

function replaceGroup(html, group, items) {
  const pattern = new RegExp(
    `(<ul\\b[^>]*data-sitemap-group="${group}"[^>]*>)[\\s\\S]*?(</ul>)`
  );
  if (!pattern.test(html)) return html;
  const body = items.length ? `\n        ${items.join("\n        ")}\n      ` : "";
  return html.replace(pattern, `$1${body}$2`);
}

function appendItem(html, group, item) {
  const pattern = new RegExp(
    `(<ul\\b[^>]*data-sitemap-group="${group}"[^>]*>)([\\s\\S]*?)(</ul>)`
  );
  if (!pattern.test(html)) return html;
  return html.replace(pattern, (_, open, body, close) => {
    const trimmed = body.replace(/\s*$/, "");
    return `${open}${trimmed}\n        ${item}\n      ${close}`;
  });
}

export function syncHtmlSitemap() {
  const warnings = [];
  const added = [];
  let html;
  let sitemap;
  try {
    html = readFileSync(join(root, "sitemap.html"), "utf8");
    sitemap = readFileSync(join(root, "sitemap.xml"), "utf8");
  } catch (error) {
    warnings.push(`HTML sitemap sync skipped: ${error.message}`);
    return { added, warnings };
  }

  const cityItems = readdirSync(root)
    .filter((name) => /-adu-builder\.html$/i.test(name))
    .sort()
    .filter((name) => !isNoindex(`/${name}`))
    .map((name) => `<li><a href="/${name}">${escapeHtml(cityLabel(name))}</a></li>`);
  html = replaceGroup(html, "city", cityItems);

  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  for (const loc of locs) {
    let pathname = "";
    try {
      pathname = normalizePath(loc);
    } catch {
      warnings.push(`Skipped unparseable sitemap URL: ${loc}`);
      continue;
    }
    if (!pathname) continue;
    if (isNoindex(pathname)) {
      warnings.push(`Left noindex URL off the HTML sitemap: ${loc}`);
      continue;
    }
    if (linkedPaths(html).has(pathname)) continue;
    const group = /-adu-builder\.html$/i.test(pathname) ? "city" : GROUPS[pathname] || "extra";
    const href = pathname === "/" ? "/" : pathname;
    const item = `<li><a href="${href}">${escapeHtml(pageTitle(pathname))}</a></li>`;
    const next = appendItem(html, group, item);
    if (next === html) {
      warnings.push(`Could not auto-add ${loc}; publishing is not blocked.`);
      continue;
    }
    html = next;
    added.push(loc);
  }

  const extra = html.match(/<ul\b[^>]*data-sitemap-group="extra"[^>]*>([\s\S]*?)<\/ul>/i);
  const extraHasLinks = extra ? /<a\b/i.test(extra[1]) : false;
  html = html.replace(/<section\b[^>]*id="sitemap-extra"[^>]*>/i, (tag) => {
    const without = tag.replace(/\s+hidden(?:=["'][^"']*["'])?/i, "");
    return extraHasLinks ? without : without.replace(/>$/, " hidden>");
  });

  writeFileSync(join(root, "sitemap.html"), html);
  return { added, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = syncHtmlSitemap();
  for (const warning of result.warnings) console.warn(warning);
  if (result.added.length) {
    console.log(`Auto-added ${result.added.length} URL(s): ${result.added.join(", ")}`);
  } else {
    console.log("HTML sitemap already lists every sitemap.xml URL.");
  }
}
