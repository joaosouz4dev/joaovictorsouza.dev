import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, AudioLines, Check, ChevronLeft, ChevronRight, Circle, Download, Heart, Keyboard, Maximize, Music2, Play, SlidersHorizontal, Square, Volume2, X } from 'lucide-react';
import Seo from '../../components/seo';
import { useLocalizedPath } from '../../utils/useLocalizedPath';
import { noteName, SONGS, SPONSOR_URL } from './music';
import { usePiano } from './usePiano';
import './piano.css';

const TIMBRES = [{ id: 'piano', label: 'Piano clássico', detail: 'Claro e expressivo' }, { id: 'felt', label: 'Piano suave', detail: 'Íntimo e delicado' }, { id: 'electric', label: 'Piano elétrico', detail: 'Quente e nostálgico' }];
const timeLabel = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

function TempoInput({ value, onChange }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input aria-label="Andamento em batidas por minuto" type="number" min="40" max="220" value={draft}
    onChange={(event) => { setDraft(event.target.value); const next = Number(event.target.value); if (next >= 40 && next <= 220) onChange(Math.round(next)); }}
    onBlur={() => { const next = Math.max(40, Math.min(220, Math.round(Number(draft) || value))); setDraft(String(next)); onChange(next); }}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
}

export default function Piano() {
  const piano = usePiano();
  const path = useLocalizedPath();
  const studio = useRef(null);
  const keyboardScroll = useRef(null);
  const [labels, setLabels] = useState(true);
  const [shortcuts, setShortcuts] = useState(true);
  const [letters, setLetters] = useState(false);
  const [settings, setSettings] = useState(false);
  const [screenError, setScreenError] = useState('');
  const selectedTimbre = TIMBRES.find((item) => item.id === piano.timbre);
  const currentNote = piano.active.at(-1);
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (studio.current.requestFullscreen) await studio.current.requestFullscreen();
      else setScreenError('Este navegador não oferece tela cheia. Gire o celular para tocar com mais espaço.');
    } catch { setScreenError('Não foi possível abrir a tela cheia neste navegador.'); }
  };

  return (
    <div className="lume" lang="pt-BR">
      <Seo title="Lume Piano - piano virtual gratuito e sem anúncios" description="Um espaço para tocar. Piano virtual com três timbres, sustain, metrônomo e gravação. Toque pelo teclado, mouse ou celular, sem anúncios." canonical="/piano" />
      <a className="lume-skip" href="#lume-keyboard">Ir para o piano</a>
      <header className="lume-header">
        <Link to="/" className="lume-brand" aria-label="Lume Piano - voltar ao site de João Victor Souza">
          <span className="lume-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>lume<span className="lume-brand-caption">PIANO</span></span>
        </Link>
        <div className="lume-header-right">
          <span className="lume-free"><span /> Livre para tocar. Sem anúncios.</span>
          <a className="lume-sponsor" href={SPONSOR_URL} target="_blank" rel="noopener noreferrer"><Heart size={16} aria-hidden="true" /> Apoiar o projeto <ArrowUpRight size={15} aria-hidden="true" /></a>
        </div>
      </header>

      <main className="lume-main">
        <section className="lume-intro" aria-labelledby="lume-title">
          <div>
            <Link to={path('projects')} className="lume-back"><ArrowLeft size={13} aria-hidden="true" /> UM EXPERIMENTO DE JOÃO VICTOR</Link>
            <h1 id="lume-title">Dê espaço ao seu <em>som.</em></h1>
            <p>Algumas teclas. Infinitas possibilidades. Sente, toque e descubra.</p>
          </div>
          <div className="lume-intro-note"><span aria-hidden="true">♪</span><p>Sem pressa.<br />No seu tempo.</p></div>
        </section>

        <section className="lume-studio" ref={studio} aria-label="Estúdio de piano">
          <div className="lume-instrument-bar">
            <div className="lume-instrument-name"><span className="lume-instrument-icon"><Music2 size={21} aria-hidden="true" /></span><div><span className="lume-overline">SEU INSTRUMENTO</span><strong>{selectedTimbre.label}</strong></div></div>
            <div className="lume-timbres" role="group" aria-label="Timbre do piano">
              {TIMBRES.map((item, index) => <button key={item.id} aria-pressed={piano.timbre === item.id} onClick={() => piano.setTimbre(item.id)} title={item.detail}><span>0{index + 1}</span>{item.label.replace('Piano ', '')}</button>)}
            </div>
            <label className="lume-volume"><Volume2 size={17} aria-hidden="true" /><span className="lume-sr-only">Volume</span><input type="range" min="0" max="100" value={piano.volume} onChange={(event) => piano.setVolume(Number(event.target.value))} /><output>{piano.volume}%</output></label>
          </div>

          <div className="lume-soundscape">
            <div className="lume-session"><span className={`lume-status-dot ${piano.active.length ? 'is-playing' : ''}`} /><span>{piano.playing ? 'ACOMPANHE A MELODIA' : piano.active.length ? 'A MÚSICA É SUA' : 'PRONTO PARA TOCAR'}</span></div>
            <div className="lume-staff" aria-hidden="true">{[0,1,2,3,4].map((line) => <i key={line} />)}</div>
            <div className="lume-current-note" aria-hidden="true"><span>{currentNote !== undefined ? noteName(currentNote + piano.transpose, letters).replace(/\d/g, '') : '♪'}</span><p>{piano.active.length > 1 ? piano.active.map((note) => noteName(note + piano.transpose, letters)).join(' · ') : currentNote !== undefined ? noteName(currentNote + piano.transpose, letters) : 'Sua próxima nota começa aqui'}</p></div>
            <div className={`lume-bars ${piano.active.length ? 'is-playing' : ''}`} aria-hidden="true">{Array.from({ length: 41 }, (_, index) => <i key={index} style={{ '--bar-height': `${8 + ((index * 17 + (currentNote || 0)) % 49)}px`, '--bar-delay': `${index * 25}ms` }} />)}</div>
            <span className="lume-soundscape-signature">LUME / EST. 2026</span>
          </div>

          <div className="lume-toolbar">
            <div className="lume-toolbar-group">
              <button className="lume-tool" aria-pressed={piano.sustain} onClick={() => piano.setSustain(!piano.sustain)}><AudioLines size={16} aria-hidden="true" /> Sustain <span className={`lume-toggle ${piano.sustain || piano.pedal ? 'is-on' : ''}`} aria-hidden="true" /></button>
              <button className="lume-tool" aria-pressed={labels} onClick={() => setLabels(!labels)}><Music2 size={16} aria-hidden="true" /> Notas {labels && <Check size={12} aria-hidden="true" />}</button>
              <button className="lume-tool lume-shortcuts-control" aria-pressed={shortcuts} onClick={() => setShortcuts(!shortcuts)}><Keyboard size={16} aria-hidden="true" /> Atalhos</button>
            </div>
            <div className="lume-toolbar-group">
              <div className="lume-octave"><span>OITAVA</span><button aria-label="Diminuir oitava" disabled={piano.octave <= 1} onClick={() => piano.setOctave(piano.octave - 1)}><ChevronLeft size={16} aria-hidden="true" /></button><output>{piano.octave}</output><button aria-label="Aumentar oitava" disabled={piano.octave >= 5} onClick={() => piano.setOctave(piano.octave + 1)}><ChevronRight size={16} aria-hidden="true" /></button></div>
              <button className="lume-icon-button" aria-label="Ajustes do piano" aria-expanded={settings} aria-controls="lume-settings" onClick={() => setSettings(!settings)}><SlidersHorizontal size={17} aria-hidden="true" /></button>
              <button className="lume-icon-button" aria-label="Alternar tela cheia" onClick={fullscreen}><Maximize size={17} aria-hidden="true" /></button>
            </div>
          </div>

          {settings && <div className="lume-settings" id="lume-settings">
            <label>Nome das notas<select value={letters ? 'letters' : 'solfege'} onChange={(event) => setLetters(event.target.value === 'letters')}><option value="solfege">Dó, Ré, Mi</option><option value="letters">C, D, E</option></select></label>
            <label>Transposição<select value={piano.transpose} onChange={(event) => piano.setTranspose(Number(event.target.value))}>{Array.from({ length: 25 }, (_, i) => i - 12).map((value) => <option key={value} value={value}>{value > 0 ? '+' : ''}{value} semitons</option>)}</select></label>
            <button className="lume-tool" onClick={piano.silence}><Square size={14} aria-hidden="true" /> Silenciar notas</button>
            <button className="lume-icon-button" aria-label="Fechar ajustes" onClick={() => setSettings(false)}><X size={16} aria-hidden="true" /></button>
          </div>}

          <div className="lume-keyboard-scroll" ref={keyboardScroll} data-lenis-prevent>
            <div className="lume-keyboard" id="lume-keyboard" tabIndex={-1} role="group" aria-label="Piano de 37 teclas. Use o teclado do computador ou toque nas teclas.">
              {piano.notes.map((note) => <button key={note.midi} type="button" className={`lume-key ${note.black ? 'lume-black' : 'lume-white'} ${piano.active.includes(note.midi) ? 'is-active' : ''}`} style={{ left: `${(note.whiteIndex + (note.black ? .69 : 0)) / 22 * 100}%`, width: `${(note.black ? .62 : 1) / 22 * 100}%` }} aria-label={`${noteName(note.midi + piano.transpose)}, atalho ${note.shortcut}`} aria-pressed={piano.active.includes(note.midi)}
                onClick={(event) => { if (event.detail === 0) piano.tap(note.midi); }}
                onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); piano.press(`pointer:${event.pointerId}`, note.midi); }}
                onPointerUp={(event) => piano.release(`pointer:${event.pointerId}`)} onPointerCancel={(event) => piano.release(`pointer:${event.pointerId}`)} onLostPointerCapture={(event) => piano.release(`pointer:${event.pointerId}`)}
                onKeyDown={(event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) piano.press(`focus:${note.midi}`, note.midi); } }}
                onKeyUp={(event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); piano.release(`focus:${note.midi}`); } }} onBlur={() => piano.release(`focus:${note.midi}`)}>
                <span className="lume-key-labels">{labels && <span className="lume-note-label">{noteName(note.midi + piano.transpose, letters)}</span>}{shortcuts && <kbd>{note.shortcut}</kbd>}</span>
                {!note.black && note.midi % 12 === 0 && <i className="lume-c-marker" aria-hidden="true" />}
              </button>)}
            </div>
          </div>
          <div className="lume-keyboard-footer"><span><Keyboard size={14} aria-hidden="true" /> Toque com o teclado, mouse ou tela</span><span>Segure <kbd>espaço</kbd> para sustentar</span><span className="lume-mobile-hint"><button aria-label="Ver teclas mais graves" onClick={() => keyboardScroll.current.scrollBy({ left: -keyboardScroll.current.clientWidth * .7 })}><ChevronLeft size={15} aria-hidden="true" /></button><span>Mais teclas</span><button aria-label="Ver teclas mais agudas" onClick={() => keyboardScroll.current.scrollBy({ left: keyboardScroll.current.clientWidth * .7 })}><ChevronRight size={15} aria-hidden="true" /></button></span></div>
          {(piano.error || screenError) && <p className="lume-error" role="alert">{piano.error || screenError}</p>}

          <div className="lume-practice-bar">
            <div className="lume-metronome">
              <button className={`lume-round-button ${piano.metronome ? 'is-on' : ''}`} aria-label={piano.metronome ? 'Parar metrônomo' : 'Iniciar metrônomo'} aria-pressed={piano.metronome} onClick={piano.toggleMetronome}>{piano.metronome ? <Square size={14} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}</button>
              <div><strong>Metrônomo</strong><span className="lume-beats" aria-label="Compasso de quatro tempos">{[0,1,2,3].map((beat) => <i key={beat} className={beat === piano.beat ? 'is-active' : ''} />)}</span></div>
              <label className="lume-bpm"><TempoInput value={piano.bpm} onChange={piano.setBpm} /><span>BPM</span></label>
              <input className="lume-tempo-slider" aria-label="Ajustar andamento" type="range" min="40" max="220" value={piano.bpm} onChange={(event) => piano.setBpm(Number(event.target.value))} />
            </div>
            <div className="lume-recorder"><span className="lume-record-time">{timeLabel(piano.seconds)}</span><button className={`lume-record-button ${piano.recording ? 'is-recording' : ''}`} onClick={piano.recording ? piano.stopRecording : piano.startRecording}>{piano.recording ? <Square size={13} aria-hidden="true" /> : <Circle size={13} aria-hidden="true" />} {piano.recording ? 'Parar gravação' : 'Gravar'}<span className="lume-sr-only"> sua música</span></button></div>
          </div>
          {piano.take && <div className="lume-take"><span>Sua última gravação</span><audio controls src={piano.take.url} aria-label="Ouvir sua gravação" /><a href={piano.take.url} download={`lume-piano.${piano.take.extension}`}><Download size={16} aria-hidden="true" /> Baixar áudio</a></div>}
        </section>

        <div className="lume-below">
          <section className="lume-melodies" aria-labelledby="lume-melodies-title"><div className="lume-section-heading"><div><span className="lume-overline">UM PONTO DE PARTIDA</span><h2 id="lume-melodies-title">A primeira melodia.</h2></div><span className="lume-small-tag">OUÇA E EXPERIMENTE</span></div>
            {SONGS.map((song, index) => <button key={song.id} className={`lume-song ${piano.playing === song.id ? 'is-playing' : ''}`} onClick={() => piano.playSong(song)} aria-label={`${piano.playing === song.id ? 'Parar' : 'Ouvir'} ${song.title}`} aria-pressed={piano.playing === song.id}><span className="lume-song-number">0{index + 1}</span><span className="lume-song-title"><strong>{song.title}</strong><span>{song.composer}</span></span><span className="lume-song-level">{song.level}</span><span className="lume-song-play">{piano.playing === song.id ? <Square size={13} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}</span></button>)}
          </section>
          <section className="lume-guide" aria-labelledby="lume-guide-title"><span className="lume-overline">SIMPLES ASSIM</span><h2 id="lume-guide-title">O seu teclado é um piano.</h2><p>As letras em cada tecla são seus atalhos. Combine notas, mude o timbre e encontre uma melodia só sua.</p><div className="lume-guide-tip"><span><kbd>q</kbd><kbd>w</kbd><kbd>e</kbd></span><span>Comece com Dó, Ré, Mi.</span></div><p className="lume-privacy-note">Grave até 5 minutos por vez. O áudio fica no seu navegador: baixe para guardar.</p></section>
        </div>
      </main>
      <footer className="lume-footer"><span>Feito por <Link to="/">João Victor Souza</Link></span><span>Um pequeno espaço para fazer música.</span><a href={SPONSOR_URL} target="_blank" rel="noopener noreferrer">Feito com cuidado. Mantido com seu apoio. <Heart size={13} aria-hidden="true" /></a></footer>
    </div>
  );
}
