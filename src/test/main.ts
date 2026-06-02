// Offline pitch-detection test bench. Picks a source (recording file or
// synth signal), runs the same algorithm as the live PitchTracker, and
// renders detected notes against the waveform with a PASS/FAIL verdict.

import { analyze, analyzeRaw, envelope, type DetectedNote, type RawTick, type AnalyzeOptions } from "./analyze";
import { verify, verifySynth, referenceExpected, type VerifyResult } from "./verify";
import {
  SYNTH_SIGNALS,
  monophonic16thsAt140,
  bend200,
  hammerOn,
  pullOff,
  type SynthSignal,
} from "./synthesise";
import {
  FIXTURE_IDS,
  loadFixture,
  loadAudio,
  verifyFixture,
  type FixtureSpec,
  type FixtureResult,
} from "./fixtures/fixtures";
import { BEAT_PROXIMITY_WINDOW, BEAT_PROXIMITY_SUBS_OF_BEAT } from "../audio/Conductor";
import { countBars, type BarCountResult } from "./barCount";

interface Source {
  id: string;
  label: string;
  bpm: number;
  /** Resolves to mono audio + meta. */
  load: () => Promise<LoadedSource> | LoadedSource;
}

interface LoadedSource {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
  numberOfChannels: number;
  peaks: number[];
  /** When the player's first note begins (after count-in if applicable). */
  playStartSec: number;
  /** Synth-generated signals carry their own expected events. */
  signal?: SynthSignal;
  /** Real-recording fixtures carry a JSON-described expected event list. */
  fixtureSpec?: FixtureSpec;
  /** Recording sources keep an audio element for playback. */
  audioElem?: HTMLAudioElement;
}

const RECORDING_URL = new URLSearchParams(location.search).get("recording")
  ?? "/samples/outrun-axe-session-2026-05-11-14-21-53.webm";

const SOURCES: Source[] = [
  {
    id: "monophonic-reference",
    label: "Reference recording — 90 BPM 8ths, F#/C# alternating",
    bpm: 90,
    load: async () => loadRecording(RECORDING_URL),
  },
  {
    // Sample-audio regression for the held-note bar fix. 90 BPM quarter/eighth
    // notes — each held note must register as ONE bar, not many tiny dots.
    // Run: open /pitch-test.html?source=notes-90bpm
    id: "notes-90bpm",
    label: "Sample — 0510 90 BPM quarter/eighth notes (bar-count regression)",
    bpm: 90,
    load: async () => loadRecording("/samples/0510_90bpmNotes.mp3"),
  },
  {
    id: "monophonic-16ths-140bpm",
    label: "Synth — 16ths at 140 BPM, F#/C# alternating",
    bpm: 140,
    load: () => loadSynth(monophonic16thsAt140()),
  },
  {
    id: "bend-200",
    label: "Synth — F#4 bent up to G#4 (200¢) and released",
    bpm: 90,
    load: () => loadSynth(bend200()),
  },
  {
    id: "hammer-on",
    label: "Synth — F#4 plucked, hammer-on to A4",
    bpm: 90,
    load: () => loadSynth(hammerOn()),
  },
  {
    id: "pull-off",
    label: "Synth — A4 plucked, pull-off to F#4",
    bpm: 90,
    load: () => loadSynth(pullOff()),
  },
  ...FIXTURE_IDS.map((id) => ({
    id,
    label: `Fixture — ${id}`,
    bpm: 120,
    load: async (): Promise<LoadedSource> => {
      const { audio, spec } = await loadFixture(id);
      const audioElem = new Audio(`/samples/${id}.webm`);
      audioElem.preload = "auto";
      let max = 0;
      for (let i = 0; i < audio.samples.length; i++) {
        const v = Math.abs(audio.samples[i]);
        if (v > max) max = v;
      }
      // Earliest expected event time as the play-start hint.
      const firstT =
        spec.expected.length > 0
          ? Math.min(...spec.expected.map((e) => e.tSec))
          : 0;
      return {
        samples: audio.samples,
        sampleRate: audio.sampleRate,
        duration: audio.duration,
        numberOfChannels: 1,
        peaks: [max],
        playStartSec: firstT,
        fixtureSpec: spec,
        audioElem,
      };
    },
  })),
];

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
  source: document.getElementById("source") as HTMLSelectElement | null,
  rerun: document.getElementById("rerun") as HTMLButtonElement,
  play: document.getElementById("play") as HTMLButtonElement,
  verdict: document.getElementById("verdict")!,
};

// Populate source dropdown if present.
if (els.source) {
  els.source.innerHTML = "";
  for (const s of SOURCES) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label;
    els.source.appendChild(opt);
  }
  // Apply ?source=... if set.
  const initial = new URLSearchParams(location.search).get("source");
  if (initial && SOURCES.some((s) => s.id === initial)) els.source.value = initial;
}

let currentSource: Source = SOURCES.find((s) => s.id === (els.source?.value ?? "")) ?? SOURCES[0];
let loaded: LoadedSource | null = null;
let detections: DetectedNote[] = [];
let raw: RawTick[] = [];

declare global {
  interface Window {
    __pitchTest: {
      loaded: LoadedSource | null;
      detections: DetectedNote[];
      raw: RawTick[];
      verifyResult?: VerifyResult;
      /** Bar-count regression result (only set for the notes-90bpm source). */
      barCount?: BarCountResult;
    };
  }
}

async function loadRecording(url: string): Promise<LoadedSource> {
  const audio = await loadAudio(url);
  const audioElem = new Audio(url);
  audioElem.preload = "auto";
  let max = 0;
  for (let i = 0; i < audio.samples.length; i++) {
    const v = Math.abs(audio.samples[i]);
    if (v > max) max = v;
  }
  return {
    samples: audio.samples,
    sampleRate: audio.sampleRate,
    duration: audio.duration,
    numberOfChannels: 1,
    peaks: [max],
    playStartSec: (60 / 90) * 4,
    audioElem,
  };
}

function loadSynth(signal: SynthSignal): LoadedSource {
  let max = 0;
  for (let i = 0; i < signal.audio.length; i++) {
    const v = Math.abs(signal.audio[i]);
    if (v > max) max = v;
  }
  return {
    samples: signal.audio,
    sampleRate: signal.sampleRate,
    duration: signal.audio.length / signal.sampleRate,
    numberOfChannels: 1,
    peaks: [max],
    playStartSec: signal.playStartSec,
    signal,
  };
}

function makeBeatProximity(bpm: number, playStartSec: number) {
  const beatDur = 60 / bpm;
  return (t: number) => {
    const into = t - playStartSec;
    if (into < 0) return 0;
    let min = Infinity;
    for (const frac of BEAT_PROXIMITY_SUBS_OF_BEAT) {
      const sub = frac * beatDur;
      const closest = Math.round(into / sub) * sub;
      const d = Math.abs(into - closest);
      if (d < min) min = d;
    }
    return min >= BEAT_PROXIMITY_WINDOW ? 0 : 1 - min / BEAT_PROXIMITY_WINDOW;
  };
}

async function loadSelectedSource() {
  els.status.textContent = `loading ${currentSource.label}...`;
  loaded = await currentSource.load();
  els.status.textContent =
    `${currentSource.label} · ${loaded.duration.toFixed(2)}s · ${loaded.sampleRate}Hz · ${loaded.numberOfChannels}ch · peaks=[${loaded.peaks.map((p) => p.toFixed(3)).join(", ")}]`;
  // Sync BPM input.
  els.bpm.value = String(currentSource.bpm);
  rerun();
}

function rerun() {
  if (!loaded) return;
  const bpm = parseFloat(els.bpm.value);

  const opts: AnalyzeOptions = {
    fftSize: parseInt(els.fft.value, 10),
    yinThreshold: parseFloat(els.yin.value),
    tickStep: parseInt(els.step.value, 10),
    latencyBiasSec: 0,
    algorithm: els.algo.value as AnalyzeOptions["algorithm"],
    beatProximityProvider: makeBeatProximity(bpm, loaded.playStartSec),
  };

  const t0 = performance.now();
  detections = analyze(loaded.samples, loaded.sampleRate, opts);
  raw = analyzeRaw(loaded.samples, loaded.sampleRate, opts);
  const dt = performance.now() - t0;

  window.__pitchTest = { loaded, detections, raw };

  els.count.textContent =
    `${detections.length} notes detected · ${raw.length} raw ticks · analyzed in ${dt.toFixed(0)}ms`;
  renderList(bpm);
  renderCanvas(bpm);
  renderVerdict();
}

function renderVerdict() {
  if (!loaded) return;

  // Sample-audio bar-count regression. The held-note fix groups pitch
  // updates strictly by onsetId (hud/noteBars.ts), so feeding the detections
  // through the SAME BarAccumulator must yield one bar per detected onset —
  // NOT the ~3-5x inflated count the old time/pitch-proximity logic produced.
  // True note count: 90 BPM quarter/eighth notes over the audible play span
  // (after the 4-beat count-in), bounded between a quarter-note floor and an
  // eighth-note ceiling so the assertion is deterministic and clip-agnostic.
  if (currentSource.id === "notes-90bpm") {
    const beatDur = 60 / 90;
    const playSpan = Math.max(0, loaded.duration - loaded.playStartSec);
    // Use the eighth-note count as the nominal "true note count" target.
    const expectedNotes = Math.max(1, Math.round(playSpan / (beatDur / 2)));
    const bc = countBars(detections, expectedNotes);
    window.__pitchTest.barCount = bc;
    const header = bc.passed
      ? `<span class="pass">PASS</span>  ${bc.barCount} bars for ${bc.onsetCount} detected notes — no dot fragmentation.`
      : `<span class="fail">FAIL</span>  ${bc.barCount} bars vs ${bc.onsetCount} onsets / ~${bc.expectedNotes} expected notes — bars must not fragment.`;
    els.verdict.innerHTML = header + `\n\n${bc.details.join("\n")}`;
    return;
  }

  // Fixture sources have their own JSON spec.
  if (loaded.fixtureSpec) {
    const fr: FixtureResult = verifyFixture(detections, loaded.fixtureSpec);
    window.__pitchTest.verifyResult = {
      passed: fr.passed,
      expectedCount: fr.expectedCount,
      detectedNoteCount: fr.detectedOnsetCount,
      matches: fr.matches,
      pitchMismatches: fr.pitchMismatches,
      missing: fr.missing,
      extras: fr.extras,
      sustainGaps: 0,
      details: fr.details,
    };
    const header = fr.passed
      ? `<span class="pass">PASS</span>  ${fr.matches}/${fr.expectedCount} onsets correct, ${fr.extras} extras (tol ${loaded.fixtureSpec.tolerance.extras}).`
      : `<span class="fail">FAIL</span>  matched ${fr.matches}/${fr.expectedCount}  ·  pitch mismatches ${fr.pitchMismatches}  ·  missing ${fr.missing}  ·  extras ${fr.extras}`;
    const detailLines = fr.details.slice(0, 15).join("\n");
    const truncated = fr.details.length > 15 ? `\n... (${fr.details.length - 15} more)` : "";
    els.verdict.innerHTML = header + (detailLines ? `\n\n${detailLines}${truncated}` : "");
    return;
  }

  const result: VerifyResult = loaded.signal
    ? verifySynth(detections, loaded.signal)
    : verify(detections, referenceExpected(), {
        recordingDurationSec: loaded.duration,
      });
  window.__pitchTest.verifyResult = result;

  const header = result.passed
    ? `<span class="pass">PASS</span>  ${result.matches}/${result.expectedCount} notes correct, no extras${result.sustainGaps ? `, ${result.sustainGaps} sustain gaps` : ", no sustain gaps"}.`
    : `<span class="fail">FAIL</span>  matched ${result.matches}/${result.expectedCount}  ·  pitch mismatches ${result.pitchMismatches}  ·  missing ${result.missing}  ·  extras ${result.extras}  ·  sustain gaps ${result.sustainGaps}`;

  const detailLines = result.details.slice(0, 15).join("\n");
  const truncated = result.details.length > 15
    ? `\n... (${result.details.length - 15} more)`
    : "";

  els.verdict.innerHTML = header + (detailLines ? `\n\n${detailLines}${truncated}` : "");
}

function renderList(bpm: number) {
  if (!loaded) return;
  els.list.innerHTML = "";
  const eighthSec = 60 / bpm / 2;

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

function renderCanvas(bpm: number) {
  if (!loaded) return;
  const canvas = els.canvas;
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width = canvas.clientWidth;
  const H = canvas.height = canvas.clientHeight;

  ctx.fillStyle = "#0a0612";
  ctx.fillRect(0, 0, W, H);

  const dur = loaded.duration;
  const env = envelope(loaded.samples, Math.floor(loaded.samples.length / W));

  const beatSec = 60 / bpm;
  const eighthSec = beatSec / 2;

  ctx.strokeStyle = "#3a1f5e";
  ctx.lineWidth = 1;
  for (let t = 0; t < dur; t += eighthSec) {
    const x = (t / dur) * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.strokeStyle = "#6a3f9e";
  for (let t = 0; t < dur; t += beatSec) {
    const x = (t / dur) * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

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

  ctx.fillStyle = "#fff";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  for (const n of detections) {
    if (n.source !== "onset") continue;
    const x = (n.time / dur) * W;
    const y = H * 0.85 - (n.midi - 40) * 4;
    ctx.fillText(n.name, x, y - 9);
  }

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
  if (loaded?.audioElem) {
    loaded.audioElem.currentTime = 0;
    loaded.audioElem.play();
  }
});
els.source?.addEventListener("change", () => {
  const id = els.source!.value;
  const next = SOURCES.find((s) => s.id === id);
  if (next) {
    currentSource = next;
    loadSelectedSource().catch((err) => {
      els.status.textContent = `failed: ${err.message}`;
    });
  }
});

// Reference SYNTH_SIGNALS so unused-import linting doesn't complain when we
// switch to a slimmer source list later.
void SYNTH_SIGNALS;

loadSelectedSource().catch((err) => {
  els.status.textContent = `failed: ${err.message}`;
});
