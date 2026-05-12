import Phaser from "phaser";
import { Conductor } from "../audio/Conductor";
import { PitchTracker } from "../audio/PitchTracker";
import { getAudioContext } from "../audio/AudioContextSingleton";
import { colors } from "../ui/style";

const BPM_MIN = 60;
const BPM_MAX = 120;
const BPM_STEP = 5;

// Title oscillates at a fixed rapid rate; mic level controls AMPLITUDE.
const MIC_PULSE_GAIN = 2;
const MIC_PULSE_MAX_AMP = 0.12;
const MIC_PULSE_LERP = 0.25;
const MIC_PULSE_HZ = 12;

export class StartScene extends Phaser.Scene {
  private conductor!: Conductor;
  private tracker!: PitchTracker;
  private bpm = 90;
  private titleText!: Phaser.GameObjects.Text;
  private bpmText!: Phaser.GameObjects.Text;
  private leftArrow!: Phaser.GameObjects.Container;
  private rightArrow!: Phaser.GameObjects.Container;
  private playButton!: Phaser.GameObjects.Container;
  private playBg!: Phaser.GameObjects.Rectangle;
  private offBeat?: () => boolean;
  private offLevel?: () => boolean;
  private micLevel = 0;
  private pulseAmp = 0;

  constructor() {
    super("StartScene");
  }

  create() {
    const { width, height } = this.scale;

    this.cameras.main.setBackgroundColor(colors.bg);

    this.titleText = this.add
      .text(width / 2, height * 0.18, "OUTRUN AXE", {
        fontFamily: "monospace",
        fontSize: "48px",
        color: colors.accent,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const tempoY = height * 0.45;
    this.bpmText = this.add
      .text(width / 2, tempoY, String(this.bpm), {
        fontFamily: "monospace",
        fontSize: "180px",
        color: colors.text,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    // Arrow buttons flanking the tempo readout. Spaced so they don't overlap
    // the widest 3-digit number ("120").
    const arrowGap = 200;
    this.leftArrow = this.makeArrowButton(
      width / 2 - arrowGap,
      tempoY,
      "◀",
      () => this.adjustBpm(-BPM_STEP),
    );
    this.rightArrow = this.makeArrowButton(
      width / 2 + arrowGap,
      tempoY,
      "▶",
      () => this.adjustBpm(BPM_STEP),
    );

    this.add
      .text(width / 2, height * 0.6, "BPM", {
        fontFamily: "monospace",
        fontSize: "28px",
        color: colors.text,
      })
      .setOrigin(0.5)
      .setAlpha(0.6);

    this.add
      .text(width / 2, height * 0.7, "← →   adjust tempo    ⏎  play", {
        fontFamily: "monospace",
        fontSize: "18px",
        color: colors.text,
      })
      .setOrigin(0.5)
      .setAlpha(0.5);

    this.playButton = this.makePlayButton(width / 2, height * 0.85);
    this.makeMuteButton(width - 80, 60);

    this.conductor = new Conductor();
    this.conductor.setBpm(this.bpm);
    // Restore mute preference before the click starts so the user isn't blasted
    // with audio if they had muted in a prior session.
    const savedMute = localStorage.getItem("outrunaxe.muted");
    if (savedMute === "1") this.conductor.setMuted(true);
    this.conductor.startPreroll();

    this.tracker = new PitchTracker();
    this.offLevel = this.tracker.onLevel((rms) => {
      this.micLevel = rms;
    });

    // Runtime test hooks:
    //   ?fakeMic=<url> — pipe a pre-recorded audio file through the live
    //     engine instead of getUserMedia. Used to test the end-to-end
    //     pipeline (PitchEngine + PlayScene) deterministically.
    //   ?autoPlay=1   — auto-click Play shortly after load.
    const params = new URLSearchParams(location.search);
    const fakeMicUrl = params.get("fakeMic");
    const autoPlay = params.has("autoPlay");

    const trackerStart = (async () => {
      if (fakeMicUrl) {
        const resp = await fetch(fakeMicUrl);
        const arr = await resp.arrayBuffer();
        const buffer = await getAudioContext().decodeAudioData(arr);
        this.tracker.prepareFakeMic(buffer);
      }
      await this.tracker.start();
    })();

    trackerStart.catch(() => {
      // Mic denied/unavailable or fakeMic load failed.
    });

    if (autoPlay) {
      // setTimeout (not Phaser's time.delayedCall) so the runtime test works
      // in environments where rAF is throttled (e.g. headless previews).
      setTimeout(() => {
        trackerStart
          .then(() => this.startGame())
          .catch((err) => console.error("[autoPlay]", err));
      }, 800);
    }

    this.offBeat = this.conductor.onBeat((info) => {
      // Beats are scheduled ~100ms ahead of audible time. Defer the visual
      // pulse so it lands on the actual hit.
      const delayMs = Math.max(0, (info.time - this.conductor.audioTime) * 1000);
      this.time.delayedCall(delayMs, () => this.pulseOnBeat(info.beatInPhase));
    });

    this.input.keyboard?.on("keydown-LEFT", () => this.adjustBpm(-BPM_STEP));
    this.input.keyboard?.on("keydown-RIGHT", () => this.adjustBpm(BPM_STEP));
    this.input.keyboard?.on("keydown-SPACE", () => this.startGame());
    this.input.keyboard?.on("keydown-ENTER", () => this.startGame());
    this.input.keyboard?.on("keydown-M", () => this.toggleMute());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offBeat?.();
      this.offLevel?.();
    });
  }

  update(time: number) {
    const target = Phaser.Math.Clamp(this.micLevel * MIC_PULSE_GAIN, 0, MIC_PULSE_MAX_AMP);
    this.pulseAmp = Phaser.Math.Linear(this.pulseAmp, target, MIC_PULSE_LERP);
    const phase = (time / 1000) * MIC_PULSE_HZ * Math.PI * 2;
    this.titleText.setScale(1 + this.pulseAmp * Math.sin(phase));
  }

  private adjustBpm(delta: number) {
    const next = Phaser.Math.Clamp(this.bpm + delta, BPM_MIN, BPM_MAX);
    if (next === this.bpm) return;
    this.bpm = next;
    this.bpmText.setText(String(this.bpm));
    this.conductor.setBpm(this.bpm);
  }

  private pulseOnBeat(beatInBar: number) {
    const isDownbeat = beatInBar === 0;

    // Tempo number: snappy scale-up then ease back. Bigger pop on the 1.
    const peak = isDownbeat ? 1.18 : 1.08;
    this.tweens.killTweensOf(this.bpmText);
    this.bpmText.setScale(peak);
    this.tweens.add({
      targets: this.bpmText,
      scale: 1,
      duration: 220,
      ease: "Quad.easeOut",
    });

    // Play button: subtle width pulse + brightening flash on the fill.
    this.tweens.killTweensOf(this.playButton);
    this.playButton.setScale(isDownbeat ? 1.08 : 1.04);
    this.tweens.add({
      targets: this.playButton,
      scale: 1,
      duration: 220,
      ease: "Quad.easeOut",
    });

    const flashColor = isDownbeat ? colors.activeStroke : colors.activeFill;
    this.playBg.setFillStyle(flashColor, isDownbeat ? 0.55 : 0.85);
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 240,
      ease: "Quad.easeOut",
      onComplete: () => this.playBg.setFillStyle(colors.activeFill, 1),
    });
  }

  private makeArrowButton(
    x: number,
    y: number,
    glyph: string,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const size = 80;
    const bg = this.add
      .rectangle(0, 0, size, size, colors.barFill, 1)
      .setStrokeStyle(2, colors.barStroke);
    const label = this.add
      .text(0, 0, glyph, {
        fontFamily: "monospace",
        fontSize: "44px",
        color: colors.text,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const container = this.add.container(x, y, [bg, label]);
    container.setSize(size, size);
    container.setInteractive({ useHandCursor: true });
    container.on("pointerover", () => {
      bg.setStrokeStyle(2, colors.activeStroke);
      label.setColor(colors.accent);
    });
    container.on("pointerout", () => {
      bg.setStrokeStyle(2, colors.barStroke);
      label.setColor(colors.text);
    });
    container.on("pointerdown", () => {
      onClick();
      this.tweens.killTweensOf(container);
      container.setScale(0.9);
      this.tweens.add({
        targets: container,
        scale: 1,
        duration: 140,
        ease: "Quad.easeOut",
      });
    });
    return container;
  }

  private makePlayButton(x: number, y: number): Phaser.GameObjects.Container {
    const w = 220;
    const h = 64;
    this.playBg = this.add
      .rectangle(0, 0, w, h, colors.activeFill, 1)
      .setStrokeStyle(3, colors.activeStroke);
    const label = this.add
      .text(0, 0, "▶  PLAY", {
        fontFamily: "monospace",
        fontSize: "28px",
        color: colors.text,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const container = this.add.container(x, y, [this.playBg, label]);
    container.setSize(w, h);
    container.setInteractive({ useHandCursor: true });
    container.on("pointerover", () => label.setColor(colors.accent));
    container.on("pointerout", () => label.setColor(colors.text));
    container.on("pointerdown", () => this.startGame());
    return container;
  }

  private muteLabel: Phaser.GameObjects.Text | null = null;
  private muteBg: Phaser.GameObjects.Rectangle | null = null;

  private makeMuteButton(x: number, y: number) {
    const size = 64;
    const bg = this.add
      .rectangle(0, 0, size, size, colors.barFill, 1)
      .setStrokeStyle(2, colors.barStroke);
    const label = this.add
      .text(0, 0, this.muteLabelText(), {
        fontFamily: "monospace",
        fontSize: "13px",
        fontStyle: "bold",
        color: colors.text,
        align: "center",
      })
      .setOrigin(0.5);
    this.muteLabel = label;
    this.muteBg = bg;
    const container = this.add.container(x, y, [bg, label]);
    container.setSize(size, size);
    container.setInteractive({ useHandCursor: true });
    container.on("pointerover", () => bg.setStrokeStyle(2, colors.activeStroke));
    container.on("pointerout", () => this.refreshMuteVisual());
    container.on("pointerdown", () => this.toggleMute());
  }

  private muteLabelText() {
    return this.conductor?.muted ? "SOUND\nOFF" : "SOUND\nON";
  }

  private refreshMuteVisual() {
    if (!this.muteBg || !this.muteLabel) return;
    const muted = this.conductor.muted;
    this.muteBg.setStrokeStyle(2, muted ? colors.activeStroke : colors.barStroke);
    this.muteLabel.setText(this.muteLabelText());
    this.muteLabel.setColor(muted ? colors.accent : colors.text);
  }

  private toggleMute() {
    const next = !this.conductor.muted;
    this.conductor.setMuted(next);
    localStorage.setItem("outrunaxe.muted", next ? "1" : "0");
    this.refreshMuteVisual();
  }

  private startGame() {
    if (this.conductor.currentPhase !== "preroll") return;
    this.leftArrow.disableInteractive();
    this.rightArrow.disableInteractive();
    this.playButton.disableInteractive();
    this.conductor.triggerPlay();
    this.offLevel?.();
    this.scene.start("PlayScene", {
      conductor: this.conductor,
      tracker: this.tracker,
    });
  }
}
