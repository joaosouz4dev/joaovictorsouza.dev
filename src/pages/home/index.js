import React, { useState, useEffect } from 'react';
import Portifolio from '../../components/portifolio';
import SvgAnimated from '../../components/portifolio/svgAnimated';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import iconCv from '../../assets/images/icon-cv.png';
import LanguageSelector from '../../components/footer/languageSelector';

import profile from '../../assets/images/profile/profile.png';
import Navbar from '../../components/navbar';
import Seo from '../../components/seo';

// const oldprofile = '/assets/images/new/hero-2.webp'

const ANO_INICIAL = 2015;

const tecnologias = [
  'Typescript',
  'Javascript',
  'ReactJS',
  'React Native',
  'NextJS',
  'PHP',
  'NodeJS',
  'Photoshop',
  'Illustrator',
  'Sketch',
  'Html',
  'Css',
  'JQuery',
  'MongoDB',
  'Wordpress',
  'Lumen',
  'SQL',
  'Express',
];

const linkedin = 'https://www.linkedin.com/in/joaosouz4dev';

const celular = '+55 31 9 9858-7817';

const whatsappUrl = 'https://joaovictorsouza.dev/whatsapp';

const redes_sociais = [
  {
    nome: 'Facebook',
    url: 'https://www.facebook.com/joaosouz4dev',
    icone: 'fa fa-facebook',
  },
  {
    nome: 'Instagram',
    url: 'https://www.instagram.com/joaosouz4dev',
    icone: 'fa fa-instagram',
  },
  {
    nome: 'Github',
    url: 'https://github.com/joaosouz4dev',
    icone: 'fa fa-github',
  },
  {
    nome: 'Linkedin',
    url: linkedin,
    icone: 'fa fa-linkedin',
  },
  {
    nome: 'Whatsapp',
    url: whatsappUrl,
    icone: 'fa fa-whatsapp',
  },
];

const Home = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const year = new Date().getFullYear();
  const anos = year - ANO_INICIAL;
  const [darkMode, setDarkMode] = useState(true);
  const [menuActive, setMenuActive] = useState('/');
  const [isLoading, setIsLoading] = useState(true);

  const menus = [
    {
      href: '/',
      label: 'Inicio',
    },
    {
      href: '/sobre',
      label: 'Sobre',
    },
    {
      href: '/servicos',
      label: 'Servicos',
    },
    {
      href: '/cases',
      label: 'Cases',
    },
    {
      href: '/blog',
      label: 'Blog',
    },
    {
      href: '/projetos',
      label: 'Projetos',
    },
    {
      href: '/contato',
      label: 'Contato',
    },
  ];

  const professionalSkills = [
    { progress: 80, label: t('skills.words.communication') },
    { progress: 55, label: t('skills.words.teamwork') },
    { progress: 86, label: t('skills.words.management') },
    { progress: 90, label: t('skills.words.proactivity') },
  ];

  const homeSchema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: 'Joao Victor Souza',
      url: 'https://joaovictorsouza.dev/',
      sameAs: [linkedin, 'https://github.com/joaosouz4dev'],
      jobTitle:
        'Especialista em WhatsApp Cloud API, Meta CAPI e Chatbots com IA',
      knowsAbout: [
        'WhatsApp Cloud API',
        'Meta Pixel',
        'Conversions API',
        'Chatbots com IA',
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Joao Victor Souza',
      url: 'https://joaovictorsouza.dev/',
    },
  ];

  useEffect(() => {
    if (localStorage.getItem('darkmode') !== null) {
      setDarkMode(localStorage.getItem('darkmode') === 'true');
    } else {
      const prefersDarkMode = window.matchMedia(
        '(prefers-color-scheme: dark)',
      ).matches;
      setDarkMode(prefersDarkMode);
      localStorage.setItem('darkmode', prefersDarkMode);
    }

    setTimeout(() => {
      setIsLoading(false);
    }, 300);
  }, []);

  useEffect(() => {
    setMenuActive(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const body = document.querySelector('body');
    if (darkMode) {
      body.classList.add('dark-vertion');
      body.classList.remove('white-vertion');
    } else {
      body.classList.remove('dark-vertion');
      body.classList.add('white-vertion');
    }
  }, [darkMode]);

  useEffect(() => {
    // SPA fallback: when navigating back to Home, WOW/legacy scripts might not re-run.
    // This keeps "Portfolio recente" and "Habilidades Profissionais" visible and stable.
    const revealWowElements = () => {
      document.querySelectorAll('.wow').forEach((element) => {
        if (element instanceof HTMLElement) {
          element.style.visibility = 'visible';
        }
      });
    };

    revealWowElements();
  }, []);

  const toggleDarkMode = () => {
    let _darkMode = !darkMode;
    setDarkMode(_darkMode);
    localStorage.setItem('darkmode', _darkMode);
  };

  const toggleMenuActive = (menu) => {
    setMenuActive(menu);
    navigate(menu);
  };

  return (
    <>
      <Seo
        title="Especialista em WhatsApp Cloud API, Meta CAPI e IA | Joao Victor Souza"
        description="Desenvolvedor especialista em integracao WhatsApp Cloud API, Meta Pixel/CAPI, chatbots com IA e automacoes para atendimento e vendas."
        canonical="/"
        keywords="whatsapp cloud api, meta capi, chatbot ia, integracoes api, automacao atendimento"
        schema={homeSchema}
      />
      <main>
      {isLoading && (
        <div className="section-loader">
          <div className="loader">
            <div />
            <div />
          </div>
        </div>
      )}

      <header
        className="black-bg jv-header jv-fixed-nav nav-scroll jv-xs-mobile-nav"
        id="jv-header"
      >
        <Navbar
          menus={menus}
          menuActive={menuActive}
          toggleMenuActive={toggleMenuActive}
          toggleDarkMode={toggleDarkMode}
          darkMode={darkMode}
        />
      </header>

      <section className="jv-home image-bg home-1-img" id="jv-home">
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
                    <span>{t('banner.title')}</span>
                  </div>

                  <h2
                    className="wow fadeInUp wrapper"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.2s"
                    style={{
                      position: 'relative',
                    }}
                  >
                    <div
                      className="stack"
                      style={{
                        '--stacks': '3',
                      }}
                    >
                      <span style={{ '--index': '0' }}>João Victor Souza</span>
                      <span style={{ '--index': '1' }}>João Victor Souza</span>
                      <span style={{ '--index': '2' }}>João Victor Souza</span>
                    </div>
                  </h2>
                  <h4
                    className="wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.3s"
                  >
                    {t('banner.profession')}
                  </h4>

                  <ul>
                    <li
                      className="wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.4s"
                    >
                      <i className="fa fa-envelope" />
                      <a href="mailto:web@joaovictorsouza.dev">
                        web@joaovictorsouza.dev
                      </a>
                    </li>
                    <li
                      className="wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.5s"
                    >
                      <i className="fa fa-phone" />
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {celular}
                      </a>
                    </li>
                    <li
                      className="wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.6s"
                    >
                      <i className="fa fa-map-marker" />
                      {t('banner.location')}
                    </li>
                  </ul>
                  <ul
                    className="social-icon wow fadeInUp"
                    data-wow-duration="0.8s"
                    data-wow-delay="0.7s"
                  >
                    {redes_sociais.map((rede) => (
                      <li key={rede.nome}>
                        <a
                          href={rede.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <i className={rede.icone} />
                        </a>
                      </li>
                    ))}
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
                      src={profile}
                      alt="Foto de Joao Victor Souza"
                      className="img-fluid"
                      width="500"
                      height="500"
                      fetchPriority="high"
                      decoding="async"
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
                <SvgAnimated />
              </div>
            </div>
            <div className="col-sm-12 col-md-6">
              <div className="jv-about-inner">
                <h2
                  className="wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.1s"
                >
                  {t('about.title')}
                </h2>
                <p
                  className="wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.2s"
                >
                  {t('about.description')}
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
        <div className="jv-service image-bg featured-img-two">
          <div className="img-color-overlay">
            <div className="container">
              <div className="row section-separator">
                <div
                  className="col-sm-12 text-center section-title wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.2s"
                >
                  <h2>{t('skills.title')}</h2>
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
                        filter: 'grayscale(100%)',
                      }}
                    />
                    <h3>{t('skills.card1.title')}</h3>
                    <p>{t('skills.card1.description')}</p>
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
                        filter: 'grayscale(100%)',
                      }}
                    />
                    <h3>{t('skills.card2.title')}</h3>
                    <p>{t('skills.card2.description')}</p>
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
                        filter: 'grayscale(100%)',
                      }}
                    />
                    <h3>{t('skills.card3.title')}</h3>
                    <p>{t('skills.card3.description')}</p>
                  </div>
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
                    <h3>{t('skills.title2')}</h3>
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
                              style={{ width: '96%' }}
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
                              style={{ width: '86%' }}
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
                              style={{ width: '58%' }}
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
                              style={{ width: '85%' }}
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
                              style={{ width: '89%' }}
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
                              style={{ width: '40%' }}
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
                  <h3>{t('skills.title3')}</h3>
                  <ul className="jv-professional-progress">
                    {professionalSkills.map((skill) => (
                      <li key={skill.label}>
                        <div
                          className="jv-progress jv-progress-circle is-static"
                          style={{
                            '--progress': `${skill.progress}%`,
                          }}
                        >
                          <span>{skill.progress}%</span>
                        </div>
                        <div className="pr-skill-name">{skill.label}</div>
                      </li>
                    ))}
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
              <div className="each-quates col-sm-12 col-md-6">
                <div
                  style={{
                    padding: '40px',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <img
                    src={iconCv}
                    alt=""
                    style={{
                      maxHeight: '160px',
                      opacity: '0.7',
                    }}
                  />
                </div>
              </div>
              <div className="each-quates col-sm-12 col-md-6">
                <h3
                  className="wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.2s"
                >
                  {t('experiences.since')} {ANO_INICIAL}{' '}
                  {t('experiences.title')}
                </h3>
                <p
                  className="wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.4s"
                >
                  {t('experiences.description')}
                </p>
                <a
                  href={linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className="cta wow fadeInUp "
                  data-wow-duration="0.8s"
                  data-wow-delay="0.5s"
                >
                  <span>
                    <i className="fa fa-linkedin" /> Linkedin
                  </span>
                  <svg width="13px" height="10px" viewBox="0 0 13 10">
                    <path d="M1,5 L11,5"></path>
                    <polyline points="8 1 12 5 8 9"></polyline>
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Portifolio />

      <section className="home-seo-links">
        <div className="container">
          <div className="row section-separator">
            <div className="col-sm-12 section-title wow fadeInUp">
              <h3>Especialidades e Conteudo Tecnico</h3>
              <p>
                Páginas focadas em servicos, cases e artigos para integracao
                Meta, WhatsApp e IA.
              </p>
            </div>
            <div className="col-sm-12">
              <div className="seo-grid">
                <article className="seo-card">
                  <h4>Servico WhatsApp Cloud API</h4>
                  <p>Webhooks, templates, filas e handoff humano.</p>
                  <Link to="/servicos/whatsapp-cloud-api">Acessar pagina</Link>
                </article>
                <article className="seo-card">
                  <h4>Servico Meta Pixel + CAPI</h4>
                  <p>Mensuracao server-side com deduplicacao de eventos.</p>
                  <Link to="/servicos/meta-ads-e-integracoes">
                    Acessar pagina
                  </Link>
                </article>
                <article className="seo-card">
                  <h4>Blog tecnico</h4>
                  <p>Guias práticos de arquitetura, integracoes e IA.</p>
                  <Link to="/blog">Ler artigos</Link>
                </article>
                <article className="seo-card">
                  <h4>Cases</h4>
                  <p>Estudos de caso com solucoes e aprendizados.</p>
                  <Link to="/cases">Ver cases</Link>
                </article>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="jv-footer jv-footer-3" id="jv-contact">
        <div className="jv-quates image-bg home-1-img">
          <div className="container">
            <div className="row section-separator">
              <div className="each-quates col-sm-12 col-md-6">
                <h3
                  className="wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.2s"
                >
                  {t('quates.title')}
                </h3>
                <p
                  className="wow fadeInUp"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.4s"
                >
                  {t('quates.description').replace('{anos}', anos)}
                </p>
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="cta wow fadeInUp "
                  data-wow-duration="0.8s"
                  data-wow-delay="0.5s"
                >
                  <span>
                    <i className="fa fa-whatsapp" /> Whatsapp
                  </span>
                  <svg width="13px" height="10px" viewBox="0 0 13 10">
                    <path d="M1,5 L11,5"></path>
                    <polyline points="8 1 12 5 8 9"></polyline>
                  </svg>
                </a>
              </div>
              <div className="each-quates col-sm-12 col-md-6">
                <div className="wrap-image">
                  <img
                    src="/assets/images/new/foto.webp"
                    alt="Joao Victor Souza em retrato"
                    width="600"
                    height="600"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="container-fluid">
          <div className="row section-separator">
            <div
              className="col-sm-12 section-title wow fadeInUp"
              data-wow-duration="0.8s"
              data-wow-delay="0.2s"
            >
              <h3>{t('menu.contact')}</h3>
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
                          <h4>{t('contact.address.title')}</h4>
                          <address>{t('contact.address.description')}</address>
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
                          <h4>{t('contact.email.title')}</h4>
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
                          <h4>{t('contact.phone.title')}</h4>
                          <a href={'callto:' + celular.replace(/[^0-9]/g, '')}>
                            {celular}
                          </a>
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
                      <div className="col-sm-6 d-flex justify-content-center align-items-center">
                        <p className="mt-2 mb-2">
                          © {ANO_INICIAL} - {year} - João Victor Souza
                        </p>
                      </div>
                      <div className="col-sm-6 d-flex justify-content-center align-items-center">
                        <ul
                          className="social-icon wow fadeInUp"
                          data-wow-duration="0.8s"
                          data-wow-delay="0.7s"
                        >
                          {redes_sociais.map((rede) => (
                            <li key={rede.nome}>
                              <a
                                href={rede.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <i className={rede.icone} />
                              </a>
                            </li>
                          ))}
                        </ul>
                        <LanguageSelector />
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
    </>
  );
};

export default Home;
