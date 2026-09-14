export const SPONSOR_URL = 'https://github.com/sponsors/joaosouz4dev';

const NOTE_NAMES = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];
const LETTER_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
// Chromatic order, matching the reference's white and black key shortcuts.
const CODES = [
  'KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU',
  'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP', 'KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyF', 'KeyV',
  'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash', 'BracketRight', 'Backslash',
  'Equal',
];
const PUNCTUATION = { Comma: ',', Period: '.', Semicolon: ';', Slash: '/', BracketRight: ']', Backslash: '\\', Equal: '=' };

export const noteName = (midi, letters = false) => `${(letters ? LETTER_NAMES : NOTE_NAMES)[midi % 12]}${Math.floor(midi / 12) - 1}`;
export const frequencyFor = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const keyboardNotes = (octave) => {
  let whiteIndex = -1;
  return Array.from({ length: 37 }, (_, offset) => {
    const midi = (octave + 1) * 12 + offset;
    const black = [1, 3, 6, 8, 10].includes(midi % 12);
    if (!black) whiteIndex += 1;
    const code = CODES[offset];
    return { midi, black, whiteIndex, code, shortcut: PUNCTUATION[code] || code.replace(/Key|Digit/g, '').toLowerCase() };
  });
};

// Short melody excerpts. Each pair is [MIDI note, beats].
export const SONGS = [
  { id: 'joy', title: 'Ode à Alegria', composer: 'L. van Beethoven', level: 'Primeiras notas', bpm: 100,
    notes: [[64,1],[64,1],[65,1],[67,1],[67,1],[65,1],[64,1],[62,1],[60,1],[60,1],[62,1],[64,1],[64,1.5],[62,.5],[62,2],[64,1],[64,1],[65,1],[67,1],[67,1],[65,1],[64,1],[62,1],[60,1],[60,1],[62,1],[64,1],[62,1.5],[60,.5],[60,2]] },
  { id: 'star', title: 'Brilha, Brilha, Estrelinha', composer: 'Melodia tradicional', level: 'Para começar', bpm: 110,
    notes: [[60,1],[60,1],[67,1],[67,1],[69,1],[69,1],[67,2],[65,1],[65,1],[64,1],[64,1],[62,1],[62,1],[60,2],[67,1],[67,1],[65,1],[65,1],[64,1],[64,1],[62,2],[67,1],[67,1],[65,1],[65,1],[64,1],[64,1],[62,2]] },
  { id: 'hedwig', title: 'Harry Potter - Hedwig’s Theme', composer: 'John Williams · trecho', level: 'Para praticar', bpm: 100,
    // User-provided sequence; the penultimate note is F natural, as supplied.
    notes: [
      [59,1],[64,1.5],[67,.5],[66,1],[64,2],
      [71,1],[69,3],[66,3],
      [64,1.5],[67,.5],[66,1],[63,2],[65,1],[59,3],
    ] },
];
