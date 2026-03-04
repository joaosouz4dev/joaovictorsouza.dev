export const toBaseLanguage = (language) => {
  const normalized = (language || '').toLowerCase();
  if (normalized.startsWith('pt')) return 'pt';
  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('es')) return 'es';
  return 'en';
};

