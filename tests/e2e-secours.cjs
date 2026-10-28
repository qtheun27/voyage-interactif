// Visiteur dont le navigateur bloque la connexion en direct de Firestore (Brave sur iPhone) : lecture de secours par l'API REST. Même lancement que tests/e2e.cjs.
// Un vrai petit voyage dans Chromium contre les émulateurs : départ de Belgique, vol, ferry vers Gozo,
// « Revivre le voyage », galerie, lieu sans photo. Même lancement que tests/e2e.cjs.
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

(async () => {
  const b = await chromium.launch();
  const ed = await b.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: 'Europe/Brussels' }); await setup(ed);
  const p = await ed.newPage();
  await p.goto('http://127.0.0.1:8000/#/'); await p.waitForSelector('#screen-home:not([hidden])');
  await p.evaluate(() => window.__viTestSignIn('q.theuninck@gmail.com')); await p.waitForSelector('#seed-card'); await p.click('#seed-card');
  await p.fill('#nt-start', '2026-10-25'); await p.fill('#nt-end', '2026-10-29'); await p.fill('#nt-code', 'MALTE-VOYAGE'); await p.click('#nt-submit');
  await p.waitForSelector('#screen-trip:not([hidden])');
  const dir = '/home/user/voyage-interactif/tests/fixtures/voyage/';
  await p.setInputFiles('#f-photos', fs.readdirSync(dir).sort().map(f => dir + f));
  await p.waitForFunction(() => document.querySelectorAll('#plan .plan-item').length >= 5 && !document.querySelector('#add-submit').disabled);
  await p.waitForTimeout(800); await p.click('#add-submit'); await p.waitForFunction(() => document.querySelector('#add').hidden, null, { timeout: 60000 });
  // Visiteur dont le navigateur bloque la connexion en direct (comme Brave sur iPhone)
  const vc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await setup(vc);
  await vc.route(/google\.firestore\.v1\.Firestore\/Listen/, r => r.abort());
  const v = await vc.newPage(); v.on('pageerror', e => console.log('ERR', e.message));
  await v.goto('http://127.0.0.1:8000/?v=malte-2026&c=MALTE-VOYAGE');
  await v.waitForSelector('#hero:not([hidden]), #screen-gate:not([hidden])', { timeout: 40000 });
  console.log('écran :', await v.evaluate(() => !document.querySelector('#hero').hidden ? 'carnet (accueil du voyage)' : 'CODE'), '| mode secours :', await v.evaluate(() => document.querySelector('#hero').textContent.replace(/\s+/g,' ').slice(0, 80)));
  await v.click('#hero-explore').catch(() => {}); await v.waitForTimeout(800);
  console.log('étapes :', await v.$$eval('#list .stop', e => e.length));
  await v.click('#list .stop button[data-open]:has(img)'); await v.waitForSelector('#lb:not([hidden])');
  await v.waitForFunction(() => /^blob:/.test(document.querySelector('#lb-img img')?.src || ''), null, { timeout: 10000 }).catch(() => {});
  console.log('photo en grand :', await v.$eval('#lb-img img', i => i.naturalWidth));
  await b.close();
})();
