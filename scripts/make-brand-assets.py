"""
Brand asset pipeline: white-background emblem -> transparent PNGs + dark preview.
- Flood-fill background from all 4 corners (interior whites stay: highlights are
  disconnected from the border by gold edges; frame gaps correctly count as bg).
- 1px erosion kills the white fringe; soft gold shadow is preserved as glow.
- Outputs: public/brand/baraka-emblem-{512,256,64}.png + qa composite preview.
Usage: python scripts/make-brand-assets.py
"""
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import os

SRC = r'D:\hermes\Home\profiles\baraka-market\attachments\Baraka Logo.png'
OUT = r'D:/Dev/baraka-market/public/brand'
QA = r'D:/Hermes/Home/profiles/baraka-market/cache/scratch/qa'
os.makedirs(OUT, exist_ok=True)
os.makedirs(QA, exist_ok=True)

im = Image.open(SRC).convert('RGBA')
rgb = im.convert('RGB')

# Background = near-white pixels CONNECTED to the image border.
# (Interior whites — specular highlights — are disconnected by gold edges, so they survive.)
white = rgb.point(lambda v: 255 if v > 195 else 0).convert('L')
bg = white.copy()
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

# Dark-composite proof (navbar #0b0f17 + license card gradient base)
for name, bg, size in (('proof-nav', (11, 15, 23, 255), 72), ('proof-hero', (17, 23, 34, 255), 288)):
    tile = canvas.copy()
    tile.thumbnail((size, size), Image.LANCZOS)
    comp = Image.new('RGBA', (tile.width + 40, tile.height + 40), bg)
    comp.paste(tile, (20, 20), tile)
    p = f'{QA}/{name}.png'
    comp.save(p)
    print('PROOF', p)
