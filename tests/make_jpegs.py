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

# 5. Aucune métadonnée
jpeg("sans_meta.jpg")
print("ok", sorted(p.name for p in out.iterdir()))
