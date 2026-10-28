# Mon carnet de voyages

Des carnets de voyage illustrés : une carte nautique du pays, les photos placées et datées automatiquement, et les proches qui suivent en direct, **sans compte**, grâce à un code d'accès propre à chaque voyage.

- Site statique sans build (GitHub Pages) : `index.html`, `app.js`, `style.css`, `firebase-config.js`
- Firebase, forfait gratuit Spark : Authentication (Google ou e-mail + mot de passe pour les éditeurs, Anonyme pour les visiteurs) et Firestore. Les photos sont rangées dans Firestore (pas de Storage, pas de carte bancaire).
- Liens : `#/` accueil · `#/v/{voyage}` un voyage · `#/v/{voyage}/admin` réglages

## Mise en route

1. **Firebase**, dans la console du projet choisi :
   1. *Authentication > Méthode de connexion* : activer **Google**, **Adresse e-mail/Mot de passe** et **Anonyme**.
   2. *Authentication > Paramètres > Domaines autorisés* : ajouter `qtheun27.github.io`.
   3. *Firestore Database* : créer la base (mode production) si elle n'existe pas.
   4. Publier `firestore.rules` (voir « Règles » ci-dessous).
   5. *Paramètres du projet > Vos applications > Web* : copier la configuration dans `firebase-config.js`.
2. **GitHub Pages** : servi depuis la branche `gh-pages`, recopiée automatiquement depuis `main` (`.github/workflows/pages.yml`).
3. Ouvrir `https://qtheun27.github.io/voyage-interactif/`, cliquer sur **Je suis éditeur** et se connecter avec `q.theuninck@gmail.com`.
4. Sur l'accueil, cliquer sur **Créer « Notre voyage à Malte »** : choisir les dates et le **code d'accès**, puis créer.
5. Réglages du voyage > **Envoyer le lien et le code** : un seul message, le lien `#/v/{voyage}/c/{CODE}` fait entrer directement (le code est retiré de l'adresse aussitôt).

## Règles

`firestore.rules` est complet pour un projet dédié. Dans un projet existant, copier seulement le bloc entre `DÉBUT VOYAGE INTERACTIF` et `FIN VOYAGE INTERACTIF` dans le `match` existant, **après avoir vérifié qu'aucune règle existante n'ouvre l'accès largement** (par exemple `match /{document=**} { allow read: if request.auth != null; }`). Dans Firebase, les règles s'additionnent : une règle large donnerait aux visiteurs anonymes accès à tout.

Avec la CLI : `npx firebase deploy --only firestore:rules` (après avoir mis l'id du projet dans `.firebaserc`).

## Données

| Chemin | Contenu |
| --- | --- |
| `trips/{id}` | `title, subtitle, country (ISO3), timezone, startDate, endDate, cover (JPEG 1000 px), coverStop, status, createdAt, owner` |
| `trips/{id}/stops/{stop}` | une photo : `lat, lng, at, created, place, caption, thumb (JPEG 400 px), hasPhoto, approxPos, approxTime, device, by, byName` |
| `trips/{id}/photos/{stop}` | `data` : la photo en grand (JPEG 1600 px, moins de 1 Mio), chargée à l'ouverture |
| `trips/{id}/reactions/{photo}` | un champ par personne : `uid → "emoji|prénom"` (❤️ 😍 😂 😮 👏, une réaction par personne et par photo) |
| `trips/{id}/comments/{id}` | `photoId` (une photo de l'étape), `text`, `name`, `uid`, `at` ; jamais modifié, supprimé par son auteur ou un éditeur |
| `users/{uid}` | `photo` : photo de profil choisie dans la galerie (JPEG 256 px), lisible par son seul titulaire |
| `trips/{id}/codes/{CODE}` | document vide ; l'id est le code. Jamais lisible par les visiteurs |
| `trips/{id}/members/{uid}` | `{ code, joinedAt }`, créé par le visiteur avec le bon code |
| `config/editors` | `{ emails: [...] }`, modifiable par le propriétaire depuis les réglages |

## Compte, couverture, réactions

- **En-tête** : nom de l'appli en entier, avatar à droite (photo Google, ou photo choisie dans la galerie). Menu : changer sa photo, créer ou changer son mot de passe, se déconnecter.
- **Connexion éditeur** : Google, ou e-mail + mot de passe (adresse confirmée par le lien reçu par e-mail ; « Mot de passe oublié ? »). Un compte Google peut se créer un mot de passe pour se connecter aussi par e-mail. Seules les adresses de `config/editors` publient.
- **Couverture** des voyages : choisie dans les réglages parmi les photos du voyage (l'image en grand est reprise) ou depuis la galerie ; la première photo envoyée devient la couverture tant qu'il n'y en a pas.
- **Réactions** sur toutes les photos et **commentaires** sur les étapes et trajets, pour les proches (avec le code) comme pour les éditeurs, en direct ; le prénom des visiteurs est demandé une fois. Compteurs dans le carnet, message quand un commentaire arrive.
- **Icône** : propositions dans `icons/propositions/` ; `node tools/render-icons.cjs icons/propositions/a-carnet.svg` régénère les PNG.

## Le récit du voyage

- **Chronologie d'abord** : deux étapes voisines le même jour, sans photo entre elles, sont réunies (moins de 1 km et 3 h, ou 2 km et 30 min si l'une n'a qu'une photo) ; un arrêt de quelques minutes au milieu d'un trajet (le bateau devant une grotte) ne coupe pas le trajet ; une photo entre deux photos prises en route est en route. Deux étapes qui ont chacune un petit mot, ou une étape commencée à la main, restent distinctes.
- **↺ Remettre dans l'ordre des photos** (en tête d'un jour, quand il a été retouché) : heures et lieux lus dans les photos (`origAt`, gardé à l'envoi, sinon l'heure GPS), rangements et heures inventées oubliés ; noms et petits mots gardés ; Annuler.
- Les photos sont regroupées en **étapes** (même jour, moins de 75 min et 600 m d'écart, ou au même endroit à 150 m près dans les 5 h) reliées par des **trajets**.
- **Ajout en masse** (100 photos et plus) : lecture en parallèle, vignettes légères, photos déjà publiées ignorées, puis un **plan** qui montre les étapes et trajets détectés avant publication (nom et petit mot par étape, moyen de transport par trajet). Envoi 2 par 2, écran maintenu allumé, reprise possible.
- **Fiche trajet** (crayon dans le carnet, ou toucher le trajet sur la carte) : moyen de transport (avion, bateau, voiture, taxi, bus, train, vélo, à pied), nom, petit mot, masquer. Étapes : fusionner avec la précédente, ou nouvelle étape à partir d'une photo.
- Une photo prise **en route** ne crée pas d'étape : sur l'eau (ferry), dans l'avion (entre deux photos éloignées, à plus de 200 km/h) ou en roulant. Elle dessine le trajet et apparaît en petite vignette ronde sur la carte.
- Mode du trajet deviné automatiquement : avion, bateau (photos sur l'eau, ou traversée sans photo), voiture, à pied. L'éditeur peut l'imposer (« Arrivé ici en… »), forcer une photo en « prise en route » ou en arrêt, et poser une étiquette (Départ, Arrivée, Hôtel…).
- Étiquettes automatiques : **Départ** et **Retour** pour les étapes hors du pays du voyage, **Arrivée** après le vol aller ; vols « aller » et « retour ».
- Une photo sans position prise entre deux photos éloignées (dans l'avion) est placée sur la ligne entre les deux.
- **Ranger à la main** : *Modifier > Ranger dans une autre étape* (cette photo ou toute l'étape), ou **appui long** sur une étape du carnet pour la glisser dans une autre ; « Annuler » dans le message qui suit. Champ `stopRef` : la photo rejoint l'étape qui contient cette photo de référence, son heure et sa position suivent l'étape si elles sont incertaines ou trop éloignées.
- **Vidéos « vidées » par l'iPhone** (le navigateur reçoit une copie sans lieu ni appareil, datée du moment de l'export) : reconnues, jamais placées au hasard ; on choisit leur étape dans « Où était-ce ? » avant l'envoi.
- **Plusieurs éditeurs** (Réglages > Éditeurs) : leurs photos suivent exactement le même rangement que les tiennes (même endroit et même moment = même étape, sinon nouvelle étape ou trajet).
- **Lieu sans photo** (bouton dans le carnet) : la maison au départ, l'aéroport…, trouvé par recherche ou en touchant la carte.

Pour les proches : écran d'accueil du voyage, **Revivre le voyage** (la carte suit le parcours, l'avion et le bateau avancent, les photos défilent en diaporama), visionneuse plein écran qui enchaîne toutes les photos du voyage au doigt, onglet **Photos** (galerie par jour), message quand une nouvelle photo arrive.

## Vidéos et photos HD (Backblaze B2)

- Une fois Backblaze branché, les **photos en grand** partent aussi sur le seau (2560 px, JPEG 0,88, champs `photoUrl`, `photoKey`) ; les miniatures (400 px) restent dans Firestore pour un carnet et une carte rapides. Les photos déjà publiées restent lues depuis Firestore ; pour les passer en haute qualité, il suffit de les réimporter : elles sont reconnues (même appareil, même seconde, même endroit) et seule l'image en grand est remplacée, noms, petits mots, étapes et réglages compris.

- Les vidéos (MOV d'iPhone, MP4) partent **telles quelles** sur un seau Backblaze B2 public (10 Go gratuits, sans carte), sous un nom aléatoire impossible à deviner ; seule leur adresse est enregistrée dans Firestore, lisible par les membres du voyage.
- Date avec fuseau, position GPS, durée et appareil sont lus dans la vidéo (`lib/mov.js`, boîte « moov » seulement). Une image vers 1 s sert d'affiche (carte, carnet, galerie).
- Envoi direct depuis le téléphone de l'éditeur avec des URL présignées S3 (`lib/s3.js`, signature V4) ; au-delà de 32 Mo, en morceaux de 16 Mo, 3 à la fois, chacun réessayé.
- Visionneuse : lecture intégrée ; « Revivre le voyage » : la vidéo passe en entier (30 s au plus), muette par défaut, bouton son.
- Réglages : *Réglages du voyage > Vidéos* (propriétaire) : point d'accès S3, seau, keyID, applicationKey, adresse publique, bouton **Tester**. Enregistrés dans `config/storage`, lisibles par les seuls éditeurs.
- Le seau doit être **public** et avoir une règle CORS autorisant `https://qtheun27.github.io` pour `s3_put`, `s3_post`, `s3_get`, `s3_head`, `s3_delete`, avec l'en-tête `ETag` exposé.

## Fonds de carte

Bouton de la carte (en haut) : **Paysage** (par défaut : vue du ciel Esri World Imagery adoucie, noms de lieux CARTO par-dessus), **Plan** (CARTO Voyager), **Illustrée** (la carte dessinée du carnet). Le choix est retenu sur l'appareil.

## Pays et packs

- Fond du monde (aller-retour) : `data/world-land.geojson`, Natural Earth 1:50m (domaine public), simplifié.
- Le contour du pays vient de `data/{ISO3}.geojson` s'il existe, sinon de l'API geoBoundaries (mis en cache sur l'appareil). Pour l'ajouter au dépôt : `node tools/fetch-boundary.mjs FRA`.
- Un « pack » ajoute lieux connus, pictogrammes, ferries et étiquettes : voir `packs/MLT.js`, à déclarer dans `packs/index.js`.
- Sans lieu connu à proximité, le nom vient de Nominatim (OpenStreetMap), 1 requête par seconde au plus, puis il est enregistré dans la photo.

## Rapidité

- **Cache Firestore** sur l'appareil (IndexedDB) : à la réouverture, le carnet et ses miniatures s'affichent tout de suite, seules les nouveautés sont téléchargées.
- **sw.js** garde l'appli, les bibliothèques, les polices et les fonds de carte sur le téléphone ; une nouvelle version publiée est détectée et l'appli se recharge d'elle-même à l'ouverture (ou propose « Recharger »).
- Carte et photos se chargent en parallèle ; exifr (photos HEIC) n'est chargé qu'au premier ajout de photos qui en a besoin ; modules Firebase préchargés.

## Tests

```sh
npm install
npm test                 # EXIF, heures autour du 25/10/2026, étapes et trajets, vidéos (MOV/MP4), signature S3
npm run test:rules       # règles Firestore avec l'émulateur (Java requis)
python3 tests/make_jpegs.py   # régénère les JPEG de test
# Parcours complet dans Chromium (Playwright requis) :
npm run emulators & npm run mock-s3 & python3 -m http.server 8000 --bind 127.0.0.1 & npm run test:e2e
```

## Limites du forfait gratuit

Firestore gratuit : 1 Gio stocké (environ 2 000 photos à 400 à 500 Ko), 50 000 lectures et 20 000 écritures par jour. Chaque visiteur qui ouvre un voyage lit une fois chaque étape, plus une lecture par photo ouverte en grand.
