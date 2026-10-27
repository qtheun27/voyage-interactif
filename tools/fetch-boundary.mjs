// Met en cache le contour d'un pays dans data/{ISO3}.geojson.  Usage : node tools/fetch-boundary.mjs FRA
import { writeFile } from "node:fs/promises";
const iso = (process.argv[2] || "").toUpperCase();
if (!/^[A-Z]{3}$/.test(iso)) { console.error("Usage : node tools/fetch-boundary.mjs ISO3"); process.exit(1); }
const meta = await (await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${iso}/ADM0/`)).json();
const gj = await (await fetch(meta.simplifiedGeometryGeoJSON)).json();
const f = gj.features[0];
const out = { type: "FeatureCollection", features: [{ type: "Feature",
  properties: { shapeName: f.properties.shapeName, shapeGroup: iso, source: "geoBoundaries gbOpen ADM0 (CC BY 4.0)" }, geometry: f.geometry }] };
await writeFile(new URL(`../data/${iso}.geojson`, import.meta.url), JSON.stringify(out));
console.log(`data/${iso}.geojson écrit (${f.geometry.type}).`);
