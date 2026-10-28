// Vidéos dans Chromium contre les émulateurs et un faux Backblaze (tests/mock-s3.cjs sur le port 9000) :
// réglages, test du stockage, envoi simple et en morceaux, visionneuse, « Revivre », suppression.
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
  await ctx.route(/fonts\.googleapis|fonts\.gstatic|geoboundaries|basemaps\.cartocdn|arcgisonline/, r => r.abort());
  await ctx.route(/nominatim\.openstreetmap\.org\/search/, r => r.fulfill({ contentType: 'application/json', headers: {'access-control-allow-origin': '*'},
    body: JSON.stringify([{ name: 'Maison', display_name: 'Maison, Gosselies, Charleroi, Belgique', lat: '50.47', lon: '4.43' }]) }));
  await ctx.route(/nominatim\.openstreetmap\.org\/reverse/, r => {
    const u = new URL(r.request().url()), lat = +u.searchParams.get('lat');
    r.fulfill({ contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify({ name: lat > 45 ? 'Aéroport de Charleroi' : '', address: { village: lat > 45 ? 'Charleroi' : 'Lieu OSM' } }) });
  });
  await ctx.route(/127\.0\.0\.1:8000\/firebase-config\.js/, r => r.fulfill({ body: testCfg, contentType: 'text/javascript' }));
}
const log = (...a) => console.log('•', ...a), txt = s => s.replace(/\s+/g, ' ').trim();
(async () => {
  const big = process.argv[2]; // vidéo de plus de 32 Mo (facultatif) pour tester l'envoi en morceaux
  const browser = await chromium.launch();
  const errs = [];
  const ed = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: 'Europe/Brussels' });
  await setup(ed);
  const p = await ed.newPage();
  p.on('pageerror', e => errs.push('éditeur : ' + e.message));
  await p.goto('http://127.0.0.1:8000/#/'); await p.waitForSelector('#screen-home:not([hidden])');
  await p.evaluate(() => window.__viTestSignIn('q.theuninck@gmail.com'));
  await p.waitForSelector('#seed-card'); await p.click('#seed-card');
  await p.fill('#nt-start', '2026-10-25'); await p.fill('#nt-end', '2026-10-29'); await p.fill('#nt-code', 'MALTE-VIDEO'); await p.click('#nt-submit');
  await p.waitForSelector('#screen-trip:not([hidden])');
  // Sans stockage configuré : la vidéo attend, les photos partent
  const dir = R + '/tests/fixtures/voyage/';
  await p.setInputFiles('#f-photos', [dir + '06-cirkewwa.jpg', R + '/tests/fixtures/videos/ferry-vp9.mp4']);
  await p.waitForFunction(() => /vidéo/.test(document.querySelector('#summary').textContent) && !document.querySelector('#add-submit').disabled);
  log('sans stockage :', txt(await p.textContent('#summary')).match(/\d+ vidéo\(s\)[^.]*\./)[0]);
  await p.click('#add-submit');
  await p.waitForFunction(() => /en attente/.test(document.querySelector('#add-msg').textContent), null, { timeout: 30000 });
  log('message :', txt(await p.textContent('#add-msg')));
  await p.click('#add-cancel');
  // Réglages : stockage des vidéos
  await p.goto('http://127.0.0.1:8000/#/v/malte-2026/admin'); await p.waitForSelector('#a-video-panel:not([hidden])');
  await p.fill('#v-endpoint', 'http://127.0.0.1:9000'); await p.fill('#v-bucket', 'seau'); await p.fill('#v-keyid', '003abc'); await p.fill('#v-appkey', 'K003secret');
  await p.fill('#v-public', 'http://127.0.0.1:9000/file/seau');
  await p.click('#v-test'); await p.waitForFunction(() => /Tout fonctionne|impossible|refusé|lisible/.test(document.querySelector('#v-msg').textContent));
  log('test du stockage :', await p.textContent('#v-msg'));
  await p.click('#v-save'); await p.waitForFunction(() => /enregistrés/.test(document.querySelector('#v-msg').textContent));
  // Envoi : photos du voyage + vidéo du ferry (+ grosse vidéo en morceaux)
  await p.goto('http://127.0.0.1:8000/#/v/malte-2026'); await p.waitForSelector('#screen-trip:not([hidden])'); await p.waitForTimeout(800);
  const files = [...fs.readdirSync(dir).sort().map(f => dir + f), R + '/tests/fixtures/videos/ferry-vp9.mp4', R + '/tests/fixtures/videos/copie-iphone.mp4', ...(big ? [big] : [])];
  await p.setInputFiles('#f-photos', files);
  await p.waitForFunction(() => document.querySelectorAll('#plan .plan-item').length >= 5 && !document.querySelector('#add-submit').disabled, null, { timeout: 60000 });
  await p.waitForTimeout(1200);
  // La vidéo « vidée » par l'iPhone : signalée, à ranger dans une étape existante (Ċirkewwa, publiée plus tôt)
  log('à ranger :', txt(await p.textContent('#where-strip .miss small')));
  await p.selectOption('#where-strip .miss select', { index: 1 });
  await p.waitForTimeout(500);
  log('rangée dans :', await p.$eval('#where-strip .miss select', s => s.options[s.selectedIndex].text));
  log('résumé :', txt(await p.textContent('#summary')));
  log('passage en HD proposé :', /1 photo déjà publiée en qualité standard/.test(await p.textContent('#summary')), '|', await p.textContent('#add-submit'));
  log('plan :', (await p.$$eval('#plan .plan-item', els => els.map(e => (e.classList.contains('leg') ? '↝ ' + e.querySelector('b').textContent : '● ' + e.querySelector('input').value) + ' (' + e.querySelectorAll('.plan-strip .fi').length + (e.querySelector('.vbadge') ? ', vidéo' : '') + ')'))).join(' | '));
  const t0 = Date.now();
  await p.click('#add-submit');
  await p.waitForFunction(() => document.querySelector('#add').hidden, null, { timeout: 180000 });
  log(`envoi : ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await p.waitForTimeout(1500);
  log('bandeau :', txt(await p.textContent('#status')));
  // Les photos en grand sont parties sur Backblaze (2560 px), les miniatures restent dans Firestore
  await p.click('#list .stop button[data-open]:has(img)'); await p.waitForSelector('#lb:not([hidden])');
  await p.waitForFunction(() => /127\.0\.0\.1:9000\/file\//.test(document.querySelector('#lb-img img')?.src || ''), null, { timeout: 15000 });
  log('photo en grand :', await p.$eval('#lb-img img', i => `${i.naturalWidth}×${i.naturalHeight} depuis ${new URL(i.src).host}`));
  await p.click('#lb-close');
  // La photo publiée avant Backblaze (Ċirkewwa) est passée en haute qualité, en gardant son nom
  await p.click('#view-tabs [data-view="carnet"]').catch(() => {});
  const cir = await p.$('#list .stop:has-text("Ċirkewwa") button[data-open]');
  await cir.click(); await p.waitForSelector('#lb:not([hidden])');
  await p.waitForFunction(() => /127\.0\.0\.1:9000\/file\//.test(document.querySelector('#lb-img img')?.src || ''), null, { timeout: 15000 }).catch(() => {});
  log('photo passée en HD :', await p.$eval('#lb-img img', i => new URL(i.src).host), '|', await p.textContent('#lb-title'));
  await p.click('#lb-close');
  log('vidéo rangée :', await p.$$eval('#list .stop', els => els.filter(e => e.querySelector('.vmark')).map(e => e.querySelector('.place').textContent).join(', ')));
  // Ranger une photo dans une autre étape depuis « Modifier », puis Annuler
  await p.click('#list .stop:has-text("Valletta") button[data-open]'); await p.waitForSelector('#lb:not([hidden])');
  await p.click('#lb-editbtn');
  await p.selectOption('#e-target', { label: (await p.$$eval('#e-target option', o => o.map(x => x.textContent))).find(t => /Mġarr/.test(t)) });
  await p.click('#e-move-photo');
  await p.waitForFunction(() => /Rangé dans « Mġarr/.test(document.querySelector('#toast').textContent));
  await p.waitForTimeout(800);
  log('après rangement : Valletta', await p.$$eval('#list .stop', els => els.filter(e => /Valletta/.test(e.textContent)).length), 'étape(s) | Mġarr :', await p.$eval('#list .stop:has-text("Mġarr")', e => e.querySelector('.mosaic')?.dataset.n || '0'));
  await p.click('#toast .toast-btn'); await p.waitForTimeout(1200);
  log('annulé : Valletta', await p.$$eval('#list .stop', els => els.filter(e => /Valletta/.test(e.textContent)).length), 'étape(s)');
  // Vidéo mal placée : choisir l'étape puis « Enregistrer » la range ; changer son heure ne déplace qu'elle
  await p.waitForSelector('#toast', { state: 'hidden', timeout: 10000 });
  const openVideo = async () => {
    await p.click('#list .stop:has(.vmark) button[data-open]'); await p.waitForSelector('#lb:not([hidden])');
    for (let k = 0; k < 12 && !(await p.$('#lb-img video')); k++) await p.click('#lb-img .arrow.r');
    return txt(await p.textContent('#lb-title'));
  };
  const where0 = await openVideo();
  await p.click('#lb-editbtn');
  log('fiche vidéo :', await p.textContent('#e-when-label'), '| décaler toute l\'étape proposé :', await p.isVisible('#e-shift'));
  const opts = await p.$$eval('#e-target option', o => o.map(x => x.textContent));
  const dest = opts.find(t => /Valletta/.test(t)) || opts[1];
  await p.selectOption('#e-target', { label: dest });
  await p.click('#e-save');
  await p.waitForFunction(() => /Rangé dans/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 });
  await p.waitForTimeout(1000);
  log('rangée par Enregistrer :', where0, '->', await p.$$eval('#list .stop', els => els.filter(e => e.querySelector('.vmark')).map(e => e.querySelector('.place').textContent).join(', ')));
  await p.click('#toast .toast-btn'); await p.waitForTimeout(1200);
  await p.waitForSelector('#toast', { state: 'hidden', timeout: 10000 }).catch(() => {});
  const stops0 = await p.$$eval('#list .stop', e => e.length);
  await openVideo(); await p.click('#lb-editbtn');
  const other = await p.evaluate(() => { const o = [...document.querySelectorAll('#e-target option')].find(x => /Mġarr/.test(x.textContent)); return o?.textContent; });
  const hh = /(\d{1,2}):(\d{2})/.exec(other);
  const cur = await p.inputValue('#e-when');
  await p.fill('#e-when', cur.slice(0, 11) + hh[1].padStart(2, '0') + ':' + String(+hh[2] + 1).padStart(2, '0'));
  await p.click('#e-save'); await p.waitForTimeout(1500);
  log('heure changée :', stops0, '->', await p.$$eval('#list .stop', e => e.length), 'étapes | vidéo dans :', await p.$$eval('#list .stop', els => els.filter(e => e.querySelector('.vmark')).map(e => e.querySelector('.place').textContent).join(', ')));
  await p.click('#lb-close').catch(() => {});
  // Appui long et glisser : l'étape « Mġarr » glissée dans « Ċirkewwa »
  await p.waitForSelector('#toast', { state: 'hidden', timeout: 10000 });
  const n0 = await p.$$eval('#list .stop', e => e.length);
  const src = await p.$('#list .stop:has-text("Mġarr") button[data-open]'), dst = await p.$('#list .stop:has-text("Ċirkewwa") button[data-open]');
  await src.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(300);
  const a = await src.boundingBox(), b = await dst.boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down(); await p.waitForFunction(() => document.body.classList.contains('dragmode'), null, { timeout: 5000 }).catch(() => {});
  log('mode glisser :', await p.evaluate(() => document.body.classList.contains('dragmode')));
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 5, { steps: 8 }); await p.waitForTimeout(200);
  log('cible survolée :', await p.$$eval('#list li.drop', e => e.map(x => x.querySelector('.place').textContent).join()));
  await p.mouse.up(); await p.waitForTimeout(1500);
  log('glisser-déposer :', n0, '->', await p.$$eval('#list .stop', e => e.length), 'étapes |', txt(await p.textContent('#toast')));
  await p.screenshot({ path: OUT + '/vid5-glisser.png' });
  log('carnet (vidéos) :', await p.$$eval('#list .vbadge, #list .vmark', e => e.length), 'repères vidéo');
  await p.screenshot({ path: OUT + '/vid1-carnet.png' });
  // Visionneuse : la vidéo se lit
  await p.click('#view-tabs [data-view="photos"]');
  await p.click('#list .gallery button:has(.vbadge)');
  await p.waitForSelector('#lb-img video');
  const ok = await p.waitForFunction(() => { const v = document.querySelector('#lb-img video'); return v && v.readyState >= 2 && v.videoWidth > 0; }, null, { timeout: 15000 }).then(() => true).catch(() => false);
  log('visionneuse vidéo :', ok ? 'lisible' : 'NON LISIBLE', await p.$eval('#lb-img video', v => `${v.videoWidth}×${v.videoHeight}, ${v.duration.toFixed(1)} s`));
  await p.evaluate(() => document.querySelector('#lb-img video').play()); await p.waitForTimeout(1200);
  log('lecture :', await p.$eval('#lb-img video', v => v.currentTime > 0.3 ? `en cours (${v.currentTime.toFixed(1)} s)` : 'bloquée'));
  await p.screenshot({ path: OUT + '/vid2-visionneuse.png' });
  await p.click('#lb-close');
  log('vidéo arrêtée à la fermeture :', await p.evaluate(() => !document.querySelector('#lb-img video')));
  await p.click('#view-tabs [data-view="carnet"]');
  // Revivre : la vidéo passe en plein dans le récit, avec le son en option
  await p.click('#btn-replay'); await p.waitForSelector('#story:not([hidden])');
  let found = false;
  for (let i = 0; i < 20 && !found; i++){ found = await p.evaluate(() => !!document.querySelector('#st-media video')); if (!found) await p.click('#st-next'); await p.waitForTimeout(300); }
  await p.waitForTimeout(1500);
  log('revivre :', found ? `vidéo jouée (${await p.$eval('#st-media video', v => (v.currentTime > 0 ? 'en lecture' : 'à l\'arrêt') + (v.muted ? ', muette' : ''))})` : 'pas de vidéo', '| bouton son :', await p.isVisible('#st-sound'));
  await p.click('#st-sound'); log('son :', await p.$eval('#st-media video', v => v.muted ? 'coupé' : 'activé'));
  await p.screenshot({ path: OUT + '/vid3-revivre.png' });
  await p.click('#st-close');
  // Supprimer la vidéo : le fichier part aussi de Backblaze
  await p.click('#view-tabs [data-view="photos"]'); await p.click('#list .gallery button:has(.vbadge)'); await p.waitForSelector('#lb-img video');
  await p.click('#lb-editbtn'); await p.click('#e-delphoto'); await p.click('#e-delphoto');
  await p.waitForTimeout(1500);
  log('après suppression :', await p.$$eval('#list .gallery .vbadge', e => e.length), 'vidéo(s) dans la galerie');
  // Visiteur sur téléphone
  const vc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await setup(vc);
  const v = await vc.newPage(); v.on('pageerror', e => errs.push('visiteur : ' + e.message));
  await v.goto('http://127.0.0.1:8000/#/v/malte-2026'); await v.waitForSelector('#screen-gate:not([hidden])');
  await v.fill('#gate-code', 'MALTE-VIDEO'); await v.click('#gate-submit'); await v.waitForSelector('#hero:not([hidden])'); await v.click('#hero-explore');
  await v.click('#view-tabs [data-view="photos"]');
  const vv = await v.$$('#list .gallery button:has(.vbadge)');
  if (vv.length){ await vv[0].click(); await v.waitForSelector('#lb-img video');
    const okv = await v.waitForFunction(() => { const x = document.querySelector('#lb-img video'); return x && x.readyState >= 2; }, null, { timeout: 15000 }).then(() => true).catch(() => false);
    log('visiteur, vidéo :', okv ? 'lisible' : 'NON LISIBLE'); await v.screenshot({ path: OUT + '/vid4-visiteur.png' }); }
  else log('visiteur : aucune vidéo (supprimées ?)');
  console.log('ERREURS:', errs.length ? errs.join('\n') : 'aucune');
  await browser.close();
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
