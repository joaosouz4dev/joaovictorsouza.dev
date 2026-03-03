import React from 'react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';

const Contato = () => {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    name: 'Contato - Joao Victor Souza',
    url: 'https://joaovictorsouza.dev/contato',
  };

  return (
    <SiteLayout>
      <Seo
        title="Contato | Integracoes WhatsApp, Meta e IA"
        description="Fale com Joao Victor Souza para projetos de WhatsApp Cloud API, Meta CAPI, chatbots com IA e automação de integrações."
        canonical="/contato"
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">Contato</span>
        <h1>Vamos desenhar sua arquitetura de integração</h1>
        <p>
          Compartilhe seu contexto técnico e objetivo de negócio para receber um
          diagnóstico inicial.
        </p>
      </section>

      <section className="seo-grid">
        <article className="seo-card">
          <h2>Email</h2>
          <p>
            <a href="mailto:web@joaovictorsouza.dev">web@joaovictorsouza.dev</a>
          </p>
        </article>
        <article className="seo-card">
          <h2>LinkedIn</h2>
          <p>
            <a
              href="https://www.linkedin.com/in/joaosouz4dev/"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Abrir perfil no LinkedIn"
            >
              linkedin.com/in/joaosouz4dev
            </a>
          </p>
        </article>
        <article className="seo-card">
          <h2>WhatsApp</h2>
          <p>
            <a
              href="/whatsapp"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Abrir contato rápido no WhatsApp"
            >
              Abrir contato rápido
            </a>
          </p>
        </article>
      </section>
    </SiteLayout>
  );
};

export default Contato;
