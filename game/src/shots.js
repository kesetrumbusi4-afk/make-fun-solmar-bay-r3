// Screenshot scenes behind ?shot=chase|coast|bank|title. Each one plays the real
// rules forward from a fresh world for a fixed number of steps, steered by a
// simple autopilot, so the frame is what real play looks like and the same seed
// always gives the same frame.
import { STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { startMission, stepWorld } from './world.js';

const SAMPLE = STEP;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Drive toward a point: W to accelerate, A/D to steer toward it.
function driveInput(state, tx, ty) {
  return {
    moveX() {
      const p = state.player;
      const diff = wrapAngle(Math.atan2(ty - p.y, tx - p.x) - p.angle);
      return diff > 0.18 ? 1 : diff < -0.18 ? -1 : 0;
    },
    moveY() {
      const p = state.player;
      const diff = Math.abs(wrapAngle(Math.atan2(ty - p.y, tx - p.x) - p.angle));
      return diff < 1.1 ? -1 : 0;
    },
  };
}

// Walk toward a point.
function walkInput(state, tx, ty) {
  return {
    moveX() {
      const dx = tx - state.player.x;
      return Math.abs(dx) > 12 ? Math.sign(dx) : 0;
    },
    moveY() {
      const dy = ty - state.player.y;
      return Math.abs(dy) > 12 ? Math.sign(dy) : 0;
    },
  };
}

function runSteps(state, input, seconds, shootAt) {
  for (let t = 0; t < seconds; t += SAMPLE) {
    stepWorld(state, input, SAMPLE, 0, shootAt || null);
  }
}

function idleInput() {
  return { moveX: () => 0, moveY: () => 0 };
}

export function stageShot(name, state) {
  // Clear the coast-road lane ahead of the player, so the shot shows a drive,
  // not a traffic jam; cross traffic and the cars behind stay in frame.
  function clearLaneAhead() {
    const p = state.player;
    state.cars = state.cars.filter(
      (c) => !(c.kind === 'traffic' && Math.abs(c.x - 2480) < 60 && c.y > p.y - 100 && c.y < p.y + 900),
    );
  }
  if (name === 'chase') {
    // Wanted 3 police chase down the coast road, mission 4's escape in progress.
    startMission(state, 3);
    const p = state.player;
    p.x = 2480; p.y = 500;
    const car = state.cars.find((c) => c.id === p.carId);
    if (car) { car.x = 2480; car.y = 500; car.angle = Math.PI / 2; }
    p.angle = Math.PI / 2;
    // Reach the informant marker to trigger the escape stage, then raise the heat.
    p.x = 2480; p.y = 880;
    if (car) { car.x = 2480; car.y = 880; }
    runSteps(state, idleInput(), 0.2);
    state.wanted = 3;
    p.x = 2480; p.y = 500;
    if (car) { car.x = 2480; car.y = 500; car.angle = Math.PI / 2; }
    clearLaneAhead();
    runSteps(state, driveInput(state, 2480, 2200), 3.5);
    return { screen: SCREEN_PLAY };
  }
  if (name === 'coast') {
    // Golden-hour drive down the beach road, traffic alongside.
    const p = state.player;
    p.x = 2480; p.y = 900;
    const car = state.cars.find((c) => c.id === p.carId);
    if (car) { car.x = 2480; car.y = 900; car.angle = Math.PI / 2; }
    p.angle = Math.PI / 2;
    clearLaneAhead();
    runSteps(state, driveInput(state, 2480, 2200), 3);
    return { screen: SCREEN_PLAY };
  }
  if (name === 'bank') {
    // Mission 5, "Grab the cash": Jax on foot in the bank vault, piles in reach,
    // wanted 3, police closing in.
    startMission(state, 4);
    const p = state.player;
    const car = state.cars.find((c) => c.id === p.carId);
    if (car) { car.x = 1520; car.y = 880; car.angle = 0; car.speed = 0; }
    p.inCar = false;
    p.carId = car ? car.id : 0;
    p.x = 1600; p.y = 1180;
    p.walkAngle = -Math.PI / 2;
    runSteps(state, walkInput(state, 1600, 1120), 2.5);
    return { screen: SCREEN_PLAY };
  }
  // Title (default).
  runSteps(state, idleInput(), 2);
  return { screen: SCREEN_TITLE };
}
