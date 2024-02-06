import React, { useEffect, useState, useRef } from "react";
import Fancybox from "./fancybox.js";

const PORTFOLIO = [
  {
    categoria: 'site',
    img: 'assets/images/portfolio/g1.webp',
    title: 'Ramon Vieira',
    subTitle: 'Site',
    link: 'https://www.ramonvieira.com/',
    descricao: `Site unica para fotografo exibir fotos de eventos e receber contatos de possiveis clientes`,
    tecnologias: [
      'php',
      'html',
      'css',
      'javascript',
    ]
  },
  {
    categoria: 'sistema',
    img: 'assets/images/portfolio/g2.webp',
    title: 'Solardash',
    subTitle: 'Sistema',
    link: 'https://solardash.com.br/',
    descricao: `A plataforma de gestão completa para empresa de energia solar facilita o primeiro contato com o cliente até o pós venda. A plataforma permite que a empresa possua um controle maior sobre as etapas do projeto, desde a captação de clientes, instalação dos painéis solares até o controle de pós venda`,
    tecnologias: [
      'php',
      'html',
      'css',
      'php',
      'React',
      'Javascript',
      'Node.JS'
    ]
  },
  {
    categoria: 'site',
    img: 'assets/images/portfolio/g3.webp',
    title: 'Lumus Solar',
    subTitle: 'Site',
    link: 'https://www.lumus.eng.br/',
    descricao: `Site unico para empresa que faz instalação de sistemas de energia fotovoltaica`,
    tecnologias: [
      'html',
      'css',
      'Javascript',
      'php',
      'wordpress',
    ]
  },
  {
    categoria: 'site app',
    img: 'assets/images/portfolio/g4.webp',
    title: 'Mapp Sistemas',
    subTitle: 'Site e App',
    link: 'https://mappsistemas.com.br/',
    descricao: `Site completo com blog desenvolvido para a empresa vender seu sistema web e aplicativos usuarios dessa empresa`,
    tecnologias: [
      'php',
      'wordpress',
      'html',
      'css',
      'Javascript',
      'React Native',
    ]
  },
  {
    categoria: 'sistema',
    img: 'assets/images/portfolio/g7.webp',
    title: 'Folhetos.app',
    subTitle: 'Sistema',
    link: 'https://folhetos.app/',
    descricao: `Sistema web para empresas exibirem ofertas online`,
    tecnologias: [
      'php',
      'html',
      'css',
      'Javascript',
    ]
  },
  {
    categoria: 'ecommerce app',
    img: 'assets/images/portfolio/g5.webp',
    title: 'Dujuca',
    subTitle: 'E-Commerce e App',
    link: 'https://dujuca.com/',
    descricao: `E-Commerce e app criado para a empresa vender produtos online`,
    tecnologias: [
      'php',
      'html',
      'css',
      'React',
      'React Native',
      'Javascript',
      'php',
      'wordpress',
    ]
  },
  {
    categoria: 'sistema',
    img: 'assets/images/portfolio/g8.webp',
    title: 'Wppconnect',
    subTitle: 'Sistema',
    link: 'https://wppconnect.io/',
    descricao: `Projeto open source criado para facilitar as manipulações do whatsapp web, possibilitando criar chatbots, chat de comunicação dentre outras coisas.`,
    tecnologias: [
      'React',
      'Javascript',
      'Node.JS'
    ]
  },
  {
    categoria: 'sistema site app',
    img: 'assets/images/portfolio/g6.webp',
    title: 'Dr.pay Saude',
    subTitle: 'Sistema, Site e App',
    link: 'https://drpaysaude.com.br/',
    descricao: `Sistema e app focado para medicos e unidades de saude, ofertando diversos produtos`,
    tecnologias: [
      'php',
      'html',
      'css',
      'php',
      'wordpress',
      'React',
      'React Native',
      'Javascript',
      'Node.JS'
    ]
  },
  {
    categoria: 'ecommerce',
    img: 'assets/images/portfolio/g9.webp',
    title: 'Felavie',
    subTitle: 'E-Commerce',
    link: 'https://felavie.com.br/',
    descricao: `E-Commerce criado para a empresa vender produtos online`,
    tecnologias: [
      'php',
      'html',
      'css',
      'php',
      'wordpress',
      'React',
      'Javascript',
    ]
  },
];

function useOutsideAlerter(ref, closeModal = () => { }) {
  useEffect(() => {
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        closeModal();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [ref, closeModal]);
}

const ModalPortifolio = ({ selected = {}, modalIsOpen, setIsOpen }) => {
  const [data, setData] = useState({
    titulo: '',
    descricao: '',
    tecnologias: [],
    link: '',
    imagem: ''
  });
  const wrapperRef = useRef(null);
  useOutsideAlerter(wrapperRef, closeModal);

  useEffect(() => {
    setData({
      titulo: '',
      descricao: '',
      tecnologias: [],
      link: '',
      imagem: ''
    });
    if (selected && selected.titulo) {
      setData(selected);
    }
  }, [selected]);

  useEffect(() => {
    if (modalIsOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = null;
    }
  }, [modalIsOpen])


  function closeModal() {
    setIsOpen(false);
  }

  return (
    <div className="jv-portfolio-modal" style={{
      display: modalIsOpen ? 'flex' : 'none',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'fixed',
      zIndex: 9999,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: '#282828b3'
    }}>
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
            position: "relative"
          }}>
          <div className="col-sm-5">
            <h2>{data.titulo}</h2>
            <p>{data.descricao}</p>
            <div className="jv-about-tag">
              <ul>
                {data.tecnologias.map((e, i) => (
                  <li key={i}><span>{e}</span></li>
                ))}
              </ul>
            </div>
            <a href={data.link} target="_blank" className="btn btn-fill" rel="noopener noreferrer">Ver Mais</a>
          </div>
          <div className="col-sm-7">
            <div className="jv-portfolio-modal-img" style={{
              margin: '10px auto',
              display: 'block',
              textAlign: 'center',
            }}>
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
              color: '#ffffff'
            }}
            onClick={closeModal}
          >
            <i className="fa fa-close"></i>
          </div>
        </div>
      </div>
    </div>
  );
}

const Portfolio = () => {
  const [selected, setSelected] = useState({
    titulo: '',
    descricao: '',
    tecnologias: [],
    link: '',
    imagem: ''
  });
  const [modalIsOpen, setIsOpen] = useState(false);
  return (
    <>
      <section className="jv-portfolio" id="jv-portfolio">
        <Fancybox>
          <div className="container">
            <div className="row section-separator">
              <div className="section-title col-sm-12 wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.1s">
                <h3>Portfólio recente</h3>
              </div>
              <div className="part col-sm-12">
                <div className="portfolio-nav col-sm-12" id="filter-button">
                  <ul>
                    <li data-filter="*" className="current wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.1s"> <span>Todos</span></li>
                    <li data-filter=".site" className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.2s"><span>Site</span></li>
                    <li data-filter=".app" className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.3s"><span>App</span></li>
                    <li data-filter=".sistema" className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.4s"><span>Sistema</span></li>
                    <li data-filter=".ecommerce" className="wow fadeInUp" data-wow-duration="0.8s" data-wow-delay="0.5s"><span>E-Commerce</span></li>
                  </ul>
                </div>
                <div className="jv-project-gallery col-sm-12 wow fadeInUp" id="project-gallery" data-wow-duration="0.8s" data-wow-delay="0.5s">
                  <div className="portfolioContainer row">
                    {PORTFOLIO.map((e, i) => (
                      <div key={i} className={"grid-item col-md-4 col-sm-6 col-xs-12 " + e.categoria}>
                        <figure>
                          <img src={e.img} alt="" />
                          <figcaption className="fig-caption"
                            style={{
                              cursor: "pointer"
                            }}
                            onClick={() => {
                              setIsOpen(true);
                              setSelected({
                                titulo: e.title,
                                descricao: e.descricao,
                                tecnologias: e.tecnologias,
                                link: e.link,
                                imagem: e.img
                              })
                            }}>
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
      <ModalPortifolio
        selected={selected}
        modalIsOpen={modalIsOpen}
        setIsOpen={setIsOpen}
      />
    </>
  );
};

export default Portfolio;
