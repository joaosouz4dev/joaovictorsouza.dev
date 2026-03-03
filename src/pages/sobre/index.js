import React from 'react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';

const Sobre = () => {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Joao Victor Souza',
    url: 'https://joaovictorsouza.dev/sobre',
    sameAs: [
      'https://github.com/joaosouz4dev',
      'https://www.linkedin.com/in/joaosouz4dev/',
    ],
    jobTitle:
      'Especialista em WhatsApp Cloud API, Meta CAPI e Chatbots com IA',
    knowsAbout: [
      'WhatsApp Cloud API',
      'Meta Pixel',
      'Conversions API',
      'Chatbots com IA',
      'Node.js',
      'Java',
      'AWS',
    ],
  };

  return (
    <SiteLayout>
      <Seo
        title="Sobre | Joao Victor Souza"
        description="Desenvolvedor especializado em integrações WhatsApp, Meta CAPI, chatbots com IA e arquitetura backend."
        canonical="/sobre"
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">Sobre</span>
        <h1>Engenharia de integrações para operação e crescimento</h1>
        <p>
          Sou desenvolvedor focado em backend e integrações, com experiência em
          WhatsApp Cloud API, Meta CAPI, automação de processos e chatbots com
          IA aplicada.
        </p>
      </section>

      <section className="seo-grid">
        <article className="seo-card">
          <h2>Especialidades</h2>
          <ul className="seo-list">
            <li>WhatsApp Business Platform / Cloud API</li>
            <li>Meta Pixel + Conversions API (CAPI)</li>
            <li>Chatbots com IA (RAG, roteamento, handoff)</li>
            <li>Integração CRM/ERP e automação de processos</li>
          </ul>
        </article>

        <article className="seo-card">
          <h2>Stack técnica</h2>
          <ul className="seo-list">
            <li>Java, Spring Boot, Node.js, TypeScript</li>
            <li>React, APIs REST, Webhooks</li>
            <li>AWS, observabilidade e boas práticas de deploy</li>
            <li>MySQL e modelagem orientada a negócio</li>
          </ul>
        </article>
      </section>
    </SiteLayout>
  );
};

export default Sobre;
