// Obvious electronic beeps for the count-in measure. High beep on beat 1, lower
// on beats 2-4 so the player can hear the downbeat.

export class BeepSynth {
  constructor(private ctx: AudioContext, private out: AudioNode) {}

  beep(time: number, accent: boolean) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1200 : 800;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.4 : 0.25, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    osc.connect(gain).connect(this.out);
    osc.start(time);
    osc.stop(time + 0.12);
  }
}
