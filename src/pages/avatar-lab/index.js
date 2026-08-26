import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Mic, Square, RotateCcw, Camera, Video, VideoOff } from 'lucide-react';

import Seo from '../../components/seo';
import { cn } from '../../lib/cn';
import { useFaceCloud } from './useFaceCloud';
import { useSpeech } from './useSpeech';
import { useCamera } from './useCamera';

const CODENAME = 'JV';

// Anel HUD da referencia: circulos concentricos tracejados + coroa de ticks
// radiais com comprimentos pseudo-aleatorios (deterministicos por indice).
const TickRing = () => {
  const ticks = useMemo(
    () =>
      Array.from({ length: 144 }, (_, i) => {
        const angle = (i / 144) * Math.PI * 2;
        const len = 4 + ((i * 37) % 23) * 0.7 + (i % 9 === 0 ? 8 : 0);
        const r1 = 204;
        const r2 = r1 + len;
        return {
          x1: Math.cos(angle) * r1,
          y1: Math.sin(angle) * r1,
          x2: Math.cos(angle) * r2,
          y2: Math.sin(angle) * r2,
          bright: i % 9 === 0,
          magenta: i % 5 === 0,
        };
      }),
    [],
  );

  return (
    <svg
      viewBox="-250 -250 500 500"
      className="pointer-events-none absolute left-1/2 top-1/2 h-[82vmin] w-[82vmin] -translate-x-1/2 -translate-y-1/2"
      aria-hidden="true"
    >
      <g className="animate-[spin_70s_linear_infinite]" style={{ transformOrigin: '0 0' }}>
        {ticks.map((tick, i) => (
          <line
            key={i}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={tick.magenta ? '#e935a8' : '#37c9e8'}
            strokeWidth={tick.bright ? 1.4 : 0.7}
            opacity={tick.bright ? 0.7 : 0.28}
          />
        ))}
      </g>
      <g className="animate-[spin_45s_linear_infinite_reverse]" style={{ transformOrigin: '0 0' }}>
        <circle r="188" fill="none" stroke="#37c9e8" strokeWidth="0.8" opacity="0.35" strokeDasharray="4 14" />
        <circle r="172" fill="none" stroke="#e935a8" strokeWidth="0.6" opacity="0.3" strokeDasharray="1 10" />
      </g>
      <circle r="198" fill="none" stroke="#37c9e8" strokeWidth="0.5" opacity="0.25" />
      <circle r="150" fill="none" stroke="#8a5cf6" strokeWidth="0.5" opacity="0.2" strokeDasharray="60 24" />
      <g className="animate-[spin_28s_linear_infinite]" style={{ transformOrigin: '0 0' }}>
        <path
          d="M 0 -160 A 160 160 0 0 1 113 -113"
          fill="none"
          stroke="#e935a8"
          strokeWidth="1.6"
          opacity="0.6"
        />
        <path
          d="M 0 160 A 160 160 0 0 1 -113 113"
          fill="none"
          stroke="#37c9e8"
          strokeWidth="1.6"
          opacity="0.5"
        />
      </g>
    </svg>
  );
};

const StatBar = ({ value, wide }) => (
  <div
    className={cn('h-[5px] overflow-hidden rounded-sm bg-fuchsia-500/10', wide ? 'w-40' : 'w-28')}
  >
    <div
      className="h-full rounded-sm bg-gradient-to-r from-fuchsia-500 to-pink-400 shadow-[0_0_8px_rgba(233,53,168,0.8)] transition-all duration-700"
      style={{ width: `${value}%` }}
    />
  </div>
);

const MENU_ITEMS = ['SCAN', 'MESH', 'VOICE', 'SYNC', 'FEED', 'CORE'];

const iconButtonClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-cyan-400/25 bg-white/[0.02] text-cyan-200/80 transition hover:border-cyan-300/70 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300';

const AvatarLab = () => {
  const { t } = useTranslation();
  const [photoUrl, setPhotoUrl] = useState(null);
  const [text, setText] = useState('');
  const [liveMode, setLiveMode] = useState(false);
  const fileInputRef = useRef(null);

  const { supported, voices, voiceURI, setVoiceURI, speaking, level, speak, cancel } =
    useSpeech();
  const { containerRef, canvasHostRef, setVideoSource, clearVideo, faceStatus } =
    useFaceCloud(photoUrl, { speaking, level });
  const camera = useCamera();

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  useEffect(() => {
    if (liveMode && camera.active) {
      setVideoSource(camera.videoRef.current);
    }
  }, [liveMode, camera.active, setVideoSource]);

  const swapToStaticSource = (url) => {
    if (liveMode) {
      camera.stop();
      setLiveMode(false);
    }
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(url);
  };

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    swapToStaticSource(URL.createObjectURL(file));
  };

  const handleReset = () => {
    if (liveMode) {
      camera.stop();
      setLiveMode(false);
    }
    clearVideo();
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleStartLive = async () => {
    const ok = await camera.start();
    if (ok) {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      setPhotoUrl(null);
      setLiveMode(true);
    }
  };

  const handleStopLive = () => {
    camera.stop();
    setLiveMode(false);
    clearVideo();
  };

  const handleCapturePhoto = async () => {
    const url = await camera.capturePhoto();
    if (url) {
      camera.stop();
      setLiveMode(false);
      swapToStaticSource(url);
    }
  };

  const handleSpeak = () => speak(text);

  const handleTextKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (text.trim()) speak(text);
    }
  };

  const ptVoices = useMemo(
    () => voices.filter((v) => v.lang?.toLowerCase().startsWith('pt')),
    [voices],
  );
  const otherVoices = useMemo(
    () => voices.filter((v) => !v.lang?.toLowerCase().startsWith('pt')),
    [voices],
  );

  const hasSource = Boolean(photoUrl) || liveMode;
  const faceFound = faceStatus === 'found';
  const statusText =
    faceStatus === 'detecting'
      ? t('avatarLab.statusScanning')
      : faceStatus === 'notFound'
        ? t('avatarLab.statusNoFace')
        : faceStatus === 'error'
          ? t('avatarLab.statusError')
          : faceFound
            ? liveMode
              ? t('avatarLab.statusLive')
              : t('avatarLab.statusOnline')
            : t('avatarLab.statusIdle');

  return (
    <>
      <Seo
        title={t('seo.avatarLabTitle')}
        description={t('seo.avatarLabDescription')}
        canonical="/avatar-lab"
        robots="noindex,follow"
      />

      <main
        ref={containerRef}
        className="relative h-screen overflow-hidden bg-[#0b0518] font-terminal text-cyan-100"
      >
        {/* fundo: brilhos roxos + grade + vinheta */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,rgba(88,40,190,0.32)_0%,rgba(20,8,44,0.1)_55%,transparent_75%)]" />
        <div className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-indigo-700/20 blur-[120px]" />
        <div className="pointer-events-none absolute -right-24 bottom-1/4 h-96 w-96 rounded-full bg-fuchsia-700/20 blur-[120px]" />
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-[0.12]" />

        {/* anel HUD atras da cabeca */}
        <TickRing />

        {/* nuvem de pontos (three.js) */}
        <div
          ref={canvasHostRef}
          className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full"
        />

        {/* vinheta por cima do canvas */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(6,2,14,0.9)_100%)]" />

        {/* moldura da tela */}
        <div className="pointer-events-none absolute inset-3 border border-fuchsia-500/25 sm:inset-5">
          <span className="absolute -left-px -top-px h-4 w-4 border-l-2 border-t-2 border-fuchsia-400/80" />
          <span className="absolute -right-px -top-px h-4 w-4 border-r-2 border-t-2 border-fuchsia-400/80" />
          <span className="absolute -bottom-px -left-px h-4 w-4 border-b-2 border-l-2 border-fuchsia-400/80" />
          <span className="absolute -bottom-px -right-px h-4 w-4 border-b-2 border-r-2 border-fuchsia-400/80" />
        </div>

        {/* emblema superior esquerdo */}
        <div className="pointer-events-none absolute left-8 top-8 hidden h-20 w-20 sm:block">
          <div
            className="absolute inset-0 rounded-full border border-dashed border-fuchsia-400/50 animate-[spin_16s_linear_infinite]"
          />
          <div className="absolute inset-2 rounded-full border border-cyan-400/20" />
          <div className="absolute inset-0 flex items-center justify-center gap-[3px]">
            <span className="h-2.5 w-2.5 bg-fuchsia-400/90 shadow-[0_0_6px_rgba(233,53,168,0.9)]" />
            <span className="mb-2 h-2 w-2 bg-cyan-300/80" />
            <span className="h-1.5 w-1.5 bg-fuchsia-300/70" />
          </div>
        </div>

        {/* codinome no topo direito */}
        <div className="pointer-events-none absolute right-8 top-8 select-none text-2xl tracking-[0.7em] text-fuchsia-400/90 drop-shadow-[0_0_10px_rgba(233,53,168,0.7)] sm:text-3xl">
          {CODENAME}
        </div>

        {/* logo estilizado a esquerda, como a marca da referencia */}
        <div className="pointer-events-none absolute left-8 top-1/2 hidden -translate-y-1/2 select-none md:block">
          <div className="mb-1 flex items-center gap-2 text-[10px] tracking-[0.5em] text-fuchsia-300/60">
            <span className="h-px w-8 bg-fuchsia-400/50" />
            <span>{'▲▲'}</span>
            <span className="h-px w-8 bg-fuchsia-400/50" />
          </div>
          <div className="relative text-4xl uppercase tracking-[0.12em] text-fuchsia-400 drop-shadow-[0_0_14px_rgba(233,53,168,0.8)]">
            <span aria-hidden="true" className="absolute inset-0 translate-x-[2px] text-cyan-300/60 animate-glitch-1">
              Avatar
            </span>
            <span aria-hidden="true" className="absolute inset-0 -translate-x-[2px] text-fuchsia-300/60 animate-glitch-2">
              Avatar
            </span>
            Avatar
          </div>
          <div className="relative -mt-1 text-4xl uppercase tracking-[0.3em] text-fuchsia-400 drop-shadow-[0_0_14px_rgba(233,53,168,0.8)]">
            Lab
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] tracking-[0.5em] text-fuchsia-300/60">
            <span className="h-px w-14 bg-fuchsia-400/50" />
            <span>{'◆'}</span>
            <span className="h-px w-14 bg-fuchsia-400/50" />
          </div>
        </div>

        {/* status no canto superior esquerdo interno */}
        <div className="pointer-events-none absolute left-8 top-32 text-xs uppercase tracking-[0.35em] text-cyan-300/70 sm:left-32 sm:top-9">
          {statusText}
          <span className="ml-1 inline-block h-3 w-[6px] translate-y-[2px] bg-cyan-300/80 animate-blink" />
        </div>

        {/* barras de status inferior esquerdo */}
        <div className="pointer-events-none absolute bottom-24 left-8 hidden flex-col gap-2 sm:flex">
          <StatBar wide value={faceFound ? 100 : hasSource ? 55 : 8} />
          <StatBar value={speaking ? Math.round(level * 100) : 6} />
          <StatBar wide value={faceFound ? 92 : 15} />
          <div className="mt-1 text-[10px] tracking-[0.4em] text-fuchsia-300/50">
            {CODENAME}.SYS {speaking ? `// ${t('avatarLab.statusSpeaking')}` : ''}
          </div>
        </div>

        {/* menu de pontos + orbe a direita */}
        <div className="pointer-events-none absolute bottom-24 right-8 hidden items-end gap-6 sm:flex">
          <div className="flex flex-col gap-1.5 text-[10px] tracking-[0.3em] text-cyan-300/50">
            {MENU_ITEMS.map((item, i) => (
              <div key={item} className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    i % 2 === 0 ? 'bg-fuchsia-400/80' : 'bg-cyan-300/70',
                  )}
                />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="relative mb-1 h-10 w-10">
            <div className="absolute inset-0 rounded-full bg-fuchsia-500/80 blur-md" />
            <div className="absolute inset-2 rounded-full bg-pink-300/90" />
          </div>
        </div>

        {/* aviso quando nao ha fonte */}
        {!hasSource && (
          <div className="pointer-events-none absolute inset-x-0 top-[68%] flex justify-center px-6 text-center">
            <p className="max-w-sm text-sm tracking-[0.15em] text-cyan-300/60">
              {t('avatarLab.emptyState')}
            </p>
          </div>
        )}

        {/* video oculto usado como fonte da camera */}
        <video
          ref={camera.videoRef}
          muted
          playsInline
          className="pointer-events-none absolute h-px w-px opacity-0"
        />

        {/* faixa de controles */}
        <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center px-3 sm:bottom-7">
          <div className="flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-fuchsia-500/25 bg-[#160a2e]/85 p-2.5 backdrop-blur-md">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFile}
              className="hidden"
              id="avatar-lab-file"
            />
            <label htmlFor="avatar-lab-file" className={cn(iconButtonClass, 'cursor-pointer')} title={t('avatarLab.uploadButton')}>
              <Upload className="h-4 w-4" />
            </label>

            {camera.supported && !liveMode && (
              <button type="button" onClick={handleStartLive} className={iconButtonClass} title={t('avatarLab.cameraButton')}>
                <Video className="h-4 w-4" />
              </button>
            )}
            {liveMode && camera.active && (
              <>
                <button type="button" onClick={handleCapturePhoto} className={iconButtonClass} title={t('avatarLab.snapshotButton')}>
                  <Camera className="h-4 w-4" />
                </button>
                <button type="button" onClick={handleStopLive} className={iconButtonClass} title={t('avatarLab.stopCameraButton')}>
                  <VideoOff className="h-4 w-4" />
                </button>
              </>
            )}
            {hasSource && (
              <button type="button" onClick={handleReset} className={iconButtonClass} title={t('avatarLab.resetButton')}>
                <RotateCcw className="h-4 w-4" />
              </button>
            )}

            {supported ? (
              <>
                <select
                  value={voiceURI}
                  onChange={(event) => setVoiceURI(event.target.value)}
                  className="h-9 max-w-[140px] rounded-md border border-cyan-400/25 bg-black/40 px-2 text-xs text-cyan-100 outline-none focus:border-cyan-300/70"
                  aria-label={t('avatarLab.voiceLabel')}
                >
                  {ptVoices.length > 0 && (
                    <optgroup label="PT">
                      {ptVoices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherVoices.length > 0 && (
                    <optgroup label={t('avatarLab.otherVoices')}>
                      {otherVoices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                <input
                  type="text"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={handleTextKeyDown}
                  placeholder={t('avatarLab.textPlaceholder')}
                  className="h-9 min-w-[160px] flex-1 rounded-md border border-cyan-400/25 bg-black/40 px-3 text-sm text-cyan-100 outline-none placeholder:text-cyan-300/30 focus:border-cyan-300/70"
                />

                {speaking ? (
                  <button
                    type="button"
                    onClick={cancel}
                    className={cn(iconButtonClass, 'border-fuchsia-400/50 text-fuchsia-200')}
                    title={t('avatarLab.stopButton')}
                  >
                    <Square className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSpeak}
                    disabled={!text.trim()}
                    className="flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-fuchsia-600 to-pink-500 px-4 text-xs uppercase tracking-[0.2em] text-white shadow-[0_0_16px_rgba(233,53,168,0.5)] transition hover:brightness-110 disabled:opacity-40"
                  >
                    <Mic className="h-4 w-4" />
                    {t('avatarLab.speakButton')}
                  </button>
                )}
              </>
            ) : (
              <p className="px-2 text-xs text-fuchsia-300/70">{t('avatarLab.unsupported')}</p>
            )}
          </div>
        </div>
      </main>
    </>
  );
};

export default AvatarLab;
