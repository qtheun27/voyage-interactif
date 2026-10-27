/* Pack Malte : lieux connus, pictogrammes, lignes de ferry, étiquettes de mer et d'îles. */
export default {
  home: [[35.80,14.18],[36.085,14.58]],
  maxBounds: [[35.55,13.85],[36.3,14.9]],
  minZoom: 9.5,
  noteTitle: "Malta · Gozo · Comino",
  places: [
    ["Valletta",35.8989,14.5146,1],["Mdina",35.8860,14.4030,1],["Victoria (Gozo)",36.0444,14.2397,1],
    ["Sliema",35.9122,14.5042],["St Julian's",35.9187,14.4890],["Paceville",35.9235,14.4880],["Gżira",35.9058,14.4950],["Floriana",35.8935,14.5060],
    ["Birgu",35.8879,14.5225],["Senglea",35.8875,14.5170],["Kalkara",35.8890,14.5300],["Marsaxlokk",35.8419,14.5431],["St Peter's Pool",35.8335,14.5625],
    ["Marsaskala",35.8620,14.5670],["Birżebbuġa",35.8260,14.5270],["Żurrieq",35.8310,14.4740],["Blue Grotto",35.8210,14.4570],["Ħaġar Qim",35.8277,14.4420],
    ["Siġġiewi",35.8550,14.4380],["Dingli Cliffs",35.8530,14.3830],["Rabat",35.8810,14.3990],["Mosta",35.9100,14.4260],["Naxxar",35.9150,14.4440],
    ["Attard (San Anton)",35.8950,14.4410],["Aéroport (Luqa)",35.8575,14.4775],["Qawra",35.9560,14.4200],["Buġibba",35.9510,14.4150],["St Paul's Bay",35.9480,14.4010],
    ["Għajn Tuffieħa",35.9280,14.3450],["Golden Bay",35.9330,14.3440],["Mġarr",35.9200,14.3660],["Mellieħa",35.9564,14.3620],["Popeye Village",35.9590,14.3420],
    ["Għadira (Mellieħa Bay)",35.9640,14.3530],["Ċirkewwa (ferry)",35.9887,14.3290],["Blue Lagoon (Comino)",36.0153,14.3249],["Comino",36.0090,14.3350],
    ["Mġarr (port de Gozo)",36.0250,14.2990],["Xlendi",36.0300,14.2150],["Dwejra",36.0490,14.1900],["Marsalforn",36.0720,14.2590],["Ramla Bay",36.0620,14.2840],
    ["Xagħra (Ġgantija)",36.0470,14.2650],["Nadur",36.0380,14.2950],["Għarb (Ta' Pinu)",36.0580,14.2220],["Wied il-Għasri",36.0730,14.2260]
  ],
  marks: [
    [35.8989,14.5146,"dome"],[35.8860,14.4030,"fort"],[36.0465,14.2395,"fort"],[35.9887,14.3290,"boat"],[36.0250,14.2990,"boat"],
    [36.0153,14.3249,"wave"],[35.9330,14.3440,"sun"],[35.8277,14.4420,"stones"],[35.8530,14.3830,"cliff"],[36.0490,14.1900,"cliff"],[35.8419,14.5431,"boat"],[36.0580,14.2220,"dome"]
  ],
  ferries: [
    [[35.9887,14.3290],[36.0250,14.2990],.12],
    [[35.9000,14.5115],[35.9105,14.5045],.25],
    [[35.8925,14.5155],[35.8885,14.5195],.4]
  ],
  labels: [
    [[35.80,14.27],"sea-label big","Mer Méditerranée"],
    [[36.004,14.36],"sea-label","Canal de Gozo"],
    [[35.995,14.40],"sea-label","Baie de Mellieħa"],
    [[35.875,14.44],"island-label","Malta"],
    [[36.042,14.27],"island-label","Gozo"],
    [[36.00,14.268],"sea-label","Ferry · 25 min"]
  ]
};
