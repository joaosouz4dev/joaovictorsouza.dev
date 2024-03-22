import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './routes';
import reportWebVitals from './reportWebVitals';
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import translatePt from './config/translate/pt';
import translateEn from './config/translate/en';

i18next.use(LanguageDetector).init({
  fallbackLng: 'en',
  debug: true,
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
