import React from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";

import Home from "./routes/index";
import Matrix from "./routes/matrix/index";
import NotFound from "./routes/404/index";
import Wpp from "./routes/wpp/index";

import "./assets/css/style.css";

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

export default App;
