"""Optimise the manual's raster images for the web and strip their metadata.

For every input image this script:

* applies the EXIF orientation, then drops **all** metadata (EXIF incl. GPS,
  XMP, comments, ICC; a non-sRGB ICC profile is first converted to sRGB);
* flattens any alpha channel onto a background colour (default white);
* resizes to at most 1600 px on the long edge;
* writes an optimised progressive JPEG under the **same filename** (so page
  references stay valid) and a ``.webp`` sibling, lowering quality step by
  step until both files are at most 200 KB; if even the quality floor is too
  big (fine texture, e.g. asphalt), the long edge is stepped down
  (1440, 1280, 1152, 1024 px) before giving up and reporting "over 200 KB";
* prints a before/after table.

It is idempotent: an image that is already a clean JPEG within the size
limits and has a matching ``.webp`` sibling (same pixel size) is skipped (use ``--force`` to
re-encode anyway). Re-encoding a clean file again is avoided on purpose, to
prevent generation loss.

Usage (from the repo root)::

    python scripts/optimize-images.py                  # all img/*.jpg, *.jpeg, *.png
    python scripts/optimize-images.py img/new.jpg      # selected files
    python scripts/optimize-images.py --bg 1a1a1a img/logo.png

A ``.png`` input is written as ``<name>.jpg`` + ``<name>.webp``; the original
PNG is left in place for you to delete. Requires Pillow.
"""

from __future__ import annotations

import argparse
import io
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageCms, ImageOps

MAX_EDGE = 1600
TARGET_BYTES = 200 * 1024
MIN_EDGE = 1024
EDGE_STEPS = (1600, 1440, 1280, 1152, 1024)
JPEG_QUALITIES = (86, 82, 78, 74, 70, 66, 62)
WEBP_QUALITIES = (82, 78, 74, 70, 66, 62, 58)
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_GLOBS = ("*.jpg", "*.jpeg", "*.png")
METADATA_KEYS = ("exif", "xmp", "XML:com.adobe.xmp", "icc_profile", "comment", "photoshop", "iptc")


@dataclass
class Result:
    """One row of the before/after table."""

    name: str
    before_bytes: int
    before_size: tuple[int, int]
    jpeg_bytes: int = 0
    webp_bytes: int = 0
    after_size: tuple[int, int] = (0, 0)
    status: str = ""


def parse_bg(value: str) -> tuple[int, int, int]:
    """Parse ``#rrggbb`` / ``rrggbb`` into an RGB tuple."""
    v = value.lstrip("#")
    if len(v) != 6:
        raise argparse.ArgumentTypeError(f"background must be rrggbb, got {value!r}")
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def has_metadata(im: Image.Image) -> bool:
    """True if the opened image still carries EXIF, XMP, ICC or comments."""
    if len(im.getexif()):
        return True
    return any(k in im.info for k in METADATA_KEYS)


def is_clean(src: Path, webp: Path) -> bool:
    """True if *src* needs no work: real JPEG, no metadata, within limits, webp up to date."""
    if src.suffix.lower() not in (".jpg", ".jpeg") or not webp.exists():
        return False
    with Image.open(src) as im:
        if im.format != "JPEG" or im.mode != "RGB" or has_metadata(im):
            return False
        if max(im.size) > MAX_EDGE:
            return False
        size = im.size
    # Same pixel size = the .webp was made from this JPEG (mtimes are not reliable after a git checkout).
    with Image.open(webp) as w:
        if w.format != "WEBP" or w.size != size or has_metadata(w):
            return False
    # Over-target files are accepted once they were encoded at the quality floor;
    # re-encoding them again would only lose quality.
    return True


def to_srgb(im: Image.Image) -> Image.Image:
    """Convert an image with an embedded ICC profile to sRGB (best effort)."""
    icc = im.info.get("icc_profile")
    if not icc:
        return im
    try:
        src_profile = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        dst_profile = ImageCms.createProfile("sRGB")
        mode = "RGBA" if "A" in im.getbands() else "RGB"
        return ImageCms.profileToProfile(im.convert(mode), src_profile, dst_profile, outputMode=mode)
    except (ImageCms.PyCMSError, OSError, ValueError) as exc:
        print(f"  warning: ICC conversion failed ({exc}); assuming sRGB", file=sys.stderr)
        return im


def prepare(src: Path, bg: tuple[int, int, int]) -> Image.Image:
    """Load *src* and return a metadata-free, flattened, resized RGB image."""
    with Image.open(src) as im:
        im.load()
        im = ImageOps.exif_transpose(im)
        im = to_srgb(im)
        if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
            rgba = im.convert("RGBA")
            flat = Image.new("RGB", rgba.size, bg)
            flat.paste(rgba, mask=rgba.getchannel("A"))
            im = flat
        else:
            im = im.convert("RGB")
    if max(im.size) > MAX_EDGE:
        im.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    # Rebuild from raw pixels so no info/EXIF/ICC can leak into the encoder.
    clean = Image.frombytes("RGB", im.size, im.tobytes())
    clean.info = {}
    return clean


def encode(im: Image.Image, fmt: str) -> bytes:
    """Encode at the highest quality that fits TARGET_BYTES (or the quality floor)."""
    qualities = JPEG_QUALITIES if fmt == "JPEG" else WEBP_QUALITIES
    data = b""
    for q in qualities:
        buf = io.BytesIO()
        if fmt == "JPEG":
            im.save(buf, "JPEG", quality=q, optimize=True, progressive=True, subsampling="4:2:0")
        else:
            im.save(buf, "WEBP", quality=q, method=6)
        data = buf.getvalue()
        if len(data) <= TARGET_BYTES:
            break
    return data


def encode_pair(im: Image.Image) -> tuple[Image.Image, bytes, bytes]:
    """Encode JPEG + WebP at one shared pixel size, stepping the size down if needed."""
    long_edge = max(im.size)
    edges = [long_edge] + [e for e in EDGE_STEPS if e < long_edge and e >= MIN_EDGE]
    for edge in edges:
        sized = im
        if edge < long_edge:
            sized = im.copy()
            sized.thumbnail((edge, edge), Image.Resampling.LANCZOS)
        jpeg_data, webp_data = encode(sized, "JPEG"), encode(sized, "WEBP")
        if len(jpeg_data) <= TARGET_BYTES and len(webp_data) <= TARGET_BYTES:
            break
    return sized, jpeg_data, webp_data


def write_atomic(path: Path, data: bytes) -> None:
    """Write *data* to *path* via a temporary file."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def process(src: Path, bg: tuple[int, int, int], force: bool) -> Result:
    """Optimise one image and return its table row."""
    jpg = src.with_suffix(".jpg") if src.suffix.lower() == ".png" else src
    webp = src.with_suffix(".webp")
    with Image.open(src) as im:
        res = Result(src.name, src.stat().st_size, im.size)
    if not force and is_clean(src, webp):
        with Image.open(src) as im:
            res.after_size = im.size
        res.jpeg_bytes, res.webp_bytes, res.status = src.stat().st_size, webp.stat().st_size, "skipped (clean)"
        return res
    im, jpeg_data, webp_data = encode_pair(prepare(src, bg))
    write_atomic(jpg, jpeg_data)
    write_atomic(webp, webp_data)
    res.after_size, res.jpeg_bytes, res.webp_bytes = im.size, len(jpeg_data), len(webp_data)
    over = [n for n, b in (("jpg", res.jpeg_bytes), ("webp", res.webp_bytes)) if b > TARGET_BYTES]
    res.status = "optimised" + (f" (over 200 KB: {', '.join(over)})" if over else "")
    if jpg != src:
        res.status += f" -> {jpg.name}"
    return res


def collect(paths: list[str]) -> list[Path]:
    """Resolve CLI paths, or default to every raster image in img/."""
    if paths:
        return [Path(p) for p in paths]
    img = REPO_ROOT / "img"
    found = {p for g in DEFAULT_GLOBS for p in img.glob(g)}
    # A .png with a .jpg twin was converted earlier; the .jpg is the one to check.
    return sorted(p for p in found if not (p.suffix.lower() == ".png" and p.with_suffix(".jpg").exists()))


def kb(n: int) -> str:
    """Format a byte count as KB."""
    return f"{n / 1024:,.0f} KB"


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("files", nargs="*", help="images to optimise (default: img/*.jpg, *.jpeg, *.png)")
    ap.add_argument("--bg", type=parse_bg, default=(255, 255, 255),
                    help="background for flattening transparency, rrggbb (default ffffff)")
    ap.add_argument("--force", action="store_true", help="re-encode even if the image is already clean")
    args = ap.parse_args(argv)

    rows: list[Result] = []
    for src in collect(args.files):
        if not src.exists():
            print(f"missing: {src}", file=sys.stderr)
            return 2
        rows.append(process(src, args.bg, args.force))

    head = f"{'file':<22} {'before':>10} {'before px':>11}  {'after px':>11} {'jpg':>8} {'webp':>8}  status"
    print(head)
    print("-" * len(head))
    for r in rows:
        print(f"{r.name:<22} {kb(r.before_bytes):>10} {'%dx%d' % r.before_size:>11}  "
              f"{'%dx%d' % r.after_size:>11} {kb(r.jpeg_bytes):>8} {kb(r.webp_bytes):>8}  {r.status}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
