// Titulos dos posts mais recentes para o rodape do site.
//
// O rodape aparece em todas as paginas, entao ele entra no bundle de entrada.
// Importar ./data.js aqui traria junto excerpt e keywords dos posts inteiros
// nos tres idiomas, que sao a maior parte daquele arquivo e que o rodape nunca
// usa: ele so precisa de slug e titulo de quatro posts. Manter essa lista curta
// separada e o que impede o bundle de entrada de crescer a cada artigo novo.
//
// Ordem: do mais recente para o mais antigo, igual a ./data.js. Ao publicar um
// artigo, basta acrescentar a entrada no topo e remover a ultima.

import { toBaseLanguage } from '../../utils/i18n.js';

const LATEST_POSTS = [
  {
    slug: 'quota-contexto-por-cliente-conversa-longa-vira-prejuizo',
    title: {
      pt: 'Quota de contexto por cliente: quando a conversa longa vira prejuízo',
      en: 'Per-customer context quota: when a long conversation becomes a loss',
      es: 'Cuota de contexto por cliente: cuándo la conversación larga se vuelve pérdida',
    },
  },
  {
    slug: 'roteamento-conversa-entre-agentes-especializados-sem-perder-contexto',
    title: {
      pt: 'Roteamento de conversa entre agentes especializados sem perder o contexto',
      en: 'Routing conversations between specialized agents without losing context',
      es: 'Enrutamiento de conversación entre agentes especializados sin perder el contexto',
    },
  },
  {
    slug: 'testes-regressao-ferramentas-agente-contrato-antes-do-prompt',
    title: {
      pt: 'Testes de regressão para ferramentas do agente: contrato antes do prompt',
      en: 'Regression tests for agent tools: contract before prompt',
      es: 'Pruebas de regresión para herramientas del agente: contrato antes del prompt',
    },
  },
  {
    slug: 'rollback-base-conhecimento-voltar-indice-sem-derrubar-atendimento',
    title: {
      pt: 'Rollback de base de conhecimento: voltar o índice sem derrubar o atendimento',
      en: 'Knowledge base rollback: reverting the index without taking support down',
      es: 'Rollback de base de conocimiento: volver el índice sin tirar la atención',
    },
  },
];

export const getLatestPosts = (language = 'pt') => {
  const locale = toBaseLanguage(language);
  return LATEST_POSTS.map(({ slug, title }) => ({
    slug,
    title: title[locale] || title.pt,
  }));
};

export default LATEST_POSTS;
