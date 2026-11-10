import json
import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = None
LARGEUR, HAUTEUR = 4096, 2048
TERRE = np.array([224, 223, 219], dtype=np.float32)
OCEAN = np.array([118, 160, 196], dtype=np.float32)

zip_chemin, terres_chemin, sortie, apercu = map(Path, sys.argv[1:5])

dossier = zip_chemin.parent / 'x'
dossier.mkdir(exist_ok=True)
with zipfile.ZipFile(zip_chemin) as z:
    for info in z.infolist():
        n = info.filename
        if '/' in n or '\\' in n or '..' in n:
            continue
        z.extract(info, dossier)
tif = next(dossier.glob('*.tif'))
print('raster', tif.name)

img = Image.open(tif)
print('taille', img.size, img.mode)
gris = np.asarray(img.convert('L').resize((LARGEUR, HAUTEUR), Image.LANCZOS), dtype=np.float32) / 255

masque = Image.new('L', (LARGEUR, HAUTEUR), 0)
dessin = ImageDraw.Draw(masque)
def px(lon, lat):
    return ((lon + 180) / 360 * LARGEUR, (90 - lat) / 180 * HAUTEUR)
for f in json.loads(terres_chemin.read_text(encoding='utf-8'))['features']:
    g = f['geometry']
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    for p in polys:
        dessin.polygon([px(*c[:2]) for c in p[0]], fill=255)
m = np.asarray(masque.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32) / 255

terre, mer = m > 0.5, m < 0.5
for nom, sel in (('terre', terre), ('ocean', mer)):
    print(nom, 'percentiles 5/25/50/75/95', np.percentile(gris[sel], [5, 25, 50, 75, 95]).round(3))

med_t, med_o = np.median(gris[terre]), np.percentile(gris[mer], 75)
f_t = np.clip(gris / med_t, 0.82, 1.05)
f_o = np.clip(gris / med_o, 0.72, 1.06)
rgb = m[..., None] * (TERRE * f_t[..., None]) + (1 - m[..., None]) * (OCEAN * f_o[..., None])
rgb = np.clip(rgb, 0, 255).astype(np.uint8)
out = Image.fromarray(rgb, 'RGB')
out.save(sortie, quality=84, optimize=True, progressive=True)
out.resize((1600, 800), Image.LANCZOS).save(apercu)
print('ecrit', sortie, sortie.stat().st_size // 1024, 'Ko')
