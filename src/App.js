import React from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";

import "./assets/css/style.css";

import Home from "./routes/index";
import Matrix from "./routes/matrix/index";
import NotFound from "./routes/404/index";
import Wpp from "./routes/wpp/index";
import Converta from "./routes/converta";

const App = () => {
  return (
    <Router>
      <Routes>
        <Route exact path="/" element={<Home />} />
        <Route exact path="/zap" element={<Wpp />} />
        <Route exact path="/matrix" element={<Matrix />} />
        <Route exact path="/converta/ibivagas" element={<Converta />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
};

export default App;
