"""
Brand asset pipeline: black-background emblem -> transparent PNGs + dark preview.
- Flood-fill background from all 4 corners (interior whites stay: highlights are
  disconnected from the border by gold edges; frame gaps correctly count as bg).
- 1px erosion kills the white fringe; soft gold shadow is preserved as glow.
- Outputs: public/brand/baraka-emblem-{512,256,64}.png + qa composite preview.
Usage: python scripts/make-brand-assets.py
"""
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import os

SRC = r'D:\hermes\Home\profiles\baraka-market\attachments\Firefly.png'
OUT = r'D:/Dev/baraka-market/public/brand'
QA = r'D:/Hermes/Home/profiles/baraka-market/cache/scratch/qa'
os.makedirs(OUT, exist_ok=True)
os.makedirs(QA, exist_ok=True)

im = Image.open(SRC).convert('RGBA')
rgb = im.convert('RGB')

# Background = near-BLACK pixels CONNECTED to the image border.
# (Interior darks — notch, speaker slit, lens — are disconnected, so they survive.)
dark = rgb.point(lambda v: 255 if v < 60 else 0).convert('L')
bg = dark.copy()
for seed in [(0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)]:
    ImageDraw.floodfill(bg, seed, 128, thresh=0)
bgmask = bg.point(lambda v: 255 if v == 128 else 0)

alpha = bgmask.point(lambda v: 0 if v > 0 else 255)
alpha = alpha.filter(ImageFilter.MinFilter(3))  # trim 1px halo fringe
im.putalpha(alpha)

bbox = alpha.getbbox()
im = im.crop(bbox)
# 6% transparent breathing room for the glow
pad = int(max(im.size) * 0.06)
canvas = Image.new('RGBA', (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
canvas.paste(im, (pad, pad), im)

for s in (512, 256, 64):
    c = canvas.copy()
    c.thumbnail((s, s), Image.LANCZOS)
    p = f'{OUT}/baraka-emblem-{s}.png'
    c.save(p, optimize=True)
    print(p, c.size, os.path.getsize(p) // 1024, 'KB')

# Compact MARK (script core) for tiny sizes: gold-mass bbox -> square crop.
# The full emblem's thin phone frame vanishes at 36px; the thick calligraphic
# core survives. Used for navbar tile + favicon only; hero keeps full emblem.
opaque = Image.new('RGBA', canvas.size, (0, 0, 0, 255))
flat = Image.alpha_composite(opaque, canvas).convert('RGB')
gold = flat.point(lambda v: 255 if v > 110 else 0).convert('L')
core = gold.getbbox()
print('CORE-BBOX', core)
if core:
    x0, y0, x1, y1 = core
    w, h = x1 - x0, y1 - y0
    side = max(w, h)
    cx, cy = x0 + w / 2, y0 + h / 2
    sq = (int(cx - side / 2), int(cy - side / 2),
          int(cx + side / 2), int(cy + side / 2))
    mark = canvas.crop(sq)
    pad = int(max(mark.size) * 0.10)
    tile = Image.new('RGBA', (mark.width + 2 * pad, mark.height + 2 * pad), (0, 0, 0, 0))
    tile.paste(mark, (pad, pad), mark)
    for s in (256, 64):
        m = tile.copy()
        m.thumbnail((s, s), Image.LANCZOS)
        p = f'{OUT}/baraka-mark-{s}.png'
        m.save(p, optimize=True)
        print(p, m.size, os.path.getsize(p) // 1024, 'KB')
    proof = tile.copy()
    proof.thumbnail((96, 96), Image.LANCZOS)
    comp = Image.new('RGBA', (136, 136), (11, 15, 23, 255))
    comp.paste(proof, (20, 20), proof)
    comp.save(f'{QA}/proof-mark.png')
    print('PROOF-MARK saved')

# Dark-composite proof (navbar #0b0f17 + license card gradient base)
for name, bg, size in (('proof-nav', (11, 15, 23, 255), 72), ('proof-hero', (17, 23, 34, 255), 288)):
    tile = canvas.copy()
    tile.thumbnail((size, size), Image.LANCZOS)
    comp = Image.new('RGBA', (tile.width + 40, tile.height + 40), bg)
    comp.paste(tile, (20, 20), tile)
    p = f'{QA}/{name}.png'
    comp.save(p)
    print('PROOF', p)
