import { frequencyFor } from './music.js';

const TIMBRES = {
  piano: { partials: [1, .38, .2, .09, .045, .02], decay: 2.6, attack: .006 },
  felt: { partials: [1, .18, .045, .012], decay: 1.7, attack: .016 },
  electric: { partials: [1, .04, .32, .02, .06], decay: 3.4, attack: .004 },
};

// Local additive synthesis: no sample downloads, microphone access or audio uploads.
export class PianoAudio {
  constructor() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('Este navegador não oferece áudio. Experimente uma versão atual do Chrome, Safari ou Firefox.');
    this.context = new Context({ latencyHint: 'interactive' });
    this.voices = new Map();
    this.sustaining = false;
    this.master = this.context.createGain();
    this.master.gain.value = .65;
    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = -12;
    this.limiter.knee.value = 12;
    this.limiter.ratio.value = 8;
    this.master.connect(this.limiter);
    this.limiter.connect(this.context.destination);
    this.stream = this.context.createMediaStreamDestination();
    this.limiter.connect(this.stream);
  }

  resume() { return this.context.resume(); }
  setVolume(value) { this.master.gain.setTargetAtTime(value, this.context.currentTime, .02); }

  noteOn(id, midi, timbre) {
    if (this.voices.has(id)) this.release(id, true);
    if (this.voices.size >= 64) this.release(this.voices.keys().next().value, true);
    const now = this.context.currentTime;
    const preset = TIMBRES[timbre] || TIMBRES.piano;
    const fundamental = frequencyFor(midi);
    const bus = this.context.createGain();
    bus.connect(this.master);
    const oscillators = [];
    const gains = [];
    preset.partials.forEach((amplitude, index) => {
      if (fundamental * (index + 1) >= this.context.sampleRate / 2) return;
      const oscillator = this.context.createOscillator();
      const envelope = this.context.createGain();
      oscillator.frequency.value = fundamental * (index + 1);
      const peak = amplitude * .17;
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(peak, now + preset.attack);
      envelope.gain.exponentialRampToValueAtTime(.00001, now + preset.decay * (1.9 / (1 + index * .45)));
      oscillator.connect(envelope);
      envelope.connect(bus);
      oscillator.start(now);
      oscillator.stop(now + 8);
      oscillators.push(oscillator);
      gains.push(envelope);
    });
    const voice = { bus, oscillators, gains, down: true };
    this.voices.set(id, voice);
    oscillators[0].onended = () => {
      oscillators.forEach((oscillator) => oscillator.disconnect());
      gains.forEach((gain) => gain.disconnect());
      bus.disconnect();
      if (this.voices.get(id) === voice) this.voices.delete(id);
    };
  }

  noteOff(id) {
    const voice = this.voices.get(id);
    if (!voice) return;
    voice.down = false;
    if (!this.sustaining) this.release(id);
  }

  release(id, immediate = false) {
    const voice = this.voices.get(id);
    if (!voice) return;
    const now = this.context.currentTime;
    voice.bus.gain.cancelScheduledValues(now);
    voice.bus.gain.setTargetAtTime(0, now, immediate ? .006 : .065);
    voice.oscillators.forEach((oscillator) => oscillator.stop(now + (immediate ? .04 : .4)));
    this.voices.delete(id);
  }

  setSustain(value) {
    this.sustaining = value;
    if (!value) this.voices.forEach((voice, id) => { if (!voice.down) this.release(id); });
  }

  click(accent, when = this.context.currentTime) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = accent ? 1200 : 800;
    gain.gain.setValueAtTime(.11, when);
    gain.gain.exponentialRampToValueAtTime(.0001, when + .04);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + .05);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  stopAll() { [...this.voices.keys()].forEach((id) => this.release(id, true)); }
  dispose() {
    this.stopAll();
    this.stream.stream.getTracks().forEach((track) => track.stop());
    void this.context.close();
  }
}
