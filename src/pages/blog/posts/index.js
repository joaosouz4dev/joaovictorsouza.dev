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
import cameraVirtualBlur from './camera-virtual-blur-auto-framing-mediapipe.js';
import avaliacaoContinuaBots from './avaliacao-continua-bots-eval-automatico.js';
import featureStorePersonalizacao from './feature-store-personalizacao-atendimento.js';
import orquestracaoAgentes from './orquestracao-agentes-ia-producao.js';
import functionCallingVsRag from './function-calling-vs-rag-dados-tempo-real.js';
import observabilidadeLlm from './observabilidade-llm-tracing-custo-qualidade.js';
import guardrailsSaidaLlm from './guardrails-saida-llm-validacao-recusa-segura.js';
import memoriaLongoPrazo from './memoria-longo-prazo-agentes-atendimento.js';
import cacheSemantico from './cache-semantico-reduzir-custo-llm.js';
import roteamentoModelos from './roteamento-modelos-modelo-certo-cada-tarefa.js';
import streamingRespostaLlm from './streaming-resposta-llm-sem-quebrar-ux.js';
import rateLimitFilaPrioridade from './rate-limit-fila-prioridade-apis-llm.js';
import chunkingDocumentoRag from './chunking-documento-rag-sem-perder-contexto.js';
import rerankingRag from './reranking-rag-melhorar-retrieval-sem-trocar-modelo.js';
import idempotenciaToolUse from './idempotencia-tool-use-evitar-acao-duplicada-agente.js';
import promptInjectionRag from './prompt-injection-rag-defender-contexto-recuperado.js';
import fallbackProvedoresLlm from './fallback-provedores-llm-sem-parar-atendimento.js';
import compressaoContexto from './compressao-contexto-caber-mais-janela-sem-perder-sinal.js';
import timeoutCancelamentoCadeia from './timeout-cancelamento-cadeia-chamadas-llm.js';
import versionarPromptComoCodigo from './versionar-prompt-como-codigo-rollout-rollback-teste.js';
import deduplicacaoContextoRag from './deduplicacao-contexto-rag-cortar-trecho-repetido.js';
import backpressurePipelineIa from './backpressure-pipeline-ia-consumidor-nao-acompanha.js';
import migracaoModeloPrompt from './migracao-modelo-sem-quebrar-prompt-producao.js';
import anonimizacaoDadosLlm from './anonimizacao-dados-antes-de-mandar-para-llm.js';
import custoPorConversa from './custo-por-conversa-atribuir-fatura-ia-ao-valor.js';
import derivaQualidadeBot from './detectar-deriva-qualidade-bot-atendimento-antes-do-cliente-reclamar.js';
import modoDegradado from './modo-degradado-manter-atendimento-quando-ia-indisponivel.js';
import trilhaAuditoriaAgente from './trilha-auditoria-agente-ia-provar-o-que-foi-decidido.js';
import limiteGastoPorCliente from './limite-gasto-por-cliente-cortar-abuso-sem-punir-uso-legitimo.js';
import janelaContextoCompartilhada from './janela-contexto-compartilhada-entre-canais-whatsapp-web-telefone.js';
import migrarEmbeddings from './migrar-embeddings-sem-reindexar-tudo-de-uma-vez.js';
import testesCargaSistemaLlm from './testes-carga-sistema-llm-simular-provedor-sem-pagar.js';
import featureFlagFluxoAgente from './feature-flag-fluxo-agente-ligar-comportamento-novo-para-poucos.js';
import sandboxFerramentasAgente from './sandbox-ferramentas-limitar-o-que-agente-pode-executar.js';
import multiIdiomaBotAtendimento from './multi-idioma-bot-atendimento-detectar-responder-escalar.js';
import aquecimentoCachePrompt from './aquecimento-cache-prompt-pagar-prefixo-uma-vez.js';
import congelarConjuntoAvaliacao from './congelar-conjunto-avaliacao-eval-envelhece-como-renovar.js';
import retencaoDadosSistemaIa from './retencao-dados-sistema-ia-o-que-guardar-quanto-tempo-como-apagar.js';
import aquecimentoIndiceVetorial from './aquecimento-indice-vetorial-primeira-consulta-do-dia-lenta.js';
import filaRevisaoHumana from './fila-revisao-humana-quais-respostas-agente-merecem-auditoria.js';
import orcamentoLatenciaPorEtapa from './orcamento-latencia-por-etapa-onde-cortar-quando-resposta-demora.js';
import rollbackBaseConhecimento from './rollback-base-conhecimento-voltar-indice-sem-derrubar-atendimento.js';
import testesRegressaoFerramentas from './testes-regressao-ferramentas-agente-contrato-antes-do-prompt.js';
import roteamentoEntreAgentes from './roteamento-conversa-entre-agentes-especializados-sem-perder-contexto.js';
import quotaContextoPorCliente from './quota-contexto-por-cliente-conversa-longa-vira-prejuizo.js';
import sinalAbandonoChat from './sinal-abandono-chat-detectar-desistencia-antes-do-cliente-sumir.js';
import chaveIdempotenciaWebhookPagamento from './chave-idempotencia-webhook-pagamento-cobrar-uma-vez-so.js';
import amostragemTraceProducao from './amostragem-trace-producao-guardar-o-que-explica-o-incidente.js';
import contratoSaidaEstruturada from './contrato-saida-estruturada-quando-esquema-do-modelo-muda-sozinho.js';
import timeoutCascataRetry from './timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar.js';
import orcamentoErroAtendimento from './orcamento-erro-atendimento-automatizado-quando-parar-de-lancar.js';
import chaveParticionamentoErrada from './chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo.js';

const postContentBySlug = {
  'chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo': chaveParticionamentoErrada,
  'orcamento-erro-atendimento-automatizado-quando-parar-de-lancar': orcamentoErroAtendimento,
  'timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar': timeoutCascataRetry,
  'contrato-saida-estruturada-quando-esquema-do-modelo-muda-sozinho': contratoSaidaEstruturada,
  'amostragem-trace-producao-guardar-o-que-explica-o-incidente': amostragemTraceProducao,
  'chave-idempotencia-webhook-pagamento-cobrar-uma-vez-so': chaveIdempotenciaWebhookPagamento,
  'sinal-abandono-chat-detectar-desistencia-antes-do-cliente-sumir': sinalAbandonoChat,
  'quota-contexto-por-cliente-conversa-longa-vira-prejuizo': quotaContextoPorCliente,
  'roteamento-conversa-entre-agentes-especializados-sem-perder-contexto': roteamentoEntreAgentes,
  'testes-regressao-ferramentas-agente-contrato-antes-do-prompt': testesRegressaoFerramentas,
  'rollback-base-conhecimento-voltar-indice-sem-derrubar-atendimento': rollbackBaseConhecimento,
  'orcamento-latencia-por-etapa-onde-cortar-quando-resposta-demora': orcamentoLatenciaPorEtapa,
  'fila-revisao-humana-quais-respostas-agente-merecem-auditoria': filaRevisaoHumana,
  'aquecimento-indice-vetorial-primeira-consulta-do-dia-lenta': aquecimentoIndiceVetorial,
  'retencao-dados-sistema-ia-o-que-guardar-quanto-tempo-como-apagar': retencaoDadosSistemaIa,
  'congelar-conjunto-avaliacao-eval-envelhece-como-renovar': congelarConjuntoAvaliacao,
  'aquecimento-cache-prompt-pagar-prefixo-uma-vez': aquecimentoCachePrompt,
  'multi-idioma-bot-atendimento-detectar-responder-escalar': multiIdiomaBotAtendimento,
  'sandbox-ferramentas-limitar-o-que-agente-pode-executar': sandboxFerramentasAgente,
  'feature-flag-fluxo-agente-ligar-comportamento-novo-para-poucos': featureFlagFluxoAgente,
  'testes-carga-sistema-llm-simular-provedor-sem-pagar': testesCargaSistemaLlm,
  'migrar-embeddings-sem-reindexar-tudo-de-uma-vez': migrarEmbeddings,
  'janela-contexto-compartilhada-entre-canais-whatsapp-web-telefone': janelaContextoCompartilhada,
  'limite-gasto-por-cliente-cortar-abuso-sem-punir-uso-legitimo': limiteGastoPorCliente,
  'trilha-auditoria-agente-ia-provar-o-que-foi-decidido': trilhaAuditoriaAgente,
  'modo-degradado-manter-atendimento-quando-ia-indisponivel': modoDegradado,
  'detectar-deriva-qualidade-bot-atendimento-antes-do-cliente-reclamar': derivaQualidadeBot,
  'custo-por-conversa-atribuir-fatura-ia-ao-valor': custoPorConversa,
  'anonimizacao-dados-antes-de-mandar-para-llm': anonimizacaoDadosLlm,
  'migracao-modelo-sem-quebrar-prompt-producao': migracaoModeloPrompt,
  'backpressure-pipeline-ia-consumidor-nao-acompanha': backpressurePipelineIa,
  'deduplicacao-contexto-rag-cortar-trecho-repetido': deduplicacaoContextoRag,
  'versionar-prompt-como-codigo-rollout-rollback-teste': versionarPromptComoCodigo,
  'timeout-cancelamento-cadeia-chamadas-llm': timeoutCancelamentoCadeia,
  'compressao-contexto-caber-mais-janela-sem-perder-sinal': compressaoContexto,
  'fallback-provedores-llm-sem-parar-atendimento': fallbackProvedoresLlm,
  'prompt-injection-rag-defender-contexto-recuperado': promptInjectionRag,
  'idempotencia-tool-use-evitar-acao-duplicada-agente': idempotenciaToolUse,
  'reranking-rag-melhorar-retrieval-sem-trocar-modelo': rerankingRag,
  'chunking-documento-rag-sem-perder-contexto': chunkingDocumentoRag,
  'rate-limit-fila-prioridade-apis-llm': rateLimitFilaPrioridade,
  'streaming-resposta-llm-sem-quebrar-ux': streamingRespostaLlm,
  'roteamento-modelos-modelo-certo-cada-tarefa': roteamentoModelos,
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
  'camera-virtual-blur-auto-framing-mediapipe': cameraVirtualBlur,
  'avaliacao-continua-bots-eval-automatico': avaliacaoContinuaBots,
  'feature-store-personalizacao-atendimento': featureStorePersonalizacao,
  'orquestracao-agentes-ia-producao': orquestracaoAgentes,
  'function-calling-vs-rag-dados-tempo-real': functionCallingVsRag,
  'observabilidade-llm-tracing-custo-qualidade': observabilidadeLlm,
  'guardrails-saida-llm-validacao-recusa-segura': guardrailsSaidaLlm,
  'memoria-longo-prazo-agentes-atendimento': memoriaLongoPrazo,
  'cache-semantico-reduzir-custo-llm': cacheSemantico,
};

export const getPostContentBySlug = (slug, language = 'pt') => {
  const post = postContentBySlug[slug];
  if (!post) return null;
  return post[language] || post.pt || null;
};

export default postContentBySlug;
