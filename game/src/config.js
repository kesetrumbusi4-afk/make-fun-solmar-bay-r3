// Solmar Bay — tuning numbers, palette and mission data. One place, no magic numbers elsewhere.
export const STEP = 1 / 60;
export const VIEW = { width: 1280, height: 720 };
export const WORLD = { width: 3200, height: 2400 };
export const SAVE_KEY = 'solmar-bay.checkpoint.v1';

// Road centrelines. East of BEACH_X is sand, east of SEA_X is the sea.
export const ROADS_X = [240, 560, 880, 1200, 1520, 1840, 2160, 2480];
export const ROADS_Y = [240, 560, 880, 1200, 1520, 1840, 2160];
export const ROAD_W = 96;
export const BEACH_X = 2720;
export const SEA_X = 2880;
export const PIER = { x0: 2720, x1: 3060, y: 1200, w: 72 };

export const PLAYER = {
  walkSpeed: 230,
  radius: 14,
  hp: 100,
  carAccel: 620,
  carBrake: 900,
  carMaxSpeed: 560,
  carReverseMax: 220,
  carTurn: 3.2,
  carRadius: 26,
};

export const TRAFFIC_COUNT = 42;
export const PED_COUNT = 26;
export const MAX_PARTICLES = 240;
export const BULLET_SPEED = 900;

export const PALETTE = {
  grass: '#4a6b3a',
  grassDry: '#6b7a3f',
  park: '#3d6b34',
  asphalt: '#33313b',
  asphaltEdge: '#26242e',
  sidewalk: '#8a7f72',
  lane: '#d8c56a',
  sand: '#d9b380',
  seaDeep: '#1d4e6b',
  seaShallow: '#2f7d8f',
  skyTop: '#2b1b4d',
  skyMid: '#c65d3b',
  skyLow: '#f2a35e',
  building: ['#7a5a6e', '#5d6b8a', '#8a6a4d', '#6e5a8a', '#4d6b7a', '#8a4d5a'],
  windowLit: '#ffd98a',
  windowDark: '#2c2438',
  text: '#fff3e0',
  muted: '#d8b49a',
  hudBg: 'rgba(20,12,28,0.72)',
  accent: '#ffb347',
  danger: '#ff5a4d',
  good: '#7ee787',
  marker: '#ffd23f',
};

export const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

// Mission catalogue. Stage types:
//  goto: reach the marker. pickup: reach marker, cargo loads. deliver: reach marker with cargo.
//  steal: target car spawns at marker; enter it, then drive it to `to`.
//  grab: collect `count` cash piles around the marker (on foot).
//  shoot: eliminate `count` enemies that spawn around the marker.
//  escape: reach `to` while wanted; reaching it clears the heat.
//  taxi: pick up a passenger at the marker, then deliver to `to` (used by mission 1 & 6 chains).
export const MISSIONS = [
  {
    id: 1, name: 'First Fare', reward: 150,
    intro: "Lena needs a driver. Pick up the fare outside the hotel and drop them at the marina.",
    stages: [{ type: 'taxi', x: 880, y: 880, toX: 2480, toY: 1520, text: 'Pick up the passenger' }],
  },
  {
    id: 2, name: 'Package Run', reward: 300, timer: 90,
    intro: 'A sealed package waits at the north depot. Deliver it to the south docks before the clock runs out.',
    stages: [
      { type: 'pickup', x: 2160, y: 240, text: 'Pick up the package' },
      { type: 'deliver', x: 560, y: 2160, text: 'Deliver the package' },
    ],
  },
  {
    id: 3, name: 'Hot Wheels', reward: 500,
    intro: 'A tuned Comet GT is parked uptown. Steal it and bring it to the garage — in one piece.',
    stages: [{ type: 'steal', x: 1200, y: 1520, toX: 1840, toY: 560, text: 'Steal the Comet GT' }],
  },
  {
    id: 4, name: 'The Informant', reward: 800,
    intro: 'Meet the informant on the beach road. The cops will not like it — lose them at the safehouse.',
    stages: [
      { type: 'goto', x: 2480, y: 880, text: 'Meet the informant' },
      { type: 'escape', x: 2480, y: 880, toX: 880, toY: 2160, wanted: 2, text: 'Lose the cops — reach the safehouse' },
    ],
  },
  {
    id: 5, name: 'The Big Score', reward: 1500, timer: 150,
    intro: 'The Solmar Bank vault is open for five minutes. Grab the cash, then get back to Lena\'s Bar.',
    stages: [
      { type: 'grab', x: 1600, y: 1000, count: 3, text: 'Grab the cash', wanted: 3 },
      { type: 'deliver', x: 560, y: 560, text: 'Get the cash to Lena\'s Bar' },
    ],
  },
  {
    id: 6, name: 'Night Shift', reward: 900, timer: 180,
    intro: 'Three fares, one night. The meter is running — don\'t keep them waiting.',
    stages: [
      { type: 'taxi', x: 1520, y: 2160, toX: 240, toY: 1200, text: 'Fare 1 of 3' },
      { type: 'taxi', x: 2160, y: 1200, toX: 880, toY: 240, text: 'Fare 2 of 3' },
      { type: 'taxi', x: 1200, y: 1840, toX: 2480, toY: 240, text: 'Fare 3 of 3' },
    ],
  },
  {
    id: 7, name: 'Dockside Deal', reward: 700,
    intro: 'A deal goes down on the pier. The crew is armed — clear them, take the package, deliver it.',
    stages: [
      { type: 'shoot', x: 2920, y: 1200, count: 4, text: 'Clear the pier crew' },
      { type: 'pickup', x: 2920, y: 1200, text: 'Take the package' },
      { type: 'deliver', x: 1200, y: 2160, text: 'Deliver the package' },
    ],
  },
  {
    id: 8, name: 'Grand Theft Bay', reward: 1200,
    intro: 'One last job: lift the mayor\'s armoured coupe from the marina and bring it home. Every cop in Solmar Bay will be looking.',
    stages: [{ type: 'steal', x: 2160, y: 1840, toX: 880, toY: 1520, wanted: 4, text: 'Steal the armoured coupe' }],
  },
];

// Ten hidden packages scattered around the city, +$100 each.
export const HIDDEN_PACKAGES = [
  [300, 300], [1500, 300], [2420, 300], [300, 1140], [1500, 1140],
  [2420, 2100], [300, 2100], [1140, 300], [2100, 900], [900, 1500],
];

// Taxi side-job stands (press T on foot near a road to hail a fare).
export const TAXI_STANDS = [
  { x: 880, y: 560 }, { x: 1520, y: 1200 }, { x: 240, y: 1840 }, { x: 2160, y: 560 },
];
