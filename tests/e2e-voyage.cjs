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
  await ctx.route(/fonts\.googleapis|fonts\.gstatic|geoboundaries|basemaps\.cartocdn/, r => r.abort());
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
  const ed = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: 'Europe/Brussels' });
  await setup(ed);
  const p = await ed.newPage();
  p.on('pageerror', e => errs.push('éditeur : ' + e.message));
  await p.goto('http://127.0.0.1:8000/#/');
  await p.waitForSelector('#screen-home:not([hidden])');
  await p.evaluate(() => window.__viTestSignIn('q.theuninck@gmail.com'));
  await p.waitForSelector('#seed-card');
  await p.click('#seed-card');
  await p.fill('#nt-start', '2026-10-25'); await p.fill('#nt-end', '2026-10-29'); await p.fill('#nt-code', 'MALTE-VOYAGE');
  await p.click('#nt-submit');
  await p.waitForSelector('#screen-trip:not([hidden])');
  await p.waitForFunction(() => document.querySelector('#status').textContent.includes('Pas encore commencé'));
  const dir = R + '/tests/fixtures/voyage/';
  await p.setInputFiles('#f-photos', fs.readdirSync(dir).sort().map(f => dir + f));
  await p.waitForFunction(() => document.querySelectorAll('#plan .plan-item').length >= 5 && !document.querySelector('#add-submit').disabled);
  await p.waitForTimeout(1500);
  log('résumé :', txt(await p.textContent('#summary')));
  log('plan :', (await p.$$eval('#plan .plan-item', els => els.map(e => (e.classList.contains('leg') ? '↝ ' + e.querySelector('b').textContent : '● ' + e.querySelector('input').value) + ' (' + e.querySelectorAll('.plan-strip img').length + ')'))).join('  |  '));
  await p.screenshot({ path: OUT + '/v0-plan.png' });
  await p.click('#add-submit');
  await p.waitForFunction(() => document.querySelector('#add').hidden, null, { timeout: 60000 });
  await p.waitForFunction(() => document.querySelectorAll('#list .leg').length >= 2, null, { timeout: 15000 });
  await p.waitForTimeout(1500);
  log('carnet :', (await p.$$eval('#list .stop, #list .leg', els => els.map(e => (e.classList.contains('leg') ? '↝ ' : '● ') + e.textContent.replace(/\s+/g, ' ').trim()))).join('  |  '));
  log('jours :', txt(await p.textContent('#days')));
  log('bandeau :', txt(await p.textContent('#status')));
  await p.screenshot({ path: OUT + '/v1-carnet.png' });
  await p.click('#btn-overview');
  await p.waitForTimeout(800);
  await p.screenshot({ path: OUT + '/v2-aller-retour.png' });
  // Visionneuse depuis le vol : photo du hublot, puis on enchaîne
  await p.click('#list .leg.m-plane button[data-open]');
  await p.waitForSelector('#lb:not([hidden])');
  log('visionneuse vol :', txt(await p.textContent('#lb-when')), '|', txt(await p.textContent('#lb-title')));
  await p.click('#lb-editbtn');
  log('édition trajet, champs étape cachés :', await p.isHidden('#e-name'), '| mode :', await p.isVisible('#e-mode'));
  await p.click('#e-cancel');
  await p.click('#lb-img .arrow.r');
  log('photo suivante :', txt(await p.textContent('#lb-title')), '|', await p.textContent('#lb-img .lb-count'));
  await p.screenshot({ path: OUT + '/v3-visionneuse.png' });
  await p.click('#lb-close');
  // Fiche trajet : passer « En voiture » (Luqa -> Valletta) en bus, avec un nom
  await p.click('#list .leg.m-car .rowedit');
  await p.waitForSelector('#legsheet:not([hidden])');
  await p.click('#ls-modes [data-mode="bus"]'); await p.fill('#ls-label', 'Bus X4 pour La Valette'); await p.click('#ls-save');
  await p.waitForFunction(() => [...document.querySelectorAll('#list .leg')].some(e => e.textContent.includes('Bus X4')));
  log('trajet modifié :', txt(await p.textContent('#list .leg.m-bus')));
  // Doublons : réimporter les mêmes photos ne publie rien
  await p.setInputFiles('#f-photos', fs.readdirSync(dir).sort().map(f => dir + f));
  await p.waitForFunction(() => /déjà publiée/.test(document.querySelector('#summary').textContent));
  log('réimport :', txt(await p.textContent('#add-title')), '|', (await p.textContent('#summary')).match(/\d+ photos? déjà publiées?/)[0]);
  await p.click('#add-cancel');
  // Lieu sans photo
  await p.click('#btn-addplace');
  await p.fill('#pl-search', 'maison charleroi');
  await p.waitForSelector('#pl-results button', { timeout: 10000 });
  await p.click('#pl-results button');
  await p.fill('#pl-when', '2026-10-25T05:30'); await p.fill('#pl-tag', 'Départ'); await p.fill('#pl-caption', 'On part !');
  await p.click('#pl-submit');
  await p.waitForFunction(() => document.querySelector('#place').hidden);
  await p.waitForFunction(() => [...document.querySelectorAll('#list .stop')].some(e => e.textContent.includes('Maison')));
  log('lieu sans photo ajouté :', txt(await p.textContent('#list .stop')));
  // Galerie
  await p.click('#view-tabs [data-view="photos"]');
  log('galerie :', await p.$$eval('#list .gallery button', e => e.length), 'photos');
  await p.screenshot({ path: OUT + '/v4-galerie.png' });
  await p.click('#view-tabs [data-view="carnet"]');
  // Revivre le voyage (éditeur, grand écran)
  await p.click('#btn-replay');
  await p.waitForSelector('#story:not([hidden])');
  await p.waitForTimeout(1800);
  log('revivre :', txt(await p.textContent('#st-kicker')), '|', txt(await p.textContent('#st-title')), '|', await p.textContent('#st-count'));
  await p.screenshot({ path: OUT + '/v5-revivre.png' });
  for (let i = 0; i < 3; i++) await p.click('#st-next');
  await p.waitForTimeout(2500);
  log('revivre (vol) :', txt(await p.textContent('#st-title')), '|', await p.textContent('#st-count'));
  await p.screenshot({ path: OUT + '/v6-revivre-vol.png' });
  await p.click('#st-play'); log('pause :', await p.evaluate(() => document.querySelector('#story').classList.contains('paused')));
  await p.click('#st-close');
  await p.waitForSelector('#story', { state: 'hidden' });

  // ---------- Visiteur sur téléphone ----------
  const vc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Brussels' });
  await setup(vc);
  const v = await vc.newPage();
  v.on('pageerror', e => errs.push('visiteur : ' + e.message));
  await v.goto('http://127.0.0.1:8000/#/v/malte-2026');
  await v.waitForSelector('#screen-gate:not([hidden])');
  await v.fill('#gate-code', 'malte-voyage'); await v.click('#gate-submit');
  await v.waitForSelector('#hero:not([hidden])', { timeout: 15000 });
  await v.waitForTimeout(1500);
  log('accueil visiteur :', txt(await v.textContent('#hero')));
  await v.screenshot({ path: OUT + '/v7-accueil-mobile.png' });
  // Pas de défilement horizontal sur téléphone
  const overflow = async (label) => {
    const r = await v.evaluate(() => {
      const W = document.documentElement.clientWidth, out = [];
      document.querySelectorAll('body *').forEach(el => { const b = el.getBoundingClientRect(); if (b.width && b.right > W + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.leaflet-container,.days,.film,.strip,.hero')) out.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) + ' ' + Math.round(b.right)); });
      return { sw: document.documentElement.scrollWidth, W, out: out.slice(0, 8) };
    });
    log(`débordement ${label} :`, r.sw > r.W ? `OUI (${r.sw} > ${r.W}) ${r.out.join(', ')}` : 'aucun');
  };
  await overflow('accueil du voyage');
  await v.click('#hero-explore'); await v.waitForTimeout(500);
  await overflow('carnet');
  await v.click('#view-tabs [data-view="photos"]'); await overflow('galerie'); await v.click('#view-tabs [data-view="carnet"]');
  await v.evaluate(() => window.scrollTo(0, 0));
  await v.evaluate(() => { const b = document.querySelector('#btn-replay'); b.click(); });
  await v.waitForTimeout(800); await overflow('revivre'); await v.click('#st-close'); await v.waitForTimeout(400);
  await v.evaluate(() => { sessionStorage.clear(); }); await v.reload(); await v.waitForSelector('#hero:not([hidden])', { timeout: 15000 });
  await v.click('#hero-play');
  await v.waitForSelector('#story:not([hidden])');
  await v.waitForTimeout(2500);
  await v.screenshot({ path: OUT + '/v8-revivre-mobile.png' });
  for (let i = 0; i < 6; i++) await v.click('#st-next');
  await v.waitForTimeout(2600);
  log('mobile revivre :', txt(await v.textContent('#st-title')), '|', await v.textContent('#st-count'));
  await v.screenshot({ path: OUT + '/v9-revivre-ferry-mobile.png' });
  await v.click('#st-close');
  await v.waitForTimeout(600);
  await v.screenshot({ path: OUT + '/v10-carte-mobile.png' });
  // Visionneuse au doigt : balayage
  await v.click('#list .stop button[data-open]:has(img)');
  await v.waitForSelector('#lb:not([hidden])');
  const before = await v.textContent('#lb-img .lb-count');
  await v.dispatchEvent('#lb-img', 'touchstart', { touches: [{ identifier: 0, clientX: 300, clientY: 300 }] });
  await v.dispatchEvent('#lb-img', 'touchend', { changedTouches: [{ identifier: 0, clientX: 100, clientY: 305 }] });
  log('balayage :', before, '->', await v.textContent('#lb-img .lb-count'));
  await v.screenshot({ path: OUT + '/v11-visionneuse-mobile.png' });
  // Direct : une nouvelle photo arrive
  await p.setInputFiles('#f-photos', [R + '/tests/fixtures/gps_fuseau.jpg']);
  await p.waitForFunction(() => !document.querySelector('#add-submit').disabled);
  await p.click('#add-submit');
  await v.waitForFunction(() => !document.querySelector('#toast').hidden && document.querySelector('#toast').textContent.includes('Nouvelle photo'), null, { timeout: 15000 });
  log('notification visiteur :', await v.textContent('#toast'));
  console.log('ERREURS:', errs.length ? errs.join('\n') : 'aucune');
  await browser.close();
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
