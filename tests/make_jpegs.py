"""Génère les JPEG de test (Pillow) : python3 tests/make_jpegs.py"""
from pathlib import Path
from PIL import Image

out = Path(__file__).parent / "fixtures"; out.mkdir(exist_ok=True)

def jpeg(name, exif=None):
    img = Image.new("RGB", (64, 48), (40, 140, 170))
    img.save(out / name, "JPEG", **({"exif": exif} if exif is not None else {}))

# 1. iPhone : date + fuseau + GPS (La Valette) + heure GPS
e = Image.Exif()
e[0x010F] = "Apple"; e[0x0110] = "iPhone 15"; e[0x0132] = "2026:10:24 18:12:05"
ex = e.get_ifd(0x8769)
ex[0x9003] = "2026:10:24 18:12:05"; ex[0x9011] = "+02:00"
g = e.get_ifd(0x8825)
g[1] = "N"; g[2] = (35.0, 53.0, 56.04); g[3] = "E"; g[4] = (14.0, 30.0, 52.56)
g[7] = (16.0, 12.0, 5.0); g[29] = "2026:10:24"
jpeg("gps_fuseau.jpg", e)

# 2. Sans fuseau, la nuit du changement d'heure (heure ambiguë 02:30), sans GPS
e = Image.Exif(); e[0x010F] = "Canon"; e[0x0110] = "EOS R6"
e.get_ifd(0x8769)[0x9003] = "2026:10:25 02:30:00"
jpeg("sans_fuseau_changement_heure.jpg", e)

# 3. Appareil resté à l'heure de Bruxelles... mais à l'heure d'été, après le passage à l'hiver : l'heure GPS corrige
e = Image.Exif(); e[0x010F] = "Samsung"; e[0x0110] = "Galaxy S24"
e.get_ifd(0x8769)[0x9003] = "2026:10:27 15:00:00"
g = e.get_ifd(0x8825)
g[1] = "N"; g[2] = (36.0, 2.0, 40.0); g[3] = "E"; g[4] = (14.0, 14.0, 23.0)  # Victoria, Gozo
g[7] = (12.0, 0.0, 0.0); g[29] = "2026:10:27"
jpeg("heure_fausse_gps_juste.jpg", e)

# 4. Hémisphère sud / ouest
e = Image.Exif()
e.get_ifd(0x8769)[0x9003] = "2026:01:10 09:00:00"; e.get_ifd(0x8769)[0x9011] = "-03:00"
g = e.get_ifd(0x8825); g[1] = "S"; g[2] = (34.0, 36.0, 0.0); g[3] = "W"; g[4] = (58.0, 22.0, 48.0)
jpeg("sud_ouest.jpg", e)

# 4b. Arrivée à Malte à 01:00, mais GPS resté sur Charleroi (point GPS de 21:39 UTC) : position périmée
e = Image.Exif(); e[0x010F] = "Apple"; e[0x0110] = "iPhone 15 Pro Max"
e.get_ifd(0x8769)[0x9003] = "2026:10:26 01:00:00"; e.get_ifd(0x8769)[0x9011] = "+01:00"
g = e.get_ifd(0x8825); g[1] = "N"; g[2] = (50.0, 27.0, 57.64); g[3] = "E"; g[4] = (4.0, 28.0, 11.39)
g[7] = (21.0, 39.0, 0.0); g[29] = "2026:10:25"
jpeg("arrivee_gps_perime.jpg", e)

# 5. Aucune métadonnée
jpeg("sans_meta.jpg")
print("ok", sorted(p.name for p in out.iterdir()))

# 6. Un vrai petit voyage : Charleroi -> avion -> Luqa -> ferry vers Gozo (tests/fixtures/voyage/)
import math, random
v = out / "voyage"; v.mkdir(exist_ok=True)
def dms(x):
    x = abs(x); d = int(x); m = int((x - d) * 60); s = round(((x - d) * 60 - m) * 60, 2)
    return (float(d), float(m), s)
def photo(name, when, off, lat=None, lng=None, color=(200, 150, 90)):
    random.seed(name)
    img = Image.new("RGB", (1200, 900), color)
    d = img.load()
    for y in range(0, 900, 3):
        for x in range(0, 1200, 3):
            r, g, b = color; k = math.sin(x / 90 + y / 70) * 30 + random.randint(-12, 12)
            for dy in range(3):
                for dx in range(3):
                    if x + dx < 1200 and y + dy < 900: d[x + dx, y + dy] = (max(0, min(255, int(r + k))), max(0, min(255, int(g + k))), max(0, min(255, int(b + k))))
    e = Image.Exif(); e[0x010F] = "Apple"; e[0x0110] = "iPhone 15"
    ex = e.get_ifd(0x8769); ex[0x9003] = when; ex[0x9011] = off
    if lat is not None:
        g = e.get_ifd(0x8825); g[1] = "N" if lat >= 0 else "S"; g[2] = dms(lat); g[3] = "E" if lng >= 0 else "W"; g[4] = dms(lng)
    img.save(v / name, "JPEG", quality=88, exif=e)
photo("01-charleroi.jpg", "2026:10:25 06:40:00", "+01:00", 50.4592, 4.4538, (120, 130, 150))
photo("02-embarquement.jpg", "2026:10:25 07:05:00", "+01:00", 50.4601, 4.4521, (110, 140, 170))
photo("03-hublot.jpg", "2026:10:25 08:30:00", "+01:00", None, None, (90, 150, 210))
photo("04-luqa.jpg", "2026:10:25 10:20:00", "+01:00", 35.8575, 14.4775, (220, 190, 140))
photo("05-valletta.jpg", "2026:10:25 13:00:00", "+01:00", 35.8989, 14.5146, (210, 170, 110))
photo("06-cirkewwa.jpg", "2026:10:26 09:00:00", "+01:00", 35.9887, 14.3290, (90, 160, 190))
photo("07-ferry.jpg", "2026:10:26 09:10:00", "+01:00", 36.0010, 14.3150, (60, 140, 200))
photo("08-ferry.jpg", "2026:10:26 09:18:00", "+01:00", 36.0120, 14.3050, (50, 130, 210))
photo("09-mgarr.jpg", "2026:10:26 09:32:00", "+01:00", 36.0250, 14.2990, (200, 180, 120))
print("voyage ok")
