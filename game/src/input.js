// Keyboard + mouse input. Keys are tracked by code; actions are edge-triggered
// (consumed once by the loop) so a single press never fires twice.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER_CAR = 4;
export const ACTION_MISSION = 8;
export const ACTION_TAXI = 16;
export const ACTION_CHECKPOINT = 32;
export const ACTION_RETRY = 64;
export const ACTION_MUTE = 128;

const EDGE_KEYS = {
  Enter: ACTION_CONFIRM,
  Space: ACTION_CONFIRM,
  KeyE: ACTION_ENTER_CAR,
  KeyM: ACTION_MISSION,
  KeyT: ACTION_TAXI,
  KeyC: ACTION_CHECKPOINT,
  KeyR: ACTION_RETRY,
  KeyP: ACTION_PAUSE,
  Escape: ACTION_PAUSE,
  KeyN: ACTION_MUTE,
};

export function createInput(canvas) {
  const held = new Set();
  const queue = [];
  let mouseX = 0;
  let mouseY = 0;
  let mouseDown = false;
  let mouseClicked = false;

  function onKeyDown(event) {
    if (event.repeat) return;
    held.add(event.code);
    const action = EDGE_KEYS[event.code];
    if (action) {
      queue.push(action);
      event.preventDefault();
    }
  }
  function onKeyUp(event) {
    held.delete(event.code);
  }
  function onMouseMove(event) {
    const rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
  }
  function onMouseDown(event) {
    onMouseMove(event);
    mouseDown = true;
    mouseClicked = true;
    queue.push(ACTION_CONFIRM);
  }
  function onMouseUp() {
    mouseDown = false;
  }
  function onBlur() {
    held.clear();
    mouseDown = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);

  return {
    // -1/0/1 per axis from WASD + arrows.
    moveX() {
      const l = held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0;
      const r = held.has('KeyD') || held.has('ArrowRight') ? 1 : 0;
      return r - l;
    },
    moveY() {
      const u = held.has('KeyW') || held.has('ArrowUp') ? 1 : 0;
      const d = held.has('KeyS') || held.has('ArrowDown') ? 1 : 0;
      return d - u;
    },
    takeActions() {
      let actions = 0;
      while (queue.length) actions |= queue.shift();
      return actions;
    },
    takeClick() {
      const c = mouseClicked;
      mouseClicked = false;
      return c;
    },
    get mouseDown() {
      return mouseDown;
    },
    get mouseX() {
      return mouseX;
    },
    get mouseY() {
      return mouseY;
    },
    held(code) {
      return held.has(code);
    },
  };
}
