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
import { BulletSystem } from "../combat/BulletSystem";
import { PlayerStats } from "../combat/PlayerStats";
import { createOverlay, flashCombo, setHp, type OverlayElements } from "../hud/Overlay";
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
  private offBeat?: () => unknown;
  private offPitchFired?: () => unknown;
  private offKeysNarrowed?: () => unknown;
  private offCombo?: () => unknown;
  private hudParent: HTMLElement;
  private startedPlayPhase = false;
  private finishedAt = 0;
  private done = false;
  private measureDamageBuckets: Map<number, number> = new Map();

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
      const applied = this.bullets.fire(targets, ev.confidence, ev.audioTime);
      this.stats.totalDamage += applied;
      // Bucket damage by measure for retroactive combo burst.
      const m = ev.measureIdx;
      this.measureDamageBuckets.set(m, (this.measureDamageBuckets.get(m) ?? 0) + applied);
      const killed = targets.filter((t) => !t.alive).length;
      this.stats.kills += killed;
      if (startingAlive > 0) {
        flashCombo(
          this.overlay,
          `${ev.pitchClass}  x${startingAlive}  ${Math.round(ev.confidence * 100)}%`,
          targets[0]
            ? `#${(targets[0].mesh.material as THREE.MeshToonMaterial).color.getHexString()}`
            : "#ff2bd6",
        );
      } else {
        flashCombo(this.overlay, `${ev.pitchClass}  miss`, "#888");
      }
      this.avatar?.triggerStrum(ev.audioTime);
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

    this.offBeat = this.conductor.onBeat(() => {});

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
    this.offPhase?.();
    this.offBeat?.();
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
    if (this.avatar) this.game.renderer.worldScene.remove(this.avatar);
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
    camera.position.set(
      railPos.x - fwd.x * 5.5,
      railPos.y + 2.0,
      railPos.z - fwd.z * 5.5,
    );
    camera.lookAt(
      railPos.x + fwd.x * 7,
      railPos.y + 1.0,
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
      const checkInterval = window.setInterval(() => {
        const playStart = this.conductor.measureStartTime(0);
        if (!isFinite(playStart)) return;
        if (this.conductor.audioTime >= playStart + fireAtBeatFromPlayStart * beatDur) {
          clearInterval(checkInterval);
          this.resolver.bus.emit("pitchFired", {
            pitchClass: spawn.pitchClass,
            midi: 60,
            confidence: 1,
            audioTime: this.conductor.audioTime,
            measureIdx: this.conductor.currentPlayMeasure(),
          });
        }
      }, 30);
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
