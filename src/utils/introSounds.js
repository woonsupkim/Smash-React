// Synthesized intro sound effects (Web Audio API) - no audio files needed.
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
  } catch (_) { /* audio unavailable - stay silent */ }
}

// Serve impact: the airy "puck" of a big first serve (or a billiard ball
// click with body) - a dull broadband thud, no ringing tones. Built from a
// very short noise burst rolled off above ~1 kHz plus a fast low thump.
export function playSmack() {
  try {
    const ac = getCtx();
    if (!ac || ac.state !== 'running') return;
    const t = ac.currentTime;

    // Original crack + thump: a sharp high-frequency noise crack plus a
    // low sine thump that pitch-drops, both with fast decays.
    const crack = ac.createBufferSource();
    crack.buffer = noiseBuffer(ac, 0.12);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const crackGain = ac.createGain();
    crackGain.gain.setValueAtTime(0.5, t);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    crack.connect(hp).connect(crackGain).connect(ac.destination);
    crack.start(t);
    crack.stop(t + 0.12);

    const thump = ac.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(190, t);
    thump.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    const thumpGain = ac.createGain();
    thumpGain.gain.setValueAtTime(0.45, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    thump.connect(thumpGain).connect(ac.destination);
    thump.start(t);
    thump.stop(t + 0.15);
  } catch (_) { /* audio unavailable - stay silent */ }
}

// Ball-in-flight whoosh: the soft airy rush of a served ball crossing the
// court - breathier and less "cutting" than the intro swoosh: gently
// lowpassed noise that starts bright and fades away as it travels.
export function playServeWhoosh() {
  try {
    const ac = getCtx();
    if (!ac || ac.state !== 'running') return;
    const t = ac.currentTime;

    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, 0.7);

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.6);

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);

    src.connect(lp).connect(gain).connect(ac.destination);
    src.start(t);
    src.stop(t + 0.7);
  } catch (_) { /* audio unavailable - stay silent */ }
}
