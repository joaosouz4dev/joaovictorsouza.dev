import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';

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

const AppRoutes = () => {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route exact path="/" element={<Home />} />
        <Route exact path="/sobre" element={<Sobre />} />
        <Route exact path="/servicos" element={<Servicos />} />
        <Route exact path="/servicos/:slug" element={<Servico />} />
        <Route exact path="/cases" element={<Cases />} />
        <Route exact path="/cases/:slug" element={<Case />} />
        <Route exact path="/blog" element={<Blog />} />
        <Route exact path="/blog/:slug" element={<BlogPost />} />
        <Route exact path="/projetos" element={<Projetos />} />
        <Route exact path="/projetos/:slug" element={<Projeto />} />
        <Route exact path="/contato" element={<Contato />} />
        <Route exact path="/zap" element={<Navigate to="/whatsapp" replace />} />
        <Route exact path="/whatsapp" element={<Wpp />} />
        <Route exact path="/wpp" element={<WhatsAppPage />} />
        <Route exact path="/matrix" element={<Matrix />} />
        <Route exact path="/politica-de-privacidade/:title" element={<Privacidade />} />
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

