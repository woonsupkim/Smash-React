// Synthesized intro sound effects (Web Audio API) — no audio files needed.
//
// Note: browsers block audio until the user has interacted with the page at
// least once, so on a completely fresh page load the sounds may stay silent
// (the AudioContext starts suspended and resume() is rejected). Every visit
// to Home after any click/keypress anywhere in the app plays them normally.

let ctx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function noiseBuffer(ac, seconds) {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * seconds), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// Air-cutting swoosh: white noise through a bandpass filter whose center
// frequency sweeps up then settles, with a fade-in/out gain envelope.
export function playSwoosh() {
  try {
    const ac = getCtx();
    if (!ac || ac.state !== 'running') return;
    const t = ac.currentTime;

    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, 0.6);

    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(3800, t + 0.28);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.55);

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);

    src.connect(bp).connect(gain).connect(ac.destination);
    src.start(t);
    src.stop(t + 0.6);
  } catch (_) { /* audio unavailable — stay silent */ }
}

// Racket smack: a sharp high-frequency noise crack plus a low "thump"
// oscillator that pitch-drops, both with fast decays.
export function playSmack() {
  try {
    const ac = getCtx();
    if (!ac || ac.state !== 'running') return;
    const t = ac.currentTime;

    // crack
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, 0.12);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const crackGain = ac.createGain();
    crackGain.gain.setValueAtTime(0.5, t);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(hp).connect(crackGain).connect(ac.destination);
    src.start(t);
    src.stop(t + 0.12);

    // thump
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    const thumpGain = ac.createGain();
    thumpGain.gain.setValueAtTime(0.45, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(thumpGain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  } catch (_) { /* audio unavailable — stay silent */ }
}
