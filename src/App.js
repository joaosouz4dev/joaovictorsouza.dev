import React from "react";

export default () => {
  const year = new Date().getFullYear();
  const anos = year - 2015;
  return (
    <main>
      <div class="section-loader">
        <div class="loader">
          <div />
          <div />
        </div>
      </div>

      <header
        class="black-bg jv-header jv-fixed-nav nav-scroll jv-xs-mobile-nav"
        id="jv-header"
      >
        <div class="overlay" />
        <div class="container">
          <div class="row">
            <nav class="navbar navbar-expand-lg jv-nav nav-btn">
              <button
                class="navbar-toggler"
                type="button"
                data-toggle="collapse"
                data-target="#navbarSupportedContent"
                aria-controls="navbarSupportedContent"
                aria-expanded="false"
                aria-label="Toggle navigation"
              >
                <span class="navbar-toggler-icon icon" />
              </button>

              <div class="collapse navbar-collapse" id="navbarSupportedContent">
                <ul class="navbar-nav mr-auto ml-auto">
                  <li class="nav-item active">
                    <a class="nav-link" href="#jv-home">
                      Inicio
                    </a>
                  </li>
                  <li class="nav-item">
                    <a class="nav-link" href="#jv-about">
                      Sobre
                    </a>
                  </li>
                  <li class="nav-item">
                    <a class="nav-link" href="#jv-skills">
                      Habilidades
                    </a>
                  </li>
                  <li class="nav-item">
                    <a class="nav-link" href="#jv-experience">
                      Experiências
                    </a>
                  </li>
                  <li class="nav-item">
                    <a class="nav-link" href="#jv-contact">
                      Contatos
                    </a>
                  </li>
                </ul>
              </div>
            </nav>
          </div>
        </div>
      </header>

      <section class="jv-home image-bg home-2-img" id="jv-home">
        <div class="img-foverlay img-color-overlay">
          <div class="container">
            <div class="row section-separator xs-column-reverse vertical-middle-content home-padding">
              <div class="col-sm-6">
                <div class="jv-header-info">
                  <div
                    class="jv-promo wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.1s"
                  >
                    <span>Olá, Tudo bem ?</span>
                  </div>

                  <h2
                    class="wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.2s"
                  >
                    João Victor Souza
                  </h2>
                  <h4
                    class="wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.3s"
                  >
                    Desenvolvedor
                  </h4>

                  <ul>
                    <li
                      class="wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.4s"
                    >
                      <i class="fa fa-envelope" />
                      web@joaovictorsouza.dev
                    </li>
                    <li
                      class="wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.5s"
                    >
                      <i class="fa fa-phone" />
                      <a
                        href="https://api.whatsapp.com/send?phone=553199587817"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        +55 31 9 9858-7817
                      </a>
                    </li>
                    <li
                      class="wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.6s"
                    >
                      <i class="fa fa-map-marker" />
                      Betim - Minas Gerais, Brasil
                    </li>
                  </ul>

                  <ul
                    class="social-icon wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.7s"
                  >
                    <li>
                      <a
                        href="https://www.facebook.com/joaosouz4dev"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <i class="fa fa-facebook" />
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://www.instagram.com/joaosouz4dev"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <i class="fa fa-instagram" />
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://github.com/joaosouz4dev"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <i class="fa fa-github" />
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://www.linkedin.com/in/joaosouz4dev"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <i class="fa fa-linkedin" />
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://api.whatsapp.com/send?phone=553199587817"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <i class="fa fa-whatsapp" />
                      </a>
                    </li>
                  </ul>
                </div>
              </div>
              <div class="col-sm-6">
                <div
                  class="hero-img wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.6s"
                >
                  <div class="img-border">
                    <img
                      src={process.env.PUBLIC_URL + "/assets/images/hero-1.png"}
                      alt=""
                      class="img-fluid"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="jv-about" id="jv-about">
        <div class="container">
          <div class="row section-separator">
            <div class="col-sm-12 col-md-6">
              <div
                class="jv-about-img shadow-2 wow fadeInUp"
                data-wow-duration="0.8s"
                data-wow-delay="0.4s"
              >
                <img
                  src={process.env.PUBLIC_URL + "/assets/images/4136918.png"}
                  alt=""
                  class="img-fluid"
                  style={{
                    maxHeight: "315px",
                    margin: "0 auto",
                    display: "block",
                  }}
                />
              </div>
            </div>
            <div class="col-sm-12 col-md-6">
              <div class="jv-about-inner">
                <h2
                  class="wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.1s"
                >
                  Sobre mim
                </h2>
                <p
                  class="wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.2s"
                >
                  Olá, sou o João, desenvolvedor Web no Brasil. Tenho uma rica
                  experiência em design, construção de sites e programação.
                  Geralmente utilizo:
                </p>
                <div
                  class="jv-about-tag wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.3s"
                >
                  <ul>
                    <li>
                      <span>photoshop</span>
                    </li>
                    <li>
                      <span>html</span>
                    </li>
                    <li>
                      <span>css</span>
                    </li>
                    <li>
                      <span>Javascript</span>
                    </li>
                    <li>
                      <span>jquery</span>
                    </li>
                    <li>
                      <span>React</span>
                    </li>
                    <li>
                      <span>React Native</span>
                    </li>
                    <li>
                      <span>php</span>
                    </li>
                    <li>
                      <span>wordpress</span>
                    </li>
                    <li>
                      <span>lumen</span>
                    </li>
                    <li>
                      <span>SQL</span>
                    </li>
                    <li>
                      <span>MONGODB</span>
                    </li>
                    <li>
                      <span>e outros</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

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
                      <div class="jv-eduyear">2015-2020</div>
                      <p>Bacharelado em Sistemas de Informação</p>
                    </div>
                    <div
                      class="jv-education-item dark-bg wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.5s"
                    >
                      <h4>
                        <a target="_new" href="https://descomplica.com.br/pos-graduacao">
                          Descomplica
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
                      </a> – Desenvolvimento de aplicativos e sistemas
                      </h4>
                      <div class="jv-eduyear">2020-atual</div>
                      <span>Desenvolvedor web fullStack</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="jv-quates">
        <div class="container">
          <div class="row section-separator">
            <div class="each-quates col-sm-12 col-md-6">
              <h3
                class="wow fadeInUp"
                data-wow-duration="0.8s"
                data-wow-delay="0.2s"
              >
                Vamos trabalhar juntos?
              </h3>
              <p
                class="wow fadeInUp"
                data-wow-duration="0.8s"
                data-wow-delay="0.4s"
              >
                Desenvolvedor, design e proativo. Há {anos} anos na programação,
                João Victor Souza tem a arte de programar como profissão e
                paixão.
              </p>
              <a
                href="https://api.whatsapp.com/send?phone=553199587817"
                class="btn btn-fill wow fadeInUp"
                data-wow-duration="0.8s"
                data-wow-delay="0.5s"
              >
                Whatsapp <i class="fa fa-whatsapp" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer class="jv-footer jv-footer-3" id="jv-contact">
        <div class="container-fluid">
          <div class="row section-separator">
            <div
              class="col-sm-12 section-title wow fadeInUp"
              data-wow-duration="0.8s"
              data-wow-delay="0.2s"
            >
              <h3>Meus Contatos</h3>
            </div>
            <div class="map-image image-bg col-sm-12">
              <div class="container mt-30">
                <div class="row">
                  <div
                    class="col-sm-12 col-md-6 jv-footer-address wow fadeInUp mx-auto"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.2s"
                  >
                    <div class="col-sm-12 xs-no-padding">
                      <div
                        class="jv-address-footer-item dark-bg shadow-1 media wow fadeInUp"
                        data-wow-duration="0.8s"
                        data-wow-delay="0.2s"
                      >
                        <div class="each-icon">
                          <i class="fa fa-location-arrow" />
                        </div>
                        <div class="each-info media-body">
                          <h4>Endereço</h4>
                          <address>Betim - MG</address>
                        </div>
                      </div>
                    </div>
                    <div class="col-sm-12 xs-no-padding">
                      <div
                        class="jv-address-footer-item media dark-bg shadow-1 wow fadeInUp"
                        data-wow-duration="0.8s"
                        data-wow-delay="0.4s"
                      >
                        <div class="each-icon">
                          <i class="fa fa-envelope-o" />
                        </div>
                        <div class="each-info media-body">
                          <h4>Email</h4>
                          <a href="mailto:web@joaovictorsouza.dev">
                            web@joaovictorsouza.dev
                          </a>
                        </div>
                      </div>
                    </div>
                    <div class="col-sm-12 xs-no-padding">
                      <div
                        class="jv-address-footer-item media dark-bg shadow-1 wow fadeInUp"
                        data-wow-duration="0.8s"
                        data-wow-delay="0.6s"
                      >
                        <div class="each-icon">
                          <i class="fa fa-phone" />
                        </div>
                        <div class="each-info media-body">
                          <h4>Telefone</h4>
                          <a href="callto:+5531998587817">(31) 9 9858-7817</a>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    class="col-sm-12 jv-copyright wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.2s"
                  >
                    <div class="row">
                      <div class="col-sm-6">
                        <div class="text-center">
                          <p>
                            João Victor Souza © {year} -{" "}
                            <a
                              target="_new"
                              href="https://github.com/joaosouz4dev"
                              style={{ color: "#0bceaf" }}
                            >
                              Meu repositório
                            </a>
                          </p>
                        </div>
                      </div>
                      <div class="col-sm-6 text-center">
                        <ul
                          class="social-icon wow fadeInUp"
                          data-wow-duration="0.8s"
                          data-wow-delay="0.7s"
                        >
                          <li>
                            <a
                              href="https://www.facebook.com/joaosouz4dev"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <i class="fa fa-facebook" />
                            </a>
                          </li>
                          <li>
                            <a
                              href="https://www.instagram.com/joaosouz4dev"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <i class="fa fa-instagram" />
                            </a>
                          </li>
                          <li>
                            <a
                              href="https://github.com/joaosouz4dev"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <i class="fa fa-github" />
                            </a>
                          </li>
                          <li>
                            <a
                              href="https://www.linkedin.com/in/joaosouz4dev"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <i class="fa fa-linkedin" />
                            </a>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
};
