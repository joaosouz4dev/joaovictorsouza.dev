import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

import '../assets/css/style.css';

import Home from '../pages/home';
import Matrix from '../pages/matrix';
import NotFound from '../pages/404';
import Wpp from '../pages/wpp';
import Privacidade from '../pages/privacidade';
import Sobre from '../pages/sobre';
import Servicos from '../pages/servicos';
import Servico from '../pages/servico';
import Cases from '../pages/cases';
import Case from '../pages/case';
import Blog from '../pages/blog';
import BlogPost from '../pages/blog-post';
import Projetos from '../pages/projetos';
import Projeto from '../pages/projeto';
import Contato from '../pages/contato';
import { Analytics } from '@vercel/analytics/react';
import WhatsAppPage from '../pages/wpp-new';

const App = () => {
  return (
    <>
      <Analytics />
      <Router>
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
      </Router>
    </>
  );
};

export default App;
