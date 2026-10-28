// Compte, couverture, réactions et commentaires, dans Chromium contre les émulateurs.
// Même lancement que tests/e2e.cjs.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'tests', 'captures');
fs.mkdirSync(OUT, { recursive: true });
const FB = R + '/node_modules/firebase/';
const testCfg = fs.readFileSync(R + '/firebase-config.js', 'utf8')
  .replace(/projectId: "[^"]+"/, 'projectId: "demo-voyage"').replace(/authDomain: "[^"]+"/, 'authDomain: "demo-voyage.firebaseapp.com"')
  .replace('export const emulators = null;', 'export const emulators = { host: "127.0.0.1" };');
async function setup(ctx){
  await ctx.route(/gstatic\.com\/firebasejs\/10\.14\.1\/(.+)$/, r => r.fulfill({ path: FB + r.request().url().split('/').pop(), contentType: 'text/javascript' }));
  await ctx.route(/leaflet\.min\.js$/, r => r.fulfill({ path: R + '/node_modules/leaflet/dist/leaflet.js', contentType: 'text/javascript' }));
  await ctx.route(/leaflet\.min\.css$/, r => r.fulfill({ path: R + '/node_modules/leaflet/dist/leaflet.css', contentType: 'text/css' }));
  await ctx.route(/exifr@7\.1\.3/, r => r.fulfill({ path: R + '/node_modules/exifr/dist/lite.umd.js', contentType: 'text/javascript' }));
  await ctx.route(/fonts\.googleapis|fonts\.gstatic|geoboundaries/, r => r.abort());
  await ctx.route(/basemaps\.cartocdn|arcgisonline|maps\.eox\.at|tile\.openstreetmap\.fr/, r => r.fulfill({ body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'), contentType: 'image/png' }));
  await ctx.route(/nominatim\.openstreetmap\.org\/search/, r => r.fulfill({ contentType: 'application/json', headers: {'access-control-allow-origin': '*'},
    body: JSON.stringify([{ name: 'Maison', display_name: 'Maison, Gosselies, Charleroi, Belgique', lat: '50.47', lon: '4.43' }]) }));
  await ctx.route(/nominatim\.openstreetmap\.org\/reverse/, r => {
    const u = new URL(r.request().url()), lat = +u.searchParams.get('lat');
    r.fulfill({ contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify({ name: lat > 45 ? 'Aéroport de Charleroi' : '', address: { village: lat > 45 ? 'Charleroi' : 'Lieu OSM' } }) });
  });
  await ctx.route(/127\.0\.0\.1:8000\/firebase-config\.js/, r => r.fulfill({ body: testCfg, contentType: 'text/javascript' }));
}
const log = (...a) => console.log('•', ...a);
const txt = s => s.replace(/\s+/g, ' ').trim();
(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const ed = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Brussels' });
  await setup(ed);
  const p = await ed.newPage();
  p.on('pageerror', e => errs.push('éditeur : ' + e.message));
  p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8000/#/');
  await p.waitForSelector('#screen-home:not([hidden])');
  log('titre :', await p.title(), '|', txt(await p.textContent('#screen-home h1')));
  const h1 = await p.$eval('#screen-home h1', el => el.scrollWidth <= el.clientWidth + 1);
  log('nom en entier dans l\'en-tête :', h1);
  await p.evaluate(() => window.__viTestSignIn('q.theuninck@gmail.com'));
  await p.waitForSelector('#seed-card');
  log('avatar (initiales) :', txt(await p.textContent('#home-account .avatar')));
  await p.click('#seed-card');
  await p.fill('#nt-start', '2026-10-25'); await p.fill('#nt-end', '2026-10-29'); await p.fill('#nt-code', 'MALTE-VOYAGE');
  await p.click('#nt-submit');
  await p.waitForSelector('#screen-trip:not([hidden])');
  const dir = R + '/tests/fixtures/voyage/';
  const files = fs.readdirSync(dir).sort().map(f => dir + f).slice(-4);
  await p.setInputFiles('#f-photos', files);
  await p.waitForFunction(() => !document.querySelector('#add-submit').disabled && document.querySelectorAll('#plan .plan-item').length >= 1);
  await p.waitForTimeout(1000);
  await p.click('#add-submit');
  await p.waitForFunction(() => document.querySelector('#add').hidden, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  // Couverture par défaut : visible sur l'accueil
  await p.goto('http://127.0.0.1:8000/#/');
  await p.waitForSelector('#home-cards .tcard .cover');
  log('couverture par défaut :', await p.$eval('#home-cards .tcard .cover', el => !!el.querySelector('img')));
  // Couverture choisie parmi les photos
  await p.goto('http://127.0.0.1:8000/#/v/malte-2026/admin');
  await p.waitForSelector('#screen-admin:not([hidden])');
  await p.click('#a-cover-pick');
  await p.waitForSelector('#a-cover-grid [data-cover]');
  const n = await p.$$eval('#a-cover-grid [data-cover]', l => l.length);
  const pressed0 = await p.$$eval('#a-cover-grid [data-cover]', l => l.findIndex(b => b.getAttribute('aria-pressed') === 'true'));
  await p.click('#a-cover-grid [data-cover]:last-child');
  await p.click('#a-save');
  await p.waitForFunction(() => document.querySelector('#a-msg').textContent.includes('Enregistré'), null, { timeout: 15000 });
  log('couverture choisie :', n, 'photos proposées, celle par défaut =', pressed0, '->', await p.textContent('#a-msg'));
  await p.click('#a-cover-pick'); await p.click('#a-cover-pick');
  log('couverture cochée après enregistrement :', await p.$$eval('#a-cover-grid [data-cover]', l => l.findIndex(b => b.getAttribute('aria-pressed') === 'true')));
  await p.screenshot({ path: OUT + '/s0-couverture.png' });
  // Mon compte : photo de profil depuis la galerie, mot de passe
  await p.click('#admin-account .avatar');
  await p.waitForSelector('#acct:not([hidden])');
  log('menu compte :', txt(await p.textContent('#ac-signed')));
  await p.setInputFiles('#ac-photo', files[0]);
  await p.waitForFunction(() => document.querySelector('#ac-msg').textContent.includes('changée'), null, { timeout: 15000 });
  log('photo de profil :', await p.$eval('#admin-account .avatar', b => b.querySelector('img')?.src.startsWith('blob:')));
  await p.click('#ac-pw-open');
  log('création mot de passe, champ actuel caché :', await p.isHidden('#ac-pw-cur'));
  await p.fill('#ac-pw-new', 'court'); await p.fill('#ac-pw-new2', 'court'); await p.click('#ac-pw-save');
  log('trop court :', await p.textContent('#ac-msg'));
  await p.fill('#ac-pw-new', 'Gozo-2026!'); await p.fill('#ac-pw-new2', 'Gozo-2026!'); await p.click('#ac-pw-save');
  await p.waitForFunction(() => /enregistré|marché|Mot de passe|Cette|Trop|Pas|activée/.test(document.querySelector('#ac-msg').textContent), null, { timeout: 15000 }).catch(async () => console.log('msg=', await p.textContent('#ac-msg'), await p.isDisabled('#ac-pw-save')));
  log('mot de passe :', await p.textContent('#ac-msg'));
  await p.screenshot({ path: OUT + '/s1-compte.png' });
  await p.click('#ac-pw-open');
  log('changement, champ actuel visible :', await p.isVisible('#ac-pw-cur'));
  await p.fill('#ac-pw-cur', 'faux-mot'); await p.fill('#ac-pw-new', 'Malte-2027!'); await p.fill('#ac-pw-new2', 'Malte-2027!'); await p.click('#ac-pw-save');
  await p.waitForFunction(() => document.querySelector('#ac-msg').classList.contains('err'), null, { timeout: 15000 });
  log('mauvais mot de passe actuel :', await p.textContent('#ac-msg'));
  await p.fill('#ac-pw-cur', 'Gozo-2026!'); await p.click('#ac-pw-save');
  await p.waitForFunction(() => document.querySelector('#ac-msg').classList.contains('ok'), null, { timeout: 15000 });
  log('changé :', await p.textContent('#ac-msg'));
  // Déconnexion puis connexion par e-mail et mot de passe
  await p.click('#ac-signed [data-action="signout"]');
  await p.waitForSelector('#join-form:not([hidden])');
  await p.click('#home-account .avatar');
  log('menu invité :', await p.isVisible('#ac-login'));
  await p.fill('#ac-email', 'q.theuninck@gmail.com'); await p.fill('#ac-pass', 'Malte-2027!');
  await p.click('#ac-signin');
  await p.waitForSelector('#home-editor-actions:not([hidden])', { timeout: 15000 });
  log('connecté par e-mail, éditeur :', await p.isHidden('#acct'), '| photo gardée :', await p.$eval('#home-account .avatar', b => !!b.querySelector('img')));
  // Création d'un compte : e-mail à confirmer
  await p.click('#home-account .avatar'); await p.click('#ac-signed [data-action="signout"]');
  await p.waitForSelector('#join-form:not([hidden])');
  await p.click('#home-account .avatar');
  await p.fill('#ac-email', 'cousin@example.com'); await p.fill('#ac-pass', 'Cousin-2026');
  await p.click('#ac-create');
  await p.waitForFunction(() => /Compte créé|marché/.test(document.querySelector('#ac-login-msg').textContent), null, { timeout: 15000 });
  log('création :', await p.textContent('#ac-login-msg'));
  await p.click('#ac-signin');
  await p.waitForFunction(() => /confirmée|éditeur/.test(document.querySelector('#ac-login-msg').textContent), null, { timeout: 15000 });
  log('connexion sans confirmation :', await p.textContent('#ac-login-msg'));
  await p.click('#acct [data-close="acct"]');

  // ---------- Visiteur : réactions et commentaire ----------
  const vc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Brussels' });
  await setup(vc);
  const v = await vc.newPage();
  v.on('pageerror', e => errs.push('visiteur : ' + e.message));
  v.on('dialog', d => d.accept());
  await v.goto('http://127.0.0.1:8000/#/v/malte-2026');
  await v.waitForSelector('#screen-gate:not([hidden])');
  await v.fill('#gate-code', 'malte-voyage'); await v.click('#gate-submit');
  await v.waitForSelector('#hero:not([hidden])', { timeout: 15000 });
  await v.click('#hero-explore'); await v.waitForTimeout(500);
  await v.click('#list .stop button[data-open]');
  await v.waitForSelector('#lb:not([hidden])');
  log('boutons de réaction :', txt(await v.textContent('#lb-reacts')));
  await v.click('#lb-reacts [data-react="❤️"]');
  await v.waitForSelector('#namesheet:not([hidden])');
  log('proposition de compte :', await v.isVisible('#ns-google'), await v.textContent('#ns-submit'));
  await v.fill('#ns-name', 'Mamie'); await v.click('#ns-skip');
  await v.waitForFunction(() => document.querySelector('#lb-reacts [aria-pressed="true"]'));
  await v.waitForTimeout(800);
  log('réaction :', txt(await v.textContent('#lb-reacts')), '|', await v.textContent('#lb-who'));
  await v.click('#lb-reacts [data-react="👏"]'); await v.waitForTimeout(800);
  log('changée :', txt(await v.textContent('#lb-reacts')), '|', await v.textContent('#lb-who'));
  await v.fill('#lb-c-text', 'Quelle vue ! Profitez bien 😘');
  await v.click('#lb-c-send');
  await v.waitForFunction(() => document.querySelectorAll('#lb-c-list li:not(.c-empty)').length === 1, null, { timeout: 10000 });
  await v.waitForTimeout(800);
  log('commentaire :', txt(await v.textContent('#lb-c-list')), '|', await v.textContent('#lb-c-title'));
  await v.screenshot({ path: OUT + '/s2-visiteur-social.png', fullPage: false });
  await v.evaluate(() => document.querySelector('#lb-comments').scrollIntoView());
  await v.screenshot({ path: OUT + '/s3-commentaires.png' });
  log('avatar visiteur :', txt(await v.textContent('#trip-account .avatar')));

  // ---------- L'éditeur voit tout en direct ----------
  await p.click('#home-account .avatar');
  await p.click('#ac-login [data-action="google-signin"]').catch(() => {});
  await p.evaluate(() => window.__viTestSignIn('q.theuninck@gmail.com'));
  await p.waitForSelector('#home-editor-actions:not([hidden])', { timeout: 15000 });
  await p.evaluate(() => document.querySelector('#acct').hidden = true);
  await p.goto('http://127.0.0.1:8000/#/v/malte-2026');
  await p.waitForSelector('#list .stop');
  await p.waitForTimeout(1500);
  log('carnet éditeur :', (await p.$$eval('#list .social-mini', l => l.map(x => x.textContent.trim()))).join(' | '));
  await p.click('#list .stop button[data-open]');
  await p.waitForSelector('#lb:not([hidden])');
  // Commentaire en direct : toast chez l'éditeur
  await v.fill('#lb-c-text', 'Deuxième petit mot'); await v.click('#lb-c-send');
  await p.waitForFunction(() => document.querySelectorAll('#lb-c-list li:not(.c-empty)').length === 2, null, { timeout: 10000 });
  log('toast éditeur :', await p.textContent('#toast'));
  // Supprimé par son auteur
  await v.click('#lb-c-list li:last-child [data-cdel]');
  await p.waitForFunction(() => document.querySelectorAll('#lb-c-list li:not(.c-empty)').length === 1, null, { timeout: 10000 });
  log('supprimé par l\'auteur : 1 restant chez l\'éditeur');
  await p.screenshot({ path: OUT + '/s4-editeur.png' });
  // Un autre proche se crée un compte au moment de réagir : il reste dans le carnet, sur la même photo
  const ac = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await setup(ac);
  const ap = await ac.newPage(); ap.on('pageerror', e => errs.push('compte : ' + e.message));
  await ap.goto('http://127.0.0.1:8000/?v=malte-2026&c=MALTE-VOYAGE');
  await ap.waitForSelector('#hero:not([hidden])', { timeout: 15000 }); await ap.click('#hero-explore'); await ap.waitForTimeout(500);
  await ap.click('#list .stop button[data-open]:has(img)'); await ap.waitForSelector('#lb:not([hidden])');
  const where = await ap.textContent('#lb-img .lb-count');
  await ap.click('#lb-reacts [data-react="😍"]'); await ap.waitForSelector('#namesheet:not([hidden])');
  await ap.fill('#ns-name', 'Papy'); await ap.fill('#ns-email', 'papy@example.com'); await ap.fill('#ns-pass', 'Malte-2026!');
  await ap.click('#ns-submit'); await ap.waitForSelector('#namesheet', { state: 'hidden', timeout: 10000 });
  await ap.waitForTimeout(1000);
  log('compte créé : toujours sur la photo', where, '=', await ap.textContent('#lb-img .lb-count'), '|', await ap.textContent('#lb-who'), '| anonyme :', await ap.evaluate(() => window.__auth?.currentUser?.isAnonymous ?? 'n/a'));
  await ap.fill('#lb-c-text', 'Bises de Papy'); await ap.click('#lb-c-send');
  await ap.waitForFunction(() => /Bises de Papy/.test(document.querySelector('#lb-c-list').textContent), null, { timeout: 10000 });
  log('commentaire signé :', (await ap.textContent('#lb-c-list')).includes('Toi'));
  // Papy, sur un autre téléphone, se connecte à son compte existant au moment de commenter
  const bc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await setup(bc);
  const bp = await bc.newPage(); bp.on('pageerror', e => errs.push('papy 2 : ' + e.message));
  await bp.goto('http://127.0.0.1:8000/?v=malte-2026&c=MALTE-VOYAGE');
  await bp.waitForSelector('#hero:not([hidden])', { timeout: 15000 }); await bp.click('#hero-explore'); await bp.waitForTimeout(500);
  await bp.click('#list .stop button[data-open]:has(img)'); await bp.waitForSelector('#lb:not([hidden])');
  await bp.fill('#lb-c-text', 'Re-bonjour'); await bp.click('#lb-c-send'); await bp.waitForSelector('#namesheet:not([hidden])');
  await bp.click('#ns-mode'); await bp.fill('#ns-email', 'papy@example.com'); await bp.fill('#ns-pass', 'Malte-2026!'); await bp.click('#ns-submit');
  await bp.waitForFunction(() => /Re-bonjour/.test(document.querySelector('#lb-c-list')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  log('connexion à un compte existant : carnet ouvert =', await bp.isVisible('#lb'), '| commentaire :', (await bp.textContent('#lb-c-list')).includes('Re-bonjour'));
  // ---------- Administration : éditeurs et stockage réservés au propriétaire ----------
  await p.goto('http://127.0.0.1:8000/#/v/malte-2026/admin'); await p.waitForSelector('#screen-admin:not([hidden])');
  log('réglages du voyage sans Backblaze :', await p.$$eval('#screen-admin #a-video-panel, #screen-admin #ed-panel', e => e.length) === 0);
  await p.goto('http://127.0.0.1:8000/#/'); await p.waitForSelector('#btn-appadmin:not([hidden])');
  await p.click('#btn-appadmin'); await p.waitForSelector('#screen-appadmin:not([hidden])');
  await p.evaluate(() => { navigator.share = undefined; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
  await p.fill('#ed-email', 'Cousine@Example.com'); await p.click('#ed-form button[type="submit"]');
  await p.waitForFunction(() => /est éditeur/.test(document.querySelector('#ed-msg').textContent));
  log('éditeurs :', await p.$$eval('#ed-list .ed-mail', e => e.map(x => x.textContent.trim()).join(' | ')));
  const inv = await p.evaluate(() => window.__copied || '');
  log('invitation :', inv.split('\n')[0], '|', /#\/editeur\/cousine%40example\.com/.test(inv));
  await p.screenshot({ path: OUT + '/s5-administration.png' });
  const ic = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await setup(ic);
  const ip = await ic.newPage(); ip.on('pageerror', e => errs.push('invité : ' + e.message));
  await ip.goto(inv.match(/https?:\/\/\S+/)[0]);
  await ip.waitForSelector('#acct:not([hidden])', { timeout: 10000 });
  log('lien d\'invitation : e-mail rempli =', await ip.inputValue('#ac-email'), '|', (await ip.textContent('#ac-login-msg')).slice(0, 40));
  await ip.screenshot({ path: OUT + '/s6-invitation.png' });
  await p.click('#ed-list [data-ed-del="cousine@example.com"]'); await p.waitForTimeout(800);
  log('retirée :', await p.$$eval('#ed-list .ed-mail', e => e.length));
  // ---------- Éditeur d'un seul voyage, invité depuis les réglages du voyage ----------
  await p.goto('http://127.0.0.1:8000/#/v/malte-2026/admin'); await p.waitForSelector('#te-panel:not([hidden])');
  await p.evaluate(() => { window.__copied = ''; navigator.share = undefined; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
  await p.fill('#te-email', 'oncle@example.com'); await p.click('#te-form button[type="submit"]');
  await p.waitForFunction(() => /peut publier/.test(document.querySelector('#te-msg').textContent));
  const inv2 = await p.evaluate(() => window.__copied);
  log('invitation au voyage :', inv2.split('\n')[0], '|', /#\/editeur\/oncle%40example\.com\/malte-2026/.test(inv2));
  await p.screenshot({ path: OUT + '/s7-editeurs-voyage.png' });
  const oc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await setup(oc);
  const op = await oc.newPage(); op.on('pageerror', e => errs.push('oncle : ' + e.message));
  await op.goto(inv2.match(/https?:\/\/\S+/)[0]);
  await op.waitForSelector('#acct:not([hidden])', { timeout: 10000 });
  await op.evaluate(() => window.__viTestSignIn('oncle@example.com'));
  await op.waitForSelector('#screen-trip:not([hidden])', { timeout: 15000 });
  await op.waitForTimeout(1500);
  log('oncle connecté : voyage ouvert =', await op.evaluate(() => location.hash), '| peut ajouter des photos :', await op.isVisible('#fab'));
  await op.goto('http://127.0.0.1:8000/#/'); await op.waitForSelector('#screen-home:not([hidden])'); await op.waitForTimeout(1500);
  log('accueil de l\'oncle :', await op.$$eval('#home-cards .tcard h2', e => e.map(x => x.textContent).join(', ')), '| nouveau voyage :', await op.isVisible('#btn-newtrip'));
  await op.goto('http://127.0.0.1:8000/#/v/malte-2026/admin'); await op.waitForSelector('#screen-admin:not([hidden])', { timeout: 10000 });
  log('réglages du voyage pour l\'oncle : éditeurs cachés =', await op.isHidden('#te-panel'));
  await browser.close();
  console.log('ERREURS:', errs.length ? errs.join('\n') : 'aucune');
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
