// Drawing only: world state + screen in, pixels out. The 1280x720 logical view
// scales to the window; the camera follows the player. Performance rules:
// viewport culling on every layer, sunset gradient + lamp halos + vignette
// pre-rendered once, car sprites pre-rendered per colour, HUD strings cached
// and rebuilt only when their values change, no allocation in the hot path
// beyond the few strings the cache rebuilds.
import {
  BEACH_X, FONT, PALETTE, PIER, ROADS_X, ROADS_Y, ROAD_W, SEA_X, VIEW, WORLD,
} from './config.js';
import { clamp } from './random.js';
import { objectivePos } from './world.js';

export const SCREEN_TITLE = 0;
export const SCREEN_PLAY = 1;
export const SCREEN_PAUSED = 2;
export const SCREEN_OVER = 3;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Detailed 52x26 car sprite: body, roof, windshield, headlights, taillights,
// wheels, and a police variant with a light bar. Drawn once per colour.
function carSprite(color, police) {
  const c = makeCanvas(64, 36);
  const g = c.getContext('2d');
  g.translate(32, 18);
  // Wheels.
  g.fillStyle = '#14141a';
  g.fillRect(-20, -15, 12, 6);
  g.fillRect(8, -15, 12, 6);
  g.fillRect(-20, 9, 12, 6);
  g.fillRect(8, 9, 12, 6);
  // Body.
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(-26, -13, 52, 26, 7);
  g.fill();
  // Hood + trunk shading.
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(-24, -11, 10, 22);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(14, -11, 10, 22);
  // Roof + windshield.
  g.fillStyle = 'rgba(20,24,40,0.9)';
  g.beginPath();
  g.roundRect(-8, -11, 16, 22, 4);
  g.fill();
  g.fillStyle = 'rgba(160,200,255,0.55)';
  g.fillRect(-8, -11, 4, 22);
  // Headlights (front = +x) and taillights.
  g.fillStyle = '#fff6c9';
  g.fillRect(24, -10, 3, 5);
  g.fillRect(24, 5, 3, 5);
  g.fillStyle = '#ff3b30';
  g.fillRect(-27, -10, 3, 5);
  g.fillRect(-27, 5, 3, 5);
  if (police) {
    g.fillStyle = '#ff3b30';
    g.fillRect(-2, -13, 5, 5);
    g.fillStyle = '#3b82ff';
    g.fillRect(-2, 8, 5, 5);
    g.fillStyle = '#e8e8e8';
    g.fillRect(4, -11, 6, 22);
  }
  return c;
}

// Pedestrian sprite, drawn facing +x; the renderer flips it by angle.
function pedSprite(shirt) {
  const c = makeCanvas(20, 20);
  const g = c.getContext('2d');
  g.fillStyle = shirt;
  g.beginPath();
  g.arc(10, 10, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2a1e16';
  g.beginPath();
  g.arc(14, 10, 3.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  g.arc(8, 12, 3, 0, Math.PI * 2);
  g.fill();
  return c;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const carSprites = new Map();
  const pedSprites = new Map();

  // Pre-rendered once: sunset gradient, lamp halo, vignette.
  const skyGrad = makeCanvas(VIEW.width, VIEW.height);
  {
    const g = skyGrad.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, VIEW.height);
    grad.addColorStop(0, PALETTE.skyTop);
    grad.addColorStop(0.45, PALETTE.skyMid);
    grad.addColorStop(1, PALETTE.skyLow);
    g.fillStyle = grad;
    g.fillRect(0, 0, VIEW.width, VIEW.height);
  }
  const halo = makeCanvas(128, 128);
  {
    const g = halo.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,214,120,0.55)');
    grad.addColorStop(0.5, 'rgba(255,170,80,0.18)');
    grad.addColorStop(1, 'rgba(255,170,80,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const vignette = makeCanvas(VIEW.width, VIEW.height);
  {
    const g = vignette.getContext('2d');
    const grad = g.createRadialGradient(640, 360, 300, 640, 360, 780);
    grad.addColorStop(0, 'rgba(20,8,32,0)');
    grad.addColorStop(1, 'rgba(20,8,32,0.42)');
    g.fillStyle = grad;
    g.fillRect(0, 0, VIEW.width, VIEW.height);
  }

  // HUD string cache: rebuild only when the value changes.
  const cache = {};
  function cached(key, value) {
    if (cache[key] !== value) cache[key] = value;
    return cache[key];
  }

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    scale = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
    offsetX = (canvas.width - VIEW.width * scale) / 2;
    offsetY = (canvas.height - VIEW.height * scale) / 2;
  }

  function spriteForCar(car) {
    const key = `${car.color}|${car.kind === 'police'}`;
    let s = carSprites.get(key);
    if (!s) {
      s = carSprite(car.color, car.kind === 'police');
      carSprites.set(key, s);
    }
    return s;
  }

  function spriteForPed(ped) {
    let s = pedSprites.get(ped.shirt);
    if (!s) {
      s = pedSprite(ped.shirt);
      pedSprites.set(ped.shirt, s);
    }
    return s;
  }

  function drawCar(g, car, camX, camY) {
    const s = spriteForCar(car);
    g.save();
    g.translate(car.x, car.y);
    g.rotate(car.angle);
    if (car.wreck) {
      g.globalAlpha = 0.85;
      g.filter = 'brightness(0.45) saturate(0.4)';
    }
    g.drawImage(s, -32, -18);
    g.restore();
    g.filter = 'none';
    // Headlight cones + halo at dusk (skip in ECO mode).
    if (!car.wreck && !stateRef.eco) {
      const hx = car.x + Math.cos(car.angle) * 26;
      const hy = car.y + Math.sin(car.angle) * 26;
      g.save();
      g.globalAlpha = 0.5;
      g.translate(hx, hy);
      g.rotate(car.angle);
      const grad = g.createLinearGradient(0, 0, 90, 0);
      grad.addColorStop(0, 'rgba(255,240,180,0.35)');
      grad.addColorStop(1, 'rgba(255,240,180,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, -6);
      g.lineTo(90, -26);
      g.lineTo(90, 26);
      g.lineTo(0, 6);
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  let stateRef = null;

  function drawWorld(g, state, camX, camY, viewW, viewH) {
    stateRef = state;
    const x0 = camX - 40;
    const y0 = camY - 40;
    const x1 = camX + viewW + 40;
    const y1 = camY + viewH + 40;

    // Ground: grass base, then roads, beach, sea.
    g.fillStyle = PALETTE.grass;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // Sea + sand (east).
    if (x1 > BEACH_X) {
      g.fillStyle = PALETTE.sand;
      g.fillRect(Math.max(x0, BEACH_X), y0, Math.min(x1, SEA_X) - Math.max(x0, BEACH_X), y1 - y0);
      g.fillStyle = PALETTE.seaShallow;
      g.fillRect(Math.max(x0, SEA_X), y0, x1 - Math.max(x0, SEA_X), y1 - y0);
      g.fillStyle = PALETTE.seaDeep;
      g.fillRect(Math.max(x0, SEA_X + 120), y0, x1 - Math.max(x0, SEA_X + 120), y1 - y0);
      // Animated wave lines.
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 2;
      for (let wy = Math.floor(y0 / 90) * 90; wy < y1; wy += 90) {
        const wob = Math.sin(state.time * 1.4 + wy * 0.05) * 8;
        g.beginPath();
        g.moveTo(SEA_X + 6 + wob, wy);
        g.lineTo(SEA_X + 46 + wob, wy);
        g.stroke();
      }
    }
    // Roads.
    g.fillStyle = PALETTE.asphalt;
    for (const rx of ROADS_X) {
      if (rx + ROAD_W / 2 < x0 || rx - ROAD_W / 2 > x1) continue;
      g.fillRect(rx - ROAD_W / 2, Math.max(y0, 120), ROAD_W, Math.min(y1, 2280) - Math.max(y0, 120));
    }
    for (const ry of ROADS_Y) {
      if (ry + ROAD_W / 2 < y0 || ry - ROAD_W / 2 > y1) continue;
      g.fillRect(Math.max(x0, 120), ry - ROAD_W / 2, Math.min(x1, 2720) - Math.max(x0, 120), ROAD_W);
    }
    // Sidewalks.
    g.fillStyle = PALETTE.sidewalk;
    for (const rx of ROADS_X) {
      if (rx + ROAD_W / 2 < x0 || rx - ROAD_W / 2 > x1) continue;
      g.fillRect(rx - ROAD_W / 2 - 10, Math.max(y0, 120), 10, Math.min(y1, 2280) - Math.max(y0, 120));
      g.fillRect(rx + ROAD_W / 2, Math.max(y0, 120), 10, Math.min(y1, 2280) - Math.max(y0, 120));
    }
    // Lane dashes (only the visible ones).
    g.fillStyle = PALETTE.lane;
    for (const rx of ROADS_X) {
      if (rx < x0 || rx > x1) continue;
      for (let y = Math.floor(y0 / 60) * 60; y < y1; y += 60) {
        if (y < 140 || y > 2260) continue;
        let blocked = false;
        for (const ry of ROADS_Y) if (Math.abs(y - ry) < 60) { blocked = true; break; }
        if (!blocked) g.fillRect(rx - 2, y, 4, 26);
      }
    }
    for (const ry of ROADS_Y) {
      if (ry < y0 || ry > y1) continue;
      for (let x = Math.floor(x0 / 60) * 60; x < x1; x += 60) {
        if (x < 140 || x > 2700) continue;
        let blocked = false;
        for (const rx of ROADS_X) if (Math.abs(x - rx) < 60) { blocked = true; break; }
        if (!blocked) g.fillRect(x, ry - 2, 26, 4);
      }
    }
    // Pier.
    g.fillStyle = '#6b4d2f';
    g.fillRect(PIER.x0, PIER.y - PIER.w / 2, PIER.x1 - PIER.x0, PIER.w);
    g.fillStyle = '#8a6a42';
    for (let x = PIER.x0; x < PIER.x1; x += 48) g.fillRect(x, PIER.y - PIER.w / 2, 4, PIER.w);

    // Park.
    g.fillStyle = PALETTE.park;
    g.fillRect(1896, 1536, 208, 248);

    // Buildings: long sunset shadows to the east, lit windows, name labels.
    for (const b of state.buildings) {
      if (b.x + b.w < x0 || b.x > x1 || b.y + b.h < y0 || b.y > y1) continue;
      // Shadow: long, warm, eastward.
      g.fillStyle = 'rgba(30,10,30,0.35)';
      g.beginPath();
      g.moveTo(b.x + 8, b.y + b.h);
      g.lineTo(b.x + b.w + 70, b.y + b.h + 26);
      g.lineTo(b.x + b.w + 70, b.y + b.h);
      g.lineTo(b.x + b.w, b.y + b.h);
      g.closePath();
      g.fill();
      g.fillStyle = b.color;
      g.fillRect(b.x, b.y, b.w, b.h);
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(b.x, b.y, b.w, 6);
      // Lit windows.
      const cols = Math.max(1, Math.floor(b.w / 34));
      const rows = Math.max(1, Math.floor(b.h / 34));
      for (let cx = 0; cx < cols; cx += 1) {
        for (let cy = 0; cy < rows; cy += 1) {
          const lit = ((cx * 7 + cy * 13 + b.x + b.y) % 10) / 10 < b.lit;
          g.fillStyle = lit ? PALETTE.windowLit : PALETTE.windowDark;
          g.fillRect(b.x + 10 + cx * 34, b.y + 10 + cy * 34, 16, 14);
        }
      }
      if (b.name) {
        g.fillStyle = PALETTE.text;
        g.font = 'bold 15px ' + FONT;
        g.textAlign = 'center';
        g.fillText(b.name, b.x + b.w / 2, b.y + b.h / 2);
      }
    }

    // Trees (culled).
    for (const t of state.trees) {
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
      g.fillStyle = 'rgba(30,10,30,0.3)';
      g.beginPath();
      g.ellipse(t.x + 14, t.y + 8, 16, 7, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2f5a26';
      g.beginPath();
      g.arc(t.x, t.y, 13, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#4d8a3d';
      g.beginPath();
      g.arc(t.x - 4, t.y - 4, 8, 0, Math.PI * 2);
      g.fill();
    }

    // Hidden packages: golden glint.
    for (const pkg of state.packages) {
      if (pkg.taken || pkg.x < x0 || pkg.x > x1 || pkg.y < y0 || pkg.y > y1) continue;
      const pulse = 0.6 + 0.4 * Math.sin(state.time * 3 + pkg.x);
      g.fillStyle = `rgba(255,210,63,${pulse})`;
      g.save();
      g.translate(pkg.x, pkg.y);
      g.rotate(Math.PI / 4);
      g.fillRect(-7, -7, 14, 14);
      g.restore();
    }

    // Mission cash piles.
    if (state.mission?.stage?.cashPiles) {
      for (const pile of state.mission.stage.cashPiles) {
        if (pile.taken) continue;
        g.fillStyle = '#7ee787';
        g.fillRect(pile.x - 10, pile.y - 7, 20, 14);
        g.fillStyle = '#2f7a3d';
        g.font = 'bold 12px ' + FONT;
        g.textAlign = 'center';
        g.fillText('$', pile.x, pile.y + 4);
      }
    }

    // Objective marker: bouncing diamond + beam.
    const obj = objectivePos(state);
    if (obj && obj.x > x0 - 100 && obj.x < x1 + 100 && obj.y > y0 - 100 && obj.y < y1 + 100) {
      const bob = Math.sin(state.time * 4) * 6;
      g.fillStyle = 'rgba(255,210,63,0.25)';
      g.fillRect(obj.x - 4, obj.y - 120, 8, 120);
      g.fillStyle = PALETTE.marker;
      g.save();
      g.translate(obj.x, obj.y - 30 + bob);
      g.rotate(Math.PI / 4);
      g.fillRect(-11, -11, 22, 22);
      g.restore();
      g.strokeStyle = PALETTE.marker;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(obj.x, obj.y, 26 + bob * 0.5, 0, Math.PI * 2);
      g.stroke();
    }

    // Cars (culled, sorted by y for a hint of depth).
    const visibleCars = [];
    for (const car of state.cars) {
      if (car.x < x0 - 60 || car.x > x1 + 60 || car.y < y0 - 60 || car.y > y1 + 60) continue;
      visibleCars.push(car);
    }
    visibleCars.sort((a, b) => a.y - b.y);
    for (const car of visibleCars) {
      // Street-lamp halo under each car headlight is drawn in drawCar; here the sprite.
      drawCar(g, car, camX, camY);
      if (car.kind === 'police' && !car.wreck) {
        const phase = Math.floor(state.time * 4) % 2 === 0;
        g.drawImage(halo, car.x - 40, car.y - 40, 80, 80);
        g.fillStyle = phase ? 'rgba(255,59,48,0.5)' : 'rgba(59,130,255,0.5)';
        g.beginPath();
        g.arc(car.x, car.y, 34, 0, Math.PI * 2);
        g.fill();
      }
      if (car.kind === 'target' && !car.wreck) {
        g.fillStyle = PALETTE.marker;
        g.font = 'bold 13px ' + FONT;
        g.textAlign = 'center';
        g.fillText('STEAL ME', car.x, car.y - 26 + Math.sin(state.time * 4) * 3);
      }
    }

    // Street lamps along the coast road: pre-rendered halo sprite.
    if (!state.eco) {
      for (let y = 200; y < 2300; y += 320) {
        const lx = 2440;
        if (lx < x0 || lx > x1 || y < y0 || y > y1) continue;
        g.fillStyle = '#2a2438';
        g.fillRect(lx - 2, y - 26, 4, 26);
        g.drawImage(halo, lx - 48, y - 26 - 48, 96, 96);
      }
    }

    // Pedestrians.
    for (const ped of state.peds) {
      if (!ped.alive || ped.x < x0 || ped.x > x1 || ped.y < y0 || ped.y > y1) continue;
      const s = spriteForPed(ped);
      g.save();
      g.translate(ped.x, ped.y);
      g.rotate(ped.angle);
      g.drawImage(s, -10, -10);
      g.restore();
    }

    // Enemies.
    for (const e of state.enemies) {
      if (e.hp <= 0 || e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
      g.save();
      g.translate(e.x, e.y);
      g.rotate(e.angle);
      g.fillStyle = '#3a3a3a';
      g.beginPath();
      g.arc(0, 0, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ff5a4d';
      g.fillRect(8, -2, 12, 4);
      g.restore();
      g.fillStyle = '#1d1d1d';
      g.fillRect(e.x - 14, e.y - 22, 28, 5);
      g.fillStyle = '#ff5a4d';
      g.fillRect(e.x - 14, e.y - 22, 28 * Math.max(0, e.hp / 40), 5);
    }

    // Player on foot (52x26 car sprite covers the in-car case).
    const p = state.player;
    if (!p.inCar && p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.walkAngle);
      g.fillStyle = '#ffb347';
      g.beginPath();
      g.arc(0, 0, 13, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2a1e16';
      g.beginPath();
      g.arc(6, 0, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(-12, -4, 8, 8);
      g.restore();
      if (p.invuln > 0) {
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(p.x, p.y, 18, 0, Math.PI * 2);
        g.stroke();
      }
    }

    // Bullets.
    g.fillStyle = '#ffe9a8';
    for (const b of state.bullets) {
      if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) continue;
      g.fillRect(b.x - 3, b.y - 3, 6, 6);
    }

    // Particles.
    for (const pt of state.particles) {
      if (pt.x < x0 || pt.x > x1 || pt.y < y0 || pt.y > y1) continue;
      g.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      g.fillStyle = pt.color;
      g.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    g.globalAlpha = 1;
  }

  function drawMinimap(g, state) {
    const mw = 200;
    const mh = 150;
    const mx = VIEW.width - mw - 16;
    const my = 16;
    const sx = mw / WORLD.width;
    const sy = mh / WORLD.height;
    g.fillStyle = 'rgba(20,12,28,0.72)';
    g.fillRect(mx - 4, my - 4, mw + 8, mh + 8);
    g.fillStyle = '#2f4a2a';
    g.fillRect(mx, my, mw, mh);
    g.fillStyle = '#4a4556';
    for (const rx of ROADS_X) g.fillRect(mx + rx * sx - 1, my, 2, mh);
    for (const ry of ROADS_Y) g.fillRect(mx, my + ry * sy, mw, 2);
    g.fillStyle = '#2f7d8f';
    g.fillRect(mx + SEA_X * sx, my, mw - SEA_X * sx, mh);
    const obj = objectivePos(state);
    if (obj) {
      g.fillStyle = PALETTE.marker;
      g.beginPath();
      g.arc(mx + obj.x * sx, my + obj.y * sy, 5, 0, Math.PI * 2);
      g.fill();
    }
    for (const car of state.cars) {
      if (car.kind !== 'police') continue;
      g.fillStyle = '#3b82ff';
      g.fillRect(mx + car.x * sx - 2, my + car.y * sy - 2, 4, 4);
    }
    const p = state.player;
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(mx + p.x * sx, my + p.y * sy, 4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffb347';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(mx + p.x * sx, my + p.y * sy, 6, 0, Math.PI * 2);
    g.stroke();
  }

  function drawHud(g, state, screen) {
    const p = state.player;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    // Cash + mission panel (top-left).
    g.fillStyle = PALETTE.hudBg;
    g.fillRect(16, 16, 320, 86);
    g.fillStyle = PALETTE.text;
    g.font = 'bold 26px ' + FONT;
    g.fillText(cached('cash', `$${state.cash.toLocaleString('en-US')}`), 28, 48);
    g.font = '15px ' + FONT;
    g.fillStyle = PALETTE.muted;
    const missionText = state.mission
      ? cached('mission', `M${state.mission.def.id} ${state.mission.def.name} — ${state.mission.stage?.text || ''}`)
      : state.storyDone
        ? 'Story complete — free roam'
        : cached('mission', 'No mission — press M for the next job');
    g.fillText(missionText, 28, 72);
    if (state.mission?.timer > 0) {
      const t = Math.ceil(state.mission.timer);
      g.fillStyle = t < 20 ? PALETTE.danger : PALETTE.text;
      g.font = 'bold 20px ' + FONT;
      g.fillText(cached('timer', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`), 28, 94);
    }
    // Wanted stars (top-centre).
    const cx = VIEW.width / 2;
    for (let i = 0; i < 5; i += 1) {
      g.fillStyle = i < state.wanted ? '#ffd23f' : 'rgba(255,255,255,0.25)';
      g.font = '28px ' + FONT;
      g.textAlign = 'center';
      g.fillText('★', cx - 56 + i * 28, 48);
    }
    g.textAlign = 'left';
    // HP / ammo / speed (bottom-left).
    g.fillStyle = PALETTE.hudBg;
    g.fillRect(16, VIEW.height - 64, 260, 48);
    g.fillStyle = '#ff5a4d';
    g.fillRect(28, VIEW.height - 46, 120 * Math.max(0, p.hp / 100), 12);
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.strokeRect(28, VIEW.height - 46, 120, 12);
    g.fillStyle = PALETTE.text;
    g.font = '15px ' + FONT;
    g.fillText(cached('hp', `HP ${Math.ceil(p.hp)}`), 156, VIEW.height - 34);
    g.fillText(cached('ammo', `Ammo ${p.ammo}`), 28, VIEW.height - 22);
    if (p.inCar) {
      const car = state.cars.find((c) => c.id === p.carId);
      const speed = car ? Math.abs(Math.round(car.speed * 0.12)) : 0;
      g.fillText(cached('speed', `${speed} mph`), 150, VIEW.height - 22);
    }
    // Controls hint (bottom-right).
    g.fillStyle = PALETTE.muted;
    g.font = '13px ' + FONT;
    g.textAlign = 'right';
    g.fillText('WASD drive/move · E car · Click shoot · M mission · T taxi · C checkpoint · R retry', VIEW.width - 16, VIEW.height - 16);
    g.textAlign = 'left';
    // Toast (below the mission panel, so it never covers it).
    if (state.toastTimer > 0 && state.toast) {
      g.fillStyle = PALETTE.hudBg;
      const tw = g.measureText(state.toast).width + 28;
      g.fillRect((VIEW.width - tw) / 2, 112, tw, 34);
      g.fillStyle = PALETTE.text;
      g.font = '16px ' + FONT;
      g.textAlign = 'center';
      g.fillText(state.toast, VIEW.width / 2, 135);
      g.textAlign = 'left';
    }
    // Banner.
    if (state.bannerTimer > 0 && state.banner) {
      g.fillStyle = 'rgba(20,12,28,0.8)';
      g.fillRect(0, VIEW.height / 2 - 90, VIEW.width, 64);
      g.fillStyle = PALETTE.accent;
      g.font = 'bold 34px ' + FONT;
      g.textAlign = 'center';
      g.fillText(state.banner, VIEW.width / 2, VIEW.height / 2 - 48);
      g.textAlign = 'left';
    }
    // ECO badge.
    if (state.eco) {
      g.fillStyle = PALETTE.good;
      g.font = 'bold 14px ' + FONT;
      g.fillText('ECO', VIEW.width - 60, 200);
    }
    drawMinimap(g, state);
  }

  function drawTitle(g, state, bestCash) {
    // Sunset backdrop + skyline silhouette.
    g.drawImage(skyGrad, 0, 0);
    g.fillStyle = '#1d1430';
    const skyline = [120, 200, 150, 260, 180, 230, 300, 170, 240, 200, 280, 150, 190, 230, 160];
    let x = 0;
    for (const h of skyline) {
      g.fillRect(x, VIEW.height - 180 - h, 88, h + 180);
      x += 88;
    }
    g.fillStyle = '#ffd98a';
    for (let i = 0; i < 40; i += 1) {
      const wx = (i * 173) % VIEW.width;
      const wy = VIEW.height - 180 - ((i * 97) % 180);
      if ((i * 7) % 3 !== 0) g.fillRect(wx, wy, 5, 7);
    }
    // Sun.
    g.fillStyle = '#ffcf7a';
    g.beginPath();
    g.arc(VIEW.width - 220, 170, 64, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,180,90,0.35)';
    g.beginPath();
    g.arc(VIEW.width - 220, 170, 96, 0, Math.PI * 2);
    g.fill();
    // Title.
    g.textAlign = 'center';
    g.fillStyle = '#fff3e0';
    g.font = 'bold 92px ' + FONT;
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 18;
    g.fillText('SOLMAR BAY', VIEW.width / 2, 250);
    g.shadowBlur = 0;
    g.fillStyle = '#ffb347';
    g.font = 'bold 26px ' + FONT;
    g.fillText('An open-world crime story in the sunset city', VIEW.width / 2, 300);
    g.fillStyle = '#fff3e0';
    g.font = '20px ' + FONT;
    g.fillText('Jax Marlowe needs one last score. Eight missions. One sunset. No mercy.', VIEW.width / 2, 340);
    const blink = Math.floor(state.time * 2) % 2 === 0;
    if (blink) {
      g.fillStyle = '#ffd23f';
      g.font = 'bold 26px ' + FONT;
      g.fillText('Press ENTER or click to start — Mission 1: First Fare', VIEW.width / 2, 430);
    }
    g.font = '16px ' + FONT;
    g.fillStyle = '#d8b49a';
    g.fillText('WASD drive / move · E enter car · Click shoot · M mission · T taxi · C checkpoint · R retry', VIEW.width / 2, 480);
    g.fillText('8 missions · traffic & police · wanted system · taxis & hidden packages · autosave checkpoints', VIEW.width / 2, 510);
    if (bestCash > 0) {
      g.fillStyle = '#7ee787';
      g.fillText(`Best haul so far: $${bestCash.toLocaleString('en-US')}`, VIEW.width / 2, 550);
    }
    g.textAlign = 'left';
  }

  function drawPaused(g) {
    g.fillStyle = 'rgba(20,12,28,0.72)';
    g.fillRect(0, 0, VIEW.width, VIEW.height);
    g.fillStyle = PALETTE.text;
    g.font = 'bold 48px ' + FONT;
    g.textAlign = 'center';
    g.fillText('PAUSED', VIEW.width / 2, VIEW.height / 2);
    g.font = '20px ' + FONT;
    g.fillText('Press P or Esc to keep driving', VIEW.width / 2, VIEW.height / 2 + 40);
    g.textAlign = 'left';
  }

  return {
    resize,
    draw(state, screen, bestCash, camOverride) {
      resize();
      const g = ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      if (screen === SCREEN_TITLE) {
        drawTitle(g, state, bestCash);
        return { scale, offsetX, offsetY };
      }
      // Camera follows the player, clamped to the world.
      const p = state.player;
      const camX = camOverride ? camOverride.x : clamp(p.x - VIEW.width / 2, 0, WORLD.width - VIEW.width);
      const camY = camOverride ? camOverride.y : clamp(p.y - VIEW.height / 2, 0, WORLD.height - VIEW.height);
      const viewW = VIEW.width;
      const viewH = VIEW.height;
      g.save();
      // Sunset wash over the whole world.
      g.translate(-camX, -camY);
      drawWorld(g, state, camX, camY, viewW, viewH);
      g.restore();
      // Warm sunset tint + vignette on top.
      g.fillStyle = 'rgba(255,140,60,0.07)';
      g.fillRect(0, 0, VIEW.width, VIEW.height);
      g.drawImage(vignette, 0, 0);
      if (screen === SCREEN_PAUSED) drawPaused(g);
      else drawHud(g, state, screen);
      return { scale, offsetX, offsetY, camX, camY };
    },
    // Convert a canvas pixel into world coordinates (for mouse aim).
    screenToWorld(clientX, clientY, camX, camY) {
      const rect = canvas.getBoundingClientRect();
      const px = (clientX - rect.left) * (canvas.width / rect.width);
      const py = (clientY - rect.top) * (canvas.height / rect.height);
      return {
        x: (px - offsetX) / scale + camX,
        y: (py - offsetY) / scale + camY,
      };
    },
    get viewScale() {
      return { scale, offsetX, offsetY };
    },
  };
}
