import React from 'react';
import { Link } from 'react-router-dom';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { services } from './data';

const Servicos = () => {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Inicio',
        item: 'https://joaovictorsouza.dev/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Servicos',
        item: 'https://joaovictorsouza.dev/servicos',
      },
    ],
  };

  return (
    <SiteLayout>
      <Seo
        title="Servicos de Integracao WhatsApp, Meta e IA | Joao Victor Souza"
        description="Servicos de integracao WhatsApp Cloud API, Meta Pixel/CAPI, chatbots com IA e automacao de processos com foco em resultado."
        canonical="/servicos"
        keywords="servicos whatsapp cloud api, meta capi, chatbot ia, automacao integracoes"
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">Servicos</span>
        <h1>Solucoes tecnicas para crescimento e operacao digital</h1>
        <p>
          Atuo na implementacao de integracoes e automacoes com foco em
          desempenho operacional, confiabilidade de dados e aumento de
          conversao.
        </p>
      </section>

      <section className="seo-grid">
        {services.map((service) => (
          <article key={service.slug} className="seo-card">
            <h2>{service.title}</h2>
            <p>{service.summary}</p>
            <Link className="seo-cta" to={`/servicos/${service.slug}`}>
              Ver detalhes
            </Link>
          </article>
        ))}
      </section>
    </SiteLayout>
  );
};

export default Servicos;
