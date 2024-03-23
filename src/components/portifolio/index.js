import React, { useEffect, useState, useRef } from 'react';
import Fancybox from './fancybox.js';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';

function useOutsideAlerter(ref, closeModal = () => {}) {
  useEffect(() => {
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        closeModal();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [ref, closeModal]);
}

const ModalPortifolio = ({ selected = {}, modalIsOpen, setIsOpen }) => {
  const { t } = useTranslation();
  const [data, setData] = useState({
    titulo: '',
    descricao: '',
    tecnologias: [],
    link: '',
    imagem: '',
  });
  const wrapperRef = useRef(null);
  useOutsideAlerter(wrapperRef, closeModal);

  useEffect(() => {
    setData({
      titulo: '',
      descricao: '',
      tecnologias: [],
      link: '',
      imagem: '',
    });
    if (selected && selected.titulo) {
      setData(selected);
    }
  }, [selected]);

  useEffect(() => {
    if (modalIsOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = null;
    }
  }, [modalIsOpen]);

  function closeModal() {
    setIsOpen(false);
  }

  return (
    <div
      className="jv-portfolio-modal"
      style={{
        display: modalIsOpen ? 'flex' : 'none',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'fixed',
        zIndex: 9999,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#282828b3',
      }}
    >
      <div className="container">
        <div
          ref={wrapperRef}
          className="row jv-portfolio-modal-inner dark-bg shadowdiv"
          style={{
            display: modalIsOpen ? 'flex' : 'none',
            width: '90%',
            padding: '15px',
            borderRadius: '10px',
            margin: '0 auto',
            position: 'relative',
          }}
        >
          <div className="col-sm-5">
            <h2>{data.titulo}</h2>
            <p>{data.descricao}</p>
            <div className="jv-about-tag">
              <ul>
                {data.tecnologias.map((e, i) => (
                  <li key={i}>
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            </div>
            <a href={data.link} target="_blank" className="btn btn-fill" rel="noopener noreferrer">
              {t('portfolio.btn')}
            </a>
          </div>
          <div className="col-sm-7">
            <div
              className="jv-portfolio-modal-img"
              style={{
                margin: '10px auto',
                display: 'block',
                textAlign: 'center',
              }}
            >
              <img src={data.imagem} alt="" className="img-fluid" />
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              right: '5px',
              top: '5px',
              backgroundColor: '#c81016',
              height: '30px',
              width: '30px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#ffffff',
            }}
            onClick={closeModal}
          >
            <i className="fa fa-close"></i>
          </div>
        </div>
      </div>
    </div>
  );
};

const Portfolio = () => {
  const { t } = useTranslation();
  const PORTFOLIO = [
    {
      categoria: 'site',
      img: 'assets/images/portfolio/g1.webp',
      title: 'Ramon Vieira',
      subTitle: t('portfolio.words.site'),
      link: 'https://www.ramonvieira.com/',
      descricao: t('portfolio.descriptions.desc1'),
      tecnologias: ['php', 'html', 'css', 'javascript'],
    },
    {
      categoria: 'sistema',
      img: 'assets/images/portfolio/g2.webp',
      title: 'Solardash',
      subTitle: t('portfolio.words.system'),
      link: 'https://solardash.com.br/',
      descricao: t('portfolio.descriptions.desc2'),
      tecnologias: ['php', 'html', 'css', 'php', 'React', 'Javascript', 'Node.JS'],
    },
    {
      categoria: 'site',
      img: 'assets/images/portfolio/g3.webp',
      title: 'Lumus Solar',
      subTitle: t('portfolio.words.site'),
      link: 'https://www.lumus.eng.br/',
      descricao: t('portfolio.descriptions.desc3'),
      tecnologias: ['html', 'css', 'Javascript', 'php', 'wordpress'],
    },
    {
      categoria: 'site app',
      img: 'assets/images/portfolio/g4.webp',
      title: 'Mapp Sistemas',
      subTitle: t('portfolio.words.site') + ', ' + t('portfolio.words.app'),
      link: 'https://mappsistemas.com.br/',
      descricao: t('portfolio.descriptions.desc4'),
      tecnologias: ['php', 'wordpress', 'html', 'css', 'Javascript', 'React Native'],
    },
    {
      categoria: 'sistema',
      img: 'assets/images/portfolio/g7.webp',
      title: 'Folhetos.app',
      subTitle: t('portfolio.words.system'),
      link: 'https://folhetos.app/',
      descricao: t('portfolio.descriptions.desc5'),
      tecnologias: ['php', 'html', 'css', 'Javascript'],
    },
    {
      categoria: 'ecommerce app',
      img: 'assets/images/portfolio/g5.webp',
      title: 'Dujuca',
      subTitle: t('portfolio.words.ecommerce') + ', ' + t('portfolio.words.app'),
      link: 'https://dujuca.com/',
      descricao: t('portfolio.descriptions.desc6'),
      tecnologias: ['php', 'html', 'css', 'React', 'React Native', 'Javascript', 'php', 'wordpress'],
    },
    {
      categoria: 'sistema',
      img: 'assets/images/portfolio/g8.webp',
      title: 'Wppconnect',
      subTitle: t('portfolio.words.system'),
      link: 'https://wppconnect.io/',
      descricao: t('portfolio.descriptions.desc7'),
      tecnologias: ['React', 'Javascript', 'Node.JS'],
    },
    {
      categoria: 'sistema site app',
      img: 'assets/images/portfolio/g6.webp',
      title: 'Dr.pay Saude',
      subTitle: t('portfolio.words.system') + ', ' + t('portfolio.words.site') + ', ' + t('portfolio.words.app'),
      link: 'https://drpaysaude.com.br/',
      descricao: t('portfolio.descriptions.desc8'),
      tecnologias: ['php', 'html', 'css', 'php', 'wordpress', 'React', 'React Native', 'Javascript', 'Node.JS'],
    },
    {
      categoria: 'ecommerce',
      img: 'assets/images/portfolio/g9.webp',
      title: 'Felavie',
      subTitle: t('portfolio.words.ecommerce'),
      link: 'https://felavie.com.br/',
      descricao: t('portfolio.descriptions.desc9'),
      tecnologias: ['php', 'html', 'css', 'php', 'wordpress', 'React', 'Javascript'],
    },
  ];
  const [selected, setSelected] = useState({
    titulo: '',
    descricao: '',
    tecnologias: [],
    link: '',
    imagem: '',
  });
  const [modalIsOpen, setIsOpen] = useState(false);
  return (
    <>
      <section className="jv-portfolio" id="jv-portfolio">
        <Fancybox>
          <div className="container">
            <div className="row section-separator">
              <div className="section-title col-sm-12 wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.1s">
                <h3>{t('portfolio.title')}</h3>
              </div>
              <div className="part col-sm-12">
                <div className="portfolio-nav col-sm-12" id="filter-button">
                  <ul>
                    <li data-filter="*" className="current wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.1s">
                      <span>{t('portfolio.words.all')}</span>
                    </li>
                    <li data-filter=".site" className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.2s">
                      <span>{t('portfolio.words.site')}</span>
                    </li>
                    <li data-filter=".app" className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.3s">
                      <span>{t('portfolio.words.app')}</span>
                    </li>
                    <li data-filter=".sistema" className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.4s">
                      <span>{t('portfolio.words.system')}</span>
                    </li>
                    <li
                      data-filter=".ecommerce"
                      className="wow fadeInUp"
                      data-wow-duration="0.8s"
                      data-wow-delay="0.5s"
                    >
                      <span>{t('portfolio.words.ecommerce')}</span>
                    </li>
                  </ul>
                </div>
                <div
                  className="jv-project-gallery col-sm-12 wow fadeInUp"
                  id="project-gallery"
                  data-wow-duration="0.8s"
                  data-wow-delay="0.5s"
                >
                  <div className="portfolioContainer row">
                    {PORTFOLIO.map((e, i) => (
                      <div key={i} className={'grid-item col-md-4 col-sm-6 col-xs-12 ' + e.categoria}>
                        <figure>
                          <img src={e.img} alt="" />
                          <figcaption
                            className="fig-caption"
                            style={{
                              cursor: 'pointer',
                            }}
                            onClick={() => {
                              setIsOpen(true);
                              setSelected({
                                titulo: e.title,
                                descricao: e.descricao,
                                tecnologias: e.tecnologias,
                                link: e.link,
                                imagem: e.img,
                              });
                            }}
                          >
                            <i className="fa fa-search"></i>
                            <h5 className="title">{e.title}</h5>
                            <span className="sub-title">{e.subTitle}</span>
                          </figcaption>
                        </figure>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Fancybox>
      </section>
      <ModalPortifolio selected={selected} modalIsOpen={modalIsOpen} setIsOpen={setIsOpen} />
    </>
  );
};

export default Portfolio;
