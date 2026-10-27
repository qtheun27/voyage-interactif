// Récit du voyage : étapes, trajets (avion, bateau…), étiquettes départ/arrivée/retour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildJourney, estimatePosition } from "../lib/journey.js";
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

test("vol de nuit : photo d'arrivée sans GPS fiable placée à l'aéroport, pas une étape belge", () => {
  const airport = { name: "Aéroport de Malte (Luqa)", lat: 35.8575, lng: 14.4775 };
  const known = [
    { at: Date.UTC(2026, 9, 25, 18, 8), lat: 50.4661, lng: 4.4824 },    // départ, rue d'Heppignies
    { at: Date.UTC(2026, 9, 25, 21, 39), lat: 50.4688, lng: 4.4710 },   // aéroport de Charleroi
    { at: Date.UTC(2026, 9, 26, 7, 26), lat: 35.9617, lng: 14.3591 }    // hôtel, Għadira
  ];
  const arr = estimatePosition(Date.UTC(2026, 9, 26, 0, 0), known, { airport, inCountry: land.inCountry });
  assert.equal(arr.atArrival, true); assert.equal(arr.lat, airport.lat); assert.equal(arr.place, airport.name);
  const mid = estimatePosition(Date.UTC(2026, 9, 25, 22, 45), known, { airport, inCountry: land.inCountry });
  assert.equal(mid.inFlight, true); assert.ok(mid.lat < 50 && mid.lat > 36, String(mid.lat));
  // Le récit qui en découle : départ, vol aller, arrivée à l'aéroport, puis l'hôtel
  const ps = [
    ph(50.4661, 4.4824, Date.UTC(2026, 9, 25, 18, 8)), ph(50.4685, 4.4697, Date.UTC(2026, 9, 25, 21, 21)), ph(50.4688, 4.4710, Date.UTC(2026, 9, 25, 21, 39)),
    ph(arr.lat, arr.lng, Date.UTC(2026, 9, 26, 0, 0), { approxPos: true, tag: "Arrivée" }),
    ph(35.9617, 14.3591, Date.UTC(2026, 9, 26, 7, 26))
  ];
  const j = buildJourney(ps, opts);
  const names = j.timeline.map(e => e.kind === "stop" ? `S${e.items.length}${e.tag ? "·" + e.tag : ""}` : e.label);
  assert.deepEqual(names, ["S1·Départ", "À pied", "S2", "Vol aller", "S1·Arrivée", "En voiture", "S1"]);
  assert.ok(j.legs.find(l => l.label === "Vol aller").to.at - j.legs.find(l => l.label === "Vol aller").from.end < 3 * 3600e3);
});

test("données existantes : photos « Arrivée » restées sur Charleroi, affichées à l'aéroport de Malte", () => {
  const airport = { name: "Aéroport de Malte (Luqa)", lat: 35.8575, lng: 14.4775 };
  const ps = [
    ph(50.4661, 4.4824, Date.UTC(2026, 9, 25, 18, 8)), ph(50.4685, 4.4697, Date.UTC(2026, 9, 25, 21, 21)), ph(50.4688, 4.4710, Date.UTC(2026, 9, 25, 21, 39)),
    ph(50.4660, 4.4698, Date.UTC(2026, 9, 26, 0, 0), { tag: "Arrivée", caption: "Arrivée à Malte" }), ph(50.4660, 4.4698, Date.UTC(2026, 9, 26, 0, 0)),
    ph(35.9617, 14.3591, Date.UTC(2026, 9, 26, 7, 26)), ph(35.9617, 14.3591, Date.UTC(2026, 9, 26, 8, 55))
  ];
  const j = buildJourney(ps, { ...opts, airport });
  const names = j.timeline.map(e => e.kind === "stop" ? `S${e.items.length}${e.tag ? "·" + e.tag : ""}` : e.label);
  assert.deepEqual(names, ["S1·Départ", "À pied", "S2", "Vol aller", "S2·Arrivée", "En voiture", "S1", "À pied", "S1"]);
  const arr = j.stops.find(s => s.tag === "Arrivée");
  assert.equal(arr.place, airport.name); assert.equal(arr.out, false);
  assert.equal(j.legs.find(l => l.mode === "plane").label, "Vol aller");
});
