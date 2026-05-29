import * as THREE from "three";
import { Conductor } from "../audio/Conductor";
import { BackingTrack } from "../audio/BackingTrack";
import { PitchTracker } from "../audio/PitchTracker";
import { getAudioContext } from "../audio/AudioContextSingleton";
import type { Game, GameState } from "../engine/Game";
import { KeyResolver } from "../music/KeyResolver";
import { PlayerAnchor } from "../world/PlayerAnchor";
import { RailRunner } from "../world/RailRunner";
import { buildEnvironment } from "../world/Environment";
import { EnemyDirector } from "../combat/EnemyDirector";
import type { Enemy } from "../combat/Enemy";
import { BulletSystem } from "../combat/BulletSystem";
import { PlayerStats } from "../combat/PlayerStats";
import { createOverlay, flashCombo, setHp, spawnDamagePopup, spawnKillLetter, type OverlayElements } from "../hud/Overlay";
import { Timeline } from "../hud/Timeline";
import { level1, type LevelConfig } from "../levels/level1";
import { ResultsState } from "./ResultsState";
import { LevelSelectState } from "./LevelSelectState";
import { Avatar } from "../world/Avatar";
import { loadLoadout } from "../state/Loadout";
import { ComboScorer, type MeasureComboResult } from "../music/ComboScorer";

const ENEMY_CONTACT_DAMAGE = 18;

function playKeyboardTone(midi: number, audioTime: number) {
  const ctx = getAudioContext();
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.value = freq;
  // Pluck envelope: sharp attack, exponential decay.
  gain.gain.setValueAtTime(0, audioTime);
  gain.gain.linearRampToValueAtTime(0.18, audioTime + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.35);
  // Highpass to thin it out so it doesn't clash with drums.
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 220;
  osc.connect(hp).connect(gain).connect(ctx.destination);
  osc.start(audioTime);
  osc.stop(audioTime + 0.4);
}

export class LevelState implements GameState {
  readonly name = "level";
  private game!: Game;
  private level: LevelConfig;
  private conductor!: Conductor;
  private backing!: BackingTrack;
  private tracker!: PitchTracker;
  private resolver!: KeyResolver;
  private rail!: RailRunner;
  private anchor!: PlayerAnchor;
  private director!: EnemyDirector;
  private bullets!: BulletSystem;
  private stats = new PlayerStats();
  private overlay!: OverlayElements;
  private timeline!: Timeline;
  private envGroups: THREE.Object3D[] = [];
  private avatar: Avatar | null = null;
  private charLights: THREE.Light[] = [];
  private comboScorer!: ComboScorer;
  private offPhase?: () => unknown;
  private offPitchFired?: () => unknown;
  private offKeysNarrowed?: () => unknown;
  private offCombo?: () => unknown;
  private autoFireIntervals: number[] = [];
  private hudParent: HTMLElement;
  private startedPlayPhase = false;
  private finishedAt = 0;
  private done = false;
  private measureDamageBuckets: Map<number, number> = new Map();
  // Latest measure combo multiplier (1 = no combo). Tracked so per-note audio
  // feedback can blend in the player's current scoring streak. Tweak the
  // normalization in `playNoteFeedback`.
  private lastComboMultiplier = 1;
  /** Cached white-noise buffer for the hit thud. Filled once on first hit so
   *  we don't allocate a fresh AudioBuffer per note. */
  private noiseBuffer: AudioBuffer | null = null;

  constructor(hudParent: HTMLElement, level: LevelConfig = level1) {
    this.hudParent = hudParent;
    this.level = level;
  }

  enter(game: Game) {
    this.game = game;
    const { worldScene, worldCamera } = game.renderer;
    worldScene.background = new THREE.Color(this.level.skyColor);
    worldScene.fog = new THREE.Fog(this.level.fogColor, this.level.fogNear, this.level.fogFar);

    this.envGroups = buildEnvironment(worldScene, this.level);

    this.anchor = new PlayerAnchor();
    worldScene.add(this.anchor);

    // True 3rd-person rail-shooter setup (Sin & Punishment style): the avatar
    // is a WORLD object on the rail and the camera chases behind+above it.
    // (Camera-parenting a skinned GLB caused frustum-cull + lighting bugs.)
    this.avatar = new Avatar(loadLoadout());
    this.avatar.scale.setScalar(1.0);
    worldScene.add(this.avatar);

    // Character key + rim lights travel with the avatar each frame so it
    // always reads against dark night scenes regardless of level lighting.
    const charKey = new THREE.SpotLight(0xfff0e0, 3.0, 14, Math.PI / 4, 0.55, 1.6);
    const charRim = new THREE.PointLight(0x6cf0ff, 1.4, 10, 2.0);
    const charFill = new THREE.PointLight(0xff7ac0, 1.0, 10, 2.0);
    charKey.target = this.avatar;
    worldScene.add(charKey, charKey.target, charRim, charFill);
    this.charLights = [charKey, charRim, charFill];

    worldScene.add(worldCamera);

    this.rail = new RailRunner({
      curve: this.level.curve,
      speed: this.level.bpm * 0.04,
      lookAhead: 0.015,
    });

    this.conductor = new Conductor();
    this.conductor.setBpm(this.level.bpm);
    this.backing = new BackingTrack({ levelName: this.level.name, conductor: this.conductor });
    this.backing.start();
    this.tracker = new PitchTracker();
    this.tracker.setBeatProximityProvider((t) => this.conductor.proximityToExpectedAttack(t));

    this.resolver = new KeyResolver(this.conductor, this.tracker);
    this.resolver.attach();

    this.comboScorer = new ComboScorer(this.conductor, this.resolver);
    this.comboScorer.attach();

    this.director = new EnemyDirector(
      worldScene,
      this.conductor,
      this.level,
      () => ({ pos: this.rail.position, forward: this.rail.forward }),
    );

    this.bullets = new BulletSystem(worldScene, () => {
      const p = this.rail.position.clone();
      p.add(this.rail.forward.clone().multiplyScalar(1.0));
      p.y -= 0.4;
      return p;
    });

    this.overlay = createOverlay(this.hudParent);
    this.timeline = new Timeline(this.hudParent, this.conductor);
    this.timeline.attach(this.tracker);
    setHp(this.overlay, this.stats.hp, this.stats.maxHp);
    this.overlay.status.textContent = "READY";
    this.overlay.keyInfo.textContent = "key: --";

    this.offPhase = this.conductor.onPhaseChange((p) => {
      if (p === "countIn") this.overlay.status.textContent = "COUNT IN";
      else if (p === "playing") {
        this.overlay.status.textContent = "PLAY";
        this.rail.setRunning(true);
        this.startedPlayPhase = true;
      } else if (p === "done") {
        this.overlay.status.textContent = "DONE";
        this.rail.setRunning(false);
        this.finishedAt = this.conductor.audioTime + 1.5;
      }
    });

    this.offPitchFired = this.resolver.bus.on("pitchFired", (ev) => {
      this.stats.notesFired++;
      // An enemy lives in a key. Every played note that fits that key fires
      // at it — so CDEF (all in C major) hits a key-of-C enemy four times,
      // and so does CCCC. Damage scales with `confidence` (how narrowed the
      // candidate key is), so chip damage early, full damage once locked.
      const targets = this.director.enemiesVulnerableTo(ev.pitchClass);
      const startingAlive = targets.length;
      const { applied, rootHit } = this.bullets.fire(
        targets,
        ev.pitchClass,
        ev.confidence,
        ev.audioTime,
      );
      this.stats.totalDamage += applied;
      // Bucket damage by measure for retroactive combo burst.
      const m = ev.measureIdx;
      this.measureDamageBuckets.set(m, (this.measureDamageBuckets.get(m) ?? 0) + applied);
      const killed = targets.filter((t) => !t.alive).length;
      this.stats.kills += killed;
      const enemyColor = targets[0]
        ? `#${(targets[0].mesh.material as THREE.MeshToonMaterial).color.getHexString()}`
        : "#ff2bd6";
      if (startingAlive > 0) {
        flashCombo(
          this.overlay,
          `${ev.pitchClass}  x${startingAlive}  ${Math.round(ev.confidence * 100)}%`,
          enemyColor,
        );
      } else {
        flashCombo(this.overlay, `${ev.pitchClass}  miss`, "#888");
      }
      if (applied > 0) {
        spawnDamagePopup(
          this.overlay,
          `+${applied.toFixed(1)}${rootHit ? " ROOT" : ""}`,
          rootHit ? "#ffe45a" : enemyColor,
        );
        this.playHitThud(ev.audioTime, rootHit);
      }

      // Killed-enemy feedback: detach each dead enemy's pitch label and fly it
      // up to the timeline bar that just landed the kill. The mesh keeps doing
      // its slow expand-fade in world space (Enemy.update / DEATH_DURATION).
      for (const t of targets) {
        if (t.alive) continue;
        this.spawnKillLetterFor(t, ev.midi, ev.audioTime);
      }
      this.avatar?.triggerStrum(ev.audioTime);

      // Quick synthesized "good note" blip at the played pitch. Strength `m`
      // blends note confidence with the current combo multiplier; it drives
      // both volume and a sine->sawtooth waveform morph (see playNoteFeedback).
      const comboNorm = THREE.MathUtils.clamp(
        (this.lastComboMultiplier - 1) / (5 - 1),
        0,
        1,
      );
      const strength = THREE.MathUtils.clamp(
        ev.confidence * 0.6 + comboNorm * 0.4,
        0,
        1,
      );
      this.playNoteFeedback(ev.midi, strength, ev.audioTime);
    });

    this.offCombo = this.comboScorer.bus.on("measureCombo", (combo) => {
      this.applyMeasureCombo(combo);
    });

    this.offKeysNarrowed = this.resolver.bus.on("keysNarrowed", (ev) => {
      if (ev.remaining.length === 1) {
        this.overlay.keyInfo.textContent = `key: ${ev.remaining[0]} (${Math.round(ev.confidence * 100)}%)`;
      } else if (ev.remaining.length <= 4) {
        this.overlay.keyInfo.textContent = `key: ${ev.remaining.join("/")}  ${Math.round(ev.confidence * 100)}%`;
      } else {
        this.overlay.keyInfo.textContent = `key: ${ev.remaining.length} possible  ${Math.round(ev.confidence * 100)}%`;
      }
    });

    window.addEventListener("keydown", this.handleKeyboardNote);

    // Debug auto-fire: ?auto=1 makes the resolver fire the correct pitch
    // class for each enemy as it nears the player. Used to verify the kill
    // chain end-to-end in headless previews.
    if (new URLSearchParams(location.search).has("auto")) {
      this.enableAutoFire();
    }

    void this.startEngine();
  }

  exit() {
    window.removeEventListener("keydown", this.handleKeyboardNote);
    for (const id of this.autoFireIntervals) clearInterval(id);
    this.autoFireIntervals = [];
    this.offPhase?.();
    this.offPitchFired?.();
    this.offKeysNarrowed?.();
    this.offCombo?.();
    this.comboScorer.detach();
    this.resolver.detach();
    this.tracker.stop();
    this.backing?.stop();
    this.conductor.stop();
    this.director.reset();
    this.bullets.reset();
    this.timeline.detach();
    this.overlay.root.remove();
    for (const g of this.envGroups) this.game.renderer.worldScene.remove(g);
    if (this.avatar) {
      this.game.renderer.worldScene.remove(this.avatar);
      this.avatar.dispose();
    }
    for (const l of this.charLights) {
      this.game.renderer.worldScene.remove(l);
      if ((l as THREE.SpotLight).target) {
        this.game.renderer.worldScene.remove((l as THREE.SpotLight).target);
      }
    }
    this.charLights = [];
  }

  update(dt: number, audioTime: number) {
    if (this.done) return;
    if (this.startedPlayPhase) this.rail.update(dt);

    const camera = this.game.renderer.worldCamera;
    const railPos = this.rail.position;
    const fwd = this.rail.forward;

    // Avatar stands on the rail (slightly dropped), facing forward.
    const avY = railPos.y - 0.5;
    if (this.avatar) {
      this.avatar.position.set(railPos.x, avY, railPos.z);
      // RobotExpressive faces +Z; lookAt aims -Z at the target, so aim it at a
      // point BEHIND the player to leave the model's back toward the camera.
      this.avatar.lookAt(railPos.x - fwd.x, avY, railPos.z - fwd.z);
      const ax = railPos.x, az = railPos.z;
      const kL = this.charLights[0];
      if (kL) kL.position.set(ax + 1.6, avY + 3.2, az - fwd.z * 1.0 + 1.2);
      const rL = this.charLights[1];
      if (rL) rL.position.set(ax - fwd.x * 3.0, avY + 1.6, az - fwd.z * 3.0);
      const fL = this.charLights[2];
      if (fL) fL.position.set(ax + fwd.x * 2.2, avY + 1.2, az + fwd.z * 2.2);
    }

    // Chase camera: behind + above the player, gently angled so the character
    // fills the lower-center and the road/enemies ahead read above them.
    // Trail is kept short (4.6) so the rotating -forward offset swings the
    // camera less laterally on curve bends (it used to be 5.5, which pushed
    // the camera into the flanking building line); height is raised a touch
    // (2.6) so the avatar still fills lower-center and stays inside the subway
    // tunnel envelope on bends. Buildings are set well back in Environment.ts
    // so a clear corridor always exists for this trailing offset.
    camera.position.set(
      railPos.x - fwd.x * 4.6,
      railPos.y + 2.6,
      railPos.z - fwd.z * 4.6,
    );
    camera.lookAt(
      railPos.x + fwd.x * 7,
      railPos.y + 1.1,
      railPos.z + fwd.z * 7,
    );
    this.anchor.position.copy(railPos);
    this.anchor.lookAt(this.rail.lookAtPoint);

    const reached = this.director.update(audioTime);
    for (const _e of reached) {
      this.stats.passes++;
      this.stats.takeDamage(ENEMY_CONTACT_DAMAGE);
    }
    this.bullets.update(audioTime);
    this.avatar?.update(audioTime);
    setHp(this.overlay, this.stats.hp, this.stats.maxHp);
    this.overlay.enemyCount.textContent =
      `kills ${this.stats.kills}  passes ${this.stats.passes}  alive ${this.director.aliveCount}`;

    if (this.stats.isDead) {
      this.done = true;
      this.game.setState(
        new ResultsState(
          this.hudParent,
          this.stats,
          "fail",
          this.level.name,
          () => this.restart(),
          () => this.goLevelSelect(),
        ),
      );
      return;
    }

    if (this.finishedAt > 0 && audioTime >= this.finishedAt) {
      this.done = true;
      const outcome: "win" | "fail" = this.stats.hp > 0 ? "win" : "fail";
      this.game.setState(
        new ResultsState(
          this.hudParent,
          this.stats,
          outcome,
          this.level.name,
          () => this.restart(),
          () => this.goLevelSelect(),
        ),
      );
    }
  }

  private applyMeasureCombo(combo: MeasureComboResult) {
    // Remember the latest streak so the per-note audio blip can scale its
    // volume/waveform with the player's current combo (decayed-back-to-1 logic
    // could live here later; for now it tracks the most recent measure).
    this.lastComboMultiplier = combo.totalMultiplier;
    if (combo.tags.length === 0) return;
    const baseDmg = this.measureDamageBuckets.get(combo.measureIdx) ?? 0;
    // Bonus damage = (multiplier - 1) * what they already did this measure.
    const bonus = baseDmg * (combo.totalMultiplier - 1);
    if (bonus > 0 && this.director.aliveCount > 0) {
      // Distribute the bonus across all currently alive enemies.
      const targets = this.director.enemiesAlive();
      const dmgEach = bonus / Math.max(1, targets.length);
      for (const e of targets) {
        const applied = e.takeDamage(dmgEach, this.conductor.audioTime);
        this.stats.totalDamage += applied;
        if (!e.alive) this.stats.kills++;
      }
    }
    // Loud HUD flash.
    const labels: Record<string, string> = {
      rootStart: "ROOT START",
      rootEnd: "ROOT END",
      twoOctaveRun: "TWO OCTAVE RUN",
      tripletRepeat: "TRIPLET LOCK",
      sixteenthRepeat: "SIXTEENTH LOCK",
    };
    const text = combo.tags.map((t) => labels[t] ?? t).join(" + ");
    flashCombo(
      this.overlay,
      `${text}  x${combo.totalMultiplier.toFixed(1)}`,
      "#c7ff2b",
    );
  }

  /**
   * Synthesize a short "good note" blip at the played pitch.
   *
   * @param midi      MIDI note number of the detected note.
   * @param m         Strength in [0,1] (confidence blended with combo). Drives
   *                  volume and the sine->sawtooth waveform morph.
   * @param audioTime Audio-clock time to schedule at (event time).
   *
   * Envelope/duration: a THIRTY-SECOND note = (60 / bpm) / 8 seconds. Sharp
   * ~3ms attack then exponential decay to the note end so it reads as a quick
   * percussive blip rather than a sustained tone (~0.094s at 80 BPM).
   *
   * Volume: scales with m from a quiet floor (~0.05) up to a modest max
   * (~0.22) so a strong note sits over the drums without clipping. m is
   * already clamped to [0,1] by the caller, so a strong note reaches max
   * without needing an unrealistic multiplier.
   *
   * Waveform: WebAudio oscillators can't morph type continuously, so two
   * oscillators at the same freq (one sine, one sawtooth) are crossfaded by
   * per-osc gains: sineGain = (1 - m), sawGain = m. m=0 => pure sine,
   * m=1 => pure sawtooth, smooth between. Both feed a shared envelope gain ->
   * gentle highpass -> destination, and auto-stop at the note end (no leaks).
   */
  private playNoteFeedback(midi: number, m: number, audioTime: number) {
    const ctx = getAudioContext();
    // `audioTime` is the onset-corrected attack time — PitchEngine BACKDATES
    // it by the pipeline latency, so it's almost always in the PAST relative
    // to ctx.currentTime. Scheduling the envelope at a past t0 means it has
    // already decayed to silence by the time it sounds (the bug: "can't hear
    // the note"). This is immediate feedback, so start at now; only honour
    // audioTime if it's genuinely in the future.
    const now = ctx.currentTime;
    const t0 =
      Number.isFinite(audioTime) && audioTime > now ? audioTime : now;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);

    const bpm = this.conductor?.currentBpm ?? this.level.bpm;
    // Thirty-second note: a beat is (60 / bpm)s; a 1/32 note is 1/8 of that.
    const dur = (60 / bpm) / 8;
    const end = t0 + dur;

    // Volume floor->max scaled by strength. Peak kept modest so it layers
    // over drums without clipping. (~0.05 quiet -> ~0.22 strong.)
    const VOL_FLOOR = 0.14;
    const VOL_MAX = 0.4;
    const peak = VOL_FLOOR + (VOL_MAX - VOL_FLOOR) * THREE.MathUtils.clamp(m, 0, 1);

    // Shared percussive envelope: ~3ms attack, exponential decay to note end.
    const env = ctx.createGain();
    const attack = Math.min(0.003, dur * 0.25);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    // Sine<->sawtooth crossfade via two oscillators at the same freq.
    const mm = THREE.MathUtils.clamp(m, 0, 1);
    const sineOsc = ctx.createOscillator();
    sineOsc.type = "sine";
    sineOsc.frequency.value = freq;
    const sineGain = ctx.createGain();
    sineGain.gain.value = 1 - mm;

    const sawOsc = ctx.createOscillator();
    sawOsc.type = "sawtooth";
    sawOsc.frequency.value = freq;
    const sawGain = ctx.createGain();
    sawGain.gain.value = mm;

    // Gentle highpass so it stays crisp over the drums (mirrors the keyboard
    // tone path).
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 220;

    sineOsc.connect(sineGain).connect(env);
    sawOsc.connect(sawGain).connect(env);
    env.connect(hp).connect(ctx.destination);

    // Fire-and-forget: bounded start/stop means nothing persists past exit().
    sineOsc.start(t0);
    sawOsc.start(t0);
    sineOsc.stop(end);
    sawOsc.stop(end);
  }

  /**
   * Project the dying enemy into screen space, then drift its pitch letter up
   * to the timeline note bar that just killed it. Duration is roughly
   * proportional to travel distance, capped at TWO BEATS at the current BPM.
   */
  private spawnKillLetterFor(enemy: Enemy, killShotMidi: number, audioTime: number) {
    const camera = this.game.renderer.worldCamera;
    // Project the world position of the LABEL sprite, not the enemy origin.
    // The label floats roughly 1.75 units above the body, so projecting
    // `enemy.object.position` would start the kill letter from the enemy's
    // feet — far from the glyph the player actually saw and often partly
    // occluded by the body / HUD chrome. Using the label position makes the
    // HUD letter peel off the exact pixel cluster it replaces.
    const worldPos = new THREE.Vector3();
    enemy.label.getWorldPosition(worldPos);
    const v = worldPos.project(camera);
    // Cull off-frustum. After project(), behind-camera points come back with
    // z > 1, so a single z>1 / z<-1 guard catches both extreme cases.
    if (v.z >= 1) return;
    const fromX = (v.x * 0.5 + 0.5) * window.innerWidth;
    const fromY = (-v.y * 0.5 + 0.5) * window.innerHeight;

    const target = this.timeline.getNoteScreenPos(audioTime, killShotMidi);
    if (!target) return;

    const dx = target.x - fromX;
    const dy = target.y - fromY;
    const dist = Math.hypot(dx, dy);
    // "Up to two beats to move there, depending on how far it is." Scale time
    // with distance, clamped at 2 beats so a far enemy doesn't drag a letter
    // across multiple measures.
    const beatDur = 60 / this.conductor.currentBpm;
    const maxMs = 2 * beatDur * 1000;
    const duration = Math.max(220, Math.min(maxMs, dist * 1.8));

    const color = `#${(enemy.mesh.material as THREE.MeshToonMaterial).color.getHexString()}`;
    spawnKillLetter(
      this.overlay,
      enemy.pitchClass,
      color,
      { x: fromX, y: fromY },
      { x: target.x, y: target.y },
      duration,
    );
  }

  /**
   * Short percussive thud that plays when a note connects. Filtered white
   * noise → lowpass → percussive envelope. Root-note hits get a brighter
   * filter and a bigger peak so the bonus damage reads in the audio too.
   */
  private playHitThud(audioTime: number, isRoot: boolean) {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const t0 = Number.isFinite(audioTime) && audioTime > now ? audioTime : now;
    const dur = 0.09;
    const end = t0 + dur;

    if (!this.noiseBuffer) {
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.12), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = isRoot ? 900 : 600;
    lp.Q.value = 1.2;

    const env = ctx.createGain();
    const peak = isRoot ? 0.28 : 0.18;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    src.connect(lp).connect(env).connect(ctx.destination);
    src.start(t0);
    src.stop(end);
  }

  private restart = () => {
    this.game.setState(new LevelState(this.hudParent, this.level));
  };

  private goLevelSelect = () => {
    this.game.setState(
      new LevelSelectState(this.hudParent, (lvl) =>
        this.game.setState(new LevelState(this.hudParent, lvl)),
      ),
    );
  };

  private handleKeyboardNote = (e: KeyboardEvent) => {
    const map: Record<string, number> = {
      KeyZ: 48, KeyS: 49, KeyX: 50, KeyD: 51, KeyC: 52, KeyV: 53,
      KeyG: 54, KeyB: 55, KeyH: 56, KeyN: 57, KeyJ: 58, KeyM: 59,
      Comma: 60, KeyL: 61, Period: 62, Semicolon: 63, Slash: 64,
    };
    const midi = map[e.code];
    if (midi === undefined) return;
    if (e.repeat) return;
    const t = this.conductor.audioTime;
    // The keyboard is an instrument: always make sound when a key is pressed,
    // even during count-in, so the player can warm up.
    playKeyboardTone(midi, t);
    // Gameplay (timeline + key narrowing + firing) only runs during play.
    // Feed the synthetic note through the tracker; KeyResolver is the single
    // source that emits `pitchFired` (with confidence derived from how far the
    // key has narrowed). Emitting here too would double-fire and bypass the
    // narrowing mechanic.
    if (this.conductor.currentPhase !== "playing") return;
    this.tracker.emitSyntheticNote(midi, t);
  };

  private enableAutoFire() {
    const beatDur = 60 / this.level.bpm;
    for (const spawn of this.level.spawns) {
      // Fire ~1 beat before arrival so the enemy is still alive.
      const fireAtBeatFromPlayStart = spawn.beat - 0.5;
      const id = window.setInterval(() => {
        const playStart = this.conductor.measureStartTime(0);
        if (!isFinite(playStart)) return;
        if (this.conductor.audioTime >= playStart + fireAtBeatFromPlayStart * beatDur) {
          clearInterval(id);
          this.autoFireIntervals = this.autoFireIntervals.filter((x) => x !== id);
          this.resolver.bus.emit("pitchFired", {
            pitchClass: spawn.pitchClass,
            midi: 60,
            confidence: 1,
            audioTime: this.conductor.audioTime,
            measureIdx: this.conductor.currentPlayMeasure(),
          });
        }
      }, 30);
      this.autoFireIntervals.push(id);
    }
  }

  private async startEngine() {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    this.conductor.startPreroll();
    try {
      await this.tracker.start();
    } catch (err) {
      console.warn("[mic] denied or unavailable — keyboard fallback only", err);
    }
    setTimeout(() => this.conductor.triggerPlay(), 600);
  }
}
