#!/usr/bin/env python3
"""Convert, resize, and stamp image dimensions.

This step is safe to run on every publish. Per-image failures are logged and
the process always exits 0 so a bad file cannot block publishing.

It does not edit robots.txt, sitemap.xml, sitemap.html, or FAQ copy, and it
does not write new alt text.
"""

from __future__ import annotations

import re
import sys
import traceback
import urllib.error
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_HTML = {"sitemap.html"}
QUALITY = 82
RETINA = 2
# Largest CSS box the asset is painted into. Resize only when the file is
# larger than that box at 2x. Never upscale and never crop.
LOCAL_BOXES = {
    # Hero illustration: widest paint is ~748px, tallest paint is ~248px.
    "ai-illustration-backyard-adu.png": ("cover", 748, 248),
    # Photo grid becomes one column below 860px, so the widest paint is ~828px.
    "modern-duplex-portland.jpg": ("cover", 828, 260),
    "modern-house-ladysmith.jpg": ("cover", 828, 260),
}
HANDBOOK_BOX = ("width", 900, None)
USER_AGENT = "Mozilla/5.0 (compatible; sandiegoadubuilder-image-optimize/1.0)"

failures: list[str] = []
report: list[str] = []
fetch_cache: dict[str, tuple[bytes, str, int]] = {}


def log_failure(message: str) -> None:
    failures.append(message)
    print(f"IMAGE_OPTIMIZE_FAILURE: {message}", file=sys.stderr)


def try_pillow():
    try:
        from PIL import Image
    except ImportError as error:
        log_failure(f"Pillow is not installed ({error}). Convert and resize were skipped.")
        return None
    return Image


IMAGE = try_pillow()


def html_files():
    for path in sorted(ROOT.rglob("*.html")):
        if ".git" in path.parts or path.name in SKIP_HTML:
            continue
        yield path


def target_size(width: int, height: int, box):
    if not box:
        return width, height
    fit, css_w, css_h = box
    max_w = css_w * RETINA
    if fit == "width" or not css_h:
        if width <= max_w:
            return width, height
        scale = max_w / width
        return max(1, round(width * scale)), max(1, round(height * scale))
    max_h = css_h * RETINA
    scale = max(max_w / width, max_h / height)
    if scale >= 1:
        return width, height
    return max(1, round(width * scale)), max(1, round(height * scale))


def box_for(path: Path):
    if path.name in LOCAL_BOXES:
        return LOCAL_BOXES[path.name]
    if "handbook" in path.parts:
        return HANDBOOK_BOX
    return None


def ensure_webp(src: Path, box) -> Path | None:
    if IMAGE is None:
        log_failure(f"Skipped WebP for {src.relative_to(ROOT)} because Pillow is missing.")
        return None
    webp = src.with_suffix(".webp")
    try:
        with IMAGE.open(src) as opened:
            image = opened.copy()
        width, height = image.size
        tw, th = target_size(width, height, box)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "A" in image.mode else "RGB")
        if webp.exists():
            try:
                with IMAGE.open(webp) as existing:
                    if existing.size == (tw, th):
                        report.append(
                            f"local {src.relative_to(ROOT)} {src.stat().st_size} bytes "
                            f"{width}x{height} -> {webp.name} {webp.stat().st_size} bytes {tw}x{th} (kept)"
                        )
                        return webp
            except Exception as error:
                log_failure(f"Could not read existing WebP {webp.name}: {error}")
        if (tw, th) != image.size:
            image = image.resize((tw, th), IMAGE.Resampling.LANCZOS)
        webp.parent.mkdir(parents=True, exist_ok=True)
        image.save(webp, "WEBP", quality=QUALITY, method=6)
        report.append(
            f"local {src.relative_to(ROOT)} {src.stat().st_size} bytes {width}x{height} "
            f"-> {webp.relative_to(ROOT)} {webp.stat().st_size} bytes {tw}x{th}"
        )
        return webp
    except Exception as error:
        log_failure(f"Could not convert {src.relative_to(ROOT)}: {error}")
        return None


def convert_project_images() -> None:
    folder = ROOT / "assets" / "images" / "projects"
    if not folder.exists():
        return
    for path in sorted(folder.iterdir()):
        if path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
            continue
        box = LOCAL_BOXES.get(path.name)
        if box is None:
            log_failure(f"No display size for {path.name}; converted at native pixels without resizing.")
        ensure_webp(path, box)


def has_picture_display(text: str) -> bool:
    return re.search(r"picture\s*\{[^}]*display\s*:\s*contents", text, re.I) is not None


def ensure_picture_css() -> None:
    path = ROOT / "styles.css"
    if not path.exists():
        return
    text = path.read_text()
    if has_picture_display(text):
        return
    needle = "* {\n  box-sizing: border-box;\n}\n"
    rule = "\npicture {\n  display: contents;\n}\n"
    if needle in text:
        text = text.replace(needle, needle + rule, 1)
    else:
        text += rule
    path.write_text(text)


ATTR_RE = re.compile(
    r"""([^\s=<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))"""
)
IMG_RE = re.compile(r"<img\b[^>]*>", re.I)
PICTURE_RE = re.compile(r"<picture\b[^>]*>[\s\S]*?</picture>", re.I)
DATA_IMG_RE = re.compile(
    r'<img\b[^>]*\bsrc="data:image/(png|jpe?g);base64,([^"]+)"[^>]*>',
    re.I,
)


def parse_attrs(tag: str):
    attrs = []
    for match in ATTR_RE.finditer(tag):
        value = match.group(2)
        if value is None:
            value = match.group(3)
        if value is None:
            value = match.group(4) or ""
        attrs.append((match.group(1), value))
    return attrs


def attr_map(attrs):
    return {key.lower(): value for key, value in attrs}


def upsert(attrs, key, value):
    for index, (name, _) in enumerate(attrs):
        if name.lower() == key.lower():
            attrs[index] = (name, value)
            return attrs
    attrs.append((key, value))
    return attrs


def delete_attr(attrs, key):
    return [(name, value) for name, value in attrs if name.lower() != key.lower()]


def render_img(attrs, slash: bool) -> str:
    body = " ".join(f'{name}="{value}"' for name, value in attrs)
    return f"<img {body}{' />' if slash else '>'}"


def resolve_src(html_path: Path, src: str) -> Path | None:
    if not src or src.startswith("data:") or src.startswith("http://") or src.startswith("https://"):
        return None
    if src.startswith("/"):
        return ROOT / src.lstrip("/")
    beside = (html_path.parent / src).resolve()
    rooted = (ROOT / src).resolve()
    try:
        beside.relative_to(ROOT)
        if beside.exists():
            return beside
    except ValueError:
        pass
    try:
        rooted.relative_to(ROOT)
    except ValueError:
        return None
    return rooted


def webp_url_for(src: str) -> str:
    return re.sub(r"\.(png|jpe?g)$", ".webp", src, count=1, flags=re.I)


def is_hero_src(src: str) -> bool:
    return "ai-illustration-backyard-adu" in src


def remote_cap(context: str) -> int:
    text = context.lower()
    if "og:image" in text:
        return 1200
    if "jadu-photo" in text:
        return 960 * RETINA
    if "jadu-hero" in text or "jadu-band" in text:
        return 1440 * RETINA
    if "photo-panel" in text:
        return 860 * RETINA
    if "image-card" in text:
        return 862 * RETINA
    if "hero-visual" in text:
        return 816 * RETINA
    if ".hero" in text or 'class="hero"' in text or "class='hero'" in text:
        return 1440 * RETINA
    return 1180 * RETINA


def set_query(url: str, updates: dict, cap_w: int | None = None) -> str:
    parts = urllib.parse.urlsplit(url)
    pairs = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    keys = [key for key, _ in pairs]

    def put(key, value):
        nonlocal pairs, keys
        if key in keys:
            pairs = [(name, value if name == key else current) for name, current in pairs]
        else:
            pairs.append((key, value))
            keys.append(key)

    if cap_w is not None:
        current = dict(pairs).get("w")
        try:
            width = int(current) if current else None
        except ValueError:
            width = None
        if width is None or width > cap_w:
            put("w", str(cap_w))
    # auto=format renegotiates from the Accept header and would ignore fm.
    pairs = [(key, value) for key, value in pairs if key != "auto"]
    keys = [key for key, _ in pairs]
    for key, value in updates.items():
        put(key, value)
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(pairs)))


def fetch(url: str):
    if url in fetch_cache:
        return fetch_cache[url]
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/jpeg,image/png,image/webp,*/*"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
            content_type = response.headers.get("Content-Type", "")
            length = int(response.headers.get("Content-Length") or len(data))
    except Exception as error:
        log_failure(f"Could not fetch {url}: {error}")
        return None
    fetch_cache[url] = (data, content_type, length)
    return fetch_cache[url]


def image_size(data: bytes):
    if IMAGE is None:
        return None
    try:
        with IMAGE.open(BytesIO(data)) as image:
            return image.size
    except Exception as error:
        log_failure(f"Could not read image dimensions: {error}")
        return None


def rebuild_img(tag: str, html_path: Path, context: str):
    slash = tag.rstrip().endswith("/>")
    attrs = parse_attrs(tag)
    values = attr_map(attrs)
    src = values.get("src", "")
    webp_url = None
    width = height = None

    if src.startswith("https://images.unsplash.com/"):
        cap = remote_cap(context)
        jpg = set_query(src, {"fm": "jpg"}, cap)
        webp_url = set_query(src, {"fm": "webp"}, cap)
        fetched = fetch(jpg)
        if fetched:
            size = image_size(fetched[0])
            if size:
                width, height = size
            report.append(
                f"remote {src} -> webp {webp_url} jpg-bytes {fetched[2]} type {fetched[1]}"
            )
        else:
            log_failure(f"Left {html_path.name} image dimensions unchanged because {jpg} could not be measured.")
        src = jpg
        upsert(attrs, "src", src)
    elif not src.startswith("data:"):
        local = resolve_src(html_path, src)
        if local and local.suffix.lower() in {".png", ".jpg", ".jpeg"}:
            webp = ensure_webp(local, box_for(local))
            if webp:
                webp_url = webp_url_for(src)
            try:
                if IMAGE is not None and local.exists():
                    with IMAGE.open(local) as image:
                        width, height = image.size
            except Exception as error:
                log_failure(f"Could not read {local.name}: {error}")
        elif local and local.suffix.lower() == ".webp" and local.exists() and IMAGE is not None:
            webp_url = src
            try:
                with IMAGE.open(local) as image:
                    width, height = image.size
            except Exception as error:
                log_failure(f"Could not read {local.name}: {error}")

    if width and height:
        upsert(attrs, "width", str(width))
        upsert(attrs, "height", str(height))
    elif "width" not in values or "height" not in values:
        log_failure(f"{html_path.name} img has no measured width and height: {src[:120]}")

    if is_hero_src(src) or is_hero_src(values.get("src", "")):
        attrs = delete_attr(attrs, "loading")
        attrs = delete_attr(attrs, "decoding")
        upsert(attrs, "fetchpriority", "high")
    else:
        attrs = delete_attr(attrs, "fetchpriority")
        upsert(attrs, "loading", "lazy")
        upsert(attrs, "decoding", "async")

    return render_img(attrs, slash), webp_url


def refresh_picture(block: str, html_path: Path, context: str) -> str:
    match = IMG_RE.search(block)
    if not match:
        return block
    new_img, webp_url = rebuild_img(match.group(0), html_path, context)
    block = block[: match.start()] + new_img + block[match.end() :]
    if not webp_url:
        return block
    block = re.sub(r"\s*<source\b[^>]*image/webp[^>]*>", "", block, count=1, flags=re.I)
    return re.sub(
        r"(<picture\b[^>]*>)",
        rf'\1<source srcset="{webp_url}" type="image/webp">',
        block,
        count=1,
        flags=re.I,
    )


def ensure_pictures(text: str, html_path: Path) -> str:
    masks = []

    def hide(match):
        masks.append(match.group(0))
        return f"__PICTURE_{len(masks) - 1}__"

    hidden = PICTURE_RE.sub(hide, text)

    def wrap(match):
        tag = match.group(0)
        context = hidden[max(0, match.start() - 900) : match.start()]
        new_img, webp_url = rebuild_img(tag, html_path, context)
        if not webp_url:
            return new_img
        return f'<picture><source srcset="{webp_url}" type="image/webp">{new_img}</picture>'

    hidden = IMG_RE.sub(wrap, hidden)
    for index, block in enumerate(masks):
        context = text[max(0, text.find(block) - 900) : text.find(block) if block in text else 0]
        hidden = hidden.replace(f"__PICTURE_{index}__", refresh_picture(block, html_path, context), 1)
    return hidden


def extract_handbook_images(text: str, html_path: Path) -> str:
    if html_path.name != "san-diego-adu-builder-handbook.html":
        return text
    if "data:image/" not in text:
        return text
    folder = ROOT / "assets" / "images" / "handbook"
    folder.mkdir(parents=True, exist_ok=True)
    count = 0

    def replace(match):
        nonlocal count
        count += 1
        raw = __import__("base64").b64decode(match.group(2))
        name = f"page-{count:02d}.jpg" if match.group(1).lower() != "png" else f"page-{count:02d}.png"
        dest = folder / name
        if not dest.exists():
            dest.write_bytes(raw)
        webp = ensure_webp(dest, HANDBOOK_BOX)
        attrs = parse_attrs(match.group(0))
        values = attr_map(attrs)
        alt = values.get("alt")
        width = height = None
        if IMAGE is not None:
            try:
                with IMAGE.open(dest) as image:
                    width, height = image.size
            except Exception as error:
                log_failure(f"Could not read handbook {name}: {error}")
        parts = [f'src="images/handbook/{name}"']
        if alt is not None:
            parts.append(f'alt="{alt}"')
        else:
            log_failure(f"Handbook {name} has no alt; left it unset.")
        if width and height:
            parts.append(f'width="{width}"')
            parts.append(f'height="{height}"')
        parts.append('loading="lazy"')
        parts.append('decoding="async"')
        img = "<img " + " ".join(parts) + ">"
        if not webp:
            return img
        return f'<picture><source srcset="images/handbook/{webp.name}" type="image/webp">{img}</picture>'

    try:
        return DATA_IMG_RE.sub(replace, text)
    except Exception as error:
        log_failure(f"Handbook image extraction failed: {error}")
        return text


def already_in_image_set(text: str, start: int) -> bool:
    prefix = text[max(0, start - 48) : start]
    if "image-set(" in prefix:
        return True
    return re.search(r'type\(["\']image/webp["\']\)\s*,\s*$', prefix) is not None


UNSPLASH_URL_RE = re.compile(
    r"""url\(\s*(["'])(https://images\.unsplash\.com/[^"']+)\1\s*\)""",
    re.I,
)


def rewrite_css_urls(text: str) -> str:
    pieces = []
    cursor = 0
    for match in UNSPLASH_URL_RE.finditer(text):
        pieces.append(text[cursor : match.start()])
        if already_in_image_set(text, match.start()):
            pieces.append(match.group(0))
        else:
            original = match.group(2)
            cap = remote_cap(text[max(0, match.start() - 500) : match.start()])
            webp = set_query(original, {"fm": "webp"}, cap)
            jpg = set_query(original, {"fm": "jpg"}, cap)
            before = fetch(original)
            after = fetch(webp)
            before_bytes = before[2] if before else "unknown"
            after_bytes = after[2] if after else "unknown"
            report.append(f"css {original} before {before_bytes} -> webp {after_bytes} {webp}")
            pieces.append(
                f'image-set(url("{webp}") type("image/webp"), url("{jpg}") type("image/jpeg"))'
            )
        cursor = match.end()
    pieces.append(text[cursor:])
    return "".join(pieces)


OG_RE = re.compile(r"<meta\b[^>]*property=[\"']og:image[\"'][^>]*>", re.I)


def rewrite_og(text: str) -> str:
    def replace(match):
        tag = match.group(0)
        content = re.search(r'content=(["\'])([^"\']+)\1', tag)
        if not content:
            return tag
        url = content.group(2)
        quote = content.group(1)
        if url.startswith("https://images.unsplash.com/"):
            new_url = set_query(url, {"fm": "webp"}, 1200)
            before = fetch(url)
            after = fetch(new_url)
            report.append(
                f"og {url} before {before[2] if before else 'unknown'} -> "
                f"webp {after[2] if after else 'unknown'} {new_url}"
            )
        elif re.search(r"\.(png|jpe?g)(?:$|\?)", url, re.I):
            new_url = webp_url_for(url)
            report.append(f"og {url} -> {new_url}")
        else:
            return tag
        return tag.replace(f"{quote}{url}{quote}", f"{quote}{new_url}{quote}", 1)

    return OG_RE.sub(replace, text)


def add_hero_preload(text: str, html_path: Path) -> str:
    href = None
    if html_path.name in {"index.html", "detached-adus.html"} and "ai-illustration-backyard-adu.webp" in text:
        href = "/assets/images/projects/ai-illustration-backyard-adu.webp"
    else:
        for label in ("hero-visual", "jadu-hero", ".hero{"):
            index = text.find(label)
            if index == -1:
                continue
            window = text[index : index + 2500]
            found = re.search(
                r'image-set\(\s*url\((["\'])(https://images\.unsplash\.com/[^"\']+)\1',
                window,
            )
            if found:
                href = found.group(2)
                break
    if not href:
        return text
    tag = f'<link rel="preload" as="image" type="image/webp" href="{href}" fetchpriority="high">'
    if tag in text:
        return text
    if "</head>" not in text:
        log_failure(f"{html_path.name} has a hero image but no </head> for preload.")
        return text
    return text.replace("</head>", tag + "\n</head>", 1)


def inject_picture_css(text: str) -> str:
    if "<picture" not in text.lower():
        return text
    if has_picture_display(text):
        return text
    if not re.search(r"<style\b", text, re.I):
        return text
    return re.sub(
        r"<style\b[^>]*>",
        lambda match: match.group(0) + "picture{display:contents}",
        text,
        count=1,
        flags=re.I,
    )


def transform(text: str, html_path: Path) -> str:
    text = extract_handbook_images(text, html_path)
    text = ensure_pictures(text, html_path)
    text = rewrite_css_urls(text)
    text = rewrite_og(text)
    text = add_hero_preload(text, html_path)
    text = inject_picture_css(text)
    return text


def write_missing_alt() -> None:
    missing = []
    for path in html_files():
        try:
            text = path.read_text(errors="replace")
        except Exception as error:
            log_failure(f"Could not scan alt text in {path.name}: {error}")
            continue
        rel = path.relative_to(ROOT).as_posix()
        for match in IMG_RE.finditer(text):
            values = attr_map(parse_attrs(match.group(0)))
            alt = values.get("alt")
            if alt is None or not alt.strip():
                src = values.get("src", "")
                if src.startswith("data:"):
                    src = src[:48] + "..."
                missing.append(f"- `{rel}` img has no alt. src: `{src}`")
        for match in re.finditer(r"<svg\b[^>]*>", text, re.I):
            tag = match.group(0)
            if not re.search(r'role=["\']img["\']', tag, re.I):
                continue
            if re.search(r'aria-label=["\'][^"\']+["\']', tag, re.I):
                continue
            if re.search(r'aria-labelledby=["\'][^"\']+["\']', tag, re.I):
                continue
            missing.append(f"- `{rel}` svg role=img has no alt, aria-label, or aria-labelledby.")
        for rule in re.finditer(r"<style\b[^>]*>([\s\S]*?)</style>", text, re.I):
            css = rule.group(1)
            for block in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
                if "images.unsplash.com" not in block.group(2) and "/assets/images/" not in block.group(2):
                    continue
                selector = block.group(1).strip().split(",")[0].strip()
                classes = re.findall(r"\.([A-Za-z_][\w-]*)", selector)
                if not classes:
                    missing.append(f"- `{rel}` CSS background `{selector}` has no alt attribute.")
                    continue
                class_name = classes[-1]
                tags = []
                for tag in re.findall(r"<[a-z0-9]+\b[^>]*>", text, flags=re.I):
                    class_match = re.search(r'class=["\']([^"\']+)["\']', tag, re.I)
                    tokens = class_match.group(1).split() if class_match else []
                    if class_name in tokens:
                        tags.append(tag)
                if not tags:
                    missing.append(
                        f"- `{rel}` CSS background `.{class_name}` has no matching element with an alt or aria-label."
                    )
                    continue
                unlabeled = False
                for tag in tags:
                    if re.search(r'aria-label=["\'][^"\']+["\']', tag, re.I):
                        continue
                    if re.search(r'aria-labelledby=["\'][^"\']+["\']', tag, re.I):
                        continue
                    if re.search(r'\balt=["\'][^"\']+["\']', tag, re.I):
                        continue
                    unlabeled = True
                if unlabeled:
                    missing.append(
                        f"- `{rel}` `.{class_name}` is a CSS background image and has no alt or aria-label."
                    )
    lines = [
        "# Images missing alt",
        "",
        "Ryan's image optimization pass did not write new alt text. This list is the images that still have no text alternative.",
        "",
        "## img elements",
        "",
    ]
    img_rows = [row for row in missing if " img " in row or row.startswith("- `") and " img " in row]
    img_rows = [row for row in missing if " img has no alt" in row or "svg role=img" in row]
    other = [row for row in missing if row not in img_rows]
    if img_rows:
        lines.extend(img_rows)
    else:
        lines.append("No `img` element is missing a non-empty alt attribute.")
    lines.extend(["", "## Other images", ""])
    if other:
        lines.extend(other)
    else:
        lines.append("No other image without a text alternative was found.")
    lines.append("")
    dest = ROOT / "docs" / "missing-alt.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(lines)
    if not dest.exists() or dest.read_text() != content:
        dest.write_text(content)


def self_check() -> None:
    for path in html_files():
        text = path.read_text(errors="replace")
        if "data:image/" in text:
            log_failure(f"{path.name} still embeds an image data URI.")
        for match in IMG_RE.finditer(text):
            values = attr_map(parse_attrs(match.group(0)))
            src = values.get("src", "")
            if not values.get("width") or not values.get("height"):
                log_failure(f"{path.relative_to(ROOT)} img missing width or height: {src[:140]}")
            hero = is_hero_src(src)
            if hero:
                if values.get("loading", "").lower() == "lazy":
                    log_failure(f"{path.name} hero image is lazy.")
                if values.get("fetchpriority") != "high":
                    log_failure(f"{path.name} hero image is missing fetchpriority=high.")
            else:
                if values.get("loading") != "lazy" or values.get("decoding") != "async":
                    log_failure(f"{path.name} content image is missing lazy/async: {src[:140]}")
                if values.get("fetchpriority"):
                    log_failure(f"{path.name} content image has fetchpriority: {src[:140]}")
        for match in PICTURE_RE.finditer(text):
            if "image/webp" not in match.group(0):
                log_failure(f"{path.name} picture is missing a WebP source.")


def main() -> None:
    convert_project_images()
    ensure_picture_css()
    for path in html_files():
        try:
            original = path.read_text()
        except Exception as error:
            log_failure(f"Could not read {path.relative_to(ROOT)}: {error}")
            continue
        try:
            updated = transform(original, path)
        except Exception as error:
            log_failure(f"Could not optimize images in {path.relative_to(ROOT)}: {error}")
            continue
        if updated != original:
            updated = updated.replace("styles.css?v=20261004-1", "styles.css?v=20261004-2")
            path.write_text(updated)
    try:
        write_missing_alt()
    except Exception as error:
        log_failure(f"Could not write docs/missing-alt.md: {error}")
    try:
        self_check()
    except Exception as error:
        log_failure(f"Image self-check failed open: {error}")
    print(f"Image optimization finished with {len(failures)} logged failure(s).")
    for line in report:
        print(line)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        print("IMAGE_OPTIMIZE_FAILURE: optimizer crashed. Publishing continues.", file=sys.stderr)
    sys.exit(0)
