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
  assert.deepEqual(names, ["S1·Départ", "À pied", "S2", "Vol aller", "S2·Arrivée", "En voiture", "S2"]);
  const arr = j.stops.find(s => s.tag === "Arrivée");
  assert.equal(arr.place, airport.name); assert.equal(arr.out, false);
  assert.equal(j.legs.find(l => l.mode === "plane").label, "Vol aller");
});

test("réglages de l'éditeur : trajet renommé, masqué, étapes fusionnées ou séparées", () => {
  const a = ph(35.8989, 14.5146, T(25, 12, 0)), b = ph(35.9122, 14.5042, T(25, 15, 0), { arriveBy: "bike", legLabel: "Balade le long de la côte", legCaption: "Super vue" });
  let j = buildJourney([a, b], opts);
  assert.equal(j.legs[0].mode, "bike"); assert.equal(j.legs[0].label, "Balade le long de la côte"); assert.equal(j.legs[0].caption, "Super vue");
  assert.ok(j.timeline.includes(j.legs[0]) && j.legs[0].notable);
  j = buildJourney([a, { ...b, legHidden: true }], opts); assert.equal(j.legs[0].notable, false);
  j = buildJourney([a, { ...b, joinPrev: true, arriveBy: "", legLabel: "" }], opts); assert.equal(j.stops.length, 1);
  const c = ph(35.8990, 14.5147, T(25, 12, 20), { splitHere: true });
  j = buildJourney([a, c], opts); assert.equal(j.stops.length, 2);
});

test("ranger à la main une photo (ou une vidéo) dans l'étape choisie", () => {
  const a = ph(35.8989, 14.5146, T(26, 12, 0)), b = ph(35.8990, 14.5150, T(26, 12, 20));          // La Valette
  const c = ph(35.8879, 14.5225, T(26, 16, 30)), d = ph(35.8880, 14.5226, T(26, 17, 0));          // Birgu
  const v = ph(35.8989, 14.5146, T(27, 21, 39), { video: { duration: 50 } });                      // vidéo « vidée » : mauvaise heure
  let j = buildJourney([a, b, c, d, v], opts);
  assert.equal(j.stops.length, 3);
  const moved = { ...v, stopRef: c.id, at: T(26, 17, 1), approxTime: true };
  j = buildJourney([a, b, c, d, moved], opts);
  assert.equal(j.stops.length, 2);
  assert.ok(j.stops[1].items.includes(moved)); assert.equal(j.stops[1].id, c.id);
  // une étape entière glissée dans une autre
  j = buildJourney([a, b, { ...c, stopRef: a.id }, { ...d, stopRef: a.id }], opts);
  assert.equal(j.stops.length, 1); assert.equal(j.stops[0].items.length, 4);
});

test("une journée à Comino : une traversée, une étape, dans l'ordre des photos", () => {
  // Photos réelles du 27/10 (heures UTC) : Għadira, ferry depuis Ċirkewwa, Blue Lagoon, balade sur Comino, retour au lagon.
  const raw = [[35.96174, 14.35869, 9, 24, 22], [35.99781, 14.32292, 10, 0, 0], [36.00766, 14.32715, 10, 4, 0], [36.00790, 14.32723, 10, 4, 0],
    [36.00977, 14.32652, 10, 5, 52], [36.01098, 14.32124, 10, 8, 19], [36.01108, 14.31953, 10, 8, 53], [36.01372, 14.31559, 10, 10, 39],
    [36.01386, 14.33022, 10, 11, 3, 1], [36.01520, 14.31527, 10, 11, 11], [36.01421, 14.32415, 10, 25, 3], [36.01398, 14.32438, 10, 32, 17],
    [36.01403, 14.32437, 10, 32, 51], [36.01477, 14.32697, 10, 46, 9], [36.01469, 14.32701, 10, 46, 36], [36.01456, 14.32770, 10, 48, 25],
    [36.01460, 14.32767, 10, 48, 44], [36.01459, 14.32766, 10, 49, 28], [36.01386, 14.32961, 10, 52, 22], [36.01255, 14.33197, 10, 56, 0],
    [36.01272, 14.33229, 10, 56, 35], [36.01264, 14.33265, 10, 56, 58], [36.01264, 14.33265, 10, 57, 3], [36.01259, 14.33271, 10, 57, 44],
    [36.01311, 14.33318, 10, 58, 37], [36.01362, 14.33378, 10, 59, 56], [36.01363, 14.33379, 11, 0, 18], [36.01525, 14.33575, 11, 4, 55],
    [36.01522, 14.33582, 11, 5, 10], [36.01648, 14.33631, 11, 7, 22], [36.01673, 14.33623, 11, 7, 49], [36.01673, 14.33621, 11, 7, 58],
    [36.01748, 14.33633, 11, 9, 50], [36.01747, 14.33633, 11, 10, 18], [36.01622, 14.33725, 11, 32, 49], [36.01336, 14.33051, 13, 53, 5]];
  const ps = raw.map(([lat, lng, h, m, sec, approx]) => ph(lat, lng, T(27, h, m) + sec * 1000, approx ? { approxPos: true } : {}));
  const j = buildJourney(ps, opts);
  assert.equal(j.stops.length, 2, j.stops.map(s => `${s.items.length}`).join("/"));      // Għadira, puis Comino
  assert.equal(j.legs.filter(l => l.mode === "boat").length, 1);                          // une seule traversée
  const boat = j.legs.find(l => l.mode === "boat");
  assert.ok(boat.items.length >= 6);
  assert.equal(j.stops[1].items.length + boat.items.length + 1, ps.length);
  // L'ordre chronologique est gardé
  const order = j.timeline.flatMap(e => e.items.map(x => x.at));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("étapes voisines réunies, sauf si l'éditeur les a voulues distinctes", () => {
  const a = ph(35.8989, 14.5146, T(26, 10, 0)), b = ph(35.8995, 14.5150, T(26, 10, 30));
  const c = ph(35.9050, 14.5180, T(26, 11, 30)), d = ph(35.9052, 14.5182, T(26, 11, 40));   // 750 m plus loin
  assert.equal(buildJourney([a, b, c, d], opts).stops.length, 1);
  assert.equal(buildJourney([{ ...a, caption: "Jardins" }, b, { ...c, caption: "Fort Saint-Elme" }, d], opts).stops.length, 2);
  assert.equal(buildJourney([a, b, { ...c, splitHere: true }, d], opts).stops.length, 2);
  const far = ph(35.9200, 14.4900, T(26, 11, 30));                                           // 3 km : nouvelle étape
  assert.equal(buildJourney([a, b, far], opts).stops.length, 2);
});
