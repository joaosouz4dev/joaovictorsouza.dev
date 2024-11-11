import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

import '../assets/css/style.css';

import Home from '../pages/home';
import Matrix from '../pages/matrix';
import NotFound from '../pages/404';
import Wpp from '../pages/wpp';
import Privacidade from '../pages/privacidade';
import { Analytics } from '@vercel/analytics/react';

const App = () => {
  return (
    <>
      <Analytics />
      <Router>
        <Routes>
          <Route exact path="/" element={<Home />} />
          <Route exact path="/zap" element={<Wpp />} />
          <Route exact path="/whatsapp" element={<Wpp />} />
          <Route exact path="/matrix" element={<Matrix />} />
          <Route exact path="/politica-de-privacidade/:title" element={<Privacidade />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
    </>
  );
};

export default App;
