"""Key the raven out of the provided artwork into a transparent silhouette.

Produces:
  public/raven-mask.png  — white raven on transparent (CSS mask, tinted by --gold)
  public/raven-icon.png  — solid-gold raven on transparent, square-padded (favicon)

Keying: the raven sits on a near-uniform background; pixels close to the
sampled corner color become transparent, gold pixels stay. The negative-space
lightning bolt and eye are background-colored, so they key out too — exactly
what we want (they reveal the real page background).
"""
import statistics
import sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else \
    "/Users/admin/.claude/image-cache/e6741427-2a23-4d10-87ab-15b785c87aba/7.png"

img = Image.open(SRC).convert("RGBA")
# Raven in the cream (top) half — high contrast, clean key.
crop = img.crop((120, 210, 372, 436))
w, h = crop.size
bg = crop.getpixel((3, 3))[:3]

def dist(c):
    return ((c[0] - bg[0]) ** 2 + (c[1] - bg[1]) ** 2 + (c[2] - bg[2]) ** 2) ** 0.5

LO, HI = 45, 95  # distance ramp: <=LO fully transparent, >=HI fully opaque
alpha = Image.new("L", (w, h), 0)
ap = alpha.load()
golds = []
for y in range(h):
    for x in range(w):
        r, g, b, _ = crop.getpixel((x, y))
        d = dist((r, g, b))
        a = 0 if d <= LO else 255 if d >= HI else round((d - LO) / (HI - LO) * 255)
        ap[x, y] = a
        if a > 220:
            golds.append((r, g, b))

bbox = alpha.getbbox()
alpha = alpha.crop(bbox)
mw, mh = alpha.size

mask = Image.new("RGBA", (mw, mh), (255, 255, 255, 0))
mask.putalpha(alpha)
mask.save("public/raven-mask.png")

gold = tuple(int(statistics.median([c[i] for c in golds])) for i in range(3))
icon_rect = Image.new("RGBA", (mw, mh), gold + (0,))
icon_rect.putalpha(alpha)
side = max(mw, mh)
sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
sq.paste(icon_rect, ((side - mw) // 2, (side - mh) // 2), icon_rect)
sq.save("public/raven-icon.png")

print(f"mask {mw}x{mh}  gold {gold}  opaque_px {len(golds)}")
