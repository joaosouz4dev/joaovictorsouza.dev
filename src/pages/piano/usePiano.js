import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PianoAudio } from './audio';
import { keyboardNotes } from './music';

export function usePiano() {
  const audio = useRef(null);
  const owners = useRef(new Map());
  const timers = useRef([]);
  const taps = useRef(new Map());
  const recorder = useRef(null);
  const recordingUrl = useRef(null);
  const options = useRef({});
  const [active, setActive] = useState([]);
  const [octave, setOctave] = useState(3);
  const [transpose, setTranspose] = useState(0);
  const [timbre, setTimbre] = useState('piano');
  const [volume, setVolume] = useState(65);
  const [sustain, setSustain] = useState(true);
  const [pedal, setPedal] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [bpm, setBpm] = useState(100);
  const [beat, setBeat] = useState(-1);
  const [playing, setPlaying] = useState(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [take, setTake] = useState(null);
  const [error, setError] = useState('');
  const notes = useMemo(() => keyboardNotes(octave), [octave]);
  options.current = { timbre, volume, sustain: sustain || pedal, transpose, bpm };

  const ensureAudio = useCallback(() => {
    try {
      if (!audio.current) audio.current = new PianoAudio();
      audio.current.setVolume(options.current.volume / 100);
      audio.current.setSustain(options.current.sustain);
      void audio.current.resume().catch(() => setError('Não foi possível ativar o áudio. Toque em uma tecla para tentar novamente.'));
      setError('');
      return audio.current;
    } catch (cause) {
      setError(cause.message || 'Não foi possível iniciar o áudio neste navegador.');
      return null;
    }
  }, []);

  const press = useCallback((id, midi) => {
    if (owners.current.has(id)) return;
    const engine = ensureAudio();
    if (!engine) return;
    owners.current.set(id, midi);
    engine.noteOn(id, midi + options.current.transpose, options.current.timbre);
    setActive([...new Set(owners.current.values())]);
  }, [ensureAudio]);

  const release = useCallback((id) => {
    if (!owners.current.delete(id)) return;
    audio.current?.noteOff(id);
    setActive([...new Set(owners.current.values())]);
  }, []);

  const stopSong = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    [...owners.current.keys()].filter((id) => id.startsWith('song:')).forEach((id) => release(id));
    if (audio.current) [...audio.current.voices.keys()].filter((id) => id.startsWith('song:')).forEach((id) => audio.current.release(id, true));
    setPlaying(null);
  }, [release]);

  const silence = useCallback(() => {
    stopSong();
    taps.current.forEach(clearTimeout);
    taps.current.clear();
    owners.current.clear();
    audio.current?.stopAll();
    setActive([]);
    setPedal(false);
  }, [stopSong]);

  const stopRecording = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    setRecording(false);
  }, []);

  const startRecording = () => {
    const engine = ensureAudio();
    if (!engine) return;
    if (!window.MediaRecorder) {
      setError('A gravação não está disponível neste navegador. Você ainda pode tocar normalmente.');
      return;
    }
    try {
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((value) => MediaRecorder.isTypeSupported(value));
      const instance = new MediaRecorder(engine.stream.stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      instance.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      instance.onstop = () => {
        if (recordingUrl.current) URL.revokeObjectURL(recordingUrl.current);
        const mime = instance.mimeType || chunks[0]?.type || 'audio/webm';
        const url = URL.createObjectURL(new Blob(chunks, { type: mime }));
        recordingUrl.current = url;
        setTake({ url, extension: mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm' });
        setRecording(false);
      };
      instance.onerror = () => { setError('A gravação foi interrompida pelo navegador. Tente gravar novamente.'); stopRecording(); };
      recorder.current = instance;
      instance.start(1000);
      setSeconds(0);
      setRecording(true);
    } catch {
      setError('Não foi possível iniciar a gravação neste navegador. Experimente Chrome ou Firefox.');
    }
  };

  const playSong = (song) => {
    stopSong();
    if (playing === song.id) return;
    if (!ensureAudio()) return;
    setPlaying(song.id);
    let time = 0;
    song.notes.forEach(([midi, beats], index) => {
      const id = `song:${index}`;
      const duration = beats * 60000 / song.bpm;
      timers.current.push(setTimeout(() => press(id, midi), time));
      timers.current.push(setTimeout(() => release(id), time + duration * .85));
      time += duration;
    });
    timers.current.push(setTimeout(stopSong, time + 100));
  };

  useEffect(() => { audio.current?.setVolume(volume / 100); }, [volume]);
  useEffect(() => { audio.current?.setSustain(sustain || pedal); }, [sustain, pedal]);
  useEffect(() => { silence(); }, [octave, transpose, timbre, silence]);

  useEffect(() => {
    const keydown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.target.closest?.('input, select, textarea, audio, [contenteditable="true"]')) return;
      if (event.code === 'Space') {
        if (event.target.closest?.('button, a')) return;
        event.preventDefault(); setPedal(true); return;
      }
      const note = notes.find((item) => item.code === event.code);
      if (note) { event.preventDefault(); press(`key:${event.code}`, note.midi); }
    };
    const keyup = (event) => {
      if (event.code === 'Space') setPedal(false);
      release(`key:${event.code}`);
    };
    const pause = () => { silence(); setMetronome(false); stopRecording(); };
    const visibility = () => { if (document.hidden) pause(); };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [notes, press, release, silence, stopRecording]);

  useEffect(() => {
    if (!metronome) { setBeat(-1); return undefined; }
    const engine = audio.current;
    if (!engine) return undefined;
    let next = engine.context.currentTime;
    let count = 0;
    // Schedule on the audio clock, ahead of JS timers, to keep the beat steady.
    const interval = setInterval(() => {
      while (next < engine.context.currentTime + .06) {
        engine.click(count % 4 === 0, Math.max(next, engine.context.currentTime));
        setBeat(count % 4);
        count += 1;
        next += 60 / options.current.bpm;
      }
    }, 25);
    return () => clearInterval(interval);
  }, [metronome]);

  useEffect(() => {
    if (!recording) return undefined;
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      setSeconds(elapsed);
      if (elapsed >= 300) stopRecording();
    }, 250);
    return () => clearInterval(interval);
  }, [recording, stopRecording]);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    taps.current.forEach(clearTimeout);
    if (recorder.current) {
      recorder.current.onstop = null;
      recorder.current.ondataavailable = null;
      recorder.current.onerror = null;
      if (recorder.current.state === 'recording') recorder.current.stop();
    }
    if (recordingUrl.current) URL.revokeObjectURL(recordingUrl.current);
    audio.current?.dispose();
    audio.current = null;
  }, []);

  const tap = (midi) => {
    const id = `assist:${midi}`;
    clearTimeout(taps.current.get(id));
    release(id);
    press(id, midi);
    taps.current.set(id, setTimeout(() => { release(id); taps.current.delete(id); }, 250));
  };

  return { active, notes, press, release, tap, octave, setOctave, transpose, setTranspose, timbre, setTimbre,
    volume, setVolume, sustain, setSustain, pedal, bpm, setBpm, beat, metronome,
    toggleMetronome: () => { if (ensureAudio()) setMetronome((value) => !value); },
    recording, seconds, take, startRecording, stopRecording, playing, playSong, silence, error };
}
