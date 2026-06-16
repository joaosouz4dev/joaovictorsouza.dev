// Agregador de conteudo dos artigos do blog.
// Cada arquivo de post exporta { pt, en, es }, onde cada idioma tem o formato:
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }
//
// Tipos de bloco suportados pelo renderer (blog-post/index.js):
//   { type: 'paragraph', value }
//   { type: 'list', items: [] }
//   { type: 'ordered', items: [] }
//   { type: 'code', value }
//   { type: 'diagram', value }
//   { type: 'table', columns: [], rows: [[]] }
//   { type: 'faq', items: [{ question, answer }] }

import guiaWhatsappCloudApi from './guia-whatsapp-cloud-api.js';
import metaPixelVsCapi from './meta-pixel-vs-capi-arquitetura.js';
import webhookIdempotencia from './webhook-whatsapp-idempotencia-filas.js';
import handoffHumano from './handoff-humano-whatsapp-ia.js';
import ragAtendimento from './rag-atendimento-whatsapp-producao.js';
import monitoramentoAlertas from './monitoramento-alertas-integracoes.js';
import crmPlaybook from './crm-whatsapp-playbook-vendas.js';
import segurancaIntegracoes from './seguranca-integracoes-meta-whatsapp.js';
import custosCloudApi from './custos-whatsapp-cloud-api-otimizacao.js';
import testesContrato from './testes-contrato-webhooks-apis.js';
import multiTenant from './arquitetura-multi-tenant-whatsapp-saas.js';
import roadmap90Dias from './roadmap-automacao-suporte-ia-90-dias.js';
import filaPicos from './fila-picos-campanha-whatsapp.js';
import slasBotHumano from './slas-atendimento-bot-humano.js';
import governancaTemplates from './governanca-templates-times-grandes.js';
import integracaoErpCrm from './integracao-erp-crm-sem-retrabalho.js';
import roiAutomacao from './roi-real-automacao-ia.js';
import cagVsRag from './cag-vs-rag-cache-contexto.js';
import baileysCaller from './chamadas-voz-whatsapp-baileys-caller.js';

const postContentBySlug = {
  'guia-whatsapp-cloud-api': guiaWhatsappCloudApi,
  'meta-pixel-vs-capi-arquitetura': metaPixelVsCapi,
  'webhook-whatsapp-idempotencia-filas': webhookIdempotencia,
  'handoff-humano-whatsapp-ia': handoffHumano,
  'rag-atendimento-whatsapp-producao': ragAtendimento,
  'monitoramento-alertas-integracoes': monitoramentoAlertas,
  'crm-whatsapp-playbook-vendas': crmPlaybook,
  'seguranca-integracoes-meta-whatsapp': segurancaIntegracoes,
  'custos-whatsapp-cloud-api-otimizacao': custosCloudApi,
  'testes-contrato-webhooks-apis': testesContrato,
  'arquitetura-multi-tenant-whatsapp-saas': multiTenant,
  'roadmap-automacao-suporte-ia-90-dias': roadmap90Dias,
  'fila-picos-campanha-whatsapp': filaPicos,
  'slas-atendimento-bot-humano': slasBotHumano,
  'governanca-templates-times-grandes': governancaTemplates,
  'integracao-erp-crm-sem-retrabalho': integracaoErpCrm,
  'roi-real-automacao-ia': roiAutomacao,
  'cag-vs-rag-cache-contexto': cagVsRag,
  'chamadas-voz-whatsapp-baileys-caller': baileysCaller,
};

export const getPostContentBySlug = (slug, language = 'pt') => {
  const post = postContentBySlug[slug];
  if (!post) return null;
  return post[language] || post.pt || null;
};

export default postContentBySlug;
