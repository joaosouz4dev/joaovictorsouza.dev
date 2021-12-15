import React from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";

import Home from "./routes/index";
import Matrix from "./routes/matrix/index";

const App = () => {
  return (
    <Router>
      <Routes>
        <Route exact path="/" element={<Home />} />
        <Route exact path="/zap" element={<Wpp />} />
        <Route exact path="/matrix" element={<Matrix />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
};

function Wpp() {
  window.location.href = "https://api.whatsapp.com/send?phone=553199587817";
  return <h2>Redirecionando...</h2>;
}

function NotFound() {
  return <h2>Não encontrado</h2>;
}

export default App;
