// Récit du voyage : étapes, trajets (avion, bateau…), étiquettes départ/arrivée/retour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildJourney } from "../lib/journey.js";
import { makeLand } from "../lib/geo.js";

const land = makeLand(JSON.parse(readFileSync("data/MLT.geojson")), JSON.parse(readFileSync("data/world-land.geojson")));
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" });
const opts = { dayKey: t => fmt.format(new Date(t)), ...land };
const T = (d, h, m) => Date.UTC(2026, 9, d, h, m); // heure UTC
let n = 0;
const ph = (lat, lng, at, extra = {}) => ({ id: "p" + (++n), lat, lng, at, hasPhoto: true, place: "", caption: "", ...extra });

const trip = [
  ph(50.4592, 4.4538, T(25, 5, 30)),                 // Charleroi, avant le décollage
  ph(50.4600, 4.4520, T(25, 5, 50)),
  ph(44.0, 10.5, T(25, 7, 30)),                       // dans l'avion (au-dessus de l'Italie)
  ph(35.8575, 14.4775, T(25, 9, 15)),                 // atterrissage Luqa
  ph(35.8989, 14.5146, T(25, 12, 0)), ph(35.8992, 14.5140, T(25, 12, 20)),   // Valletta
  ph(35.9887, 14.3290, T(26, 8, 0)),                  // Ċirkewwa
  ph(36.0010, 14.3150, T(26, 8, 10)), ph(36.0120, 14.3050, T(26, 8, 18)),   // sur le ferry
  ph(36.0250, 14.2990, T(26, 8, 30)),                 // Mġarr Gozo
  ph(36.0444, 14.2397, T(26, 10, 0)),                 // Victoria
  ph(35.8575, 14.4775, T(29, 15, 0)),                 // Luqa, départ retour
  ph(50.4592, 4.4538, T(29, 19, 30))                  // Charleroi, retour
];

test("étapes et trajets d'un aller-retour en avion avec ferry", () => {
  const j = buildJourney(trip, opts);
  const names = j.timeline.map(e => e.kind === "stop" ? `S${e.items.length}${e.tag ? "·" + e.tag : ""}` : `${e.label}(${e.items.length})`);
  assert.deepEqual(names, [
    "S2·Départ", "Vol aller(1)", "S1·Arrivée", "En voiture(0)", "S2",
    "En voiture(0)", "S1", "Traversée en bateau(2)", "S1", "En voiture(0)", "S1",
    "En voiture(0)", "S1", "Vol retour(0)", "S1·Retour"
  ]);
  const flight = j.legs.find(l => l.label === "Vol aller");
  assert.equal(flight.mode, "plane");
  assert.ok(flight.km > 1800, String(flight.km));
  assert.equal(j.legs.find(l => l.mode === "boat").items.length, 2);
  assert.deepEqual(j.stops.map(s => s.day), [0, 0, 0, 1, 1, 1, 2, 2]);
  assert.equal(j.days.length, 3);
});

test("ferry sans photo à bord : traversée détectée par la mer", () => {
  const j = buildJourney([ph(35.9887, 14.3290, T(26, 8, 0)), ph(36.0250, 14.2990, T(26, 8, 40))], opts);
  assert.equal(j.legs[0].mode, "boat");
});

test("balade en ville : une seule étape, pas de trajet", () => {
  const j = buildJourney([ph(35.8989, 14.5146, T(25, 12, 0)), ph(35.8995, 14.5150, T(25, 12, 30)), ph(35.8999, 14.5160, T(25, 13, 10))], opts);
  assert.equal(j.stops.length, 1); assert.equal(j.legs.length, 0);
});

test("choix manuels : mode imposé, photo « arrêt », étiquette", () => {
  const a = ph(35.8989, 14.5146, T(25, 12, 0)), b = ph(36.0444, 14.2397, T(25, 15, 0), { arriveBy: "bus", tag: "Hôtel" });
  const j = buildJourney([a, b], opts);
  assert.equal(j.legs[0].mode, "bus"); assert.equal(j.stops[1].tag, "Hôtel");
  const w = ph(36.0010, 14.3150, T(26, 8, 10), { still: true });
  assert.equal(buildJourney([w], opts).stops.length, 1);
});
