// eddieAudioFactory — the stable integration surface for Infinite Eddie audio
// (GDD §7). Gameplay imports ONLY this; it never changes between variant
// branches. createEddieAudio returns an EddieAudioRig that drives both the
// drum-machine beat (EddieBeat) and the biting bass (EddieBass) off one
// Conductor.
//
// Variant model (GDD §12.3): the `variant` argument is the stable type surface,
// but the LIVE variant for each cue is chosen per branch by the two ACTIVE_*
// constants below. On the integration/baseline branch both are "option-1". On
// a `sound/beat/option-2` branch, ACTIVE_BEAT_VARIANT becomes "option-2" (bass
// stays at its option-1 default) so the branch is runnable/reviewable on its
// own via ?eddiesound=1. The factory's `variant` arg lets the debug bench force
// a specific cue+variant combination at runtime for side-by-side audition.

import type { Conductor } from "../Conductor";
import type { EddieConfig } from "../../music/eddie/eddieTypes";
import { EddieBeat, type EddieBeatVariant } from "./EddieBeat";
import { EddieBass, type EddieBassVariant } from "./EddieBass";

export interface EddieAudioRig {
  /** Subscribe to conductor.onBeat and schedule drums + bass. Plays drums in
   *  BOTH countIn and playing phases (the intro IS the generated beat). Bass
   *  follows config.bassline, looping every 4 measures. */
  start(): void;
  /** Fully tear down: unsubscribe, stop + disconnect all oscillators/sources,
   *  fade master to avoid clicks. Mirrors BackingTrack.stop(). */
  stop(): void;
  setMuted(muted: boolean): void;
}

export type EddieAudioVariant = "option-1" | "option-2" | "option-3";

// --- Per-branch active selection -------------------------------------------
// These are what each `sound/<cue>/option-N` branch edits. The baseline /
// integration branch keeps both at "option-1".
export const ACTIVE_BEAT_VARIANT: EddieBeatVariant = "option-1";
export const ACTIVE_BASS_VARIANT: EddieBassVariant = "option-1";

/**
 * The rig combines one EddieBeat + one EddieBass. start()/stop()/setMuted fan
 * out to both. stop() leaves zero orphan oscillators (QA verifies no audio
 * after exit).
 */
class EddieAudioRigImpl implements EddieAudioRig {
  constructor(private beat: EddieBeat, private bass: EddieBass) {}

  start(): void {
    this.beat.start();
    this.bass.start();
  }

  stop(): void {
    this.beat.stop();
    this.bass.stop();
  }

  setMuted(muted: boolean): void {
    this.beat.setMuted(muted);
    this.bass.setMuted(muted);
  }
}

/**
 * Gameplay calls this with a default variant ("option-1"); the debug bench may
 * pass a different variant to force a specific cue+variant combination. The
 * `variant` argument maps to BOTH cues' variant slot; the debug bench drives
 * the two cues independently via the lower-level helpers below.
 */
export function createEddieAudio(
  variant: EddieAudioVariant,
  conductor: Conductor,
  config: EddieConfig,
): EddieAudioRig {
  // Production path: honor the per-branch ACTIVE selection so the default
  // matches the checked-out branch, but let an explicit non-default `variant`
  // override (the bench passes option-2/3 to audition). When `variant` is
  // "option-1" we defer to the branch's ACTIVE_* (which is option-1 on the
  // baseline and the chosen cue on a variant branch).
  const beatVariant: EddieBeatVariant =
    variant === "option-1" ? ACTIVE_BEAT_VARIANT : variant;
  const bassVariant: EddieBassVariant =
    variant === "option-1" ? ACTIVE_BASS_VARIANT : variant;

  const beat = new EddieBeat(conductor, beatVariant);
  const bass = new EddieBass(conductor, bassVariant, config.bassline);
  return new EddieAudioRigImpl(beat, bass);
}

/**
 * Lower-level constructor used by the sound debug bench to cycle the beat and
 * bass cues INDEPENDENTLY (3 beat × 3 bass), which the single-variant
 * createEddieAudio signature can't express. Not used in production.
 */
export function createEddieAudioPair(
  beatVariant: EddieBeatVariant,
  bassVariant: EddieBassVariant,
  conductor: Conductor,
  config: EddieConfig,
): { rig: EddieAudioRig; beat: EddieBeat; bass: EddieBass } {
  const beat = new EddieBeat(conductor, beatVariant);
  const bass = new EddieBass(conductor, bassVariant, config.bassline);
  const rig = new EddieAudioRigImpl(beat, bass);
  return { rig, beat, bass };
}