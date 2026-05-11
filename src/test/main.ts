// Offline pitch-detection test bench. Loads a recording, runs the same
// algorithm as the live PitchTracker, and renders detected notes against the
// waveform so we can see what the algorithm sees.

import { analyze, analyzeRaw, envelope, type DetectedNote, type RawTick, type AnalyzeOptions } from "./analyze";
import { verify, referenceExpected, type VerifyResult } from "./verify";

const RECORDING_URL = "/samples/outrun-axe-session-2026-05-11-14-21-53.webm";

const els = {
  status: document.getElementById("status")!,
  canvas: document.getElementById("waveform") as HTMLCanvasElement,
  list: document.getElementById("notelist")!,
  count: document.getElementById("count")!,
  bpm: document.getElementById("bpm") as HTMLInputElement,
  fft: document.getElementById("fft") as HTMLSelectElement,
  yin: document.getElementById("yin") as HTMLInputElement,
  step: document.getElementById("step") as HTMLInputElement,
  algo: document.getElementById("algo") as HTMLSelectElement,
  rerun: document.getElementById("rerun") as HTMLButtonElement,
  play: document.getElementById("play") as HTMLButtonElement,
  verdict: document.getElementById("verdict")!,
};

let decoded: AudioBuffer | null = null;
let detections: DetectedNote[] = [];
let raw: RawTick[] = [];
let audioElem: HTMLAudioElement | null = null;

// Expose to window for ad-hoc inspection via preview_eval.
declare global {
  interface Window {
    __pitchTest: {
      decoded: AudioBuffer | null;
      detections: DetectedNote[];
      raw: RawTick[];
    };
  }
}

async function loadRecording() {
  els.status.textContent = "loading...";
  const ctx = new AudioContext();
  const resp = await fetch(RECORDING_URL);
  const arr = await resp.arrayBuffer();
  decoded = await ctx.decodeAudioData(arr);
  await ctx.close();

  // Diagnose per-channel signal so a "silent channel 0" recording doesn't
  // produce 0 detections silently.
  const peaks: number[] = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const data = decoded.getChannelData(c);
    let max = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }

  els.status.textContent =
    `loaded · ${decoded.duration.toFixed(2)}s · ${decoded.sampleRate}Hz · ${decoded.numberOfChannels}ch · peaks=[${peaks.map(p => p.toFixed(3)).join(", ")}]`;

  audioElem = new Audio(RECORDING_URL);
  audioElem.preload = "auto";

  rerun();
}

/** Build a beat-proximity provider for offline analysis. */
function makeBeatProximity(bpm: number, playStartSec: number) {
  const beatDur = 60 / bpm;
  const subs = [beatDur, beatDur / 2, beatDur / 3];
  const WINDOW = 0.05;
  return (t: number) => {
    const into = t - playStartSec;
    if (into < 0) return 0;
    let min = Infinity;
    for (const sub of subs) {
      const closest = Math.round(into / sub) * sub;
      const d = Math.abs(into - closest);
      if (d < min) min = d;
    }
    return min >= WINDOW ? 0 : 1 - min / WINDOW;
  };
}

/** Mix every channel down to a single mono Float32Array. */
function getMonoSamples(buf: AudioBuffer): Float32Array {
  const n = buf.length;
  const ch = buf.numberOfChannels;
  if (ch === 1) return buf.getChannelData(0);
  const out = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  for (let i = 0; i < n; i++) out[i] /= ch;
  return out;
}

function rerun() {
  if (!decoded) return;
  const samples = getMonoSamples(decoded);
  const bpm = parseFloat(els.bpm.value);

  const opts: AnalyzeOptions = {
    fftSize: parseInt(els.fft.value, 10),
    yinThreshold: parseFloat(els.yin.value),
    tickStep: parseInt(els.step.value, 10),
    inputLatencyHint: 0,
    algorithm: els.algo.value as any,
    // The live game's recording feature starts capturing from the count-in,
    // so play begins after one 4-beat measure. Compute proximity to nearest
    // quarter / eighth / triplet position from there.
    beatProximityProvider: makeBeatProximity(bpm, (60 / bpm) * 4),
  };

  const t0 = performance.now();
  detections = analyze(samples, decoded.sampleRate, opts);
  raw = analyzeRaw(samples, decoded.sampleRate, opts);
  const dt = performance.now() - t0;

  window.__pitchTest = { decoded, detections, raw };

  els.count.textContent =
    `${detections.length} notes detected · ${raw.length} raw ticks · analyzed in ${dt.toFixed(0)}ms`;
  renderList();
  renderCanvas();
  renderVerdict();
}

function renderVerdict() {
  if (!decoded) return;
  const expected = referenceExpected();
  const result: VerifyResult = verify(detections, expected, {
    recordingDurationSec: decoded.duration,
  });
  (window as any).__pitchTest.verifyResult = result;

  const header = result.passed
    ? `<span class="pass">PASS</span>  ${result.matches}/${result.expectedCount} notes correct, no extras, no sustain gaps.`
    : `<span class="fail">FAIL</span>  matched ${result.matches}/${result.expectedCount}  ·  pitch mismatches ${result.pitchMismatches}  ·  missing ${result.missing}  ·  extras ${result.extras}  ·  sustain gaps ${result.sustainGaps}`;

  const detailLines = result.details.slice(0, 15).join("\n");
  const truncated = result.details.length > 15
    ? `\n... (${result.details.length - 15} more)`
    : "";

  els.verdict.innerHTML = header + (detailLines ? `\n\n${detailLines}${truncated}` : "");
}

function renderList() {
  if (!decoded) return;
  els.list.innerHTML = "";
  const bpm = parseFloat(els.bpm.value);
  const beatSec = 60 / bpm;
  const eighthSec = beatSec / 2;

  for (const n of detections) {
    const div = document.createElement("div");
    div.className = "note";
    const eighthIdx = Math.round(n.time / eighthSec);
    const grid = (eighthIdx * eighthSec).toFixed(3);
    const drift = ((n.time - eighthIdx * eighthSec) * 1000).toFixed(0);
    div.textContent =
      `${n.time.toFixed(3)}s   ${n.name.padEnd(4)}   ${n.freq.toFixed(1).padStart(6)}Hz   ` +
      `[${n.source}]   nearest grid ${grid}s (${drift}ms)`;
    els.list.appendChild(div);
  }
}

function renderCanvas() {
  if (!decoded) return;
  const canvas = els.canvas;
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width = canvas.clientWidth;
  const H = canvas.height = canvas.clientHeight;

  ctx.fillStyle = "#0a0612";
  ctx.fillRect(0, 0, W, H);

  const samples = getMonoSamples(decoded);
  const dur = decoded.duration;
  const env = envelope(samples, Math.floor(samples.length / W));

  // Beat grid
  const bpm = parseFloat(els.bpm.value);
  const beatSec = 60 / bpm;
  const eighthSec = beatSec / 2;

  // Eighth-note grid (faint)
  ctx.strokeStyle = "#3a1f5e";
  ctx.lineWidth = 1;
  for (let t = 0; t < dur; t += eighthSec) {
    const x = (t / dur) * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  // Quarter-note grid (brighter)
  ctx.strokeStyle = "#6a3f9e";
  for (let t = 0; t < dur; t += beatSec) {
    const x = (t / dur) * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // Waveform envelope
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const midY = H * 0.45;
  const amp = H * 0.35;
  for (let x = 0; x < W; x++) {
    const v = env[x] || 0;
    if (x === 0) ctx.moveTo(x, midY - v * amp);
    else ctx.lineTo(x, midY - v * amp);
  }
  ctx.stroke();
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    const v = env[x] || 0;
    if (x === 0) ctx.moveTo(x, midY + v * amp);
    else ctx.lineTo(x, midY + v * amp);
  }
  ctx.stroke();

  // Render notes the way PlayScene does: each [onset] starts a new note (dot
  // + extending line); subsequent [fallback] readings of the same pitch
  // extend the active line. A pitch change or 200ms gap finalizes it.
  type Active = { midi: number; startX: number; endX: number; y: number; hue: number };
  let active: Active | null = null;
  const finalizeActive = () => {
    if (!active) return;
    ctx.strokeStyle = `hsla(${active.hue}, 80%, 60%, 0.7)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(active.startX, active.y);
    ctx.lineTo(active.endX, active.y);
    ctx.stroke();
    ctx.fillStyle = `hsl(${active.hue}, 80%, 60%)`;
    ctx.beginPath();
    ctx.arc(active.startX, active.y, 5, 0, Math.PI * 2);
    ctx.fill();
    active = null;
  };

  for (const n of detections) {
    const x = (n.time / dur) * W;
    const hue = ((n.midi % 12) * 30) % 360;
    const y = H * 0.85 - (n.midi - 40) * 4;
    const isOnset = n.source === "onset";
    const sameAsActive = active && active.midi === n.midi && !isOnset;
    if (sameAsActive && active) {
      active.endX = x;
    } else {
      finalizeActive();
      active = { midi: n.midi, startX: x, endX: x, y, hue };
    }
  }
  finalizeActive();

  // Note labels — one per onset only, so the canvas isn't a wall of text.
  ctx.fillStyle = "#fff";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  for (const n of detections) {
    if (n.source !== "onset") continue;
    const x = (n.time / dur) * W;
    const y = H * 0.85 - (n.midi - 40) * 4;
    ctx.fillText(n.name, x, y - 9);
  }

  // Time axis labels
  ctx.fillStyle = "#888";
  ctx.font = "11px monospace";
  ctx.textAlign = "left";
  for (let s = 0; s <= dur; s++) {
    const x = (s / dur) * W;
    ctx.fillText(`${s}s`, x + 2, H - 4);
  }
}

els.rerun.addEventListener("click", rerun);
els.play.addEventListener("click", () => {
  if (!audioElem) return;
  audioElem.currentTime = 0;
  audioElem.play();
});

loadRecording().catch((err) => {
  els.status.textContent = `failed: ${err.message}`;
});
