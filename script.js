// script.js — Core ZenNoise functionality (commit 2)
// ES6+; creates three ambient layers using Web Audio API and binds UI controls

let audioCtx = null;
let nodes = {};

const qs = sel => document.querySelector(sel);
const $ = (id) => qs(`#${id}`);

// UI elements
const playBtn = $('playBtn');
const stopBtn = $('stopBtn');
const randomBtn = $('randomBtn');
const statusEl = $('status');

const rainVolEl = $('rainVol');
const rainDampEl = $('rainDamp');
const windVolEl = $('windVol');
const windRateEl = $('windRate');
const padVolEl = $('padVol');
const padFreqEl = $('padFreq');

const presetNameEl = $('presetName');
const savePresetBtn = $('savePreset');
const loadListEl = $('loadList');
const loadPresetBtn = $('loadPreset');
const deletePresetBtn = $('deletePreset');

// helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a,b) => (Math.random() * (b - a)) + a;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

// create white noise buffer
function createWhiteNoiseBuffer() {
  const sampleRate = audioCtx.sampleRate;
  const length = sampleRate * 2; // 2 seconds
  const buffer = audioCtx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Layer: Rain (looped white noise through lowpass)
function makeRain() {
  const noiseBuffer = createWhiteNoiseBuffer();
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = parseFloat(rainDampEl.value);

  const gain = audioCtx.createGain();
  gain.gain.value = parseFloat(rainVolEl.value);

  src.connect(filter);
  filter.connect(gain);

  return { src, filter, gain };
}

// Layer: Wind (noise through bandpass + slow LFO on gain)
function makeWind() {
  const noiseBuffer = createWhiteNoiseBuffer();
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 400;
  bp.Q.value = 0.6;

  const gain = audioCtx.createGain();
  gain.gain.value = parseFloat(windVolEl.value);

  // LFO using oscillator to modulate gain
  const lfo = audioCtx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = parseFloat(windRateEl.value);
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 0.15; // modulation depth

  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);

  src.connect(bp);
  bp.connect(gain);

  return { src, bp, gain, lfo, lfoGain };
}

// Layer: Pad (slow sine oscillator with gentle attack/release)
function makePad() {
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = parseFloat(padFreqEl.value);

  const amp = audioCtx.createGain();
  amp.gain.value = 0; // start silent

  // slow ADSR-ish envelope on start/stop managed by play/stop
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200;

  osc.connect(filter);
  filter.connect(amp);

  return { osc, filter, amp };
}

// connect layers to master
function connectAll(layers) {
  const master = audioCtx.createGain();
  master.gain.value = 0.9;
  master.connect(audioCtx.destination);

  // attach each layer's output to master
  if (layers.rain) layers.rain.gain.connect(master);
  if (layers.wind) layers.wind.gain.connect(master);
  if (layers.pad) layers.pad.amp.connect(master);

  nodes.master = master;
}

// start audio
function start() {
  ensureAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  // build layers
  const rain = makeRain();
  const wind = makeWind();
  const pad = makePad();

  // start sources
  rain.src.start();
  wind.src.start();
  wind.lfo.start();
  pad.osc.start();

  // apply initial ramp for pad gain
  const now = audioCtx.currentTime;
  pad.amp.gain.cancelScheduledValues(now);
  pad.amp.gain.setValueAtTime(0, now);
  pad.amp.gain.linearRampToValueAtTime(parseFloat(padVolEl.value), now + 2.0);

  nodes.rain = rain;
  nodes.wind = wind;
  nodes.pad = pad;

  connectAll(nodes);

  statusEl.textContent = 'Playing';
}

// stop audio
function stop() {
  if (!audioCtx || !nodes.rain) return;

  const now = audioCtx.currentTime;
  // ramp pad down gently
  nodes.pad.amp.gain.cancelScheduledValues(now);
  nodes.pad.amp.gain.setValueAtTime(nodes.pad.amp.gain.value, now);
  nodes.pad.amp.gain.linearRampToValueAtTime(0, now + 1.2);

  // stop sources after short fade
  setTimeout(() => {
    try {
      nodes.rain.src.stop();
      nodes.wind.src.stop();
      nodes.wind.lfo.stop();
      nodes.pad.osc.stop();
    } catch (e) {
      // already stopped
    }
    nodes = {};
    statusEl.textContent = 'Stopped';
  }, 1400);
}

// update functions reacting to UI
function updateRain() {
  if (nodes.rain) nodes.rain.gain.gain.setTargetAtTime(parseFloat(rainVolEl.value), audioCtx.currentTime, 0.05);
  if (nodes.rain) nodes.rain.filter.frequency.setTargetAtTime(parseFloat(rainDampEl.value), audioCtx.currentTime, 0.1);
}
function updateWind() {
  if (nodes.wind) nodes.wind.gain.gain.setTargetAtTime(parseFloat(windVolEl.value), audioCtx.currentTime, 0.08);
  if (nodes.wind) nodes.wind.lfo.frequency.setValueAtTime(parseFloat(windRateEl.value), audioCtx.currentTime);
}
function updatePad() {
  if (nodes.pad) nodes.pad.amp.gain.setTargetAtTime(parseFloat(padVolEl.value), audioCtx.currentTime, 0.2);
  if (nodes.pad) nodes.pad.osc.frequency.setTargetAtTime(parseFloat(padFreqEl.value), audioCtx.currentTime, 0.2);
}

// wire UI
playBtn.addEventListener('click', () => {
  if (!audioCtx) start();
  else if (audioCtx.state === 'suspended') audioCtx.resume().then(() => start());
  else if (!nodes.rain) start();
});
stopBtn.addEventListener('click', () => stop());
randomBtn.addEventListener('click', () => {
  rainVolEl.value = (Math.random() * 0.7 + 0.15).toFixed(2);
  rainDampEl.value = Math.floor(rand(400, 3000));
  windVolEl.value = (Math.random() * 0.6 + 0.05).toFixed(2);
  windRateEl.value = (Math.random() * 1.5 + 0.05).toFixed(2);
  padVolEl.value = (Math.random() * 0.6 + 0.05).toFixed(2);
  padFreqEl.value = Math.floor(rand(80, 440));

  updateRain(); updateWind(); updatePad();
});

// sliders
[rainVolEl, rainDampEl, windVolEl, windRateEl, padVolEl, padFreqEl].forEach(el => {
  el.addEventListener('input', () => {
    updateRain(); updateWind(); updatePad();
  });
});

// Preset UI events will be wired in later commits (persistence)
