import React from 'react';
import { Link } from 'react-router-dom';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { publishedPosts, upcomingPosts } from './data';

const Blog = () => {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Blog técnico de Integracoes e IA',
    url: 'https://joaovictorsouza.dev/blog',
    description:
      'Conteúdos sobre WhatsApp Cloud API, Meta CAPI, chatbots com IA e arquitetura de integrações.',
  };

  return (
    <SiteLayout>
      <Seo
        title="Blog: WhatsApp API, Meta CAPI e Chatbots IA | Joao Victor Souza"
        description="Artigos técnicos sobre integrações WhatsApp Cloud API, Meta Pixel/CAPI, chatbots com IA, arquitetura e performance."
        canonical="/blog"
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">Blog</span>
        <h1>Conteúdo técnico para escalar atendimento, dados e conversão</h1>
        <p>
          Publicações orientadas a implementação real em backend, integrações e
          automação com IA.
        </p>
      </section>

      <section className="seo-grid">
        {publishedPosts.map((post) => (
          <article key={post.slug} className="seo-card">
            <h2>{post.title}</h2>
            <p className="seo-article-meta">
              {post.date} | {post.category} | {post.readTime}
            </p>
            <p>{post.excerpt}</p>
            <Link className="seo-cta" to={`/blog/${post.slug}`}>
              Ler artigo
            </Link>
          </article>
        ))}
      </section>

      <section className="seo-card" style={{ marginTop: '18px' }}>
        <h2>Próximos artigos do calendário editorial</h2>
        <ul className="seo-list">
          {upcomingPosts.map((post, index) => (
            <li key={`upcoming-${index}`}>{post}</li>
          ))}
        </ul>
      </section>
    </SiteLayout>
  );
};

export default Blog;
