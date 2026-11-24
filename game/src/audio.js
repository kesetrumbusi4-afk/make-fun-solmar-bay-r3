// WebAudio synth: no audio files, everything is generated. Music is a small
// sunset bassline + hats sequenced on a lookahead timer; SFX are short
// oscillator/noise bursts. All calls are safe before the first user gesture.
export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let engineOsc = null;
  let engineGain = null;
  let muted = false;
  let musicTimer = null;
  let step = 0;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.16;
      musicGain.connect(master);
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineGain.connect(master);
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      engineOsc.connect(lp);
      lp.connect(engineGain);
      engineOsc.start();
      return true;
    } catch {
      return false;
    }
  }

  function resume() {
    if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function noiseBurst(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
  }

  function tone(freq, duration, type, gainValue, slideTo) {
    if (!ensure()) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  // Am — F — C — G roots, one bar each, with a hat tick on every eighth.
  const BASSLINE = [55, 43.65, 65.41, 49];
  function scheduleMusic() {
    if (!ctx || muted) return;
    const bar = Math.floor(step / 8) % 4;
    const eighth = step % 8;
    const root = BASSLINE[bar];
    if (eighth === 0 || eighth === 3 || eighth === 6) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = root * (eighth === 0 ? 1 : 1.5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.connect(gain);
      gain.connect(musicGain);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    }
    if (eighth % 2 === 1) noiseBurst(0.03, 8000, 0.05, 'highpass');
    step += 1;
  }

  return {
    resume,
    unlock() {
      resume();
      if (ctx && !musicTimer) musicTimer = window.setInterval(scheduleMusic, 170);
    },
    setEngine(on, speedRatio) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      engineGain.gain.setTargetAtTime(on ? 0.05 + speedRatio * 0.05 : 0, t, 0.1);
      engineOsc.frequency.setTargetAtTime(50 + speedRatio * 110, t, 0.08);
    },
    shoot() {
      noiseBurst(0.12, 1800, 0.5);
      tone(180, 0.1, 'square', 0.25, 60);
    },
    explosion() {
      noiseBurst(0.6, 400, 0.8);
      tone(90, 0.5, 'sine', 0.6, 30);
    },
    pickup() {
      tone(660, 0.12, 'sine', 0.3);
      window.setTimeout(() => tone(990, 0.18, 'sine', 0.3), 90);
    },
    cash() {
      tone(880, 0.1, 'triangle', 0.3);
      window.setTimeout(() => tone(1174, 0.1, 'triangle', 0.3), 80);
      window.setTimeout(() => tone(1568, 0.16, 'triangle', 0.3), 160);
    },
    missionComplete() {
      [523, 659, 784, 1046].forEach((f, i) => window.setTimeout(() => tone(f, 0.25, 'triangle', 0.35), i * 110));
    },
    fail() {
      tone(220, 0.4, 'sawtooth', 0.25, 110);
    },
    crash() {
      noiseBurst(0.25, 900, 0.5);
    },
    siren() {
      tone(700, 0.35, 'sine', 0.08, 950);
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    get muted() {
      return muted;
    },
  };
}
