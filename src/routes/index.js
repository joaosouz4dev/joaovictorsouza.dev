import React from "react";
require("@lottiefiles/lottie-player");

export default () => {
  const tecnologias = [
    "Photoshop",
    "Illustrator",
    "Sketch",
    "Html",
    "Css",
    "Javascript",
    "JQuery",
    "NodeJS",
    "MongoDB",
    "PHP",
    "Wordpress",
    "Lumen",
    "SQL",
    "Express",
    "NextJS",
    "ReactJS",
    "React Native",
  ];
  const year = new Date().getFullYear();
  const anos = year - 2015;
  return (
    <main>
      <div className="section-loader">
        <div className="loader">
          <div />
          <div />
        </div>
      </div>

      <header
        className="black-bg jv-header jv-fixed-nav nav-scroll jv-xs-mobile-nav"
        id="jv-header"
      >
        <div className="overlay" />
        <div className="container">
          <div className="row">
            <nav className="navbar navbar-expand-lg jv-nav nav-btn">
              <button
                className="navbar-toggler"
                type="button"
                data-toggle="collapse"
                data-target="#navbarSupportedContent"
                aria-controls="navbarSupportedContent"
                aria-expanded="false"
                aria-label="Toggle navigation"
              >
                <span className="navbar-toggler-icon icon" />
              </button>

              <div
                className="collapse navbar-collapse"
                id="navbarSupportedContent"
              >
                <ul className="navbar-nav mr-auto ml-auto">
                  <li className="nav-item active">
                    <a className="nav-link" href="#jv-home">
                      Inicio
                    </a>
                  </li>
                  <li className="nav-item">
                    <a className="nav-link" href="#jv-about">
                      Sobre
                    </a>
                  </li>
                  <li className="nav-item">
                    <a className="nav-link" href="#jv-skills">
                      Habilidades
                    </a>
                  </li>
                  <li className="nav-item">
                    <a className="nav-link" href="#jv-experience">
                      Experiências
                    </a>
                  </li>
                  <li className="nav-item">
                    <a className="nav-link" href="#jv-contact">
                      Contatos
                    </a>
                  </li>
                </ul>
              </div>
            </nav>
          </div>
        </div>
      </header>

      <section className="jv-home image-bg home-2-img" id="jv-home">
        <div className="img-foverlay img-color-overlay">
          <div className="container">
            <div className="row section-separator xs-column-reverse vertical-middle-content home-padding">
              <div className="col-sm-6">
                <div className="jv-header-info">
                  <div
                    className="jv-promo wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.1s"
                  >
                    <span>Olá, Tudo bem ?</span>
                  </div>

                  <h2
                    className="wow fadeInUp wrapper"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.2s"
                  >
                    <div
                      className="stack"
                      style={{
                        "--stacks": "3",
                      }}
                    >
                      <span style={{ "--index": "0" }}>João Victor Souza</span>
                      <span style={{ "--index": "1" }}>João Victor Souza</span>
                      <span style={{ "--index": "2" }}>João Victor Souza</span>
                    </div>
                  </h2>
                  <h4
                    className="wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.3s"
                  >
                    Software Developer
                  </h4>

                  <ul>
                    <li
                      className="wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.4s"
                    >
                      <i className="fa fa-envelope" />
                      web@joaovictorsouza.dev
                    </li>
                    <li
                      className="wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.5s"
                    >
                      <i className="fa fa-phone" />
                      <a
                        href="https://api.whatsapp.com/send?phone=553199587817"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        +55 31 9 9858-7817
                      </a>
                    </li>
                    <li
                      className="wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.6s"
                    >
                      <i className="fa fa-map-marker" />
                      Betim - Minas Gerais, Brasil
                    </li>
                  </ul>

                  <ul
                    className="social-icon wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.7s"
                  >
                    <li>
                      <a
                        href="https://www.facebook.com/joaosouz4dev"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <i className="fa fa-facebook" />
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://www.instagram.com/joaosouz4dev"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <i className="fa fa-instagram" />
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://github.com/joaosouz4dev"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <i className="fa fa-github" />
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://www.linkedin.com/in/joaosouz4dev"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <i className="fa fa-linkedin" />
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://api.whatsapp.com/send?phone=553199587817"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <i className="fa fa-whatsapp" />
                      </a>
                    </li>
                  </ul>
                </div>
              </div>
              <div className="col-sm-6">
                <div
                  className="hero-img wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.6s"
                >
                  <div className="img-border">
                    <img
                      src={process.env.PUBLIC_URL + "/assets/images/hero-2.jpg"}
                      alt=""
                      className="img-fluid"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="jv-about" id="jv-about">
        <div className="container">
          <div className="row section-separator">
            <div className="col-sm-12 col-md-6">
              <div
                className="jv-about-img shadow-2 wow fadeInUp"
                data-wow-duration="0.8s"
                data-wow-delay="0.4s"
              >
                <div
                  style={{
                    maxHeight: "315px",
                    margin: "0 auto",
                    display: "block",
                    filter: "grayscale(100%)",
                  }}
                >
                  <lottie-player
                    autoplay
                    loop
                    mode="normal"
                    src={
                      process.env.PUBLIC_URL +
                      "/assets/images/lottie/79681-usability-concept-illustration.json"
                    }
                    style={{
                      width: "300px",
                      height: "300px",
                      margin: "0 auto",
                    }}
                  ></lottie-player>
                </div>
              </div>
            </div>
            <div className="col-sm-12 col-md-6">
              <div className="jv-about-inner">
                <h2
                  className="wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.1s"
                >
                  Sobre mim
                </h2>
                <p
                  className="wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.2s"
                >
                  Sou um desenvolvedor web e estou sempre procurando resolver
                  problemas, fazer melhorias no que já existe e criar algo novo
                  que tenha um impacto social positivo. Busco novos
                  conhecimentos a cada dia e adoro desafios! Geralmente utilizo:
                </p>
                <div
                  className="jv-about-tag wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.3s"
                >
                  <ul>
                    {tecnologias.map((tecnologia, i) => (
                      <li key={i}>
                        <span>{tecnologia}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="jv-service image-bg featured-img-two">
        <div className="img-color-overlay">
          <div className="container">
            <div className="row section-separator">
              <div
                className="col-sm-12 text-center section-title wow fadeInUp"
                data-wow-duration="0.8s"
                data-wow-delay="0.2s"
              >
                <h2>O que eu sei ?</h2>
              </div>
              <div className="col-sm-4">
                <div
                  className="jv-service-item shadow-1 dark-bg wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.3s"
                >
                  <i
                    className="fa fa-bullseye purple-color"
                    style={{
                      filter: "grayscale(100%)",
                    }}
                  />
                  <h3>UI Design</h3>
                  <p>
                    Estudei artes por anos e então foquei em Design de
                    Interfaces, Crio Sites, Identidade Visual, Design Gráfico e
                    Comunicação Visual seguindo conceitos do design, gestalt e
                    teorias das cores.
                  </p>
                </div>
              </div>
              <div className="col-sm-4">
                <div
                  className="jv-service-item shadow-1 dark-bg wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.5s"
                >
                  <i
                    className="fa fa-code iron-color"
                    style={{
                      filter: "grayscale(100%)",
                    }}
                  />
                  <h3>Web Development</h3>
                  <p>
                    Posso desenvolver sites, de modo rápido e seguro, aplicando
                    sempre as melhores práticas e deixando-as com visual
                    moderno. Site, Sistema dentre outros serão Únicos!
                  </p>
                </div>
              </div>
              <div className="col-sm-4">
                <div
                  className="jv-service-item shadow-1 dark-bg wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.7s"
                >
                  <i
                    className="fa fa-object-ungroup sky-color"
                    style={{
                      filter: "grayscale(100%)",
                    }}
                  />
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

      <section className="jv-skills " id="jv-skills">
        <div className="home-v-img">
          <div className="container">
            <div className="row section-separator">
              <div className="col-sm-12 col-md-6">
                <div className="jv-skills-inner">
                  <div
                    className="jv-professional-skill wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.3s"
                  >
                    <h3>Habilidades Técnicas</h3>
                    <div className="each-skills">
                      <div className="candidatos">
                        <div className="parcial">
                          <div className="info">
                            <div className="nome">Javascript</div>
                            <div className="percentagem-num">86%</div>
                          </div>
                          <div className="progressBar">
                            <div
                              className="percentagem"
                              style={{ width: "96%" }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="candidatos">
                        <div className="parcial">
                          <div className="info">
                            <div className="nome">React</div>
                            <div className="percentagem-num">26%</div>
                          </div>
                          <div className="progressBar">
                            <div
                              className="percentagem"
                              style={{ width: "86%" }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="candidatos">
                        <div className="parcial">
                          <div className="info">
                            <div className="nome">Python</div>
                            <div className="percentagem-num">68%</div>
                          </div>
                          <div className="progressBar">
                            <div
                              className="percentagem"
                              style={{ width: "58%" }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="candidatos">
                        <div className="parcial">
                          <div className="info">
                            <div className="nome">PHP</div>
                            <div className="percentagem-num">85%</div>
                          </div>
                          <div className="progressBar">
                            <div
                              className="percentagem"
                              style={{ width: "85%" }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="candidatos">
                        <div className="parcial">
                          <div className="info">
                            <div className="nome">NodeJS</div>
                            <div className="percentagem-num">48%</div>
                          </div>
                          <div className="progressBar">
                            <div
                              className="percentagem"
                              style={{ width: "89%" }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="candidatos">
                        <div className="parcial">
                          <div className="info">
                            <div className="nome">Ruby</div>
                            <div className="percentagem-num">12%</div>
                          </div>
                          <div className="progressBar">
                            <div
                              className="percentagem"
                              style={{ width: "40%" }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-sm-12 col-md-6">
                <div
                  className="jv-professional-skills wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.5s"
                >
                  <h3>Habilidades Profissionais</h3>
                  <ul className="jv-professional-progress">
                    <li>
                      <div
                        className="jv-progress jv-progress-circle"
                        data-progress="80"
                      />
                      <div className="pr-skill-name">Comunicação</div>
                    </li>
                    <li>
                      <div
                        className="jv-progress jv-progress-circle"
                        data-progress="55"
                      />
                      <div className="pr-skill-name">Trabalho em Equipe</div>
                    </li>
                    <li>
                      <div
                        className="jv-progress jv-progress-circle"
                        data-progress="86"
                      />
                      <div className="pr-skill-name">
                        Gerenciamento de Projetos
                      </div>
                    </li>
                    <li>
                      <div
                        className="jv-progress jv-progress-circle"
                        data-progress="90"
                      />
                      <div className="pr-skill-name">Proatividade</div>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="jv-experince image-bg featured-img-one"
        id="jv-experience"
      >
        <div className="img-color-overlay">
          <div className="container">
            <div className="row section-separator">
              <div className="col-sm-12 col-md-6">
                <div className="jv-education">
                  <h3
                    className="wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.2s"
                  >
                    Educação
                  </h3>
                  <div className="jv-education-deatils">
                    <div
                      className="jv-education-item dark-bg wow fadeInUp"
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
                      <div className="jv-eduyear">2011-2014</div>
                      <p>Conclusão do Ensino Médio</p>
                    </div>
                    <div
                      className="jv-education-item dark-bg wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.5s"
                    >
                      <h4>
                        Universidade Do Estado De Minas Gerais{" "}
                        <a target="_new" href="https://www.uemg.br">
                          UEMG
                        </a>
                      </h4>
                      <div className="jv-eduyear">2015-2020</div>
                      <p>Bacharelado em Sistemas de Informação</p>
                    </div>
                    <div
                      className="jv-education-item dark-bg wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.5s"
                    >
                      <h4>
                        <a
                          target="_new"
                          href="https://descomplica.com.br/pos-graduacao"
                        >
                          Descomplica{" "}
                        </a>
                        pós graduação
                      </h4>
                      <div className="jv-eduyear">2021-cursando</div>
                      <p>
                        Pós em Projetos de aplicativos móveis multiplataforma
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-sm-12 col-md-6">
                <div className="jv-work">
                  <h3>Experiências de trabalho</h3>
                  <div className="jv-experience-deatils">
                    <div
                      className="jv-work-item dark-bg wow fadeInUp"
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
                      <div className="jv-eduyear">2017-2018</div>
                      <span>Técnico em informática</span>
                    </div>
                    <div
                      className="jv-work-item dark-bg wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.4s"
                    >
                      <h4>
                        SOS tecnologia e educação{" "}
                        <a target="_new" href="https://www.sos.com.br/">
                          S.O.S
                        </a>
                      </h4>
                      <div className="jv-eduyear">2019-2019</div>
                      <span>Professor de informática</span>
                    </div>
                    <div
                      className="jv-work-item dark-bg wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.4s"
                    >
                      <h4>
                        <a target="_new" href="https://mappsistemas.com.br/">
                          Mapp Sistemas
                        </a>{" "}
                        – Aplicativos e sistemas
                      </h4>
                      <div className="jv-eduyear">2020-2021</div>
                      <span>Desenvolvedor front end</span>
                    </div>
                    <div
                      className="jv-work-item dark-bg wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.4s"
                    >
                      <h4>
                        <a target="_new" href="https://www.drpaysaude.com.br/">
                          Dr.pay
                        </a>{" "}
                        – Soluções e Sáude
                      </h4>
                      <div className="jv-eduyear">2021-atual</div>
                      <span>Desenvolvedor front end pleno</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="jv-quates">
        <div className="container">
          <div className="row section-separator">
            <div className="each-quates col-sm-12 col-md-6">
              <h3
                className="wow fadeInUp"
                data-wow-duration="0.8s"
                data-wow-delay="0.2s"
              >
                Vamos trabalhar juntos?
              </h3>
              <p
                className="wow fadeInUp"
                data-wow-duration="0.8s"
                data-wow-delay="0.4s"
              >
                Desenvolvedor, design e proativo. Há {anos} anos na programação,
                João Victor Souza tem a arte de programar como profissão e
                paixão.
              </p>
              <a
                href="https://api.whatsapp.com/send?phone=553199587817"
                className="btn btn-fill wow fadeInUp"
                data-wow-duration="0.8s"
                data-wow-delay="0.5s"
              >
                Whatsapp <i className="fa fa-whatsapp" />
              </a>
            </div>
            <div className="each-quates col-sm-12 col-md-6">
              <div className="wrap-image">
                <img src={process.env.PUBLIC_URL + "/assets/images/foto.jpg"} alt="" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="jv-footer jv-footer-3" id="jv-contact">
        <div className="container-fluid">
          <div className="row section-separator">
            <div
              className="col-sm-12 section-title wow fadeInUp"
              data-wow-duration="0.8s"
              data-wow-delay="0.2s"
            >
              <h3>Meus Contatos</h3>
            </div>
            <div className="map-image image-bg col-sm-12">
              <div className="container mt-30">
                <div className="row">
                  <div
                    className="col-sm-12 col-md-6 jv-footer-address wow fadeInUp mx-auto"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.2s"
                  >
                    <div className="col-sm-12 xs-no-padding">
                      <div
                        className="jv-address-footer-item dark-bg shadow-1 media wow fadeInUp"
                        data-wow-duration="0.8s"
                        data-wow-delay="0.2s"
                      >
                        <div className="each-icon">
                          <i className="fa fa-location-arrow" />
                        </div>
                        <div className="each-info media-body">
                          <h4>Endereço</h4>
                          <address>Betim - MG</address>
                        </div>
                      </div>
                    </div>
                    <div className="col-sm-12 xs-no-padding">
                      <div
                        className="jv-address-footer-item media dark-bg shadow-1 wow fadeInUp"
                        data-wow-duration="0.8s"
                        data-wow-delay="0.4s"
                      >
                        <div className="each-icon">
                          <i className="fa fa-envelope-o" />
                        </div>
                        <div className="each-info media-body">
                          <h4>Email</h4>
                          <a href="mailto:web@joaovictorsouza.dev">
                            web@joaovictorsouza.dev
                          </a>
                        </div>
                      </div>
                    </div>
                    <div className="col-sm-12 xs-no-padding">
                      <div
                        className="jv-address-footer-item media dark-bg shadow-1 wow fadeInUp"
                        data-wow-duration="0.8s"
                        data-wow-delay="0.6s"
                      >
                        <div className="each-icon">
                          <i className="fa fa-phone" />
                        </div>
                        <div className="each-info media-body">
                          <h4>Telefone</h4>
                          <a href="callto:+5531998587817">(31) 9 9858-7817</a>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    className="col-sm-12 jv-copyright wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.2s"
                  >
                    <div className="row">
                      <div className="col-sm-6">
                        <div className="text-center">
                          <p>© {year} - João Victor Souza</p>
                        </div>
                      </div>
                      <div className="col-sm-6 text-center">
                        <ul
                          className="social-icon wow fadeInUp"
                          data-wow-duration="0.8s"
                          data-wow-delay="0.7s"
                        >
                          <li>
                            <a
                              href="https://www.facebook.com/joaosouz4dev"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <i className="fa fa-facebook" />
                            </a>
                          </li>
                          <li>
                            <a
                              href="https://www.instagram.com/joaosouz4dev"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <i className="fa fa-instagram" />
                            </a>
                          </li>
                          <li>
                            <a
                              href="https://github.com/joaosouz4dev"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <i className="fa fa-github" />
                            </a>
                          </li>
                          <li>
                            <a
                              href="https://www.linkedin.com/in/joaosouz4dev"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <i className="fa fa-linkedin" />
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
