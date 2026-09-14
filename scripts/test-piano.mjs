import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PianoAudio } from '../src/pages/piano/audio.js';
import { keyboardNotes, frequencyFor } from '../src/pages/piano/music.js';

class Param {
  value = 0;
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}
class AudioNode {
  gain = new Param();
  frequency = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  connected = false;
  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
  start(time) { this.started = time; }
  stop(time) { this.stopped = time; }
}
class Context {
  currentTime = 1;
  sampleRate = 48000;
  destination = new AudioNode();
  state = 'running';
  createGain() { return new AudioNode(); }
  createOscillator() { return new AudioNode(); }
  createDynamicsCompressor() { return new AudioNode(); }
  createMediaStreamDestination() {
    const node = new AudioNode();
    const track = { stopped: false, stop() { this.stopped = true; } };
    node.stream = { getTracks: () => [track] };
    return node;
  }
  resume() { return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
globalThis.window = { AudioContext: Context };

test('sustain retains released notes, then releases only notes no longer held', () => {
  const engine = new PianoAudio();
  engine.setSustain(true);
  engine.noteOn('q', 60, 'piano');
  engine.noteOn('e', 64, 'piano');
  engine.noteOff('q');
  assert.equal(engine.voices.size, 2);
  engine.setSustain(false);
  assert.equal(engine.voices.has('q'), false);
  assert.equal(engine.voices.has('e'), true);
  engine.noteOff('e');
  assert.equal(engine.voices.size, 0);
  engine.dispose();
});

test('retriggered keys survive cleanup of the previous sustained voice', () => {
  const engine = new PianoAudio();
  engine.setSustain(true);
  engine.noteOn('q', 60, 'piano');
  const previous = engine.voices.get('q');
  engine.noteOff('q');
  engine.noteOn('q', 60, 'piano');
  const current = engine.voices.get('q');
  previous.oscillators[0].onended();
  assert.equal(engine.voices.get('q'), current);
  assert.equal(previous.bus.connected, false);
  assert.equal(current.bus.connected, true);
  engine.dispose();
});

test('mouse and keyboard can independently hold the same pitch', () => {
  const engine = new PianoAudio();
  engine.noteOn('key:q', 60, 'piano');
  engine.noteOn('pointer:1', 60, 'piano');
  engine.noteOff('pointer:1');
  assert.equal(engine.voices.size, 1);
  assert.equal(engine.voices.has('key:q'), true);
  engine.dispose();
});

test('sustained playing stays bounded and stopAll stops every remaining voice', () => {
  const engine = new PianoAudio();
  engine.setSustain(true);
  for (let i = 0; i < 200; i += 1) {
    engine.noteOn(`key:${i}`, 60 + i % 12, 'felt');
    engine.noteOff(`key:${i}`);
  }
  assert.ok(engine.voices.size <= 64);
  const voices = [...engine.voices.values()];
  engine.stopAll();
  assert.equal(engine.voices.size, 0);
  assert.ok(voices.every((voice) => voice.oscillators.every((osc) => osc.stopped <= engine.context.currentTime + .05)));
  engine.dispose();
});

test('all supported octaves and transpositions stay inside the MIDI range and below Nyquist', () => {
  const engine = new PianoAudio();
  for (let octave = 1; octave <= 5; octave += 1) {
    const notes = keyboardNotes(octave);
    assert.equal(new Set(notes.map((note) => note.code)).size, notes.length);
    for (const note of notes) {
      for (const transpose of [-12, 12]) {
        const midi = note.midi + transpose;
        assert.ok(midi >= 0 && midi <= 127);
        engine.noteOn('range', midi, 'piano');
        assert.ok(engine.voices.get('range').oscillators.every((osc) => osc.frequency.value < engine.context.sampleRate / 2));
      }
    }
  }
  assert.equal(frequencyFor(69), 440);
  engine.dispose();
});

test('disposal stops the output tracks and closes the audio context', () => {
  const engine = new PianoAudio();
  engine.noteOn('q', 60, 'electric');
  engine.dispose();
  assert.equal(engine.context.state, 'closed');
  assert.equal(engine.voices.size, 0);
  assert.ok(engine.stream.stream.getTracks().every((track) => track.stopped));
});
