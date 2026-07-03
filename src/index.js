import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './routes';
import reportWebVitals from './reportWebVitals';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import translatePt from './config/translate/pt';
import translateEn from './config/translate/en';
import translateEs from './config/translate/es';
import pressStart2pWoff2 from '@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2';

// Preload da fonte pixelada usada no titulo do banner (LCP) para evitar o flash
// com a fonte de fallback enquanto o Press Start 2P carrega.
const fontPreload = document.createElement('link');
fontPreload.rel = 'preload';
fontPreload.as = 'font';
fontPreload.type = 'font/woff2';
fontPreload.crossOrigin = 'anonymous';
fontPreload.href = pressStart2pWoff2;
document.head.appendChild(fontPreload);

i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: ['pt', 'en', 'es'],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    fallbackLng: 'en',
    debug: window.location.hostname.includes('localhost'),
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
    resources: {
      en: {
        translation: {
          ...translateEn,
        },
      },
      es: {
        translation: {
          ...translateEs,
        },
      },
      pt: {
        translation: {
          ...translatePt,
        },
      },
    },
  });

const container = document.getElementById('root');
const root = ReactDOM.createRoot(container);
root.render(<App />);

reportWebVitals();
