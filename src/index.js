import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './routes';
import reportWebVitals from './reportWebVitals';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import translatePt from './config/translate/pt';
import translateEn from './config/translate/en';

i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    debug: window.location.hostname.includes('localhost'),
    resources: {
      en: {
        translation: {
          ...translateEn,
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
