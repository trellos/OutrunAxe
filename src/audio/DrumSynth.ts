// Synthesised drum voices. All triggers take an absolute audio-clock time so
// the conductor can schedule them ahead of the playhead.

export class DrumSynth {
  constructor(private ctx: AudioContext, private out: AudioNode) {}

  private makeNoise(durationSec: number): AudioBufferSourceNode {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * durationSec, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  kick(time: number) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
    osc.connect(gain).connect(this.out);
    osc.start(time);
    osc.stop(time + 0.3);
  }

  snare(time: number) {
    const noise = this.makeNoise(0.2);

    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1500;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

    noise.connect(hp).connect(gain).connect(this.out);
    noise.start(time);
    noise.stop(time + 0.2);

    // Body tone underneath
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.frequency.setValueAtTime(220, time);
    osc.frequency.exponentialRampToValueAtTime(110, time + 0.08);
    oscGain.gain.setValueAtTime(0.3, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(oscGain).connect(this.out);
    osc.start(time);
    osc.stop(time + 0.12);
  }

  hat(time: number) {
    const noise = this.makeNoise(0.05);

    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

    noise.connect(hp).connect(gain).connect(this.out);
    noise.start(time);
    noise.stop(time + 0.06);
  }
}
