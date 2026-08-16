import React, { Suspense, lazy, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { languageFromPath, uniquePathsFor } from '../config/routes';

// Fontes importadas via JS (nao via @import no CSS) para que o Vite resolva os
// url() relativos e hasheie os woff2. Com o pipeline do Tailwind v4, o @import
// no globals.css deixava esses caminhos sem resolver, gerando 404 em producao.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/space-grotesk';
import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/vt323/latin-400.css';

import '../styles/globals.css';

import Home from '../pages/home';
import { Analytics } from '@vercel/analytics/react';

const Matrix = lazy(() => import('../pages/matrix'));
const NotFound = lazy(() => import('../pages/404'));
const Wpp = lazy(() => import('../pages/wpp'));
const Privacidade = lazy(() => import('../pages/privacidade'));
const Sobre = lazy(() => import('../pages/sobre'));
const Servicos = lazy(() => import('../pages/servicos'));
const Servico = lazy(() => import('../pages/servico'));
const Cases = lazy(() => import('../pages/cases'));
const Case = lazy(() => import('../pages/case'));
const Blog = lazy(() => import('../pages/blog'));
const BlogPost = lazy(() => import('../pages/blog-post'));
const Projetos = lazy(() => import('../pages/projetos'));
const Projeto = lazy(() => import('../pages/projeto'));
const Contato = lazy(() => import('../pages/contato'));
const WhatsAppPage = lazy(() => import('../pages/wpp-new'));

const PageLoader = () => (
  <div className="section-loader">
    <div className="loader">
      <div />
      <div />
    </div>
  </div>
);

// Registra a mesma pagina nas variantes de idioma do caminho (/sobre, /about,
// /acerca-de). Rotas com segmento identico nos tres idiomas geram uma entrada so.
const localizedRoutes = (routeKey, element, slugPattern) =>
  uniquePathsFor(routeKey, slugPattern).map((path) => (
    <Route key={path} path={path} element={element} />
  ));

// O idioma vem do proprio caminho: quem abre /about espera o site em ingles,
// mesmo que o localStorage tenha outro idioma salvo. Caminhos que nao
// identificam idioma (home, /blog, /matrix) mantem o idioma detectado.
const LanguageFromRoute = () => {
  const { pathname } = useLocation();
  const { i18n } = useTranslation();

  useEffect(() => {
    const language = languageFromPath(pathname);
    if (language && i18n.resolvedLanguage !== language) {
      i18n.changeLanguage(language);
    }
  }, [i18n, pathname]);

  return null;
};

const AppRoutes = () => {
  return (
    <Suspense fallback={<PageLoader />}>
      <LanguageFromRoute />
      <Routes>
        <Route path="/" element={<Home />} />
        {localizedRoutes('about', <Sobre />)}
        {localizedRoutes('services', <Servicos />)}
        {localizedRoutes('service', <Servico />, ':slug')}
        {localizedRoutes('cases', <Cases />)}
        {localizedRoutes('case', <Case />, ':slug')}
        {localizedRoutes('blog', <Blog />)}
        {localizedRoutes('post', <BlogPost />, ':slug')}
        {localizedRoutes('projects', <Projetos />)}
        {localizedRoutes('project', <Projeto />, ':slug')}
        {localizedRoutes('contact', <Contato />)}
        {localizedRoutes('privacy', <Privacidade />, ':title')}
        <Route path="/zap" element={<Navigate to="/whatsapp" replace />} />
        {localizedRoutes('whatsapp', <Wpp />)}
        {localizedRoutes('wpp', <WhatsAppPage />)}
        {localizedRoutes('matrix', <Matrix />)}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

const App = () => {
  return (
    <>
      <Analytics />
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppRoutes />
      </Router>
    </>
  );
};

export default App;

