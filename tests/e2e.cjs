// Parcours complet dans Chromium contre les émulateurs (CDN servis depuis node_modules).
// 1) npm run emulators   2) python3 -m http.server 8000 --bind 127.0.0.1   3) npm run test:e2e
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'tests', 'captures');
fs.mkdirSync(OUT, { recursive: true });
const FB = R + '/node_modules/firebase/';
const testCfg = fs.readFileSync(R + '/firebase-config.js', 'utf8')
  .replace(/projectId: "[^"]+"/, 'projectId: "demo-voyage"').replace(/authDomain: "[^"]+"/, 'authDomain: "demo-voyage.firebaseapp.com"')
  .replace('export const emulators = null;', 'export const emulators = { host: "127.0.0.1" };');
const blankPng = fs.readFileSync(R + '/icons/icon-180.png');
async function setup(ctx){
  await ctx.route(/gstatic\.com\/firebasejs\/10\.14\.1\/(.+)$/, (r) => { const f = r.request().url().split('/').pop(); r.fulfill({ path: FB + f, contentType: 'text/javascript' }); });
  await ctx.route(/leaflet\.min\.js$/, r => r.fulfill({ path: R + '/node_modules/leaflet/dist/leaflet.js', contentType: 'text/javascript' }));
  await ctx.route(/leaflet\.min\.css$/, r => r.fulfill({ path: R + '/node_modules/leaflet/dist/leaflet.css', contentType: 'text/css' }));
  await ctx.route(/exifr@7\.1\.3/, r => r.fulfill({ path: R + '/node_modules/exifr/dist/lite.umd.js', contentType: 'text/javascript' }));
  await ctx.route(/fonts\.googleapis|fonts\.gstatic|geoboundaries/, r => r.abort());
  await ctx.route(/basemaps\.cartocdn\.com/, r => r.fulfill({ body: blankPng, contentType: 'image/png' }));
  await ctx.route(/nominatim\.openstreetmap\.org/, r => r.fulfill({ contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify({ name: '', address: { village: 'Lieu OSM test' } }) }));
  await ctx.route(/127\.0\.0\.1:8000\/firebase-config\.js/, r => r.fulfill({ body: testCfg, contentType: 'text/javascript' }));
}
const log = (...a) => console.log('•', ...a);
(async () => {
  const browser = await chromium.launch();
  const errs = [];
  // ---------- Éditeur ----------
  const ed = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: 'Europe/Brussels' });
  await setup(ed);
  const p = await ed.newPage();
  p.on('pageerror', e => errs.push('editor: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('editor console: ' + m.text()); });
  await p.goto('http://127.0.0.1:8000/#/');
  await p.waitForSelector('#screen-home:not([hidden])');
  await p.evaluate(() => window.__viTestSignIn('q.theuninck@gmail.com'));
  await p.waitForSelector('#seed-card', { timeout: 10000 });
  log('accueil éditeur avec carte de création Malte');
  await p.screenshot({ path: OUT + '/1-accueil-editeur.png' });
  await p.click('#seed-card');
  await p.fill('#nt-start', '2026-10-24'); await p.fill('#nt-end', '2026-10-31');
  await p.fill('#nt-code', 'MALTE-TEST1');
  await p.click('#nt-submit');
  await p.waitForSelector('#screen-trip:not([hidden])');
  await p.waitForFunction(() => document.querySelector('#status').textContent.includes('Pas encore commencé'));
  log('voyage créé :', await p.textContent('#trip-title'), '| hash', await p.evaluate(() => location.hash));
  await p.screenshot({ path: OUT + '/2-voyage-vide.png' });
  // Ajout de photos
  const fx = R + '/tests/fixtures/';
  await p.setInputFiles('#f-photos', [fx + 'gps_fuseau.jpg', fx + 'heure_fausse_gps_juste.jpg', fx + 'sans_fuseau_changement_heure.jpg']);
  await p.waitForFunction(() => !document.querySelector('#add').hidden && document.querySelectorAll('#plan .plan-item').length >= 2);
  log('résumé :', (await p.textContent('#summary')).replace(/\s+/g, ' ').trim());
  log('plan :', await p.$$eval('#plan .plan-item input', els => els.map(e => e.value).join(' | ')), '| zone "où" visible :', await p.isVisible('#where'));
  log('photos sans lieu montrées :', await p.$$eval('#where-strip .fi small', e => e.map(x => x.textContent).join(', ')));
  await p.screenshot({ path: OUT + '/3-ajout.png' });
  await p.selectOption('#f-place', { label: 'Mdina' });
  await p.waitForFunction(() => document.querySelectorAll('#plan .plan-item.stop').length === 3);
  await p.fill('#plan .plan-item.stop textarea', 'Premier jour sous le soleil');
  await p.click('#add-submit');
  await p.waitForFunction(() => document.querySelector('#add').hidden, null, { timeout: 30000 });
  await p.waitForFunction(() => document.querySelectorAll('#list .stop').length >= 3, null, { timeout: 15000 });
  await p.waitForTimeout(800);
  log('carnet :', (await p.$$eval('#list .stop', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()))).join(' || '));
  log('bandeau :', (await p.textContent('#status')).replace(/\s+/g, ' ').trim());
  await p.screenshot({ path: OUT + '/4-carnet.png' });
  // Visionneuse + modifier
  await p.click('#list .stop button[data-open]');
  await p.waitForSelector('#lb:not([hidden])');
  await p.waitForFunction(() => { const i = document.querySelector('#lb-img img'); return i && i.complete && i.naturalWidth > 0; });
  log('visionneuse :', (await p.textContent('#lb-when')).trim(), '|', await p.textContent('#lb-title'), '|', await p.textContent('#lb-by'));
  await p.screenshot({ path: OUT + '/5-visionneuse.png' });
  await p.click('#lb-editbtn'); await p.fill('#e-name', 'La Valette, Upper Barrakka'); await p.click('#e-save');
  await p.waitForFunction(() => document.querySelector('#lb-edit').hidden);
  await p.waitForFunction(() => document.querySelector('#lb-title').textContent.includes('Barrakka'));
  log('renommage OK');
  await p.click('#lb-close');
  // Plan des rues
  await p.click('#btn-streets');
  log('plan des rues :', await p.getAttribute('#btn-streets', 'aria-pressed'), await p.$$eval('.leaflet-tile', t => t.length) + ' tuiles');
  await p.click('#btn-streets');
  // ---------- Visiteur ----------
  const vc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/New_York' });
  await setup(vc);
  const v = await vc.newPage();
  v.on('pageerror', e => errs.push('visitor: ' + e.message));
  await v.goto('http://127.0.0.1:8000/#/v/malte-2026');
  await v.waitForSelector('#screen-gate:not([hidden])');
  await v.screenshot({ path: OUT + '/6-code.png' });
  await v.fill('#gate-code', 'faux-code'); await v.click('#gate-submit');
  await v.waitForFunction(() => document.querySelector('#gate-msg').textContent.includes("n'est pas le bon"));
  log('mauvais code :', await v.textContent('#gate-msg'));
  await v.fill('#gate-code', 'malte-test1'); await v.click('#gate-submit');
  await v.waitForSelector('#screen-trip:not([hidden])');
  await v.waitForSelector('#hero:not([hidden])', { timeout: 15000 });
  log('accueil du voyage (visiteur) :', (await v.textContent('#hero-stats')).replace(/\s+/g, ' ').trim());
  await v.click('#hero-explore');
  await v.waitForFunction(() => document.querySelectorAll('#list .stop').length >= 3, null, { timeout: 15000 });
  log('visiteur : carnet visible,', await v.$$eval('#list .stop', e => e.length), 'étapes ; bouton ajout visible :', await v.isVisible('#fab'), '; réglages visibles :', await v.isVisible('#btn-admin'));
  log('visiteur heures (fuseau de Malte malgré navigateur à New York) :', await v.$$eval('#list .when', e => e.map(x => x.textContent).join(', ')));
  await v.waitForTimeout(500);
  await v.screenshot({ path: OUT + '/7-visiteur-mobile.png', fullPage: false });
  // Direct : l'éditeur ajoute une photo, le visiteur la voit
  await p.setInputFiles('#f-photos', [fx + 'sud_ouest.jpg']);
  await p.waitForFunction(() => !document.querySelector('#add-submit').disabled);
  await p.click('#add-submit');
  await v.waitForFunction(() => document.querySelectorAll('#list .thumbstack b').length >= 1 || document.querySelectorAll('#list .stop').length >= 4, null, { timeout: 15000 });
  log('mise à jour en direct reçue par le visiteur');
  // Recharge : la session reste
  await v.goto('http://127.0.0.1:8000/#/'); await v.waitForSelector('#screen-home:not([hidden])');
  log('accueil visiteur :', (await v.textContent('#home-cards')).replace(/\s+/g, ' ').trim());
  await v.reload(); await v.goto('http://127.0.0.1:8000/#/v/malte-2026');
  await v.waitForSelector('#screen-trip:not([hidden])', { timeout: 10000 });
  log('session mémorisée après rechargement');
  // Autre voyage : rien
  await v.goto('http://127.0.0.1:8000/#/v/islande-2027'); await v.waitForSelector('#screen-gate:not([hidden])');
  log('autre voyage -> écran du code');
  await v.goto('http://127.0.0.1:8000/#/v/malte-2026'); await v.waitForSelector('#screen-trip:not([hidden])');
  // ---------- Réglages ----------
  await p.goto('http://127.0.0.1:8000/#/v/malte-2026/admin');
  await p.waitForSelector('#screen-admin:not([hidden])');
  await p.waitForFunction(() => document.querySelector('#a-code-current').textContent.includes('MALTE-TEST1'));
  await p.waitForFunction(() => /appareil/.test(document.querySelector('#a-members').textContent));
  log('admin : code', await p.textContent('#a-code-current'), '|', await p.textContent('#a-members'), '|', await p.inputValue('#a-share'));
  await p.fill('#a-code-new', 'nouveau-code-2'); await p.click('#a-code-save');
  await p.waitForFunction(() => document.querySelector('#a-code-current').textContent === 'NOUVEAU-CODE-2');
  log('code changé');
  await p.setInputFiles('#a-cover', fx + 'gps_fuseau.jpg'); await p.click('#a-save');
  await p.waitForFunction(() => document.querySelector('#a-msg').textContent === 'Enregistré.', null, { timeout: 15000 });
  log('couverture enregistrée');
  await p.screenshot({ path: OUT + '/8-reglages.png', fullPage: true });
  await p.click('#a-kick'); await p.click('#a-kick');
  await p.waitForFunction(() => /déconnecté/.test(document.querySelector('#a-members-msg').textContent));
  log(await p.textContent('#a-members-msg'));
  await v.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // simule le retour sur la page
  await v.waitForSelector('#screen-gate:not([hidden])', { timeout: 15000 });
  log('visiteur renvoyé à l\'écran du code :', await v.textContent('#gate-msg'));
  await v.fill('#gate-code', 'MALTE-TEST1'); await v.click('#gate-submit');
  await v.waitForFunction(() => document.querySelector('#gate-msg').textContent.includes("n'est pas le bon"));
  log('ancien code refusé');
  await p.goto('http://127.0.0.1:8000/#/'); await p.waitForFunction(() => document.querySelectorAll('#home-cards .tcard').length >= 1);
  await p.waitForTimeout(800);
  log('accueil éditeur :', (await p.textContent('#home-cards')).replace(/\s+/g, ' ').trim());
  await p.screenshot({ path: OUT + '/9-accueil.png' });
  // Supprimer une étape (fichiers compris)
  await p.goto('http://127.0.0.1:8000/#/v/malte-2026'); await p.waitForFunction(() => document.querySelectorAll('#list .stop').length >= 3);
  await p.waitForTimeout(1000);
  const before = await p.$$eval('#list .stop', e => e.length);
  await p.click('#list .stop:last-child button[data-open]'); await p.click('#lb-editbtn'); await p.click('#e-delstop'); await p.click('#e-delstop');
  await p.waitForFunction(n => document.querySelectorAll('#list .stop').length < n, before);
  log('étape supprimée :', before, '->', await p.$$eval('#list .stop', e => e.length));
  console.log('ERREURS:', errs.length ? errs.join('\n') : 'aucune');
  await browser.close();
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
