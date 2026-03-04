import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Navbar from '../navbar';
import LanguageSelector from '../footer/languageSelector';

const NAV_ITEMS = [
  { href: '/', key: 'menu.home' },
  { href: '/sobre', key: 'menu.about' },
  { href: '/servicos', key: 'menu.services' },
  { href: '/cases', key: 'menu.cases' },
  { href: '/blog', key: 'menu.blog' },
  { href: '/projetos', key: 'menu.projects' },
  { href: '/contato', key: 'menu.contact' },
];

const BREADCRUMB_LABEL_KEYS = {
  sobre: 'menu.about',
  servicos: 'menu.services',
  cases: 'menu.cases',
  blog: 'menu.blog',
  projetos: 'menu.projects',
  contato: 'menu.contact',
};

const getActiveMenu = (pathname) => {
  if (pathname.startsWith('/servicos')) return '/servicos';
  if (pathname.startsWith('/cases')) return '/cases';
  if (pathname.startsWith('/blog')) return '/blog';
  if (pathname.startsWith('/projetos')) return '/projetos';
  if (pathname.startsWith('/contato')) return '/contato';
  if (pathname.startsWith('/sobre')) return '/sobre';
  return '/';
};

const SiteLayout = ({ children }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [darkMode, setDarkMode] = useState(true);
  const [menuActive, setMenuActive] = useState('/');
  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false);
  const pathname = location.pathname || '/';

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
  }, []);

  useEffect(() => {
    setMenuActive(getActiveMenu(location.pathname));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [location.pathname]);

  useEffect(() => {
    const body = document.querySelector('body');
    if (!body) return;
    if (darkMode) {
      body.classList.add('dark-vertion');
      body.classList.remove('white-vertion');
    } else {
      body.classList.remove('dark-vertion');
      body.classList.add('white-vertion');
    }
  }, [darkMode]);

  useEffect(() => {
    const handleScroll = () => {
      setIsHeaderScrolled(window.scrollY > 20);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const menus = useMemo(
    () =>
      NAV_ITEMS.map((item) => ({
        href: item.href,
        label: t(item.key),
      })),
    [t],
  );

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkmode', next);
  };

  const toggleMenuActive = (href) => {
    setMenuActive(href);
    navigate(href);
  };

  const breadcrumbItems = pathname
    .split('/')
    .filter(Boolean)
    .map((segment, index, array) => {
      const href = `/${array.slice(0, index + 1).join('/')}`;
      return {
        href,
        label:
          (BREADCRUMB_LABEL_KEYS[segment] &&
            t(BREADCRUMB_LABEL_KEYS[segment])) ||
          segment
            .replace(/-/g, ' ')
            .replace(/^\w/, (char) => char.toUpperCase()),
      };
    });

  return (
    <div className="seo-layout">
      <div className="seo-ambient-shape seo-ambient-shape-1" />
      <div className="seo-ambient-shape seo-ambient-shape-2" />
      <header
        className={`black-bg jv-header jv-fixed-nav nav-scroll jv-xs-mobile-nav ${
          isHeaderScrolled ? 'is-scrolled' : ''
        }`}
        id="jv-header"
      >
        <Navbar
          menus={menus}
          menuActive={menuActive}
          toggleMenuActive={toggleMenuActive}
          toggleDarkMode={toggleDarkMode}
          darkMode={darkMode}
          isScrolled={isHeaderScrolled}
        />
      </header>

      <main className="seo-main jv-site-content">
        <div className="container">
          {pathname !== '/' && (
            <nav className="seo-breadcrumb" aria-label="Breadcrumb">
              <Link to="/">{t('menu.home')}</Link>
              {breadcrumbItems.map((item, index) => (
                <React.Fragment key={`${item.href}-${index}`}>
                  <span>/</span>
                  <Link to={item.href}>{item.label}</Link>
                </React.Fragment>
              ))}
            </nav>
          )}
          <div className="seo-page-shell">{children}</div>
        </div>
      </main>

      <footer className="jv-footer jv-footer-3">
        <div className="container">
          <div className="row section-separator">
            <div className="col-sm-12">
              <div className="seo-inner-footer">
                <div className="seo-footer-grid">
                  <div className="seo-footer-block">
                    <div className="seo-footer-brand-wrap">
                      <img
                        className="seo-footer-logo-image"
                        src="/assets/images/Logo.svg"
                        alt="Logo de Joao Victor Souza"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                    <p>
                      {t('layout.footer.description')}
                    </p>
                    <Link className="seo-cta" to="/contato">
                      {t('layout.footer.cta')}
                    </Link>
                  </div>

                  <div className="seo-footer-block">
                    <h4>{t('layout.footer.quickNav')}</h4>
                    <ul className="seo-footer-links">
                      <li>
                        <Link to="/servicos/whatsapp-cloud-api">
                          WhatsApp Cloud API
                        </Link>
                      </li>
                      <li>
                        <Link to="/servicos/meta-ads-e-integracoes">
                          Meta Pixel + CAPI
                        </Link>
                      </li>
                      <li>
                        <Link to="/blog/guia-whatsapp-cloud-api">
                          {t('layout.footer.mainGuide')}
                        </Link>
                      </li>
                      <li>
                        <Link to="/cases">{t('layout.footer.viewAllCases')}</Link>
                      </li>
                    </ul>
                  </div>

                  <div className="seo-footer-block">
                    <h4>{t('layout.footer.specialties')}</h4>
                    <div className="seo-footer-tags">
                      <span>WhatsApp Cloud API</span>
                      <span>Meta Conversions API</span>
                      <span>Chatbots com IA</span>
                      <span>RAG + Handoff Humano</span>
                      <span>Integracao CRM/ERP</span>
                      <span>Observabilidade</span>
                    </div>
                  </div>

                  <div className="seo-footer-block">
                    <h4>{t('menu.contact')}</h4>
                    <p>
                      <a href="mailto:web@joaovictorsouza.dev">
                        web@joaovictorsouza.dev
                      </a>
                    </p>
                    <p>
                      <a href="/whatsapp" target="_blank" rel="noreferrer noopener">
                        {t('layout.footer.whatsappDirect')}
                      </a>
                    </p>
                    <ul className="social-icon seo-footer-social">
                      <li>
                        <a
                          href="https://github.com/joaosouz4dev"
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={t('layout.social.github')}
                        >
                          <i className="fa fa-github" />
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://www.linkedin.com/in/joaosouz4dev/"
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={t('layout.social.linkedin')}
                        >
                          <i className="fa fa-linkedin" />
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://www.instagram.com/joaosouz4dev"
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={t('layout.social.instagram')}
                        >
                          <i className="fa fa-instagram" />
                        </a>
                      </li>
                    </ul>
                    <LanguageSelector />
                  </div>
                </div>

                <div className="seo-footer-bottom">
                  <p>© 2015 - {new Date().getFullYear()} Joao Victor Souza</p>
                  <p>
                    <Link to="/">{t('menu.home')}</Link> |{' '}
                    <Link to="/servicos">{t('menu.services')}</Link> |{' '}
                    <Link to="/blog">{t('menu.blog')}</Link> |{' '}
                    <Link to="/projetos">{t('menu.projects')}</Link>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default SiteLayout;
