import React from 'react';
import { Link, useParams } from 'react-router-dom';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { getPostBySlug } from '../blog/data';

const WebhookCode = `import express from "express";
import crypto from "crypto";

const app = express();
app.use("/webhook", express.raw({ type: "application/json" }));

function verifySignature(req, appSecret) {
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return false;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", appSecret)
      .update(req.body)
      .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

app.post("/webhook", async (req, res) => {
  if (!verifySignature(req, process.env.META_APP_SECRET)) {
    return res.status(401).send("invalid signature");
  }

  const payload = JSON.parse(req.body.toString("utf8"));
  const messageId =
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;

  if (!messageId) return res.sendStatus(200);

  if (await wasProcessed(messageId)) return res.sendStatus(200);

  await markProcessed(messageId);
  await enqueueMessage(payload);
  return res.sendStatus(200);
});`;

const BlogPost = () => {
  const { slug } = useParams();
  const post = getPostBySlug(slug);

  if (!post) {
    return (
      <SiteLayout>
        <Seo
          title="Artigo nao encontrado | Joao Victor Souza"
          description="O artigo solicitado nao foi encontrado."
          canonical="/blog"
          robots="noindex,follow"
        />
        <h1>Artigo nao encontrado</h1>
        <p>
          Volte para <Link to="/blog">/blog</Link> e veja os conteudos
          publicados.
        </p>
      </SiteLayout>
    );
  }

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.excerpt,
      author: {
        '@type': 'Person',
        name: 'Joao Victor Souza',
      },
      datePublished: post.date,
      dateModified: post.date,
      mainEntityOfPage: `https://joaovictorsouza.dev/blog/${post.slug}`,
    },
    {
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
          name: 'Blog',
          item: 'https://joaovictorsouza.dev/blog',
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: post.title,
          item: `https://joaovictorsouza.dev/blog/${post.slug}`,
        },
      ],
    },
  ];

  return (
    <SiteLayout>
      <Seo
        title={`${post.title} | Joao Victor Souza`}
        description={post.excerpt}
        canonical={`/blog/${post.slug}`}
        keywords={post.keywords}
        schema={schema}
      />

      <article>
        <header className="seo-hero">
          <span className="seo-kicker">Artigo</span>
          <h1>{post.title}</h1>
          <p className="seo-article-meta">
            Publicado em {post.date} | Categoria: {post.category} | Tempo de
            leitura: {post.readTime}
          </p>
          <p>
            Se voce quer usar WhatsApp como canal serio de vendas e atendimento,
            precisa de arquitetura confiavel: webhook seguro, filas, templates
            governados e integracao com CRM.
          </p>
        </header>

        <section className="seo-card">
          <h2>1. Quando usar WhatsApp Cloud API</h2>
          <p>Use Cloud API quando precisa de:</p>
          <ul className="seo-list">
            <li>alto volume de atendimento com estabilidade;</li>
            <li>integracao com CRM, ERP e APIs internas;</li>
            <li>chatbot com IA + handoff para humano;</li>
            <li>rastreabilidade de mensagens e eventos.</li>
          </ul>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>2. Arquitetura recomendada para producao</h2>
          <p>Estrutura base:</p>
          <ol className="seo-list">
            <li>Webhook Receiver</li>
            <li>Fila para desacoplamento</li>
            <li>Worker de processamento</li>
            <li>Camada de regras de negocio / IA</li>
            <li>Integracao com CRM + logs + alertas</li>
          </ol>
          <div className="seo-code">
            {`WhatsApp Cloud API -> Webhook -> Fila -> Worker -> Envio de resposta
                                   -> CRM -> Observabilidade`}
          </div>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>3. Webhook seguro: assinatura e idempotencia</h2>
          <p>
            Em producao, valide assinatura e nao processe mensagem duplicada.
            Isso evita erro operacional e comportamento inconsistente.
          </p>
          <pre className="seo-code">
            <code>{WebhookCode}</code>
          </pre>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>4. Templates, opt-in e qualidade de conversa</h2>
          <table className="seo-table">
            <thead>
              <tr>
                <th>Tema</th>
                <th>Boa pratica</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Opt-in</td>
                <td>Registrar consentimento por canal e finalidade</td>
              </tr>
              <tr>
                <td>Templates</td>
                <td>Versionar e medir taxa de resposta por template</td>
              </tr>
              <tr>
                <td>Fallback</td>
                <td>Transferir para humano em casos sensiveis</td>
              </tr>
              <tr>
                <td>Operacao</td>
                <td>Monitorar bloqueios, erro e tempo de resposta</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>5. Deploy e checklist de producao</h2>
          <ol className="seo-list">
            <li>Segredos em cofre e rotacao periodica.</li>
            <li>Retry exponencial + DLQ para erros persistentes.</li>
            <li>Rate limit e logs por conversation_id.</li>
            <li>Alertas de timeout, fila acumulada e falhas 5xx.</li>
            <li>Dashboard com metricas operacionais e conversao.</li>
          </ol>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>FAQ</h2>
          <article className="seo-faq-item">
            <h3>Cloud API e melhor que solucoes nao oficiais?</h3>
            <p>
              Para operacao profissional, sim. Voce ganha governanca, previsao
              e menor risco de indisponibilidade.
            </p>
          </article>
          <article className="seo-faq-item">
            <h3>Como evitar mensagens duplicadas?</h3>
            <p>
              Use idempotencia por ID da mensagem e processamento assincrono com
              fila.
            </p>
          </article>
          <article className="seo-faq-item">
            <h3>Da para integrar com IA sem perder controle?</h3>
            <p>
              Sim. Adote guardrails, fallback e handoff humano por regra de
              negocio.
            </p>
          </article>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>Conclusao</h2>
          <p>
            WhatsApp Cloud API entrega resultado quando a arquitetura e pensada
            para producao. Com webhook robusto, fila, templates bem geridos e
            observabilidade, voce escala atendimento com previsibilidade.
          </p>
          <a className="seo-cta" href="/contato">
            Solicitar diagnostico tecnico
          </a>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>Links internos recomendados</h2>
          <ul className="seo-list">
            <li>
              <Link to="/servicos/whatsapp-cloud-api">
                Servico de WhatsApp Cloud API
              </Link>
            </li>
            <li>
              <Link to="/servicos/meta-ads-e-integracoes">
                Integracao Meta Pixel + CAPI
              </Link>
            </li>
            <li>
              <Link to="/cases/whatsapp-ia-atendimento">
                Case WhatsApp + IA com handoff
              </Link>
            </li>
          </ul>
        </section>
      </article>
    </SiteLayout>
  );
};

export default BlogPost;
