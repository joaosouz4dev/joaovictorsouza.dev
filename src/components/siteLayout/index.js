import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Navbar from '../navbar';

const NAV_ITEMS = [
  { href: '/', label: 'Inicio' },
  { href: '/sobre', label: 'Sobre' },
  { href: '/servicos', label: 'Servicos' },
  { href: '/cases', label: 'Cases' },
  { href: '/blog', label: 'Blog' },
  { href: '/projetos', label: 'Projetos' },
  { href: '/contato', label: 'Contato' },
];

const BREADCRUMB_LABELS = {
  sobre: 'Sobre',
  servicos: 'Servicos',
  cases: 'Cases',
  blog: 'Blog',
  projetos: 'Projetos',
  contato: 'Contato',
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
  const navigate = useNavigate();
  const location = useLocation();
  const [darkMode, setDarkMode] = useState(true);
  const [menuActive, setMenuActive] = useState('/');
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

  const menus = useMemo(() => NAV_ITEMS, []);

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
          BREADCRUMB_LABELS[segment] ||
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

      <main className="seo-main jv-site-content">
        <div className="container">
          {pathname !== '/' && (
            <nav className="seo-breadcrumb" aria-label="Breadcrumb">
              <Link to="/">Inicio</Link>
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
                      <span className="seo-footer-logo">JS</span>
                      <div
                        className="stack seo-footer-brand"
                        style={{
                          '--stacks': '3',
                        }}
                      >
                        <span style={{ '--index': '0' }}>Joao Victor Souza</span>
                        <span style={{ '--index': '1' }}>Joao Victor Souza</span>
                        <span style={{ '--index': '2' }}>Joao Victor Souza</span>
                      </div>
                    </div>
                    <p>
                      Especialista em WhatsApp Cloud API, Meta CAPI e Chatbots
                      com IA para operacoes de vendas e atendimento.
                    </p>
                    <Link className="seo-cta" to="/contato">
                      Falar sobre projeto
                    </Link>
                  </div>

                  <div className="seo-footer-block">
                    <h4>Navegacao rapida</h4>
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
                          Guia tecnico principal
                        </Link>
                      </li>
                      <li>
                        <Link to="/cases">Ver todos os cases</Link>
                      </li>
                    </ul>
                  </div>

                  <div className="seo-footer-block">
                    <h4>Especialidades</h4>
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
                    <h4>Contato</h4>
                    <p>
                      <a href="mailto:web@joaovictorsouza.dev">
                        web@joaovictorsouza.dev
                      </a>
                    </p>
                    <p>
                      <a href="/whatsapp" target="_blank" rel="noreferrer noopener">
                        WhatsApp direto
                      </a>
                    </p>
                    <ul className="social-icon seo-footer-social">
                      <li>
                        <a
                          href="https://github.com/joaosouz4dev"
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          <i className="fa fa-github" />
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://www.linkedin.com/in/joaosouz4dev/"
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          <i className="fa fa-linkedin" />
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://www.instagram.com/joaosouz4dev"
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          <i className="fa fa-instagram" />
                        </a>
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="seo-footer-bottom">
                  <p>© 2015 - {new Date().getFullYear()} Joao Victor Souza</p>
                  <p>
                    <Link to="/">Home</Link> | <Link to="/servicos">Servicos</Link>{' '}
                    | <Link to="/blog">Blog</Link> |{' '}
                    <Link to="/projetos">Projetos</Link>
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
