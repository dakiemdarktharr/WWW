"""Rebuild Kivuno's photographic footer. No generated imagery or model inference.

Requires Pillow and numpy. Run: python scripts/compose-footer.py
Downloads the seven attributed Commons originals into .local/footer-sources,
verifies their SHA-256, hand-masks floral crops, assembles a single landscape,
and applies a deterministic glass displacement. The exported artwork is CC BY-SA 4.0.
"""
from pathlib import Path
import hashlib
import json
import math
import random
import urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.local/footer-sources'
OUT = ROOT / 'public/art/kivuno-flower-collage.webp'
W, H = 3200, 1800
SKYLINE = round(H * (1 - 1 / ((1 + math.sqrt(5)) / 2)))  # 688px, 38.2% sky
SOURCES = [
    ('sky', 'Clouds_in_the_sky_landscape.jpg', 'f/f9', 'Aammell', 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/', '16120a3917f074846eb0ce076982253b901655b7420063b4dfccceb047fd865b'),
    ('forest', 'Heavy_fog_above_a_forest_%28Unsplash%29.jpg', '5/58', 'Thomas Griesbeck (jack_scorner)', 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/', '6116c88cd1b396c6cdaf94d916468192881419c574965d0a637ee39a09c01340'),
    ('fritillaria', 'Fritillaria_meleagris_flower.jpg', '6/6d', 'Meneerke bloem', 'CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/', '7bd5d99492700b24786b7850379e7f132967c31ccef7ea6bbd5affc68ba30b5a'),
    ('tricyrtis', 'Tricyrtis_hirta_%28flower_s2%29.jpg', 'c/ce', 'Alpsdake', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', 'de1143356e0c38cdbb1e1676e04c8c53a492668d53bf7e6d2b78f5fa7cea7cea'),
    ('passiflora', 'Passiflora_incarnata_flower_and_bud.jpg', '7/7f', 'E.nielsen', 'CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/', '4e47c59058ed625f23996757c9ec5c64e3cd1e40421e55397b20841b32609d3e'),
    ('eryngium', 'Eryngium_alpinum_ENBLA05.jpg', '6/67', 'Enrico Blasutto', 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/', '0bc65d9d21fefecad7f87689a8f2819ed27fb3a3501f154354009f4d5bce8494'),
    ('helleborus', 'Helleborus_foetidus_flower.jpg', '1/10', 'Meneerke bloem', 'CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/', '8ed05f1baafe72ebfe054f34ad39344371987553e321cc90cfea32f9c49de725'),
]


def acquire():
    CACHE.mkdir(parents=True, exist_ok=True)
    for key, filename, bucket, _, _, _, checksum in SOURCES:
        dest = CACHE / f'{key}.jpg'
        if not dest.exists():
            url = f'https://upload.wikimedia.org/wikipedia/commons/{bucket}/{filename}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original'
            req = urllib.request.Request(url, headers={'User-Agent': 'KivunoPhotoAttribution/1.0 (https://github.com/dakiemdarktharr/WWW)', 'Referer': 'https://commons.wikimedia.org/'})
            with urllib.request.urlopen(req, timeout=60) as response:
                dest.write_bytes(response.read())
        if hashlib.sha256(dest.read_bytes()).hexdigest() != checksum:
            raise ValueError(f'Original photo checksum changed: {key}')


def photo(key):
    return Image.open(CACHE / f'{key}.jpg').convert('RGB')


def polygon(im, points):
    mask = Image.new('L', im.size)
    ImageDraw.Draw(mask).polygon([(int(x * im.width), int(y * im.height)) for x, y in points], fill=255)
    return mask.filter(ImageFilter.GaussianBlur(1.5))


def cutout(key, bounds, points=None, chroma=None):
    im = photo(key)
    im.thumbnail((1500, 1500), Image.Resampling.LANCZOS)
    if points:
        mask = polygon(im, points)
    else:
        mask = Image.new('L', im.size, 255)
    if chroma:
        a = np.asarray(im).astype(np.float32)
        r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
        if chroma == 'violet':
            alpha = np.clip((r + b - 2 * g + 8) / 28, 0, 1)
        elif chroma == 'lime':
            alpha = np.clip((g - b - 9) / 23, 0, 1) * np.clip((g - 65) / 30, 0, 1)
        else:
            alpha = np.clip((r + b - 2 * g + 13) / 30, 0, 1) * np.clip((r + g + b - 180) / 120, 0, 1)
        # Keep the real yellow/green reproductive structures within the passion flower.
        if key == 'passiflora':
            yy, xx = np.mgrid[:im.height, :im.width]
            center = ((xx / im.width - .59) / .105) ** 2 + ((yy / im.height - .43) / .15) ** 2 < 1
            alpha[center] = 1
        mask = Image.fromarray((alpha * np.asarray(mask)).astype('uint8')).filter(ImageFilter.GaussianBlur(.6))
    rgba = im.convert('RGBA')
    rgba.putalpha(mask)
    box = tuple(round(v * (im.width if i % 2 == 0 else im.height)) for i, v in enumerate(bounds))
    return rgba.crop(box)


def grade(im, strength=.20):
    a = np.asarray(im).astype(np.float32)
    lum = a[:, :, :3] @ np.array([.24, .58, .18], dtype=np.float32)
    # A slight violet shadow/lime highlight grade, retaining photographed textures.
    shadow = np.stack([lum * .87 + 8, lum * .82 + 6, lum * 1.02 + 13], axis=-1)
    high = np.stack([lum * 1.01 + 8, lum * 1.03 + 9, lum * .91 + 8], axis=-1)
    t = np.clip((lum - 30) / 180, 0, 1)[:, :, None]
    tint = shadow * (1 - t) + high * t
    a[:, :, :3] = a[:, :, :3] * (1 - strength) + tint * strength
    return Image.fromarray(np.clip(a, 0, 255).astype('uint8'))


def build():
    acquire()
    sky = photo('sky').crop((0, 0, 4000, 2100)).resize((W, H), Image.Resampling.LANCZOS)
    sky = ImageEnhance.Color(sky).enhance(.20)
    sky = ImageEnhance.Brightness(sky).enhance(1.22)
    sky = Image.blend(sky, Image.new('RGB', (W, H), '#ded8ea'), .30)
    canvas = sky.convert('RGBA')
    woods = ImageOps.fit(photo('forest'), (W, H), centering=(.5, .73))
    woods = grade(ImageEnhance.Color(woods).enhance(.58), .26).convert('RGBA')
    vertical = np.clip((np.arange(H, dtype=np.float32) - (SKYLINE - 45)) / 205, 0, 1)
    woods.putalpha(Image.fromarray(np.repeat((vertical * 255).astype('uint8')[:, None], W, axis=1)))
    canvas.alpha_composite(woods)

    crops = {
        'fritillaria': cutout('fritillaria', (0,.10,.83,.98), [(0,.96),(.028,.96),(.025,.75),(.012,.55),(0,.30),(0,.25),(.08,.17),(.22,.12),(.37,.11),(.48,.14),(.51,.14),(.56,.18),(.71,.19),(.76,.26),(.80,.41),(.79,.51),(.73,.60),(.69,.63),(.66,.60),(.61,.65),(.50,.70),(.43,.70),(.38,.66),(.36,.58),(.31,.63),(.26,.65),(.23,.62),(.21,.52),(.20,.42),(.22,.31),(.25,.23),(.28,.20),(.43,.18),(.46,.17),(.38,.14),(.23,.145),(.10,.20),(0,.30),(.008,.55),(.018,.75),(.02,.96)]),
        'passiflora': cutout('passiflora', (.32,.16,.84,.79), [(.34,.43),(.37,.35),(.42,.20),(.49,.21),(.56,.18),(.63,.18),(.66,.25),(.75,.28),(.79,.35),(.80,.47),(.80,.60),(.76,.65),(.69,.71),(.59,.77),(.52,.76),(.48,.70),(.41,.66),(.38,.61),(.40,.55),(.35,.52)], 'violet'),
        'tricyrtis': cutout('tricyrtis', (.40,.16,.86,.59), [(.40,.25),(.42,.245),(.53,.34),(.55,.31),(.56,.18),(.59,.17),(.61,.29),(.64,.34),(.72,.28),(.78,.235),(.80,.255),(.75,.35),(.70,.39),(.82,.43),(.85,.45),(.84,.48),(.68,.47),(.65,.49),(.69,.56),(.68,.59),(.64,.56),(.59,.49),(.56,.47),(.45,.49),(.43,.47),(.44,.45),(.52,.41),(.47,.33)], 'violet'),
        'eryngium': cutout('eryngium', (.01,.26,.53,.97), [(0,.45),(.15,.39),(.24,.34),(.30,.31),(.42,.26),(.50,.27),(.51,.37),(.42,.42),(.40,.51),(.42,.58),(.38,.64),(.39,.70),(.40,.81),(.46,.93),(.31,.97),(.22,.92),(.11,.86),(.07,.79),(.09,.73),(.10,.68),(.05,.60)], 'silver'),
        'helleborus': cutout('helleborus', (.04,.09,.88,.83), [(.05,.46),(.14,.40),(.25,.39),(.34,.40),(.40,.30),(.47,.24),(.50,.17),(.53,.13),(.53,.21),(.59,.17),(.65,.10),(.68,.10),(.66,.17),(.73,.18),(.76,.23),(.81,.24),(.84,.27),(.83,.33),(.85,.38),(.81,.43),(.79,.50),(.88,.56),(.84,.60),(.85,.65),(.82,.70),(.80,.74),(.72,.76),(.64,.72),(.57,.74),(.52,.81),(.43,.82),(.37,.79),(.34,.74),(.31,.63),(.23,.62),(.20,.58),(.13,.56),(.08,.53)], 'lime'),
        'leaf': cutout('passiflora', (.10,.48,.34,.91), [(.11,.88),(.13,.77),(.17,.66),(.24,.55),(.29,.51),(.32,.50),(.32,.56),(.28,.67),(.22,.78),(.16,.85)]),
        'frond': cutout('eryngium', (.40,.48,1,1), [(.42,.53),(.54,.54),(.61,.58),(.68,.60),(.76,.66),(.81,.72),(.94,.80),(1,.85),(1,1),(.83,.99),(.75,.89),(.67,.81),(.59,.76),(.51,.66),(.44,.62)], 'lime'),
    }
    for key, crop in crops.items():
        crops[key] = grade(crop, .24)
        crops[key].save(CACHE / f'cutout-{key}.png')

    def place(key, x, y, width, angle=0, flip=False, brightness=1, haze=0, blur=0):
        item = crops[key]
        item = item.resize((round(width), round(width * item.height / item.width)), Image.Resampling.LANCZOS)
        if flip: item = ImageOps.mirror(item)
        if brightness != 1: item = ImageEnhance.Brightness(item).enhance(brightness)
        if haze:
            alpha = item.getchannel('A')
            item = Image.blend(item, Image.new('RGBA', item.size, '#8c819e'), haze)
            item.putalpha(alpha.point(lambda value: round(value * (1 - haze * .2))))
        if angle: item = item.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
        if blur: item = item.filter(ImageFilter.GaussianBlur(blur))
        canvas.alpha_composite(item, (round(x - item.width / 2), round(y - item.height / 2)))

    rng = random.Random(271828)
    # Far flowers nest among the real treeline, leaving the golden-ratio sky clear.
    for i in range(46):
        key = ['eryngium','helleborus','tricyrtis','passiflora'][i % 4]
        x = rng.uniform(-80, W + 80); y = rng.uniform(900, 1430)
        width = rng.uniform(90, 210)
        place(key, x, y, width, rng.uniform(-17,17), i%3==0, .66, .23, .7)
    # Real leaf and branch crops form a connected understorey, never rectangular photo panels.
    for i in range(62):
        place('leaf' if i%3 else 'frond', rng.uniform(-180,W+180), rng.uniform(1110,1920), rng.uniform(180,440), rng.uniform(-75,75), bool(i%2), .56 if i<35 else .72, .05)
    arrangements = [
        ('eryngium',90,1120,340,-9),('fritillaria',385,1120,300,7),('helleborus',700,1350,400,-15),
        ('tricyrtis',960,1170,260,20),('passiflora',1190,1370,360,-17),('eryngium',1500,1120,300,11),
        ('helleborus',1750,1350,380,13),('fritillaria',1990,1060,290,-12),('tricyrtis',2220,1280,310,-23),
        ('passiflora',2510,1190,370,13),('eryngium',2860,1260,350,-7),('helleborus',3160,1390,440,12),
        ('passiflora',180,1700,540,19),('tricyrtis',640,1630,420,-12),('fritillaria',1020,1600,400,11),
        ('eryngium',1370,1740,530,-13),('passiflora',1740,1660,460,-14),('helleborus',2140,1730,570,17),
        ('fritillaria',2530,1590,440,-8),('tricyrtis',2940,1730,500,16),
    ]
    for i,(key,x,y,width,angle) in enumerate(arrangements):
        place(key,x,y,width,angle,bool(i%3==0),.96 if y>1450 else .83,.025 if y>1450 else .06)

    raw = canvas.convert('RGB')
    raw.save(CACHE / 'collage-before-glass.webp', quality=94)
    # Optical effect only: a row-wise horizontal remap, broad irregular glass bands.
    src = np.asarray(raw)
    result = np.empty_like(src)
    xx = np.arange(W, dtype=np.float32)
    for y in range(H):
        amount = .35 + .65 * min(1, y / SKYLINE)
        wave = (9*np.sin(xx/91 + .23*np.sin(y/270)) + 4*np.sin(xx/43 + y/490)) * amount
        xmap = np.clip(np.rint(xx + wave).astype(np.int32), 0, W-1)
        result[y] = src[y, xmap]
    glass = Image.fromarray(result).filter(ImageFilter.GaussianBlur(.65))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    glass.save(OUT, quality=88, method=6)
    glass.resize((1600,900), Image.Resampling.LANCZOS).save(CACHE / 'collage-preview.jpg', quality=91)
    print(f'{OUT}: {W}x{H}, {OUT.stat().st_size:,} bytes; sky boundary {SKYLINE}px')


if __name__ == '__main__':
    build()
