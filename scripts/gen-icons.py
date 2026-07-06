#!/usr/bin/env python3
"""Generate PWA icons from the app's brand accent (oklch(0.45 0.19 262.5)).

Full-bleed blue field + a white skyline mark, kept inside the maskable safe zone so the
same art serves Android maskable, iOS apple-touch (corner-masked), and the browser favicon.
Run: python3 scripts/gen-icons.py   (writes into ../public relative to this file)
"""
import math
import os
from PIL import Image, ImageDraw


def oklch_to_srgb(L, C, H_deg):
    h = math.radians(H_deg)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_
    g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_
    bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_

    def enc(x):
        x = max(0.0, min(1.0, x))
        x = 1.055 * x ** (1 / 2.4) - 0.055 if x > 0.0031308 else 12.92 * x
        return round(max(0.0, min(1.0, x)) * 255)

    return (enc(r), enc(g), enc(bl))


BLUE = oklch_to_srgb(0.45, 0.19, 262.5)
WHITE = (255, 255, 255)
SS = 4  # supersample for crisp downscaled edges


def render(size, bg=BLUE):
    S = size * SS
    img = Image.new("RGB", (S, S), bg)
    d = ImageDraw.Draw(img)
    # Three towers within the central ~46% (well inside the maskable safe circle, r=40%).
    cx, base = S / 2, S * 0.67
    w, gap = S * 0.088, S * 0.04
    heights = [0.255, 0.40, 0.315]  # left, middle, right — as fraction of S
    total = 3 * w + 2 * gap
    x = cx - total / 2
    r = w * 0.32
    for hf in heights:
        top = base - S * hf
        d.rounded_rectangle([x, top, x + w, base], radius=r, fill=WHITE)
        x += w + gap
    return img.resize((size, size), Image.LANCZOS)


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "public")
    os.makedirs(out, exist_ok=True)
    jobs = {
        "icon-192.png": 192,
        "icon-512.png": 512,
        "apple-touch-icon-180.png": 180,
        "favicon-32.png": 32,
        "favicon-16.png": 16,
    }
    for name, sz in jobs.items():
        render(sz).save(os.path.join(out, name))
        print("wrote", name, sz)
    # A crisp multi-res .ico for legacy favicon requests.
    render(64).save(
        os.path.join(out, "favicon.ico"),
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    )
    print("wrote favicon.ico  brand blue =", "#%02X%02X%02X" % BLUE)


if __name__ == "__main__":
    main()
