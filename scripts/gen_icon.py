"""Generates the ThoughtTree app icon source PNG (1024x1024).

Run with:  uv run --with pillow python scripts/gen_icon.py
Then:      pnpm exec tauri icon scripts/icon-source.png
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SS = 4  # supersample factor for smooth edges
W = SIZE * SS

OUT = Path(__file__).resolve().parent / "icon-source.png"

BG_TOP = (18, 178, 116, 255)
BG_BOTTOM = (13, 143, 96, 255)
NODE = (255, 255, 255, 255)
NODE_DIM = (255, 255, 255, 140)
LINE = (255, 255, 255, 130)
STAR = (255, 255, 255, 255)


def lerp(a: int, b: int, t: float) -> int:
    return int(round(a + (b - a) * t))


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def vertical_gradient(size: int, top, bottom) -> Image.Image:
    grad = Image.new("RGBA", (1, size))
    px = grad.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = (
            lerp(top[0], bottom[0], t),
            lerp(top[1], bottom[1], t),
            lerp(top[2], bottom[2], t),
            255,
        )
    return grad.resize((size, size), Image.BILINEAR)


def star_points(cx: float, cy: float, outer: float, inner: float, points: int = 5):
    coords = []
    for i in range(points * 2):
        radius = outer if i % 2 == 0 else inner
        angle = -math.pi / 2 + i * math.pi / points
        coords.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return coords


def build() -> Image.Image:
    badge = vertical_gradient(W, BG_TOP, BG_BOTTOM)
    badge.putalpha(rounded_mask(W, int(W * 0.22)))

    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    root = (W * 0.5, W * 0.34)
    left = (W * 0.31, W * 0.685)
    right = (W * 0.69, W * 0.685)
    stem = W * 0.045

    for child in (left, right):
        d.line([root, child], fill=LINE, width=int(stem), joint="curve")
        d.ellipse(
            [child[0] - stem / 2, child[1] - stem / 2, child[0] + stem / 2, child[1] + stem / 2],
            fill=LINE,
        )

    r_root = W * 0.098
    r_child = W * 0.082

    d.ellipse(
        [root[0] - r_root, root[1] - r_root, root[0] + r_root, root[1] + r_root], fill=NODE
    )
    d.ellipse(
        [left[0] - r_child, left[1] - r_child, left[0] + r_child, left[1] + r_child],
        fill=NODE,
    )
    d.ellipse(
        [right[0] - r_child, right[1] - r_child, right[0] + r_child, right[1] + r_child],
        fill=NODE_DIM,
    )

    # Star badge: the "important" marker from the app.
    sc = (W * 0.745, W * 0.235)
    d.polygon(star_points(sc[0], sc[1], W * 0.085, W * 0.0356), fill=STAR)

    combined = Image.alpha_composite(badge, layer)
    return combined.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    icon = build()
    icon.save(OUT, format="PNG")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
