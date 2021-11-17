import React from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";

import Home from "./routes/index";

<<<<<<< HEAD
const App = () => {
  return (
    <Router>
      <Routes>
        <Route exact path="/" element={<Home />} />
        <Route exact path="/zap" element={<Wpp />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
};
=======
      <section class="jv-service image-bg featured-img-two">
        <div class="img-color-overlay">
          <div class="container">
            <div class="row section-separator">
              <div
                class="col-sm-12 text-center section-title wow fadeInUp"
                data-wow-duration="0.8s"
                data-wow-delay="0.2s"
              >
                <h2>O que eu sei ?</h2>
              </div>
              <div class="col-sm-4">
                <div
                  class="jv-service-item shadow-1 dark-bg wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.3s"
                >
                  <i class="fa fa-bullseye purple-color" />
                  <h3>UI Design</h3>
                  <p>
                    Estudei artes por anos e então foquei em Design de
                    Interfaces, Crio Sites, Identidade Visual, Design Gráfico e
                    Comunicação Visual seguindo conceitos do design, gestalt e
                    teorias das cores.
                  </p>
                </div>
              </div>
              <div class="col-sm-4">
                <div
                  class="jv-service-item shadow-1 dark-bg wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.5s"
                >
                  <i class="fa fa-code iron-color" />
                  <h3>Web Development</h3>
                  <p>
                    Posso desenvolver sites, de modo rápido e seguro, aplicando
                    sempre as melhores práticas e deixando-as com visual
                    moderno. Site, Sistema dentre outros serão Únicos!
                  </p>
                </div>
              </div>
              <div class="col-sm-4">
                <div
                  class="jv-service-item shadow-1 dark-bg wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.7s"
                >
                  <i class="fa fa-object-ungroup sky-color" />
                  <h3>App Development</h3>
                  <p>
                    Crio aplicativos utilizando o desenvolimento
                    cross-platamorma, Utilizando framework React-Native mantido
                    pelo Facebook, onde exportamos para as principais
                    plataformas do mercado.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="jv-skills " id="jv-skills">
        <div class="home-v-img">
          <div class="container">
            <div class="row section-separator">
              <div class="col-sm-12 col-md-6">
                <div class="jv-skills-inner">
                  <div
                    class="jv-professional-skill wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.3s"
                  >
                    <h3>Habilidades Técnicas</h3>
                    <div class="each-skills">
                      <div class="candidatos">
                        <div class="parcial">
                          <div class="info">
                            <div class="nome">Javascript</div>
                            <div class="percentagem-num">86%</div>
                          </div>
                          <div class="progressBar">
                            <div class="percentagem" style={{ width: "86%" }} />
                          </div>
                        </div>
                      </div>
                      <div class="candidatos">
                        <div class="parcial">
                          <div class="info">
                            <div class="nome">Java</div>
                            <div class="percentagem-num">26%</div>
                          </div>
                          <div class="progressBar">
                            <div class="percentagem" style={{ width: "26%" }} />
                          </div>
                        </div>
                      </div>
                      <div class="candidatos">
                        <div class="parcial">
                          <div class="info">
                            <div class="nome">Python</div>
                            <div class="percentagem-num">68%</div>
                          </div>
                          <div class="progressBar">
                            <div class="percentagem" style={{ width: "68%" }} />
                          </div>
                        </div>
                      </div>
                      <div class="candidatos">
                        <div class="parcial">
                          <div class="info">
                            <div class="nome">PHP</div>
                            <div class="percentagem-num">85%</div>
                          </div>
                          <div class="progressBar">
                            <div class="percentagem" style={{ width: "85%" }} />
                          </div>
                        </div>
                      </div>

                      <div class="candidatos">
                        <div class="parcial">
                          <div class="info">
                            <div class="nome">NodeJS</div>
                            <div class="percentagem-num">48%</div>
                          </div>
                          <div class="progressBar">
                            <div class="percentagem" style={{ width: "45%" }} />
                          </div>
                        </div>
                      </div>
                      <div class="candidatos">
                        <div class="parcial">
                          <div class="info">
                            <div class="nome">Ruby</div>
                            <div class="percentagem-num">12%</div>
                          </div>
                          <div class="progressBar">
                            <div class="percentagem" style={{ width: "12%" }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="col-sm-12 col-md-6">
                <div
                  class="jv-professional-skills wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.5s"
                >
                  <h3>Habilidades Profissionais</h3>
                  <ul class="jv-professional-progress">
                    <li>
                      <div
                        class="jv-progress jv-progress-circle"
                        data-progress="80"
                      />
                      <div class="pr-skill-name">Comunicação</div>
                    </li>
                    <li>
                      <div
                        class="jv-progress jv-progress-circle"
                        data-progress="55"
                      />
                      <div class="pr-skill-name">Trabalho em Equipe</div>
                    </li>
                    <li>
                      <div
                        class="jv-progress jv-progress-circle"
                        data-progress="86"
                      />
                      <div class="pr-skill-name">Gerenciamento de Projetos</div>
                    </li>
                    <li>
                      <div
                        class="jv-progress jv-progress-circle"
                        data-progress="90"
                      />
                      <div class="pr-skill-name">Proatividade</div>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        class="jv-experince image-bg featured-img-one"
        id="jv-experience"
      >
        <div class="img-color-overlay">
          <div class="container">
            <div class="row section-separator">
              <div class="col-sm-12 col-md-6">
                <div class="jv-education">
                  <h3
                    class="wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.2s"
                  >
                    Educação
                  </h3>
                  <div class="jv-education-deatils">
                    <div
                      class="jv-education-item dark-bg wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.3s"
                    >
                      <h4>
                        Colégio Educare{" "}
                        <a
                          target="_new"
                          href="https://www.colegioeducarebetim.com.br/"
                        >
                          Rede Pitágoras
                        </a>
                      </h4>
                      <div class="jv-eduyear">2011-2014</div>
                      <p>Conclusão do Ensino Médio</p>
                    </div>
                    <div
                      class="jv-education-item dark-bg wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.5s"
                    >
                      <h4>
                        Universidade Do Estado De Minas Gerais{" "}
                        <a target="_new" href="https://www.uemg.br">
                          UEMG
                        </a>
                      </h4>
                      <div class="jv-eduyear">2015-2019</div>
                      <p>Bacharelado em Sistemas de Informação</p>
                    </div>
                    <div
                      class="jv-education-item dark-bg wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.5s"
                    >
                      <h4>
                        <a target="_new" href="https://descomplica.com.br/pos-graduacao">
                          Descomplica{" "}
                        </a>
                        pós graduação
                      </h4>
                      <div class="jv-eduyear">2021-cursando</div>
                      <p>Pós em Projetos de aplicativos móveis multiplataforma</p>
                    </div>
                  </div>
                </div>
              </div>
              <div class="col-sm-12 col-md-6">
                <div class="jv-work">
                  <h3>Experiências de trabalho</h3>
                  <div class="jv-experience-deatils">
                    <div
                      class="jv-work-item dark-bg wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.6s"
                    >
                      <h4>
                        Consórcio Intermunicipal De Saúde - Verde{" "}
                        <a
                          target="_new"
                          href="https://www.guiamais.com.br/carangola-mg/profissionais-diversos/consultores-em-saude-e-qualidade-de-vida/2341979320-3753295/cis-verde"
                        >
                          CISVERDE
                        </a>
                      </h4>
                      <div class="jv-eduyear">2017-2018</div>
                      <span>Técnico em informática</span>
                    </div>
                    <div
                      class="jv-work-item dark-bg wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.4s"
                    >
                      <h4>
                        SOS tecnologia e educação{" "}
                        <a target="_new" href="https://www.sos.com.br/">
                          S.O.S
                        </a>
                      </h4>
                      <div class="jv-eduyear">2019-2019</div>
                      <span>Professor de informática</span>
                    </div>
                    <div
                      class="jv-work-item dark-bg wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.4s"
                    >
                      <h4>
                      <a target="_new" href="https://mappsistemas.com.br/">
                        Mapp Sistemas
                      </a> – Aplicativos e sistemas
                      </h4>
                      <div class="jv-eduyear">2020-atual</div>
                      <span>Desenvolvedor web fullstack</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
>>>>>>> e3434235fdb107cadbe96fd01b718d9a15ab09fb

function Wpp() {
  window.location.href = "https://api.whatsapp.com/send?phone=553199587817";
  return <h2>Redirecionando...</h2>;
}

function NotFound() {
  return <h2>Não encontrado</h2>;
}

export default App;
