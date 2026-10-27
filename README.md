# Voyage interactif

Des carnets de voyage illustrés : une carte nautique du pays, les photos placées et datées automatiquement, et les proches qui suivent en direct, **sans compte**, grâce à un code d'accès propre à chaque voyage.

- Site statique sans build (GitHub Pages) : `index.html`, `app.js`, `style.css`, `firebase-config.js`
- Firebase, forfait gratuit Spark : Authentication (Google pour les éditeurs, Anonyme pour les visiteurs) et Firestore. Les photos sont rangées dans Firestore (pas de Storage, pas de carte bancaire).
- Liens : `#/` accueil · `#/v/{voyage}` un voyage · `#/v/{voyage}/admin` réglages

## Mise en route

1. **Firebase**, dans la console du projet choisi :
   1. *Authentication > Méthode de connexion* : activer **Google** et **Anonyme**.
   2. *Authentication > Paramètres > Domaines autorisés* : ajouter `qtheun27.github.io`.
   3. *Firestore Database* : créer la base (mode production) si elle n'existe pas.
   4. Publier `firestore.rules` (voir « Règles » ci-dessous).
   5. *Paramètres du projet > Vos applications > Web* : copier la configuration dans `firebase-config.js`.
2. **GitHub Pages** : servi depuis la branche `gh-pages`, recopiée automatiquement depuis `main` (`.github/workflows/pages.yml`).
3. Ouvrir `https://qtheun27.github.io/voyage-interactif/`, cliquer sur **Je suis éditeur** et se connecter avec `q.theuninck@gmail.com`.
4. Sur l'accueil, cliquer sur **Créer « Notre voyage à Malte »** : choisir les dates et le **code d'accès**, puis créer.
5. Partager `https://qtheun27.github.io/voyage-interactif/#/v/malte-2026` et envoyer le code à part.

## Règles

`firestore.rules` est complet pour un projet dédié. Dans un projet existant, copier seulement le bloc entre `DÉBUT VOYAGE INTERACTIF` et `FIN VOYAGE INTERACTIF` dans le `match` existant, **après avoir vérifié qu'aucune règle existante n'ouvre l'accès largement** (par exemple `match /{document=**} { allow read: if request.auth != null; }`). Dans Firebase, les règles s'additionnent : une règle large donnerait aux visiteurs anonymes accès à tout.

Avec la CLI : `npx firebase deploy --only firestore:rules` (après avoir mis l'id du projet dans `.firebaserc`).

## Données

| Chemin | Contenu |
| --- | --- |
| `trips/{id}` | `title, subtitle, country (ISO3), timezone, startDate, endDate, cover (JPEG), status, createdAt, owner` |
| `trips/{id}/stops/{stop}` | une photo : `lat, lng, at, created, place, caption, thumb (JPEG 400 px), hasPhoto, approxPos, approxTime, device, by, byName` |
| `trips/{id}/photos/{stop}` | `data` : la photo en grand (JPEG 1600 px, moins de 1 Mio), chargée à l'ouverture |
| `trips/{id}/codes/{CODE}` | document vide ; l'id est le code. Jamais lisible par les visiteurs |
| `trips/{id}/members/{uid}` | `{ code, joinedAt }`, créé par le visiteur avec le bon code |
| `config/editors` | `{ emails: [...] }`, modifiable par le propriétaire depuis les réglages |

## Pays et packs

- Le contour du pays vient de `data/{ISO3}.geojson` s'il existe, sinon de l'API geoBoundaries (mis en cache sur l'appareil). Pour l'ajouter au dépôt : `node tools/fetch-boundary.mjs FRA`.
- Un « pack » ajoute lieux connus, pictogrammes, ferries et étiquettes : voir `packs/MLT.js`, à déclarer dans `packs/index.js`.
- Sans lieu connu à proximité, le nom vient de Nominatim (OpenStreetMap), 1 requête par seconde au plus, puis il est enregistré dans la photo.

## Tests

```sh
npm install
npm test                 # lecteur EXIF (JPEG générés par Pillow) + heures autour du 25/10/2026
npm run test:rules       # règles Firestore avec l'émulateur (Java requis)
python3 tests/make_jpegs.py   # régénère les JPEG de test
# Parcours complet dans Chromium (Playwright requis) :
npm run emulators & python3 -m http.server 8000 --bind 127.0.0.1 & npm run test:e2e
```

## Limites du forfait gratuit

Firestore gratuit : 1 Gio stocké (environ 2 000 photos à 400 à 500 Ko), 50 000 lectures et 20 000 écritures par jour. Chaque visiteur qui ouvre un voyage lit une fois chaque étape, plus une lecture par photo ouverte en grand.
