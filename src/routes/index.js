import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';

import '../styles/scss/main.scss';

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
  const location = useLocation();
  const [isPageLoading, setIsPageLoading] = useState(true);

  useEffect(() => {
    setIsPageLoading(true);
    const timeout = setTimeout(() => {
      setIsPageLoading(false);
    }, 300);

    return () => {
      clearTimeout(timeout);
    };
  }, [location.pathname]);

  return (
    <>
      {isPageLoading && <PageLoader />}
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
          <Route exact path="/zap" element={<Wpp />} />
          <Route exact path="/whatsapp" element={<Wpp />} />
          <Route exact path="/wpp" element={<WhatsAppPage />} />
          <Route exact path="/matrix" element={<Matrix />} />
          <Route exact path="/politica-de-privacidade/:title" element={<Privacidade />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
};

const App = () => {
  return (
    <>
      <Analytics />
      <Router>
        <AppRoutes />
      </Router>
    </>
  );
};

export default App;
