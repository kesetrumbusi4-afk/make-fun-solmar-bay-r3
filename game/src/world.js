// Solmar Bay — world simulation: procedural sunset city, traffic, pedestrians,
// police, combat, missions, checkpoints. Pure state + step(); rendering lives in render.js.
import {
  BEACH_X, HIDDEN_PACKAGES, MISSIONS, PIER, PLAYER, ROADS_X, ROADS_Y,
  SAVE_KEY, SEA_X, STEP, TRAFFIC_COUNT, PED_COUNT, MAX_PARTICLES, BULLET_SPEED,
  WORLD,
} from './config.js';
import { angleLerp, clamp, createRandom, dist2, pick, range } from './random.js';

const GRID_CELL = 160;
const CAR_COLORS = ['#c94f3d', '#3d7ac9', '#c9a13d', '#5a8a4d', '#8a5ac9', '#c9c9c9', '#3d3d3d', '#d97b2f'];
const PED_SHIRTS = ['#e8e8e8', '#e86a5a', '#5a8ae8', '#e8c95a', '#6ae88a', '#c95ae8'];

let nextCarId = 1;

function makeCar(x, y, angle, color, kind) {
  return {
    id: nextCarId++, x, y, angle, speed: 0, hp: 100, color, kind,
    roadAxis: 'x', road: 0, dir: 1, lane: 0, respawn: 0, wreck: false, siren: 0,
    shovedUntil: 0, lastDamageAt: 0,
  };
}

export function createWorld(seed) {
  const rand = createRandom(seed);
  const state = {
    seed, rand, time: 0,
    buildings: [], trees: [], parked: [],
    cars: [], peds: [], enemies: [], bullets: [], particles: [],
    packages: HIDDEN_PACKAGES.map(([x, y]) => ({ x, y, taken: false })),
    player: {
      x: 560, y: 780, angle: Math.PI / 2, hp: PLAYER.hp, ammo: 120,
      inCar: true, carId: 0, walkAngle: Math.PI / 2, speed: 0, invuln: 0,
    },
    wanted: 0, wantedIdle: 0, crimeCooldown: 0,
    cash: 0, missionIndex: -1, mission: null, missionTimer: 0, missionDelay: 0,
    taxiJob: null, storyDone: false,
    toast: '', toastTimer: 0, banner: '', bannerTimer: 0,
    stuckTimer: 0, stuckHintShown: false, bestObjectiveDist: Infinity,
    wasted: false, busted: false, respawnTimer: 0,
    eco: false, frameWorkMs: 0, shootCooldown: 0,
    stats: { shotsFired: 0, carsStolen: 0, missionsDone: 0, packagesFound: 0, faresDone: 0 },
    grid: new Map(),
    cashPiles: [],
  };

  buildCity(state, rand);
  spawnPlayerCar(state);
  spawnTraffic(state, rand);
  spawnPeds(state, rand);
  return state;
}

function buildCity(state, rand) {
  // Fixed landmarks.
  state.buildings.push({ x: 620, y: 620, w: 160, h: 100, color: '#8a4d5a', name: "Lena's Bar", lit: 0.8 });
  state.buildings.push({ x: 1560, y: 920, w: 200, h: 160, color: '#5d6b8a', name: 'Solmar Bank', lit: 0.7 });
  state.buildings.push({ x: 1900, y: 560, w: 180, h: 120, color: '#4d6b7a', name: 'Garage', lit: 0.5 });
  // Park block: roads 1840..2160 x, 1480..1840 y.
  for (let i = 0; i < 26; i += 1) {
    state.trees.push({ x: range(rand, 1900, 2100), y: range(rand, 1540, 1780) });
  }
  // Procedural blocks between roads.
  for (let xi = 0; xi < ROADS_X.length - 1; xi += 1) {
    for (let yi = 0; yi < ROADS_Y.length - 1; yi += 1) {
      const x0 = ROADS_X[xi] + 56;
      const x1 = ROADS_X[xi + 1] - 56;
      const y0 = ROADS_Y[yi] + 56;
      const y1 = ROADS_Y[yi + 1] - 56;
      if (x0 >= x1 || y0 >= y1) continue;
      if (x0 > 2400) continue; // beach blocks stay open
      if (xi === 5 && yi === 4) continue; // park block
      const count = 1 + Math.floor(rand() * 2);
      for (let b = 0; b < count; b += 1) {
        const w = range(rand, 90, Math.min(180, (x1 - x0) / count));
        const h = range(rand, 80, Math.min(160, y1 - y0));
        const x = x0 + ((x1 - x0) / count) * b + range(rand, 4, 20);
        const y = y0 + range(rand, 4, Math.max(5, y1 - y0 - h));
        if (x + w > x1 || y + h > y1) continue;
        if (overlapsLandmark(state, x, y, w, h)) continue;
        state.buildings.push({
          x, y, w, h,
          color: pick(rand, ['#7a5a6e', '#5d6b8a', '#8a6a4d', '#6e5a8a', '#4d6b7a', '#8a4d5a']),
          lit: range(rand, 0.3, 0.85),
        });
      }
    }
  }
  // Scattered street trees along sidewalks.
  for (let i = 0; i < 40; i += 1) {
    const vertical = rand() < 0.5;
    if (vertical) {
      const x = pick(rand, ROADS_X) + (rand() < 0.5 ? -58 : 58);
      state.trees.push({ x, y: range(rand, 160, 2240) });
    } else {
      const y = pick(rand, ROADS_Y) + (rand() < 0.5 ? -58 : 58);
      state.trees.push({ x: range(rand, 160, 2600), y });
    }
  }
  // Parked cars along road edges.
  for (let i = 0; i < 14; i += 1) {
    const vertical = rand() < 0.5;
    let x, y, angle;
    if (vertical) {
      x = pick(rand, ROADS_X) + (rand() < 0.5 ? -34 : 34);
      y = range(rand, 200, 2200);
      angle = rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      y = pick(rand, ROADS_Y) + (rand() < 0.5 ? -34 : 34);
      x = range(rand, 200, 2400);
      angle = rand() < 0.5 ? 0 : Math.PI;
    }
    const car = makeCar(x, y, angle, pick(rand, CAR_COLORS), 'parked');
    state.parked.push(car);
    state.cars.push(car);
  }
}

function overlapsLandmark(state, x, y, w, h) {
  for (const b of state.buildings) {
    if (x < b.x + b.w + 12 && x + w + 12 > b.x && y < b.y + b.h + 12 && y + h + 12 > b.y) return true;
  }
  return false;
}

function spawnPlayerCar(state) {
  const car = makeCar(560, 780, Math.PI / 2, '#d97b2f', 'player');
  state.cars.push(car);
  state.player.carId = car.id;
}

function randomRoadPoint(rand, vertical) {
  if (vertical) return { x: pick(rand, ROADS_X), y: range(rand, 160, 2240) };
  return { x: range(rand, 160, 2600), y: pick(rand, ROADS_Y) };
}

function spawnTraffic(state, rand) {
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const vertical = rand() < 0.5;
    const p = randomRoadPoint(rand, vertical);
    const car = makeCar(p.x, p.y, vertical ? (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rand() < 0.5 ? 0 : Math.PI),
      pick(rand, CAR_COLORS), 'traffic');
    car.roadAxis = vertical ? 'x' : 'y';
    car.road = vertical ? p.x : p.y;
    car.dir = rand() < 0.5 ? 1 : -1;
    car.lane = car.dir > 0 ? 28 : -28; // right-hand traffic: keep to your side
    car.speed = range(rand, 120, 190);
    state.cars.push(car);
  }
}

function spawnPeds(state, rand) {
  for (let i = 0; i < PED_COUNT; i += 1) {
    const vertical = rand() < 0.5;
    const p = randomRoadPoint(rand, vertical);
    state.peds.push({
      x: p.x + (vertical ? (rand() < 0.5 ? -58 : 58) : 0),
      y: p.y + (vertical ? 0 : (rand() < 0.5 ? -58 : 58)),
      angle: vertical ? (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rand() < 0.5 ? 0 : Math.PI),
      speed: range(rand, 40, 70), shirt: pick(rand, PED_SHIRTS), alive: true,
      axis: vertical ? 'x' : 'y', road: vertical ? p.x : p.y, dir: rand() < 0.5 ? 1 : -1,
      wait: 0,
    });
  }
}

// ---------- spatial grid (rebuilt each step) ----------
function rebuildGrid(state) {
  const grid = state.grid;
  grid.clear();
  const add = (x, y, ref) => {
    const key = `${Math.floor(x / GRID_CELL)},${Math.floor(y / GRID_CELL)}`;
    let arr = grid.get(key);
    if (!arr) { arr = []; grid.set(key, arr); }
    arr.push(ref);
  };
  for (const car of state.cars) add(car.x, car.y, { kind: 'car', ref: car });
  for (const ped of state.peds) if (ped.alive) add(ped.x, ped.y, { kind: 'ped', ref: ped });
  for (const e of state.enemies) if (e.hp > 0) add(e.x, e.y, { kind: 'enemy', ref: e });
  add(state.player.x, state.player.y, { kind: 'player', ref: state.player });
}

function nearby(state, x, y, radius) {
  const out = [];
  const c = Math.floor(radius / GRID_CELL) + 1;
  const cx = Math.floor(x / GRID_CELL);
  const cy = Math.floor(y / GRID_CELL);
  for (let gx = cx - c; gx <= cx + c; gx += 1) {
    for (let gy = cy - c; gy <= cy + c; gy += 1) {
      const arr = state.grid.get(`${gx},${gy}`);
      if (arr) for (const ref of arr) out.push(ref);
    }
  }
  return out;
}

// ---------- particles ----------
export function spawnParticles(state, x, y, color, count, speed = 160, life = 0.7) {
  for (let i = 0; i < count; i += 1) {
    if (state.particles.length >= MAX_PARTICLES) state.particles.shift();
    const a = state.rand() * Math.PI * 2;
    const v = range(state.rand, speed * 0.3, speed);
    state.particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: range(state.rand, life * 0.5, life), maxLife: life, color,
      size: range(state.rand, 2, 5),
    });
  }
}

function explodeCar(state, car) {
  spawnParticles(state, car.x, car.y, '#ff7a2f', 26, 320, 0.9);
  spawnParticles(state, car.x, car.y, '#ffd23f', 14, 260, 0.6);
  spawnParticles(state, car.x, car.y, '#3a3a3a', 12, 90, 1.4);
  car.wreck = true;
  car.speed = 0;
  car.hp = 0;
  if (car.kind === 'target') {
    // Anti-jam: a wrecked steal target respawns fresh at its marker.
    const m = state.mission;
    if (m && m.stage.type === 'steal' && m.stage.targetCarId === car.id) {
      const fresh = makeCar(m.stage.x, m.stage.y, 0, '#ffd23f', 'target');
      state.cars.push(fresh);
      m.stage.targetCarId = fresh.id;
      setToast(state, 'Target wrecked — a fresh one rolled in. Steal it!');
    }
  }
  if (car.kind === 'player' && state.player.inCar && state.player.carId === car.id) {
    ejectPlayer(state, car);
  }
}

function ejectPlayer(state, car) {
  const p = state.player;
  p.inCar = false;
  p.x = car.x + Math.cos(car.angle + Math.PI / 2) * 40;
  p.y = car.y + Math.sin(car.angle + Math.PI / 2) * 40;
  p.walkAngle = car.angle;
  p.carId = 0;
}

// The pier is walkable boards over the sea; everywhere else the sea pushes back.
function onPier(x, y) {
  return x >= PIER.x0 && x <= PIER.x1 && Math.abs(y - PIER.y) < PIER.w / 2 - 8;
}

function clampToLand(state, x, y) {
  if (x > SEA_X && !onPier(x, y)) return SEA_X - 4;
  return x;
}

// ---------- collision helpers ----------
function collideCircleBuildings(state, x, y, radius) {
  for (const b of state.buildings) {
    if (x + radius < b.x || x - radius > b.x + b.w || y + radius < b.y || y - radius > b.y + b.h) continue;
    const cx = clamp(x, b.x, b.x + b.w);
    const cy = clamp(y, b.y, b.y + b.h);
    const dx = x - cx;
    const dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius) continue;
    const d = Math.sqrt(d2) || 0.001;
    const push = radius - d;
    return { x: (dx / d) * push, y: (dy / d) * push, hit: true };
  }
  return { x: 0, y: 0, hit: false };
}

// ---------- checkpoints ----------
export function snapshotCheckpoint(state) {
  const p = state.player;
  const car = state.cars.find((c) => c.id === p.carId);
  return {
    x: p.x, y: p.y, angle: p.angle, hp: p.hp, ammo: p.ammo,
    cash: state.cash, missionIndex: state.missionIndex,
    stageIndex: state.mission ? state.mission.stageIndex : 0,
    packages: state.packages.map((pkg) => pkg.taken),
    inCar: p.inCar, carHp: car ? car.hp : 100, carColor: car ? car.color : '#d97b2f',
    wanted: 0,
  };
}

export function saveCheckpoint(state, reason) {
  const snap = snapshotCheckpoint(state);
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
  } catch { /* storage off: checkpoint lasts this visit only */ }
  state.checkpoint = snap;
  setToast(state, 'Checkpoint saved');
  return snap;
}

export function loadCheckpoint(state) {
  let snap = state.checkpoint;
  if (!snap) {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (raw) snap = JSON.parse(raw);
    } catch { snap = null; }
  }
  if (!snap) return false;
  const p = state.player;
  p.x = snap.x; p.y = snap.y; p.angle = snap.angle; p.hp = snap.hp; p.ammo = snap.ammo;
  p.walkAngle = snap.angle;
  state.cash = snap.cash;
  state.packages.forEach((pkg, i) => { pkg.taken = !!snap.packages[i]; });
  state.wanted = 0;
  clearPolice(state);
  // Restore the car the player was in (or spawn a fresh one beside them).
  // A wrecked car is repaired and reused — never duplicated on every restore.
  let car = state.cars.find((c) => c.id === p.carId);
  if (!car) {
    car = makeCar(p.x, p.y, p.angle, snap.carColor || '#d97b2f', 'player');
    state.cars.push(car);
  }
  car.x = p.x; car.y = p.y; car.angle = p.angle; car.hp = snap.carHp; car.wreck = false; car.speed = 0;
  p.carId = car.id;
  p.inCar = !!snap.inCar;
  if (!p.inCar) { p.x += 40; }
  // Restart the mission from its saved stage (checkpoints are taken at mission start,
  // so stageIndex is the stage the mission began at).
  if (snap.missionIndex >= 0 && snap.missionIndex < MISSIONS.length) {
    startMission(state, snap.missionIndex, true);
  } else {
    state.mission = null;
    state.missionIndex = snap.missionIndex;
  }
  state.wasted = false; state.busted = false; state.respawnTimer = 0;
  return true;
}

export function setToast(state, text) {
  state.toast = text;
  state.toastTimer = 4;
}

function setBanner(state, text) {
  state.banner = text;
  state.bannerTimer = 3;
}

function addCrime(state, level) {
  state.wanted = clamp(Math.max(state.wanted, level), 0, 5);
  state.wantedIdle = 0;
}

// ---------- missions ----------
export function startMission(state, index, fromCheckpoint = false) {
  const def = MISSIONS[index];
  if (!def) return false;
  clearMissionEntities(state);
  state.missionIndex = index;
  state.mission = { def, stageIndex: 0, stage: null, timer: def.timer || 0 };
  state.missionDelay = 0;
  setupStage(state, 0);
  if (!fromCheckpoint) saveCheckpoint(state, 'mission start');
  setBanner(state, `Mission ${def.id}: ${def.name} — $${def.reward.toLocaleString('en-US')}`);
  setToast(state, def.intro);
  state.stuckTimer = 0;
  state.stuckHintShown = false;
  state.bestObjectiveDist = Infinity;
  return true;
}

function clearMissionEntities(state) {
  state.cars = state.cars.filter((c) => c.kind !== 'target');
  state.enemies = [];
  state.cashPiles = [];
  if (state.mission) state.mission.stage = null;
}

function setupStage(state, stageIndex) {
  const m = state.mission;
  const def = m.def;
  const s = def.stages[stageIndex];
  if (!s) return;
  m.stageIndex = stageIndex;
  const stage = { ...s, phase: s.type === 'taxi' ? 'pickup' : 'go', remaining: s.count || 0, cashPiles: [], enemies: [] };
  if (s.type === 'steal') {
    const car = makeCar(s.x, s.y, 0, '#ffd23f', 'target');
    state.cars.push(car);
    stage.targetCarId = car.id;
    stage.marker = { x: s.x, y: s.y };
  }
  if (s.type === 'grab') {
    // Piles wait just outside the bank's south doors, so they are reachable on foot.
    for (let i = 0; i < (s.count || 3); i += 1) {
      stage.cashPiles.push({ x: s.x + (i - 1) * 70, y: s.y + 120, taken: false });
    }
    if (s.wanted) addCrime(state, s.wanted);
  }
  if (s.type === 'shoot') {
    for (let i = 0; i < (s.count || 4); i += 1) {
      // On the pier the crew stands on the boards, not in the water.
      const onPier = s.x > SEA_X;
      const e = {
        x: onPier ? s.x + range(state.rand, -120, 120) : s.x + range(state.rand, -140, 140),
        y: onPier ? PIER.y + range(state.rand, -28, 28) : s.y + range(state.rand, -90, 90),
        hp: 40, shootCooldown: range(state.rand, 0.5, 1.5), angle: 0, shirt: '#3a3a3a',
      };
      state.enemies.push(e);
      stage.enemies.push(e);
    }
  }
  if (s.type === 'escape' && s.wanted) addCrime(state, s.wanted);
  if (s.type === 'steal' && s.wanted) addCrime(state, s.wanted);
  m.stage = stage;
  setToast(state, s.text);
  state.stuckTimer = 0;
  state.bestObjectiveDist = Infinity;
}

function advanceStage(state) {
  const m = state.mission;
  if (!m) return;
  if (m.stageIndex + 1 < m.def.stages.length) {
    setupStage(state, m.stageIndex + 1);
  } else {
    completeMission(state);
  }
}

function completeMission(state) {
  const m = state.mission;
  const reward = m.def.reward;
  state.cash += reward;
  state.stats.missionsDone += 1;
  state.player.ammo = Math.min(240, state.player.ammo + 60);
  setBanner(state, `Mission complete — $${reward.toLocaleString('en-US')}`);
  clearMissionEntities(state);
  state.mission = null;
  state.missionIndex = m.def.id; // next mission index (ids are 1-based, index = id)
  if (state.missionIndex >= MISSIONS.length) {
    state.storyDone = true;
    setBanner(state, 'SOLMAR BAY — story complete! Free roam: taxis, packages, chaos.');
    state.missionIndex = -1;
  } else {
    state.missionDelay = 2.5; // brief breather, then the next mission auto-starts
  }
  saveCheckpoint(state, 'mission complete');
}

function failMission(state, reason) {
  setBanner(state, reason);
  clearMissionEntities(state);
  state.mission = null;
  loadCheckpoint(state);
}

// Objective position used by the HUD marker, minimap and stuck detector.
export function objectivePos(state) {
  const m = state.mission;
  if (!m || !m.stage) return null;
  const s = m.stage;
  if (s.type === 'steal') {
    const car = state.cars.find((c) => c.id === s.targetCarId);
    if (s.phase === 'deliver') return { x: s.toX, y: s.toY };
    return car ? { x: car.x, y: car.y } : { x: s.x, y: s.y };
  }
  if (s.type === 'taxi') {
    return s.phase === 'pickup' ? { x: s.x, y: s.y } : { x: s.toX, y: s.toY };
  }
  if (s.type === 'escape') return { x: s.toX, y: s.toY };
  return { x: s.x, y: s.y };
}

function updateMission(state, dt) {
  const m = state.mission;
  if (!m) {
    if (state.missionDelay > 0) {
      state.missionDelay -= dt;
      if (state.missionDelay <= 0 && state.missionIndex >= 0 && state.missionIndex < MISSIONS.length) {
        startMission(state, state.missionIndex);
      }
    }
    return;
  }
  // Mission clock: running out sends the player back to the checkpoint.
  if (m.timer > 0) {
    m.timer -= dt;
    if (m.timer <= 0) {
      failMission(state, 'Out of time — back to the checkpoint.');
      return;
    }
  }
  const s = m.stage;
  if (!s) return;
  const p = state.player;
  const obj = objectivePos(state);
  // Stuck detector: 120 s without getting closer to the objective.
  if (obj) {
    const d = Math.sqrt(dist2(p.x, p.y, obj.x, obj.y));
    if (d < state.bestObjectiveDist - 30) {
      state.bestObjectiveDist = d;
      state.stuckTimer = 0;
    } else {
      state.stuckTimer += dt;
      if (state.stuckTimer > 120 && !state.stuckHintShown) {
        state.stuckHintShown = true;
        setToast(state, 'Stuck? Press R to restart this mission from the checkpoint.');
      }
    }
  }

  const near = (x, y, r) => dist2(p.x, p.y, x, y) < r * r;

  switch (s.type) {
    case 'goto':
      if (near(s.x, s.y, 80)) advanceStage(state);
      break;
    case 'pickup':
      if (near(s.x, s.y, 80)) {
        setToast(state, 'Package secured.');
        advanceStage(state);
      }
      break;
    case 'deliver':
      if (near(s.x, s.y, 90)) advanceStage(state);
      break;
    case 'taxi': {
      if (s.phase === 'pickup' && near(s.x, s.y, 80)) {
        s.phase = 'deliver';
        setToast(state, 'Passenger aboard — drive to the marker.');
      } else if (s.phase === 'deliver' && near(s.toX, s.toY, 90)) {
        advanceStage(state);
      }
      break;
    }
    case 'steal': {
      const car = state.cars.find((c) => c.id === s.targetCarId);
      if (!car) break;
      if (s.phase === 'go') {
        // Anti-jam: if the player sits in another car right by the target,
        // pop them out so they can take the target.
        if (p.inCar && p.carId !== car.id && dist2(p.x, p.y, car.x, car.y) < 140 * 140) {
          const cur = state.cars.find((c) => c.id === p.carId);
          if (cur) ejectPlayer(state, cur);
          setToast(state, 'Get in the marked car!');
        }
        if (p.inCar && p.carId === car.id) {
          s.phase = 'deliver';
          setToast(state, 'Now lose the heat — deliver the car to the marker.');
        }
      } else if (dist2(car.x, car.y, s.toX, s.toY) < 90 * 90) {
        advanceStage(state);
      }
      break;
    }
    case 'grab': {
      for (const pile of s.cashPiles) {
        // Pickup radius (60) is deliberately wider than a stride: a player who
        // walks up to a pile should never be left standing 2 px short of it.
        if (!pile.taken && near(pile.x, pile.y, 60)) {
          pile.taken = true;
          state.cash += 250;
          spawnParticles(state, pile.x, pile.y, '#7ee787', 10, 120, 0.5);
        }
      }
      if (s.cashPiles.every((pile) => pile.taken)) advanceStage(state);
      break;
    }
    case 'shoot': {
      if (s.enemies.every((e) => e.hp <= 0)) advanceStage(state);
      break;
    }
    case 'escape': {
      if (near(s.toX, s.toY, 100)) {
        state.wanted = 0;
        clearPolice(state);
        advanceStage(state);
      }
      break;
    }
    default:
      break;
  }
}

// ---------- taxi side jobs ----------
function startTaxiJob(state) {
  const p = state.player;
  if (p.inCar) return;
  let best = null;
  let bestD = Infinity;
  for (const s of [{ x: 880, y: 560 }, { x: 1520, y: 1200 }, { x: 240, y: 1840 }, { x: 2160, y: 560 }]) {
    const d = dist2(p.x, p.y, s.x, s.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  const dest = {
    x: pick(state.rand, ROADS_X) + (state.rand() < 0.5 ? -20 : 20),
    y: pick(state.rand, ROADS_Y) + (state.rand() < 0.5 ? -20 : 20),
  };
  const fare = 50 + Math.floor(Math.sqrt(dist2(best.x, best.y, dest.x, dest.y)) / 22);
  state.taxiJob = { x: best.x, y: best.y, toX: dest.x, toY: dest.y, phase: 'pickup', fare: Math.min(120, fare) };
  setToast(state, 'Taxi fare hailed — pick up the passenger at the marker.');
}

function updateTaxiJob(state) {
  const job = state.taxiJob;
  if (!job) return;
  const p = state.player;
  const near = (x, y, r) => dist2(p.x, p.y, x, y) < r * r;
  if (job.phase === 'pickup' && near(job.x, job.y, 80)) {
    job.phase = 'deliver';
    setToast(state, 'Passenger aboard — drive to the marker.');
  } else if (job.phase === 'deliver' && near(job.toX, job.toY, 90)) {
    state.cash += job.fare;
    state.stats.faresDone += 1;
    setToast(state, `Fare complete — +$${job.fare}`);
    state.taxiJob = null;
  }
}

// ---------- police ----------
function clearPolice(state) {
  state.cars = state.cars.filter((c) => c.kind !== 'police');
}

function ensurePolice(state) {
  const want = Math.min(state.wanted, 5);
  const have = state.cars.filter((c) => c.kind === 'police').length;
  for (let i = have; i < want; i += 1) {
    const p = state.player;
    const angle = state.rand() * Math.PI * 2;
    const x = clamp(p.x + Math.cos(angle) * 700, 150, 2650);
    const y = clamp(p.y + Math.sin(angle) * 700, 150, 2250);
    const car = makeCar(x, y, angle, '#1d2f4d', 'police');
    car.speed = 200;
    state.cars.push(car);
  }
  if (want === 0 && have > 0) {
    for (const c of state.cars) {
      if (c.kind === 'police' && dist2(c.x, c.y, state.player.x, state.player.y) > 900 * 900) {
        c.hp = 0; c.wreck = true;
      }
    }
    state.cars = state.cars.filter((c) => !(c.kind === 'police' && c.wreck));
  }
}

// ---------- combat ----------
export function shootAt(state, wx, wy) {
  const p = state.player;
  if (p.ammo <= 0) { setToast(state, 'Out of ammo — finish a mission to restock.'); return false; }
  if (state.shootCooldown > 0) return false;
  p.ammo -= 1;
  state.stats.shotsFired += 1;
  state.shootCooldown = 0.18;
  const spread = p.inCar ? 0.09 : 0.02;
  const a = Math.atan2(wy - p.y, wx - p.x) + (state.rand() - 0.5) * 2 * spread;
  state.bullets.push({
    x: p.x + Math.cos(a) * 24, y: p.y + Math.sin(a) * 24,
    vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED,
    life: 1.2, friendly: true,
  });
  addCrime(state, 1);
  return true;
}

function damageCar(state, car, amount, fromPlayer) {
  if (car.wreck) return;
  car.hp -= amount;
  if (car.hp <= 0) {
    explodeCar(state, car);
    if (fromPlayer && car.kind === 'police') addCrime(state, Math.min(5, state.wanted + 1));
  }
}

function updateBullets(state, dt) {
  for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
    const b = state.bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let dead = b.life <= 0 || b.x < 0 || b.x > WORLD.width || b.y < 0 || b.y > WORLD.height;
    if (!dead) {
      for (const bd of state.buildings) {
        if (b.x > bd.x && b.x < bd.x + bd.w && b.y > bd.y && b.y < bd.y + bd.h) { dead = true; break; }
      }
    }
    if (!dead) {
      if (b.friendly) {
        for (const ref of nearby(state, b.x, b.y, 40)) {
          if (ref.kind === 'enemy' && ref.ref.hp > 0 && dist2(b.x, b.y, ref.ref.x, ref.ref.y) < 20 * 20) {
            ref.ref.hp -= 20;
            spawnParticles(state, b.x, b.y, '#ff5a4d', 6, 140, 0.4);
            if (ref.ref.hp <= 0) spawnParticles(state, ref.ref.x, ref.ref.y, '#ff5a4d', 14, 180, 0.7);
            dead = true; break;
          }
          if (ref.kind === 'car' && ref.ref.kind !== 'player' && !ref.ref.wreck && dist2(b.x, b.y, ref.ref.x, ref.ref.y) < 28 * 28) {
            damageCar(state, ref.ref, 12, true);
            spawnParticles(state, b.x, b.y, '#ffd23f', 5, 120, 0.3);
            dead = true; break;
          }
          if (ref.kind === 'ped' && ref.ref.alive && dist2(b.x, b.y, ref.ref.x, ref.ref.y) < 16 * 16) {
            ref.ref.alive = false;
            spawnParticles(state, ref.ref.x, ref.ref.y, '#ff5a4d', 10, 140, 0.6);
            addCrime(state, Math.min(5, state.wanted + 1));
            dead = true; break;
          }
        }
      } else {
        const p = state.player;
        if (dist2(b.x, b.y, p.x, p.y) < 18 * 18 && p.invuln <= 0) {
          p.hp -= 8;
          p.invuln = 0.4;
          spawnParticles(state, p.x, p.y, '#ff5a4d', 6, 140, 0.4);
          dead = true;
        }
      }
    }
    if (dead) state.bullets.splice(i, 1);
  }
}

// ---------- player ----------
function updatePlayer(state, input, dt) {
  const p = state.player;
  p.invuln = Math.max(0, p.invuln - dt);
  state.shootCooldown = Math.max(0, (state.shootCooldown || 0) - dt);
  const mx = input.moveX();
  const my = input.moveY();

  if (p.inCar) {
    const car = state.cars.find((c) => c.id === p.carId);
    if (!car || car.wreck) { ejectPlayer(state, car || makeCar(p.x, p.y, p.angle, '#d97b2f', 'player')); return; }
    const forward = my < 0 ? 1 : my > 0 ? -0.55 : 0;
    const target = forward > 0 ? PLAYER.carMaxSpeed : forward < 0 ? -PLAYER.carReverseMax : 0;
    const accel = forward !== 0 ? PLAYER.carAccel : PLAYER.carBrake;
    car.speed += clamp(target - car.speed, -accel * dt, accel * dt);
    if (Math.abs(car.speed) < 4 && forward === 0) car.speed = 0;
    const steer = mx * PLAYER.carTurn * clamp(Math.abs(car.speed) / 200, 0.15, 1);
    car.angle += steer * dt * Math.sign(car.speed || 1);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    car.x = clamp(car.x, 40, WORLD.width - 40);
    car.x = clampToLand(state, car.x, car.y);
    car.y = clamp(car.y, 40, WORLD.height - 40);
    const hit = collideCircleBuildings(state, car.x, car.y, 24);
    if (hit.hit) {
      car.x += hit.x; car.y += hit.y;
      // Hard hits hurt, but not more than once per half second of scraping.
      if (Math.abs(car.speed) > 260 && state.time - (car.lastDamageAt || 0) > 0.5) {
        car.lastDamageAt = state.time;
        damageCar(state, car, 4, false);
        spawnParticles(state, car.x, car.y, '#ffd23f', 8, 160, 0.4);
        state.audio?.crash();
      }
      car.speed *= -0.25;
    }
    if (Math.abs(car.speed) > 300 && mx !== 0) {
      spawnParticles(state, car.x - Math.cos(car.angle) * 22, car.y - Math.sin(car.angle) * 22, '#c9c9c9', 1, 40, 0.3);
    }
    p.x = car.x; p.y = car.y; p.angle = car.angle; p.speed = car.speed;
    state.audio?.setEngine(true, Math.abs(car.speed) / PLAYER.carMaxSpeed);
  } else {
    state.audio?.setEngine(false, 0);
    const len = Math.hypot(mx, my);
    if (len > 0) {
      const nx = (mx / len) * PLAYER.walkSpeed * dt;
      const ny = (my / len) * PLAYER.walkSpeed * dt;
      p.walkAngle = Math.atan2(my, mx);
      p.x += nx;
      const hitX = collideCircleBuildings(state, p.x, p.y, PLAYER.radius);
      if (hitX.hit) { p.x += hitX.x; }
      p.y += ny;
      const hitY = collideCircleBuildings(state, p.x, p.y, PLAYER.radius);
      if (hitY.hit) { p.y += hitY.y; }
      p.x = clamp(p.x, 20, WORLD.width - 20);
      p.y = clamp(p.y, 20, WORLD.height - 20);
      p.speed = PLAYER.walkSpeed;
    } else {
      p.speed = 0;
    }
    p.angle = p.walkAngle;
  }

  // Sea: the player cannot swim — push back onto the sand (the pier excepted).
  if (p.x > SEA_X && !onPier(p.x, p.y)) {
    p.x = SEA_X - 4;
    const car = state.cars.find((c) => c.id === p.carId);
    if (car && p.inCar) car.x = SEA_X - 4;
  }

  // Hidden packages.
  for (const pkg of state.packages) {
    if (!pkg.taken && dist2(p.x, p.y, pkg.x, pkg.y) < 40 * 40) {
      pkg.taken = true;
      state.cash += 100;
      state.stats.packagesFound += 1;
      setToast(state, `Hidden package found — +$100 (${state.stats.packagesFound}/10)`);
      state.audio?.pickup();
    }
  }
}

// Enter / exit the nearest car.
function tryEnterCar(state) {
  const p = state.player;
  if (p.inCar) {
    const car = state.cars.find((c) => c.id === p.carId);
    if (car) {
      car.speed = 0;
      ejectPlayer(state, car);
    }
    return;
  }
  let best = null;
  let bestD = 70 * 70;
  for (const ref of nearby(state, p.x, p.y, 80)) {
    if (ref.kind !== 'car') continue;
    const car = ref.ref;
    if (car.kind === 'police') continue;
    const d = dist2(p.x, p.y, car.x, car.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  if (!best) { setToast(state, 'No car close enough.'); return; }
  if (best.wreck || best.hp <= 0) { setToast(state, 'That car is wrecked.'); return; }
  if (best.kind === 'traffic' || best.kind === 'parked' || best.kind === 'target') {
    addCrime(state, 1);
    if (best.kind === 'target') state.stats.carsStolen += 1;
  }
  p.inCar = true;
  p.carId = best.id;
  best.speed = 0;
  p.x = best.x; p.y = best.y; p.angle = best.angle;
  setToast(state, best.kind === 'player' ? 'Your car.' : 'Car taken.');
}

// ---------- traffic / peds / police movement ----------
function updateTraffic(state, dt) {
  for (const car of state.cars) {
    if (car.kind !== 'traffic') continue;
    if (car.wreck) {
      car.respawn -= dt;
      if (car.respawn <= 0) {
        const vertical = state.rand() < 0.5;
        const pt = randomRoadPoint(state.rand, vertical);
        car.x = pt.x; car.y = pt.y;
        car.roadAxis = vertical ? 'x' : 'y';
        car.road = vertical ? pt.x : pt.y;
        car.dir = state.rand() < 0.5 ? 1 : -1;
        car.lane = car.dir > 0 ? 28 : -28;
        car.hp = 100; car.wreck = false; car.speed = range(state.rand, 120, 190);
      }
      continue;
    }
    // Slow for a car ahead in the same lane (not while being shoved forward).
    let desired = car.speed;
    const shoved = car.shovedUntil && state.time < car.shovedUntil;
    if (!shoved) {
      for (const ref of nearby(state, car.x, car.y, 70)) {
        if (ref.kind !== 'car' || ref.ref === car) continue;
        const other = ref.ref;
        const dx = other.x - car.x;
        const dy = other.y - car.y;
        const ahead = car.roadAxis === 'x' ? dy * car.dir > 0 && Math.abs(dx) < 30 : dx * car.dir > 0 && Math.abs(dy) < 30;
        if (ahead) desired = Math.min(desired, 60);
      }
    } else {
      desired = Math.max(desired, car.speed);
    }
    car.speed += clamp(desired - car.speed, -300 * dt, 200 * dt);
    if (car.roadAxis === 'x') {
      car.y += car.dir * car.speed * dt;
      car.angle = angleLerp(car.angle, car.dir > 0 ? Math.PI / 2 : -Math.PI / 2, Math.min(1, dt * 6));
      car.x += ((car.road + car.lane) - car.x) * Math.min(1, dt * 4);
      // At an intersection, sometimes turn onto the crossing road — but not
      // into a queue: turning into congestion is what jams intersections.
      for (const ry of ROADS_Y) {
        if (Math.abs(car.y - ry) < 6 && state.rand() < 0.004) {
          let clear = true;
          for (const ref of nearby(state, car.road, ry, 100)) {
            if (ref.kind === 'car' && ref.ref !== car) { clear = false; break; }
          }
          if (!clear) break;
          car.roadAxis = 'y'; car.road = ry; car.dir = state.rand() < 0.5 ? 1 : -1;
          car.lane = car.dir > 0 ? 28 : -28;
          break;
        }
      }
      if (car.y < 140 || car.y > 2260) { car.dir *= -1; car.lane = car.dir > 0 ? 28 : -28; }
    } else {
      car.x += car.dir * car.speed * dt;
      car.angle = angleLerp(car.angle, car.dir > 0 ? 0 : Math.PI, Math.min(1, dt * 6));
      car.y += ((car.road + car.lane) - car.y) * Math.min(1, dt * 4);
      for (const rx of ROADS_X) {
        if (Math.abs(car.x - rx) < 6 && state.rand() < 0.004) {
          let clear = true;
          for (const ref of nearby(state, rx, car.road, 100)) {
            if (ref.kind === 'car' && ref.ref !== car) { clear = false; break; }
          }
          if (!clear) break;
          car.roadAxis = 'x'; car.road = rx; car.dir = state.rand() < 0.5 ? 1 : -1;
          car.lane = car.dir > 0 ? 28 : -28;
          break;
        }
      }
      if (car.x < 140 || car.x > 2660) { car.dir *= -1; car.lane = car.dir > 0 ? 28 : -28; }
    }
    const hit = collideCircleBuildings(state, car.x, car.y, 24);
    if (hit.hit) { car.x += hit.x; car.y += hit.y; car.speed *= 0.5; }
  }
}

function updatePeds(state, dt) {
  for (const ped of state.peds) {
    if (!ped.alive) continue;
    if (ped.wait > 0) { ped.wait -= dt; continue; }
    if (ped.axis === 'x') {
      ped.y += ped.dir * ped.speed * dt;
      ped.angle = ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (ped.y < 150 || ped.y > 2250) ped.dir *= -1;
      for (const ry of ROADS_Y) {
        if (Math.abs(ped.y - ry) < 4 && state.rand() < 0.002) {
          ped.axis = 'y'; ped.road = ry; ped.dir = state.rand() < 0.5 ? 1 : -1; ped.wait = 0.4;
          break;
        }
      }
    } else {
      ped.x += ped.dir * ped.speed * dt;
      ped.angle = ped.dir > 0 ? 0 : Math.PI;
      if (ped.x < 150 || ped.x > 2650) ped.dir *= -1;
      for (const rx of ROADS_X) {
        if (Math.abs(ped.x - rx) < 4 && state.rand() < 0.002) {
          ped.axis = 'x'; ped.road = rx; ped.dir = state.rand() < 0.5 ? 1 : -1; ped.wait = 0.4;
          break;
        }
      }
    }
    // Flee a speeding car bearing down on them.
    for (const ref of nearby(state, ped.x, ped.y, 90)) {
      if (ref.kind === 'car' && Math.abs(ref.ref.speed) > 200) {
        const dx = ped.x - ref.ref.x;
        const dy = ped.y - ref.ref.y;
        const d = Math.hypot(dx, dy) || 1;
        ped.x += (dx / d) * 120 * dt;
        ped.y += (dy / d) * 120 * dt;
      }
    }
  }
}

function updatePolice(state, dt) {
  const p = state.player;
  for (const car of state.cars) {
    if (car.kind !== 'police' || car.wreck) continue;
    car.siren += dt;
    const dx = p.x - car.x;
    const dy = p.y - car.y;
    const d = Math.hypot(dx, dy) || 1;
    const wantAngle = Math.atan2(dy, dx);
    car.angle = angleLerp(car.angle, wantAngle, Math.min(1, dt * 2.2));
    const targetSpeed = d > 120 ? 480 : 300;
    car.speed += clamp(targetSpeed - car.speed, -500 * dt, 420 * dt);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    car.x = clampToLand(state, car.x, car.y);
    const hit = collideCircleBuildings(state, car.x, car.y, 24);
    if (hit.hit) { car.x += hit.x; car.y += hit.y; car.speed *= 0.4; }
    if (d < 60 && state.wanted >= 3 && !p.inCar) {
      // A slow cop standing on the player arrests them; a fast ram just hurts.
      if (Math.abs(car.speed) < 150) {
        state.bustedTimer = (state.bustedTimer || 0) + dt;
        if (state.bustedTimer > 1.2 && !state.busted) {
          state.busted = true;
          state.respawnTimer = 1.5;
          setBanner(state, 'BUSTED!');
        }
      } else if (p.invuln <= 0) {
        p.hp -= 10;
        p.invuln = 1;
        const push = 60;
        p.x += (dx / d) * push;
        p.y += (dy / d) * push;
        spawnParticles(state, p.x, p.y, '#ff5a4d', 8, 160, 0.5);
      }
    } else {
      state.bustedTimer = 0;
    }
    if (Math.floor(car.siren * 2) !== Math.floor((car.siren - dt) * 2)) {
      if (d < 700) state.audio?.siren();
    }
  }
}

function updateEnemies(state, dt) {
  const p = state.player;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    e.angle = Math.atan2(p.y - e.y, p.x - e.x);
    e.shootCooldown -= dt;
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    if (e.shootCooldown <= 0 && d < 520) {
      e.shootCooldown = range(state.rand, 1.0, 1.8);
      const spread = (state.rand() - 0.5) * 0.2;
      const a = e.angle + spread;
      state.bullets.push({
        x: e.x + Math.cos(a) * 20, y: e.y + Math.sin(a) * 20,
        vx: Math.cos(a) * 620, vy: Math.sin(a) * 620, life: 1.4, friendly: false,
      });
    }
  }
}

// Car-vs-car collisions through the grid (circle vs circle, push apart).
function updateCarCollisions(state) {
  for (const car of state.cars) {
    if (car.wreck) continue;
    for (const ref of nearby(state, car.x, car.y, 60)) {
      if (ref.kind !== 'car' || ref.ref === car || ref.ref.wreck) continue;
      const other = ref.ref;
      if (car.id >= other.id) continue; // each pair once
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 52 * 52 || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = (52 - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      car.x -= nx * push; car.y -= ny * push;
      other.x += nx * push; other.y += ny * push;
      const impact = Math.abs(car.speed - other.speed);
      if (impact > 180) {
        // A hard hit damages both cars and bleeds speed; gentle contact only
        // pushes them apart, so a queue can creep forward instead of deadlocking.
        damageCar(state, car, 6, false);
        damageCar(state, other, 6, false);
        spawnParticles(state, (car.x + other.x) / 2, (car.y + other.y) / 2, '#ffd23f', 6, 140, 0.4);
        state.audio?.crash();
        car.speed *= 0.7;
        other.speed *= 0.7;
      }
      // The player's car shoves slower traffic forward instead of sitting behind it.
      const p = state.player;
      if (p.inCar && (car.id === p.carId || other.id === p.carId)) {
        const pc = car.id === p.carId ? car : other;
        const oc = car.id === p.carId ? other : car;
        if ((oc.kind === 'traffic' || oc.kind === 'parked') && Math.abs(pc.speed) > Math.abs(oc.speed)) {
          oc.speed = pc.speed;
          oc.angle = pc.angle;
          oc.shovedUntil = state.time + 1.5;
        }
      }
    }
  }
}

// ---------- main step ----------
export function stepWorld(state, input, dt, actions, shootTarget) {
  state.time += dt;
  state.toastTimer = Math.max(0, state.toastTimer - dt);
  state.bannerTimer = Math.max(0, state.bannerTimer - dt);
  const p = state.player;

  // Respawn after wasted / busted.
  if (state.respawnTimer > 0) {
    state.respawnTimer -= dt;
    if (state.respawnTimer <= 0) {
      loadCheckpoint(state);
      setToast(state, 'Back at the checkpoint.');
    }
    return;
  }

  if (actions & 64) { // ACTION_RETRY
    if (state.mission) {
      setToast(state, 'Mission restarted from the checkpoint.');
      loadCheckpoint(state);
    }
  }
  if (actions & 32) saveCheckpoint(state, 'manual'); // ACTION_CHECKPOINT
  if (actions & 4) tryEnterCar(state); // ACTION_ENTER_CAR
  if (actions & 16) { // ACTION_TAXI
    if (!state.taxiJob && !state.player.inCar) startTaxiJob(state);
  }
  if (shootTarget) shootAt(state, shootTarget.x, shootTarget.y);

  rebuildGrid(state);
  updatePlayer(state, input, dt);
  updateTraffic(state, dt);
  updatePeds(state, dt);
  ensurePolice(state);
  updatePolice(state, dt);
  updateEnemies(state, dt);
  updateBullets(state, dt);
  updateCarCollisions(state);
  // A speeding car that clips the player on foot knocks them down.
  if (!p.inCar && p.invuln <= 0) {
    for (const ref of nearby(state, p.x, p.y, 50)) {
      if (ref.kind === 'car' && !ref.ref.wreck && Math.abs(ref.ref.speed) > 120) {
        if (dist2(p.x, p.y, ref.ref.x, ref.ref.y) < 30 * 30) {
          p.hp -= 10;
          p.invuln = 1;
          const dx = p.x - ref.ref.x;
          const dy = p.y - ref.ref.y;
          const d = Math.hypot(dx, dy) || 1;
          p.x += (dx / d) * 50;
          p.y += (dy / d) * 50;
          spawnParticles(state, p.x, p.y, '#ff5a4d', 8, 160, 0.5);
          break;
        }
      }
    }
  }
  updateMission(state, dt);
  updateTaxiJob(state);

  // Wanted decay: 25 s clean and the heat drops a star.
  if (state.wanted > 0) {
    state.wantedIdle += dt;
    if (state.wantedIdle > 25) {
      state.wanted -= 1;
      state.wantedIdle = 0;
    }
  }

  // Player death: wasted.
  if (p.hp <= 0 && !state.wasted) {
    state.wasted = true;
    state.respawnTimer = 1.5;
    setBanner(state, 'WASTED');
    state.audio?.fail();
    const car = state.cars.find((c) => c.id === p.carId);
    if (car && p.inCar) explodeCar(state, car);
  }

  // Particles.
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const pt = state.particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= 0.98;
    pt.vy *= 0.98;
    pt.life -= dt;
    if (pt.life <= 0) state.particles.splice(i, 1);
  }

  // Wrecked police despawn once the heat is gone.
  state.cars = state.cars.filter((c) => !(c.kind === 'police' && c.wreck && c.hp <= 0 && state.wanted === 0));
}

// Expose the mission list for the HUD.
export { MISSIONS };
