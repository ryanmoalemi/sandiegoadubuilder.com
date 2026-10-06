import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { syncHtmlSitemap } from "./sync-html-sitemap.mjs";

const root = new URL("..", import.meta.url).pathname;
const failures = [];

try {
  const sitemapSync = syncHtmlSitemap();
  for (const warning of sitemapSync.warnings) console.warn(warning);
  if (sitemapSync.added.length) {
    console.log(
      `HTML sitemap auto-added ${sitemapSync.added.length} URL(s) without blocking publish: ${sitemapSync.added.join(", ")}`
    );
  }
} catch (error) {
  console.warn(`HTML sitemap sync failed open and did not block publish: ${error.message}`);
}

function fail(message) {
  failures.push(message);
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

function decode(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[^"']+/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

const BANNED = [
  { re: /\bwe build\b/i, label: "we build" },
  { re: /\bour team\b/i, label: "our team" },
  { re: /\bbook a\b/i, label: "Book a" },
  { re: /\bschedule a\b/i, label: "Schedule a" },
  { re: /schedule consultation/i, label: "Schedule Consultation" },
  { re: /get a similar adu plan/i, label: "Get A Similar ADU Plan" },
  { re: /turnkey/i, label: "turnkey" },
  { re: /request a quote/i, label: "request a quote" },
  { re: /request-a-quote/i, label: "request-a-quote" },
  { re: /120\+/, label: "120+" },
  { re: /4\.9\/5/, label: "4.9/5" },
  { re: /localbusiness/i, label: "LocalBusiness" },
  { re: /homeandconstructionbusiness/i, label: "HomeAndConstructionBusiness" },
  { re: /formsubmit\.co/i, label: "lead form endpoint" },
  { re: /book-a-call\.html/i, label: "book-a-call link" },
  { re: /projects\.html/i, label: "projects.html link" },
  { re: /San_Diego_ADU_Builder_Handbook_Complete/i, label: "missing handbook PDF" },
  { re: /landlordtenant\.dre\.ca\.gov/i, label: "dead landlord-tenant URL" }
];

const DESCRIPTION_PAGES = new Set([
  "index.html",
  "detached-adus.html",
  "adu-permitting.html",
  "adu-financing.html",
  "adu-feasibility-studies.html",
  "pre-approved-adu-plans.html",
  "adu-cost.html",
  "adu-garage-conversions.html",
  "adu-rental-income.html",
  "san-diego-adus.html",
  "jadus.html"
]);

const GUIDE_PAGES = new Set([
  ...DESCRIPTION_PAGES,
  "attached-adus.html",
  "adu-handbook.html",
  "carlsbad-adu-builder.html",
  "about.html"
]);

const SCHEMA_DATE_KEYS = new Set(["dateModified", "datePublished", "dateCreated"]);
// Google ProfilePage types dateCreated/dateModified as DateTime. Date-only values fail Search Console.
const SCHEMA_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const files = walk(root);
const htmlFiles = files.filter((file) => file.endsWith(".html"));
const descriptions = new Map();

function rel(file) {
  return relative(root, file);
}

for (const file of htmlFiles) {
  const name = rel(file);
  const html = readFileSync(file, "utf8");
  const gaIds = [...new Set([...html.matchAll(/\bG-[A-Z0-9]+\b/g)].map((match) => match[0]))];
  if (!gaIds.includes("G-2QP9M28W4W")) {
    fail(`${name} is missing Google tag G-2QP9M28W4W`);
  }
  const otherGaIds = gaIds.filter((id) => id !== "G-2QP9M28W4W");
  if (otherGaIds.length) {
    fail(`${name} has another Google tag: ${otherGaIds.join(", ")}`);
  }

  const visible = visibleText(html);

  for (const rule of BANNED) {
    if (rule.re.test(visible)) {
      fail(`${name} contains removed language: ${rule.label}`);
    }
  }
  if (visible.includes("\u2014")) {
    fail(`${name} contains an em dash in visible text`);
  }

  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch ? decode(titleMatch[1].trim()) : "";
  if (!title) fail(`${name} is missing a title`);
  if (title.length > 60) fail(`${name} title is ${title.length} characters: ${title}`);
  if (/san diego adu builder/i.test(title)) {
    fail(`${name} title includes the brand name: ${title}`);
  }

  const robots = html.match(/<meta[^>]*name=["']robots["'][^>]*>/i);
  const noindex = robots ? /noindex/i.test(robots[0]) : false;
  const canonical = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);

  if (name.startsWith("projects/")) {
    if (!noindex) fail(`${name} must be noindex`);
    const target = {
      "projects/craftsman-backyard-cottage.html": "/adu-garage-conversions.html",
      "projects/rice-street-east-block.html": "/detached-adus.html",
      "projects/rice-street-west-block.html": "/detached-adus.html"
    }[name];
    if (!html.includes(`content="0; url=${target}"`) && !html.includes(`content="0;url=${target}"`)) {
      fail(`${name} is missing a zero-delay meta refresh to ${target}`);
    }
    if (!html.includes(`location.replace("${target}")`) && !html.includes(`location.replace('${target}')`)) {
      fail(`${name} is missing location.replace("${target}")`);
    }
    if (!canonical || !canonical[1].endsWith(target)) {
      fail(`${name} canonical must point at ${target}`);
    }
  }

  if (name === "assets/san-diego-adu-builder-handbook.html" || name === "assets/handbook-print.html") {
    if (!noindex) fail(`${name} must be noindex`);
    if (!canonical || !canonical[1].endsWith("/adu-handbook.html")) {
      fail(`${name} canonical must point at /adu-handbook.html`);
    }
  }

  if (name === "entitymap.html" && !noindex) fail("entitymap.html must be noindex");

  if (DESCRIPTION_PAGES.has(name)) {
    const meta = html.match(/<meta\b[^>]*name=["']description["'][^>]*>/i);
    const content = meta && meta[0].match(/content=["']([^"']*)["']/i);
    const description = content ? decode(content[1].replace(/\s+/g, " ").trim()) : "";
    if (description.length < 120 || description.length > 155) {
      fail(`${name} meta description is ${description.length} characters (need 120-155)`);
    }
    descriptions.set(description, name);
  }

  if (GUIDE_PAGES.has(name) && !/Last reviewed/i.test(visible)) {
    fail(`${name} is missing a visible Last reviewed date`);
  }

  const anchors = html.match(/<a\b[^>]*>/gi) || [];
  for (const tag of anchors) {
    const hrefMatch = tag.match(/href\s*=\s*(["'])(.*?)\1/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[2];
    let external = false;
    try {
      if (/^https?:/i.test(href)) {
        const host = new URL(href).hostname.replace(/^www\./, "");
        external = host !== "sandiegoadubuilder.com";
      }
    } catch {
      fail(`${name} has an unparseable href: ${href}`);
      continue;
    }
    const blank = /target\s*=\s*(["'])_blank\1/i.test(tag);
    const noopener = /rel\s*=\s*(["'])[^"']*noopener/i.test(tag);
    if (external && (!blank || !noopener)) {
      fail(`${name} external link missing target="_blank" rel="noopener": ${href}`);
    }
    if (!external && blank) {
      fail(`${name} on-site link opens a new tab: ${href}`);
    }
  }

  const blocks = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gi) || [];
  for (const block of blocks) {
    const raw = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      fail(`${name} has invalid JSON-LD: ${error.message}`);
      continue;
    }
    const stack = [{ node: data, key: "" }];
    while (stack.length) {
      const current = stack.pop();
      const node = current.node;
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        stack.push(...node.map((item) => ({ node: item, key: current.key })));
        continue;
      }
      const type = node["@type"];
      if (["LocalBusiness", "HomeAndConstructionBusiness", "Service"].includes(type)) {
        fail(`${name} JSON-LD uses @type ${type}`);
      }
      for (const key of ["offers", "provider", "areaServed", "serviceType"]) {
        if (Object.prototype.hasOwnProperty.call(node, key)) {
          fail(`${name} JSON-LD includes ${key}`);
        }
      }
      if (type === "Organization" && (current.key === "publisher" || current.key === "author")) {
        const extra = Object.keys(node).filter((key) => !["@context", "@type", "@id", "name", "url"].includes(key));
        if (extra.length) fail(`${name} publisher Organization has extra fields: ${extra.join(", ")}`);
      }
      for (const [key, value] of Object.entries(node)) {
        if (SCHEMA_DATE_KEYS.has(key) && typeof value === "string" && !SCHEMA_DATETIME.test(value)) {
          fail(`${name} JSON-LD ${key} must be an ISO 8601 datetime with a timezone offset: ${value}`);
        }
        stack.push({ node: value, key });
      }
    }
  }
}

const seen = new Map();
for (const [description, name] of descriptions) {
  if (seen.has(description)) fail(`Duplicate meta description on ${name} and ${seen.get(description)}`);
  else seen.set(description, name);
}

const sitemap = readFileSync(join(root, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
if (locs.length === 0) fail("sitemap.xml has no URLs");
for (const loc of locs) {
  if (/\/projects\//.test(loc) || /\/assets\/.*handbook/i.test(loc)) {
    fail(`sitemap includes a removed URL: ${loc}`);
  }
  const url = new URL(loc);
  const local = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
  const file = join(root, local);
  let html;
  try {
    html = readFileSync(file, "utf8");
  } catch {
    fail(`sitemap URL has no file: ${loc}`);
    continue;
  }
  if (/noindex/i.test(html)) fail(`sitemap URL is noindex: ${loc}`);
}
if (!locs.includes("https://sandiegoadubuilder.com/about.html")) {
  fail("sitemap is missing about.html");
}
if (!locs.includes("https://sandiegoadubuilder.com/sitemap.html")) {
  fail("sitemap is missing sitemap.html");
}

const htmlSitemap = readFileSync(join(root, "sitemap.html"), "utf8");
if (!/<h1>\s*Site map\s*<\/h1>/i.test(htmlSitemap)) fail("sitemap.html H1 must be Site map");
if (!/name=["']robots["'][^>]*content=["'][^"']*index,\s*follow/i.test(htmlSitemap)
  && !/content=["'][^"']*index,\s*follow[^"']*["'][^>]*name=["']robots["']/i.test(htmlSitemap)) {
  fail("sitemap.html must be index, follow");
}
if (!htmlSitemap.includes('rel="canonical" href="https://sandiegoadubuilder.com/sitemap.html"')
  && !htmlSitemap.includes("rel='canonical' href='https://sandiegoadubuilder.com/sitemap.html'")) {
  fail("sitemap.html canonical must be https://sandiegoadubuilder.com/sitemap.html");
}
if (/entitymap\.html/i.test(htmlSitemap)) fail("sitemap.html must not list entitymap.html");
const sitemapGroups = [...htmlSitemap.matchAll(/<ul\b[^>]*data-sitemap-group="[^"]+"[^>]*>[\s\S]*?<\/ul>/gi)]
  .map((match) => match[0])
  .join("\n");
for (const loc of locs) {
  const pathname = new URL(loc).pathname;
  const href = pathname === "/" ? 'href="/"' : `href="${pathname}"`;
  if (!sitemapGroups.includes(href)) {
    console.warn(`HTML sitemap is still missing ${loc} after auto-add. Publishing is not blocked.`);
  }
}

const robots = readFileSync(join(root, "robots.txt"), "utf8");
const robotGroups = robots.split(/\n(?=User-agent:)/);
for (const group of robotGroups) {
  const agentMatch = group.match(/User-agent:\s*(\S+)/);
  if (!agentMatch) continue;
  if (!group.includes("Disallow: /AGENTS.md") || !group.includes("Disallow: /README.md")) {
    fail(`robots.txt group ${agentMatch[1]} is missing Disallow for /AGENTS.md and /README.md`);
  }
}
if (!robots.includes("Sitemap: https://sandiegoadubuilder.com/sitemap.xml")) {
  fail("robots.txt is missing the sitemap line");
}

for (const jsonName of ["entitymap.json", "adu-updates.json"]) {
  const text = readFileSync(join(root, jsonName), "utf8");
  if (text.includes("\u2014")) fail(`${jsonName} contains an em dash`);
  if (/"@type"\s*:\s*"Service"/.test(text)) fail(`${jsonName} still uses Service`);
  if (/"type"\s*:\s*"Offers"/.test(text) || /"offers"\s*:/.test(text)) {
    fail(`${jsonName} still uses Offers`);
  }
  for (const rule of BANNED) {
    if (rule.re.test(text) && !["LocalBusiness", "HomeAndConstructionBusiness"].includes(rule.label)) {
      if (rule.re.test(text)) fail(`${jsonName} contains removed language: ${rule.label}`);
    }
  }
}

const entityHtml = readFileSync(join(root, "entitymap.html"), "utf8");
if (!/noindex/i.test(entityHtml)) fail("entitymap.html must be noindex");
if (/construction resource/i.test(entityHtml)) fail("entitymap.html still describes a construction resource");
if (/"@type": "Service"/.test(entityHtml) || /Offers:/.test(entityHtml)) {
  fail("entitymap.html still offers services");
}

const widget = readFileSync(join(root, "scripts/update-adu-widget.mjs"), "utf8");
if (!widget.includes("function isRemovedLanguage")) {
  fail("update-adu-widget.mjs must filter removed sales language");
}
if (!widget.includes('writeFileSync("adu-updates.json"')) {
  fail("update-adu-widget.mjs must only write adu-updates.json");
}
if (/writeFileSync\(\s*["'](?!adu-updates\.json)/.test(widget)) {
  fail("update-adu-widget.mjs writes a file other than adu-updates.json");
}

const removedPublicFiles = [
  "assets/ADU-Handbook.pdf",
  "assets/San-Diego-ADU-Builder-ADU-Handbook.pdf",
  "assets/images/projects/craftsman-after.jpg",
  "assets/images/projects/craftsman-backyard-cottage.jpg",
  "projects/craftsman-backyard-cottage.html",
  "projects/rice-street-east-block.html",
  "projects/rice-street-west-block.html"
];
for (const name of removedPublicFiles) {
  try {
    statSync(join(root, name));
    fail(`${name} should be removed`);
  } catch {
    // absent, as required
  }
}

const about = readFileSync(join(root, "about.html"), "utf8");
const oldNameMention = "San Diego ADU Guide (sandiegoadubuilder.com)";
if (about.split(oldNameMention).length - 1 !== 1) {
  fail("about.html should mention San Diego ADU Guide (sandiegoadubuilder.com) once");
}
for (const file of files) {
  if (!file.endsWith(".html") && !file.endsWith(".json")) continue;
  const text = readFileSync(file, "utf8");
  if (text.includes("San Diego ADU Builder") || text.includes("ADU BUILDER")) {
    fail(`${rel(file)} still uses the old brand name`);
  }
}

if (failures.length) {
  console.error(`Site check failed (${failures.length})`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`Site check passed (${htmlFiles.length} HTML files, ${locs.length} sitemap URLs).`);
