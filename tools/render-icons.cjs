// Génère les icônes PNG de l'appli depuis un SVG :  node tools/render-icons.cjs icons/propositions/a-carnet.svg
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const src = path.resolve(process.argv[2] || 'icons/propositions/a-carnet.svg'), out = path.resolve(__dirname, '../icons');
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  const data = 'data:image/svg+xml;base64,' + fs.readFileSync(src).toString('base64');
  for (const [n, file, round] of [[180, 'icon-180.png'], [192, 'icon-192.png'], [512, 'icon-512.png'], [512, 'icon-maskable-512.png']]){
    await p.setViewportSize({ width: n, height: n });
    await p.setContent(`<body style="margin:0"><img src="${data}" style="width:${n}px;height:${n}px;display:block"></body>`);
    await p.waitForTimeout(150); await p.screenshot({ path: path.join(out, file), omitBackground: true });
  }
  fs.copyFileSync(src, path.join(out, 'icon.svg'));
  await b.close(); console.log('icônes générées depuis', path.basename(src));
})();
