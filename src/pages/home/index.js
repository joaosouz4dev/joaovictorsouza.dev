import React, { useState, useEffect } from 'react';
import Portifolio from '../../components/portifolio';
import '@lottiefiles/lottie-player';
import SvgAnimated from '../../components/portifolio/svgAnimated';
import { useTranslation } from 'react-i18next';

import iconCv from '../../assets/images/icon-cv.png';
import LanguageSelector from '../../components/footer/languageSelector';

import profile from '../../assets/images/profile/profile-2.png';

// const oldprofile = process.env.PUBLIC_URL + '/assets/images/new/hero-2.webp'

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

const celular = '+351 969 823 079';

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
    url: 'https://joaovictorsouza.dev/zap',
    icone: 'fa fa-whatsapp',
  },
];

const Home = () => {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  const anos = year - ANO_INICIAL;
  const [darkMode, setDarkMode] = useState(true);
  const [menuActive, setMenuActive] = useState('#jv-home');
  const [scrolling, setScrolling] = useState(false);

  const menus = [
    {
      href: '#jv-home',
      label: t('menu.home'),
    },
    {
      href: '#jv-about',
      label: t('menu.about'),
    },
    {
      href: '#jv-skills',
      label: t('menu.skills'),
    },
    {
      href: '#jv-experience',
      label: t('menu.experiences'),
    },
    {
      href: '#jv-portfolio',
      label: t('menu.portfolio'),
    },
    {
      href: '#jv-contact',
      label: t('menu.contact'),
    },
  ];

  useEffect(() => {
    const $ = window.$;
    if (localStorage.getItem('darkmode') !== null) {
      setDarkMode(localStorage.getItem('darkmode') === 'true');
    } else {
      const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setDarkMode(prefersDarkMode);
      localStorage.setItem('darkmode', prefersDarkMode);
    }

    setTimeout(() => {
      $('.section-loader').fadeOut('slow');
    }, 300);
  }, []);

  useEffect(() => {
    const section = window.location.href.includes('#') ? window.location.href.split('#').pop() : false;
    if (section) {
      setMenuActive('#' + section);
      setTimeout(() => {
        const element = document.getElementById(section);
        if (element) {
          element.scrollIntoView({
            behavior: 'smooth',
          });
        }
      }, 500);
    }
  }, [document, window.location.href]);

  useEffect(() => {
    const handleScroll = () => {
      if (scrolling) return;
      const scrollPosition = window.scrollY;
      const sections = [];
      const sectionsFinded = document.querySelectorAll('section');
      if (sectionsFinded) {
        sectionsFinded.forEach((section) => {
          sections.push(section);
        });
      }
      const footerFinded = document.querySelector('#jv-contact');
      if (footerFinded) {
        sections.push(footerFinded);
      }
      sections.forEach((section) => {
        if (scrollPosition >= section.offsetTop - 250 && scrollPosition < section.offsetTop + section.offsetHeight) {
          setMenuActive('#' + section.id);
        }
      });
    };

    window.addEventListener('scroll', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [scrolling]);

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

  const toggleDarkMode = () => {
    let _darkMode = !darkMode;
    setDarkMode(_darkMode);
    localStorage.setItem('darkmode', _darkMode);
  };

  const toggleMenuActive = (menu) => {
    if (scrolling) return;
    setScrolling(true);
    setMenuActive(menu);
    const element = document.querySelector(menu);
    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
      });
      setTimeout(() => {
        setScrolling(false);
      }, 600);
    }
  };

  return (
    <main>
      <div className="section-loader">
        <div className="loader">
          <div />
          <div />
        </div>
      </div>

      <header className="black-bg jv-header jv-fixed-nav nav-scroll jv-xs-mobile-nav" id="jv-header">
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

              <div className="collapse navbar-collapse" id="navbarSupportedContent">
                <ul className="navbar-nav mr-auto ml-auto">
                  {menus.map((menu, i) => (
                    <li className={'nav-item' + (menuActive === menu.href ? ' active' : '')} key={i}>
                      <a
                        className="nav-link"
                        href={menu.href}
                        onClick={(e) => {
                          e.preventDefault();
                          toggleMenuActive(menu.href);
                        }}
                      >
                        {menu.label}
                      </a>
                    </li>
                  ))}
                </ul>
                <span
                  onClick={toggleDarkMode}
                  style={{
                    cursor: 'pointer',
                  }}
                >
                  {darkMode ? (
                    <svg width="16" height="16" fill="currentColor" className="bi bi-lightbulb" viewBox="0 0 16 16">
                      <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13a.5.5 0 0 1 0 1 .5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1 0-1 .5.5 0 0 1 0-1 .5.5 0 0 1-.46-.302l-.761-1.77a1.964 1.964 0 0 0-.453-.618A5.984 5.984 0 0 1 2 6zm6-5a5 5 0 0 0-3.479 8.592c.263.254.514.564.676.941L5.83 12h4.342l.632-1.467c.162-.377.413-.687.676-.941A5 5 0 0 0 8 1z" />
                    </svg>
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      fill="currentColor"
                      className="bi bi-lightbulb-fill"
                      viewBox="0 0 16 16"
                    >
                      <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a1.964 1.964 0 0 0-.453-.618A5.984 5.984 0 0 1 2 6zm3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5z" />
                    </svg>
                  )}
                </span>
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
                  <div className="jv-promo wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.1s">
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
                  <h4 className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.3s">
                    {t('banner.profession')}
                  </h4>

                  <ul>
                    <li className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.4s">
                      <i className="fa fa-envelope" />
                      <a href="mailto:web@joaovictorsouza.dev">web@joaovictorsouza.dev</a>
                    </li>
                    <li className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.5s">
                      <i className="fa fa-phone" />
                      <a href="https://joaovictorsouza.dev/zap" target="_blank" rel="noopener noreferrer">
                        {celular}
                      </a>
                    </li>
                    <li className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.6s">
                      <i className="fa fa-map-marker" />
                      {t('banner.location')}
                    </li>
                  </ul>
                  <ul className="social-icon wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.7s">
                    {redes_sociais.map((rede) => (
                      <li key={rede.nome}>
                        <a href={rede.url} target="_blank" rel="noopener noreferrer">
                          <i className={rede.icone} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="col-sm-6">
                <div className="hero-img wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.6s">
                  <div className="img-border">
                    <img src={profile} alt="" className="img-fluid" />
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
              <div className="jv-about-img shadow-2 wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.4s">
                <SvgAnimated />
              </div>
            </div>
            <div className="col-sm-12 col-md-6">
              <div className="jv-about-inner">
                <h2 className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.1s">
                  {t('about.title')}
                </h2>
                <p className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.2s">
                  {t('about.description')}
                </p>
                <div className="jv-about-tag wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.3s">
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
                  <div className="jv-professional-skill wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.3s">
                    <h3>{t('skills.title2')}</h3>
                    <div className="each-skills">
                      <div className="candidatos">
                        <div className="parcial">
                          <div className="info">
                            <div className="nome">Javascript</div>
                            <div className="percentagem-num">86%</div>
                          </div>
                          <div className="progressBar">
                            <div className="percentagem" style={{ width: '96%' }} />
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
                            <div className="percentagem" style={{ width: '86%' }} />
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
                            <div className="percentagem" style={{ width: '58%' }} />
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
                            <div className="percentagem" style={{ width: '85%' }} />
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
                            <div className="percentagem" style={{ width: '89%' }} />
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
                            <div className="percentagem" style={{ width: '40%' }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-sm-12 col-md-6">
                <div className="jv-professional-skills wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.5s">
                  <h3>{t('skills.title3')}</h3>
                  <ul className="jv-professional-progress">
                    <li>
                      <div className="jv-progress jv-progress-circle" data-progress="80" />
                      <div className="pr-skill-name">{t('skills.words.communication')}</div>
                    </li>
                    <li>
                      <div className="jv-progress jv-progress-circle" data-progress="55" />
                      <div className="pr-skill-name">{t('skills.words.teamwork')}</div>
                    </li>
                    <li>
                      <div className="jv-progress jv-progress-circle" data-progress="86" />
                      <div className="pr-skill-name">{t('skills.words.management')}</div>
                    </li>
                    <li>
                      <div className="jv-progress jv-progress-circle" data-progress="90" />
                      <div className="pr-skill-name">{t('skills.words.proactivity')}</div>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="jv-experince image-bg featured-img-one" id="jv-experience">
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
                <h3 className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.2s">
                  {t('experiences.since')} {ANO_INICIAL} {t('experiences.title')}
                </h3>
                <p className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.4s">
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

      <footer className="jv-footer jv-footer-3" id="jv-contact">
        <div className="jv-quates image-bg home-1-img">
          <div className="container">
            <div className="row section-separator">
              <div className="each-quates col-sm-12 col-md-6">
                <h3 className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.2s">
                  {t('quates.title')}
                </h3>
                <p className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.4s">
                  {t('quates.description').replace('{anos}', anos)}
                </p>
                <a
                  href="https://joaovictorsouza.dev/zap"
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
                  <img src={process.env.PUBLIC_URL + '/assets/images/new/foto.webp'} alt="" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="container-fluid">
          <div className="row section-separator">
            <div className="col-sm-12 section-title wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.2s">
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
                          <a href="mailto:web@joaovictorsouza.dev">web@joaovictorsouza.dev</a>
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
                          <a href={'callto:' + celular.replace(/[^0-9]/g, '')}>{celular}</a>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="col-sm-12 jv-copyright wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.2s">
                    <div className="row">
                      <div className="col-sm-6">
                        <div className="text-center">
                          <p>
                            © {ANO_INICIAL} - {year} - João Victor Souza
                          </p>
                        </div>
                      </div>
                      <div className="col-sm-6 text-center d-flex">
                        <ul className="social-icon wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.7s">
                          {redes_sociais.map((rede) => (
                            <li key={rede.nome}>
                              <a href={rede.url} target="_blank" rel="noopener noreferrer">
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
  );
};

export default Home;
