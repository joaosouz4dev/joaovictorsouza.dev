import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const Portfolio = () => {
  const { t } = useTranslation();
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedProject, setSelectedProject] = useState(null);

  const portfolioItems = [
    {
      categories: ['site'],
      img: '/assets/images/portfolio/g1.webp',
      title: 'Ramon Vieira',
      subTitle: t('portfolio.words.site'),
      link: 'https://www.ramonvieira.com/',
      descricao: t('portfolio.descriptions.desc1'),
      tecnologias: ['php', 'html', 'css', 'javascript'],
    },
    {
      categories: ['sistema'],
      img: '/assets/images/portfolio/g2.webp',
      title: 'Solardash',
      subTitle: t('portfolio.words.system'),
      link: 'https://solardash.com.br/',
      descricao: t('portfolio.descriptions.desc2'),
      tecnologias: ['php', 'html', 'css', 'php', 'React', 'Javascript', 'Node.JS'],
    },
    {
      categories: ['site'],
      img: '/assets/images/portfolio/g3.webp',
      title: 'Lumus Solar',
      subTitle: t('portfolio.words.site'),
      link: 'https://www.lumus.eng.br/',
      descricao: t('portfolio.descriptions.desc3'),
      tecnologias: ['html', 'css', 'Javascript', 'php', 'wordpress'],
    },
    {
      categories: ['site', 'app'],
      img: '/assets/images/portfolio/g4.webp',
      title: 'Mapp Sistemas',
      subTitle: t('portfolio.words.site') + ', ' + t('portfolio.words.app'),
      link: 'https://mappsistemas.com.br/',
      descricao: t('portfolio.descriptions.desc4'),
      tecnologias: ['php', 'wordpress', 'html', 'css', 'Javascript', 'React Native'],
    },
    {
      categories: ['sistema'],
      img: '/assets/images/portfolio/g7.webp',
      title: 'Folhetos.app',
      subTitle: t('portfolio.words.system'),
      link: 'https://folhetos.app/',
      descricao: t('portfolio.descriptions.desc5'),
      tecnologias: ['php', 'html', 'css', 'Javascript'],
    },
    {
      categories: ['ecommerce', 'app'],
      img: '/assets/images/portfolio/g5.webp',
      title: 'Dujuca',
      subTitle: t('portfolio.words.ecommerce') + ', ' + t('portfolio.words.app'),
      link: 'https://dujuca.com/',
      descricao: t('portfolio.descriptions.desc6'),
      tecnologias: ['php', 'html', 'css', 'React', 'React Native', 'Javascript', 'php', 'wordpress'],
    },
    {
      categories: ['sistema'],
      img: '/assets/images/portfolio/g8.webp',
      title: 'Wppconnect',
      subTitle: t('portfolio.words.system'),
      link: 'https://wppconnect.io/',
      descricao: t('portfolio.descriptions.desc7'),
      tecnologias: ['React', 'Javascript', 'Node.JS'],
    },
    {
      categories: ['sistema', 'site', 'app'],
      img: '/assets/images/portfolio/g6.webp',
      title: 'Dr.pay Saude',
      subTitle: t('portfolio.words.system') + ', ' + t('portfolio.words.site') + ', ' + t('portfolio.words.app'),
      link: 'https://drpaysaude.com.br/',
      descricao: t('portfolio.descriptions.desc8'),
      tecnologias: ['php', 'html', 'css', 'php', 'wordpress', 'React', 'React Native', 'Javascript', 'Node.JS'],
    },
    {
      categories: ['ecommerce'],
      img: '/assets/images/portfolio/g9.webp',
      title: 'Felavie',
      subTitle: t('portfolio.words.ecommerce'),
      link: 'https://felavie.com.br/',
      descricao: t('portfolio.descriptions.desc9'),
      tecnologias: ['php', 'html', 'css', 'php', 'wordpress', 'React', 'Javascript'],
    },
  ];
  const filterOptions = [
    { key: 'all', label: t('portfolio.words.all') },
    { key: 'site', label: t('portfolio.words.site') },
    { key: 'app', label: t('portfolio.words.app') },
    { key: 'sistema', label: t('portfolio.words.system') },
    { key: 'ecommerce', label: t('portfolio.words.ecommerce') },
  ];

  const filteredPortfolio = useMemo(
    () =>
      activeFilter === 'all'
        ? portfolioItems
        : portfolioItems.filter((item) => item.categories.includes(activeFilter)),
    [activeFilter, portfolioItems],
  );

  useEffect(() => {
    const onEscape = (event) => {
      if (event.key === 'Escape') {
        setSelectedProject(null);
      }
    };
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('keydown', onEscape);
    };
  }, []);

  useEffect(() => {
    if (selectedProject) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [selectedProject]);

  return (
    <>
      <section className="jv-portfolio jv-portfolio-react" id="jv-portfolio">
        <div className="container">
          <div className="row section-separator">
            <div className="section-title col-sm-12 wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.1s">
              <h3>{t('portfolio.title')}</h3>
            </div>

            <div className="col-sm-12">
              <div className="jv-portfolio-react-nav">
                {filterOptions.map((filter) => (
                  <button
                    key={filter.key}
                    className={`jv-portfolio-react-filter ${
                      activeFilter === filter.key ? 'active' : ''
                    }`}
                    type="button"
                    onClick={() => setActiveFilter(filter.key)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="col-sm-12">
              <div className="jv-portfolio-react-grid">
                {filteredPortfolio.map((project) => (
                  <article className="jv-portfolio-react-card" key={project.title}>
                    <div className="jv-portfolio-react-thumb">
                      <img src={project.img} alt={project.title} />
                    </div>

                    <div className="jv-portfolio-react-content">
                      <h4>{project.title}</h4>
                      <p>{project.subTitle}</p>
                      <button
                        type="button"
                        className="jv-portfolio-react-action"
                        onClick={() => setSelectedProject(project)}
                      >
                        {t('portfolio.btn')}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {selectedProject && (
        <div
          className="jv-portfolio-react-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedProject(null)}
        >
          <div
            className="jv-portfolio-react-modal-inner"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="jv-portfolio-react-close"
              onClick={() => setSelectedProject(null)}
              aria-label="Fechar modal"
            >
              <i className="fa fa-close" />
            </button>

            <div className="jv-portfolio-react-modal-grid">
              <div className="jv-portfolio-react-modal-image">
                <img src={selectedProject.img} alt={selectedProject.title} />
              </div>

              <div className="jv-portfolio-react-modal-content">
                <h2>{selectedProject.title}</h2>
                <p>{selectedProject.descricao}</p>

                <div className="jv-about-tag">
                  <ul>
                    {selectedProject.tecnologias.map((tech) => (
                      <li key={`${selectedProject.title}-${tech}`}>
                        <span>{tech}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <a
                  href={selectedProject.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-fill"
                >
                  {t('portfolio.btn')}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Portfolio;
