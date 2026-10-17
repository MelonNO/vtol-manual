"""Generate the PWA icons in icons/ (WP09 R5, plan F-2) with Pillow.

Usage:  python scripts/gen-icons.py

Design: an orange (#f97316, --accent) chevron / delta-wing aircraft on black (#0f0f0f, --bg).
The shape is a vector polygon in unit coordinates, drawn 8x oversized and downsampled (anti-aliased).
- icon-192.png, icon-512.png      purpose "any": the glyph fills ~76 % of the square
- icon-maskable-192/512.png       purpose "maskable": full-bleed background, glyph inside the 80 % safe circle
- apple-touch-icon.png (180 px)   opaque, same as "any"
The output is deterministic (no metadata, fixed compression), so re-running gives identical files.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
BG = (0x0F, 0x0F, 0x0F)       # --bg
ACCENT = (0xF9, 0x73, 0x16)   # --accent
SS = 8                        # supersampling factor

# Delta wing / chevron pointing up, with a short tail notch (unit square, y down).
WING = [(0.50, 0.08), (0.95, 0.86), (0.50, 0.66), (0.05, 0.86)]
# Fuselage stripe in background colour, splitting the wing into two halves (reads as an aircraft, not a plain arrow).
STRIPE = [(0.50, 0.26), (0.53, 0.645), (0.50, 0.668), (0.47, 0.645)]


def render(size: int, scale: float) -> Image.Image:
    """The glyph scaled to `scale` of the icon, centred (the wing's visual centre sits slightly above the middle)."""
    big = size * SS
    img = Image.new("RGB", (big, big), BG)
    d = ImageDraw.Draw(img)
    off = (1 - scale) / 2

    def pts(poly):
        return [((off + x * scale) * big, (off + 0.02 + y * scale) * big) for x, y in poly]

    d.polygon(pts(WING), fill=ACCENT)
    d.polygon(pts(STRIPE), fill=BG)
    return img.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, name: str) -> None:
    OUT.mkdir(exist_ok=True)
    img.save(OUT / name, format="PNG", optimize=True)
    print("wrote icons/" + name, (OUT / name).stat().st_size, "bytes")


def main() -> None:
    for size in (192, 512):
        save(render(size, 0.76), f"icon-{size}.png")
        save(render(size, 0.56), f"icon-maskable-{size}.png")   # 0.56 keeps every corner inside the 80 % safe circle
    save(render(180, 0.76), "apple-touch-icon.png")


if __name__ == "__main__":
    main()
