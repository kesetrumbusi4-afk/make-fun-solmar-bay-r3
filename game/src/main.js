// Boot and the one loop: input is read every frame, the world advances in fixed
// 1/60 s steps, the renderer paints what is there. Screens: title, play, paused.
// Enter/click on the title auto-starts Mission 1 (fast open, skippable intro).
// ?seed=N fixes the city. ?shot=chase|coast|bank|title stages that scene
// instead of running the loop, paints it twice and sets window.__shotReady.
// Debug hooks for automated verification live on window.__solmar.
import { SAVE_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, loadCheckpoint, objectivePos, saveCheckpoint, shootAt, startMission, stepWorld } from './world.js';
import {
  ACTION_CHECKPOINT, ACTION_CONFIRM, ACTION_ENTER_CAR, ACTION_MISSION, ACTION_MUTE,
  ACTION_PAUSE, ACTION_RETRY, ACTION_TAXI, createInput,
} from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const state = createWorld(seed);
const renderer = createRenderer(canvas);
const audio = createAudio();
state.audio = audio;

function readBestCash() {
  try {
    return Number.parseInt(window.localStorage.getItem(SAVE_KEY + '.best') ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBestCash(value) {
  try {
    window.localStorage.setItem(SAVE_KEY + '.best', String(value));
  } catch { /* ignore */ }
}

// Debug / verification hooks (harmless in normal play).
window.__solmar = {
  state,
  startMission: (i) => startMission(state, i),
  saveCheckpoint: () => saveCheckpoint(state, 'manual'),
  loadCheckpoint: () => loadCheckpoint(state),
  teleport: (x, y) => {
    const p = state.player;
    p.x = x; p.y = y;
    if (p.inCar) {
      const car = state.cars.find((c) => c.id === p.carId);
      if (car) { car.x = x; car.y = y; car.speed = 0; }
    }
  },
  setWanted: (n) => { state.wanted = n; },
  shootAt: (x, y) => shootAt(state, x, y),
  objective: () => objectivePos(state),
  exitCar: () => {
    const p = state.player;
    if (!p.inCar) return;
    const car = state.cars.find((c) => c.id === p.carId);
    if (car) { car.speed = 0; p.inCar = false; p.x = car.x + 40; p.y = car.y; p.carId = 0; }
  },
  enterNearestCar: () => {
    const p = state.player;
    let best = null;
    let bestD = Infinity;
    for (const c of state.cars) {
      if (c.wreck || c.kind === 'police') continue;
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best && bestD < 120 * 120) {
      p.inCar = true; p.carId = best.id; p.x = best.x; p.y = best.y; p.angle = best.angle;
      return best.id;
    }
    return 0;
  },
  stats: () => ({
    cash: state.cash,
    missionIndex: state.missionIndex,
    missionStage: state.mission ? state.mission.stageIndex : -1,
    missionStageType: state.mission?.stage?.type || null,
    missionTimer: state.mission ? state.mission.timer : 0,
    storyDone: state.storyDone,
    wanted: state.wanted,
    hp: state.player.hp,
    ammo: state.player.ammo,
    inCar: state.player.inCar,
    x: state.player.x,
    y: state.player.y,
    cars: state.cars.length,
    traffic: state.cars.filter((c) => c.kind === 'traffic').length,
    police: state.cars.filter((c) => c.kind === 'police').length,
    peds: state.peds.filter((p) => p.alive).length,
    enemiesAlive: state.enemies.filter((e) => e.hp > 0).length,
    particles: state.particles.length,
    eco: state.eco,
    stats: state.stats,
  }),
};

function runShot(name) {
  const scene = stageShot(name, state);
  let painted = 0;
  function paint() {
    renderer.draw(state, scene.screen, readBestCash());
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let bestCash = readBestCash();
  let accumulator = 0;
  let last = performance.now();
  let lastFrameWork = 0;

  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    audio.unlock();
    // Resume from a checkpoint if one exists, else a fresh story.
    const had = loadCheckpoint(state);
    if (!had) startMission(state, 0);
    screen = SCREEN_PLAY;
    announce('Playing. Mission 1: First Fare.');
  }

  function handleActions(actions) {
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
    }
    if (actions & ACTION_CONFIRM && screen === SCREEN_TITLE) {
      startGame();
      return;
    }
    if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
    if (actions & ACTION_MISSION && screen === SCREEN_PLAY && !state.mission && state.missionIndex >= 0) {
      startMission(state, state.missionIndex);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const frameStart = performance.now();
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    let actions = input.takeActions();
    handleActions(actions);
    if (screen === SCREEN_TITLE) {
      // Ambient city behind the title: traffic and pedestrians keep moving.
      while (accumulator >= STEP) {
        stepWorld(state, input, STEP, 0, null);
        accumulator -= STEP;
      }
    } else if (screen === SCREEN_PLAY) {
      let shootTarget = null;
      if (input.takeClick() || input.mouseDown) {
        const view = renderer.draw(state, screen, bestCash);
        shootTarget = renderer.screenToWorld(input.mouseX, input.mouseY, view.camX, view.camY);
      }
      while (accumulator >= STEP) {
        stepWorld(state, input, STEP, actions, shootTarget);
        actions = 0;
        shootTarget = null;
        accumulator -= STEP;
      }
      if (state.cash > bestCash) {
        bestCash = state.cash;
        saveBestCash(bestCash);
      }
    } else {
      accumulator = 0;
    }
    const view = renderer.draw(state, screen, bestCash);
    void view;
    // Adaptive ECO mode: on when a frame costs >26 ms of work, off under 15 ms.
    lastFrameWork = performance.now() - frameStart;
    state.frameWorkMs = lastFrameWork;
    if (!state.eco && lastFrameWork > 26) state.eco = true;
    else if (state.eco && lastFrameWork < 15) state.eco = false;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Solmar Bay. Press Enter or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
