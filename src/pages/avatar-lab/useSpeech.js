import { useCallback, useEffect, useRef, useState } from 'react';

// Encapsula a Web Speech API (speechSynthesis) com selecao de voz PT-BR e um
// nivel de "energia" 0..1 que a UI usa pra animar o avatar enquanto fala.
export function useSpeech() {
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const levelRafRef = useRef(null);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    if (!supported) return undefined;

    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
      setVoiceURI((current) => {
        if (current) return current;
        const ptVoice = list.find((v) => v.lang?.toLowerCase().startsWith('pt'));
        return (ptVoice || list[0])?.voiceURI || '';
      });
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, [supported]);

  const animateLevel = useCallback(() => {
    // envelope suave: interpola entre alvos aleatorios em vez de saltar,
    // imitando o ritmo de silabas sem tremer
    let current = 0.4;
    let target = 0.6;
    let sinceTarget = 0;
    const tick = () => {
      sinceTarget += 60;
      if (sinceTarget >= 160) {
        sinceTarget = 0;
        target = Math.random() < 0.18 ? 0.12 : 0.35 + Math.random() * 0.65;
      }
      current += (target - current) * 0.4;
      setLevel(current);
      levelRafRef.current = setTimeout(tick, 60);
    };
    tick();
  }, []);

  const stopLevelAnimation = useCallback(() => {
    if (levelRafRef.current) clearTimeout(levelRafRef.current);
    levelRafRef.current = null;
    setLevel(0);
  }, []);

  const speak = useCallback(
    (text) => {
      if (!supported || !text?.trim()) return;

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      const voice = voices.find((v) => v.voiceURI === voiceURI);
      if (voice) utterance.voice = voice;
      utterance.rate = 1;
      utterance.pitch = 1;

      utterance.onstart = () => {
        setSpeaking(true);
        animateLevel();
      };
      utterance.onend = () => {
        setSpeaking(false);
        stopLevelAnimation();
      };
      utterance.onerror = () => {
        setSpeaking(false);
        stopLevelAnimation();
      };

      window.speechSynthesis.speak(utterance);
    },
    [supported, voices, voiceURI, animateLevel, stopLevelAnimation],
  );

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    stopLevelAnimation();
  }, [supported, stopLevelAnimation]);

  useEffect(() => () => stopLevelAnimation(), [stopLevelAnimation]);

  return { supported, voices, voiceURI, setVoiceURI, speaking, level, speak, cancel };
}
