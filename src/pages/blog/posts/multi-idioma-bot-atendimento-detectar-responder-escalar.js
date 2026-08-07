// Conteudo do artigo: multi-idioma em bot de atendimento, detectando,
// respondendo e escalando sem misturar idioma no meio da conversa.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'Um bot que atende em três idiomas parece um problema de tradução, e é aí que o projeto começa errado. O modelo já responde em qualquer idioma sem que você peça, então o código passa a impressão de estar pronto no primeiro teste: você escreve em espanhol, ele responde em espanhol, e a demo convence todo mundo. O que quebra depois não é a fluência do modelo, é tudo que está em volta dela. A base de conhecimento está escrita em português e o retrieval devolve trechos que o cliente não lê. O template do WhatsApp foi aprovado em um idioma só e não pode ser enviado no outro. O cliente manda uma mensagem de duas palavras e o detector muda o idioma da conversa inteira por causa disso. E quando o atendimento escala para um humano, ninguém sabe se existe alguém na fila que fala aquele idioma agora. Este artigo trata multi-idioma como o que ele é de verdade: uma decisão de estado da conversa que atravessa detecção, recuperação, geração, canal e transbordo, e não uma instrução no fim do prompt.',
  sections: [
    {
      title: 'O idioma não é um atributo da mensagem, é estado da conversa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A implementação ingênua detecta o idioma de cada mensagem que chega e responde naquele idioma. Funciona nos textos longos e falha exatamente onde o atendimento acontece. Um cliente que conversa em espanhol responde "ok" a uma pergunta, e "ok" não é espanhol para nenhum detector estatístico. Outro escreve "no" para negar algo, e "no" é uma palavra inglesa perfeitamente válida. Um terceiro cola o código de rastreio do pedido, sozinho, e não existe idioma naquilo. Em todos esses casos, um detector por mensagem devolve algo diferente do idioma real da conversa e o bot muda de idioma no meio, o que o cliente lê como falha grave mesmo quando o conteúdo está correto.',
        },
        {
          type: 'paragraph',
          value:
            'A modelagem certa separa dois conceitos que a implementação ingênua confunde. O idioma da conversa é um campo do estado, com um valor e um nível de confiança, e ele governa em que idioma o bot responde. O idioma detectado na mensagem é apenas mais uma evidência que pode ou não atualizar aquele campo. A mensagem curta continua sendo processada normalmente, ela só não tem peso suficiente para virar a chave. O efeito prático é que a conversa fica estável: o bot escolhe o idioma uma vez, com evidência suficiente, e só troca quando existe evidência clara de que o cliente trocou de propósito.',
        },
        {
          type: 'table',
          columns: ['Sinal', 'O que ele diz de fato', 'Peso na decisão'],
          rows: [
            [
              'Idioma declarado no perfil ou na conta',
              'Preferência explícita do cliente, estável ao longo do tempo',
              'Alto, e vence o detector enquanto não houver contradição clara',
            ],
            [
              'Detector estatístico na mensagem longa',
              'Boa estimativa quando há dezenas de caracteres de texto corrido',
              'Alto acima de um mínimo de caracteres e de confiança',
            ],
            [
              'Detector na mensagem curta ou sem palavras',
              'Ruído: confirmações, números, códigos e emojis não têm idioma',
              'Nenhum, a mensagem é atendida mas não move o estado',
            ],
            [
              'Idioma da primeira mensagem do atendimento',
              'Ponto de partida razoável quando não há perfil',
              'Médio, serve de valor inicial com confiança baixa',
            ],
            [
              'Pedido explícito para trocar de idioma',
              'Intenção declarada, mais forte que qualquer estatística',
              'Máximo, troca imediata e registrada na conversa',
            ],
            [
              'Idioma do template ou do canal de entrada',
              'Diz por onde o cliente veio, não o que ele fala',
              'Baixo, apenas desempate quando tudo mais está vazio',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A regra de troca precisa ser explícita no código, e não emergir de um limiar solto no detector. Uma formulação que funciona bem em atendimento: troque o idioma da conversa quando o cliente pedir isso em palavras, ou quando duas mensagens consecutivas com texto suficiente forem detectadas no mesmo idioma novo com confiança acima do limiar. Uma única mensagem longa em outro idioma não basta, porque o caso mais comum dela não é troca de idioma, é o cliente colando um texto de terceiro, um e-mail recebido ou uma mensagem de erro do sistema.',
        },
      ],
    },
    {
      title: 'Detecção com abstenção: o detector precisa poder dizer que não sabe',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A maioria dos detectores devolve sempre um idioma, mesmo quando a entrada não tem informação suficiente para sustentar palpite algum. Esse comportamento é razoável em classificação de documentos e é péssimo em atendimento, onde metade das mensagens é curta. O detector útil aqui é o que tem uma terceira saída além de "português" e "espanhol": "indeterminado". Colocar a abstenção antes do classificador é mais barato e mais confiável do que tentar calibrar limiares depois, porque boa parte das mensagens que causam troca indevida nem chega a ser texto: são números, códigos, links e emojis.',
        },
        {
          type: 'code',
          value: `// Camada de decisão de idioma: transforma evidência em estado.
// O detector concreto é injetado; o que importa aqui é a política.

const IDIOMAS_SUPORTADOS = new Set(['pt', 'es', 'en']);
const MIN_CARACTERES_UTEIS = 12;
const MIN_CONFIANCA = 0.75;
const MENSAGENS_PARA_TROCAR = 2;

// Remove o que não carrega sinal de idioma: URLs, códigos, números,
// emojis e pontuação. Sobra o texto que realmente pode ser classificado.
const textoUtil = (mensagem) =>
  mensagem
    .replace(/https?:\\/\\/\\S+/g, ' ')
    .replace(/[A-Z0-9]{6,}/g, ' ')
    .replace(/[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]/gu, ' ')
    .replace(/[^\\p{L}\\s]/gu, ' ')
    .replace(/\\s+/g, ' ')
    .trim();

// Devolve o idioma OU null. Null aqui significa "não sei", e é uma
// resposta legítima que impede a conversa de trocar de idioma por ruído.
export const detectarIdioma = (mensagem, detector) => {
  const texto = textoUtil(mensagem);
  if (texto.length < MIN_CARACTERES_UTEIS) return null;

  const { idioma, confianca } = detector(texto);
  if (!IDIOMAS_SUPORTADOS.has(idioma)) return null;
  if (confianca < MIN_CONFIANCA) return null;

  return idioma;
};

// Aplica a evidência ao estado. Só troca com pedido explícito ou com
// evidência repetida; caso contrário devolve o estado inalterado.
export const aplicarEvidencia = (estado, mensagem, detector, pedidoExplicito) => {
  if (pedidoExplicito && IDIOMAS_SUPORTADOS.has(pedidoExplicito)) {
    return { idioma: pedidoExplicito, confirmado: true, candidato: null, streak: 0 };
  }

  const detectado = detectarIdioma(mensagem, detector);
  if (!detectado) return estado;

  if (!estado.idioma) {
    return { idioma: detectado, confirmado: false, candidato: null, streak: 0 };
  }

  if (detectado === estado.idioma) {
    return { ...estado, confirmado: true, candidato: null, streak: 0 };
  }

  const streak = estado.candidato === detectado ? estado.streak + 1 : 1;
  if (streak >= MENSAGENS_PARA_TROCAR) {
    return { idioma: detectado, confirmado: true, candidato: null, streak: 0 };
  }

  return { ...estado, candidato: detectado, streak };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Duas decisões dessa camada merecem destaque. A primeira é que a limpeza do texto vem antes do detector, não depois: filtrar código de rastreio e link no pré-processamento elimina a maior parte dos falsos positivos sem custo nenhum de modelo. A segunda é que o candidato à troca fica guardado no estado. Sem esse campo, "duas mensagens consecutivas" viraria uma consulta ao histórico a cada turno, e a regra deixaria de ser barata justamente no caminho quente.',
        },
        {
          type: 'paragraph',
          value:
            'Vale reconhecer o limite honesto dessa abordagem: o cliente que mistura dois idiomas na mesma frase, algo comum em fronteiras e em comunidades bilíngues, não é resolvido por classificação por mensagem. Para esse caso, a saída prática não é sofisticar o detector, é registrar a ambiguidade no estado e responder no idioma que o cliente usou para formular a pergunta em si, deixando o restante como contexto.',
        },
      ],
    },
    {
      title: 'Recuperação: a base de conhecimento é o gargalo real',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A parte cara do multi-idioma não é a resposta, é o conhecimento que sustenta a resposta. O modelo escreve em espanhol sem esforço, mas se a base está em português e o retrieval é feito com o texto em espanhol do cliente, a busca por termos praticamente não encontra nada, e a busca vetorial encontra menos do que deveria. O sintoma é característico e enganoso: o bot responde num espanhol impecável, com o conteúdo errado, e a avaliação por idioma dá nota alta enquanto a avaliação por correção despenca.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'O que exige', 'Quando compensa'],
          rows: [
            [
              'Traduzir a pergunta para o idioma da base',
              'Uma chamada de tradução curta antes do retrieval',
              'Base grande em um idioma só e volume moderado por idioma',
            ],
            [
              'Embeddings multilíngues no mesmo índice',
              'Modelo de embedding treinado entre idiomas',
              'Conteúdo semanticamente equivalente e busca vetorial dominante',
            ],
            [
              'Índice separado por idioma',
              'Conteúdo realmente escrito em cada idioma e curado',
              'Regras que mudam por país, não só o texto',
            ],
            [
              'Traduzir o trecho recuperado antes de gerar',
              'Uma tradução por trecho, no caminho quente',
              'Poucos trechos por resposta e base que muda com frequência',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A escolha entre elas quase nunca é técnica. Se o conteúdo é o mesmo em todos os mercados e só o texto muda, embedding multilíngue ou tradução da consulta resolvem com pouco esforço operacional. Se as regras mudam por país, e em atendimento elas mudam muito, prazo de troca, imposto, política de reembolso, canal de suporte disponível, então índice separado deixa de ser preferência e vira obrigação: traduzir a política brasileira para o espanhol produz uma resposta fluente e factualmente errada para o cliente do México, que é o pior desfecho possível porque parece certo.',
        },
        {
          type: 'diagram',
          value: `Mensagem do cliente
        |
        v
[limpeza do texto] --> vazio/curto? --> mantém idioma do estado
        |
        v
[detector com abstenção] --> null --> mantém idioma do estado
        |
        v
[política de troca] --> idioma da conversa (estado persistido)
        |
        +--> [retrieval] --> índice do idioma OU consulta traduzida
        |                       |
        |                       v
        |                 trechos + idioma de origem do trecho
        |
        +--> [geração] --> responde no idioma da conversa
        |
        +--> [canal] --> template aprovado nesse idioma?
        |                   não --> usa idioma de fallback declarado
        |
        +--> [transbordo] --> fila com atendente do idioma
                                não há --> política explícita de espera`,
        },
      ],
    },
    {
      title: 'Geração: instruir o idioma sem deixar o prompt escolher sozinho',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com o idioma resolvido no estado, a geração fica quase trivial, desde que o prompt seja explícito sobre a assimetria que existe ali. O modelo recebe um idioma de resposta obrigatório e trechos de contexto que podem estar em outro idioma. Sem instrução clara, dois erros aparecem com frequência: o modelo espelha o idioma do contexto recuperado em vez do idioma pedido, e o modelo traduz nomes próprios, códigos de produto e status de pedido que precisam permanecer exatamente como estão no sistema.',
        },
        {
          type: 'code',
          value: `// Montagem do prompt com idioma explícito e contexto possivelmente
// em outro idioma. A instrução separa idioma de saída de idioma de fonte.

const montarPrompt = ({ idiomaConversa, trechos, pergunta, nomesLiterais }) => {
  const contexto = trechos
    .map((t, i) => \`[\${i + 1}] (idioma da fonte: \${t.idioma})\\n\${t.texto}\`)
    .join('\\n\\n');

  const system = [
    \`Responda SEMPRE em \${idiomaConversa}, independentemente do idioma dos trechos de contexto.\`,
    'Os trechos podem estar em outro idioma. Use o conteúdo deles, traduza o sentido, nunca copie o texto original.',
    \`Não traduza nem reescreva estes valores literais: \${nomesLiterais.join(', ')}.\`,
    'Se os trechos não contiverem a informação, diga isso no idioma da resposta em vez de inferir.',
  ].join('\\n');

  return {
    system,
    user: \`Contexto:\\n\${contexto}\\n\\nPergunta do cliente:\\n\${pergunta}\`,
  };
};

// Verificação pós-geração: o idioma da resposta bate com o pedido?
// Falhar aqui é raro, mas é barato de checar e evita entregar errado.
export const responderComIdiomaGarantido = async ({ estado, trechos, pergunta, chamarModelo, detector }) => {
  const nomesLiterais = trechos.flatMap((t) => t.identificadores ?? []);
  const prompt = montarPrompt({
    idiomaConversa: estado.idioma,
    trechos,
    pergunta,
    nomesLiterais,
  });

  const resposta = await chamarModelo(prompt);
  const idiomaSaida = detectarIdioma(resposta, detector);

  // Só reprocessa quando o detector tem certeza de que errou o idioma.
  // Se o detector se absteve, aceita a resposta: reprocessar por dúvida
  // dobra o custo e a latência sem evidência de erro.
  if (idiomaSaida && idiomaSaida !== estado.idioma) {
    return chamarModelo({
      ...prompt,
      system: \`\${prompt.system}\\nA resposta anterior saiu no idioma errado. Responda obrigatoriamente em \${estado.idioma}.\`,
    });
  }

  return resposta;
};`,
        },
        {
          type: 'paragraph',
          value:
            'A verificação depois da geração é barata porque a resposta do bot costuma ser longa o suficiente para o detector ter confiança, o que é justamente o caso em que ele funciona bem. Repare que o reprocessamento só acontece quando o detector afirma um idioma diferente, nunca quando ele se abstém: tratar abstenção como erro dobraria o custo de uma fração relevante das respostas sem nenhuma evidência de que algo saiu errado.',
        },
      ],
    },
    {
      title: 'Canal e transbordo: onde o multi-idioma deixa de ser problema de modelo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Fora do modelo estão as duas restrições que mais derrubam projeto multi-idioma em produção, e nenhuma delas se resolve com prompt. A primeira é o template. Em canais como o WhatsApp Cloud API, a mensagem iniciada pela empresa fora da janela de atendimento precisa de um template aprovado, e a aprovação é por idioma. Um template aprovado em português simplesmente não existe em espanhol até que alguém o submeta e a aprovação saia. Isso significa que a matriz de templates por idioma é um item de operação com prazo próprio, e que o código precisa consultar a disponibilidade antes de tentar enviar, com um idioma de fallback declarado por template em vez de deixar o envio falhar.',
        },
        {
          type: 'ordered',
          items: [
            'Antes de enviar, consulte a disponibilidade do template no idioma da conversa, não presuma que ele existe.',
            'Se não existir, use o idioma de fallback declarado naquele template e registre a substituição no evento de envio.',
            'Se nem o fallback existir, não envie o template: converta para uma mensagem dentro da janela de atendimento ou adie.',
            'Monitore a taxa de substituição por idioma, porque ela é o indicador antecedente de que um mercado inteiro está sendo atendido no idioma errado.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A segunda restrição é o transbordo. Escalar para um humano em atendimento multi-idioma exige que a fila conheça o idioma e que exista alguém capaz de atender nele agora, o que raramente é verdade em todos os turnos do dia. O erro comum é tratar isso como detalhe de roteamento e descobrir na madrugada que a conversa em espanhol ficou parada esperando um atendente que só entra às nove da manhã. A decisão precisa ser explícita e escrita antes de acontecer: ou a conversa espera com um aviso honesto de prazo, ou é atendida em um idioma comum com o consentimento do cliente, ou entra num fluxo assíncrono de retorno. Qualquer uma das três é aceitável, e nenhuma delas é aceitável quando descoberta pelo cliente no meio da espera.',
        },
        {
          type: 'table',
          columns: ['Situação no transbordo', 'Política ruim', 'Política defensável'],
          rows: [
            [
              'Não há atendente do idioma no turno atual',
              'Enfileirar e deixar o cliente esperando sem aviso',
              'Informar o prazo real e oferecer retorno assíncrono ou outro idioma',
            ],
            [
              'Há atendente, mas a fila está longa',
              'Prometer atendimento imediato para não perder o cliente',
              'Mostrar a posição e manter o bot resolvendo o que dá para resolver',
            ],
            [
              'Cliente aceita ser atendido em outro idioma',
              'Trocar em silêncio e ninguém registra',
              'Registrar o consentimento no estado e marcar a conversa como idioma convertido',
            ],
            [
              'Histórico da conversa está em idioma diferente do atendente',
              'Entregar o histórico cru e esperar que ele se vire',
              'Anexar um resumo traduzido, preservando o original para auditoria',
            ],
          ],
        },
      ],
    },
    {
      title: 'Medir por idioma, porque a média esconde o mercado que está quebrado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um bot multi-idioma com noventa por cento do volume em português e dez por cento distribuídos em espanhol e inglês tem um problema estrutural de medição: qualquer métrica agregada é, na prática, a métrica do português. O mercado menor pode estar com resolução muito abaixo, e o painel geral não se move o suficiente para alguém perceber. Quando a queda é descoberta, ela costuma vir por reclamação comercial, meses depois, e nesse ponto o dado para diagnosticar a causa raiz já rotacionou.',
        },
        {
          type: 'list',
          items: [
            'Segmente todas as métricas de desfecho por idioma da conversa: resolução sem humano, transbordos, retorno do cliente sobre o mesmo assunto e custo por conversa.',
            'Acompanhe a taxa de trocas de idioma por conversa: um valor subindo indica detector instável, não cliente indeciso.',
            'Meça a cobertura do retrieval por idioma, contando as respostas geradas sem nenhum trecho recuperado com pontuação mínima aceitável.',
            'Monitore a taxa de substituição de template por idioma, que revela o mercado sendo notificado no idioma errado antes de qualquer reclamação.',
            'Mantenha um conjunto de avaliação por idioma com casos escritos por falantes nativos, e não traduzidos do conjunto em português, porque a tradução preserva a estrutura da pergunta original e some justamente com as formas de perguntar que só existem naquele idioma.',
            'Alerte por idioma com limiar próprio e volume mínimo, para que o mercado pequeno gere sinal sem inundar o canal de alertas com ruído estatístico.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O ponto mais frequentemente ignorado da lista é o último item sobre o conjunto de avaliação. Traduzir os casos de teste do português é o caminho barato e produz uma avaliação que aprova o sistema enquanto ele falha em produção, porque os casos traduzidos herdam a estrutura da pergunta em português. O cliente mexicano não pergunta a mesma coisa traduzida, ele pergunta outra coisa, com outro vocabulário, sobre outras regras. Um conjunto de trinta casos reais escritos por falante nativo diz mais sobre a qualidade naquele mercado do que trezentos casos traduzidos.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não detectar o idioma a cada mensagem e responder no idioma detectado?',
      answer:
        'Porque boa parte das mensagens de um atendimento não carrega sinal de idioma nenhum. Confirmações curtas, números de pedido, códigos de rastreio, links e emojis fazem qualquer detector estatístico devolver um palpite fraco, e como a maioria dos detectores sempre devolve algum idioma, esse palpite vira uma troca indevida no meio da conversa. O cliente lê isso como falha grave mesmo quando o conteúdo está correto. A modelagem que aguenta produção guarda o idioma como campo do estado da conversa, com confiança associada, e trata a detecção de cada mensagem apenas como evidência: mensagem sem texto útil suficiente é atendida normalmente mas não move o estado, e a troca só acontece com pedido explícito do cliente ou com duas mensagens consecutivas de texto suficiente no mesmo idioma novo.',
    },
    {
      question: 'A base de conhecimento precisa ser traduzida para cada idioma atendido?',
      answer:
        'Depende de o conteúdo mudar ou apenas o texto mudar. Se a informação é a mesma em todos os mercados, você evita traduzir a base usando embeddings multilíngues no mesmo índice ou traduzindo a pergunta do cliente para o idioma da base antes do retrieval, o que custa uma chamada curta por consulta. Se as regras mudam por país, e em atendimento elas mudam bastante, prazo de troca, imposto, política de reembolso e canais disponíveis, então índice separado por idioma deixa de ser preferência e vira necessidade: uma tradução da política brasileira produz uma resposta fluente e factualmente errada para o cliente do México, que é o pior desfecho possível porque parece correto e não dispara nenhuma verificação. O sinal de que você está no caso errado é a resposta sair impecável no idioma e errada no conteúdo.',
    },
    {
      question: 'O que fazer quando o cliente precisa de humano e não há atendente do idioma dele?',
      answer:
        'Decidir antes, e não no momento em que a conversa já está esperando. As três saídas defensáveis são informar o prazo real de espera até entrar um atendente daquele idioma, oferecer atendimento em um idioma comum com consentimento explícito registrado no estado da conversa, ou converter para um fluxo assíncrono com retorno agendado. Todas são aceitáveis para o cliente quando declaradas na hora; nenhuma é aceitável quando ele descobre sozinho, depois de vinte minutos na fila. Independentemente da escolha, o histórico entregue ao atendente deve vir com um resumo no idioma que ele fala, preservando o original para auditoria, senão o transbordo apenas transfere o problema de idioma do bot para a pessoa.',
    },
  ],
  conclusion: {
    title: 'Multi-idioma é decisão de estado, não instrução no prompt',
    description:
      'O modelo já fala os idiomas do seu mercado, e é por isso que o problema passa despercebido até chegar em produção. O que quebra é o retrieval buscando em um idioma e respondendo em outro, o template que não existe aprovado naquele idioma, o detector trocando o idioma da conversa por causa de um "ok", e a fila de humanos que não tem quem atenda às três da manhã. Tratar o idioma como campo do estado da conversa, com política explícita de troca, retrieval consciente do idioma, matriz de templates monitorada e transbordo com política escrita, é o que separa a demo convincente do atendimento que funciona no terceiro mercado.',
    cta: 'Quer atender em mais de um idioma sem que a qualidade caia no mercado menor? Posso desenhar essa camada de idioma no seu fluxo de atendimento, da detecção com abstenção até a medição segmentada, para que a expansão não seja descoberta pelo cliente.',
  },
  related: [
    {
      label: 'Janela de contexto compartilhada entre canais: WhatsApp, web e telefone',
      to: '/blog/janela-contexto-compartilhada-entre-canais-whatsapp-web-telefone',
    },
    {
      label: 'Governança de templates em times grandes',
      to: '/blog/governanca-templates-times-grandes',
    },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

const en = {
  intro:
    'A bot that serves three languages looks like a translation problem, and that is exactly where the project starts off wrong. The model already answers in any language without being asked, so the code gives the impression of being finished on the first test: you type in Spanish, it answers in Spanish, and the demo convinces everyone. What breaks later is not the fluency of the model, it is everything around it. The knowledge base is written in one language and retrieval returns passages the customer cannot read. The WhatsApp template was approved in a single language and cannot be sent in the other. The customer sends a two-word message and the detector flips the language of the entire conversation because of it. And when support escalates to a human, nobody knows whether there is anyone in the queue who speaks that language right now. This article treats multilingual support as what it really is: a conversation state decision that cuts across detection, retrieval, generation, channel and handoff, and not an instruction at the end of the prompt.',
  sections: [
    {
      title: 'Language is not an attribute of the message, it is conversation state',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The naive implementation detects the language of every incoming message and answers in that language. It works on long texts and fails exactly where support actually happens. A customer chatting in Spanish replies "ok" to a question, and "ok" is not Spanish to any statistical detector. Another writes "no" to deny something, and "no" is a perfectly valid English word. A third pastes the order tracking code, on its own, and there is no language in that. In all these cases a per-message detector returns something different from the real language of the conversation and the bot switches languages midway, which the customer reads as a serious failure even when the content is correct.',
        },
        {
          type: 'paragraph',
          value:
            'The right modeling separates two concepts the naive implementation conflates. The conversation language is a state field, with a value and a confidence level, and it governs which language the bot answers in. The language detected in the message is merely one more piece of evidence that may or may not update that field. The short message is still processed normally, it simply does not carry enough weight to flip the switch. The practical effect is a stable conversation: the bot picks a language once, with sufficient evidence, and only switches when there is clear evidence the customer switched on purpose.',
        },
        {
          type: 'table',
          columns: ['Signal', 'What it actually tells you', 'Weight in the decision'],
          rows: [
            [
              'Language declared in the profile or account',
              'Explicit customer preference, stable over time',
              'High, and beats the detector while there is no clear contradiction',
            ],
            [
              'Statistical detector on a long message',
              'A good estimate when there are dozens of characters of running text',
              'High above a minimum of characters and of confidence',
            ],
            [
              'Detector on a short or wordless message',
              'Noise: confirmations, numbers, codes and emojis have no language',
              'None, the message is served but does not move the state',
            ],
            [
              'Language of the first message of the session',
              'A reasonable starting point when there is no profile',
              'Medium, serves as an initial value with low confidence',
            ],
            [
              'Explicit request to switch languages',
              'Declared intent, stronger than any statistic',
              'Maximum, immediate switch recorded in the conversation',
            ],
            [
              'Language of the template or of the inbound channel',
              'Tells you where the customer came from, not what they speak',
              'Low, only a tiebreaker when everything else is empty',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The switching rule must be explicit in the code, not emerge from a loose threshold in the detector. A formulation that works well in support: switch the conversation language when the customer asks for it in words, or when two consecutive messages with enough text are detected in the same new language with confidence above the threshold. A single long message in another language is not enough, because its most common cause is not a language switch, it is the customer pasting third-party text, a received email or a system error message.',
        },
      ],
    },
    {
      title: 'Detection with abstention: the detector must be able to say it does not know',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Most detectors always return a language, even when the input carries no information to support any guess at all. That behavior is reasonable in document classification and terrible in support, where half the messages are short. The useful detector here is the one with a third output besides "Portuguese" and "Spanish": "undetermined". Putting the abstention before the classifier is cheaper and more reliable than trying to calibrate thresholds afterwards, because a good share of the messages that cause an undue switch are not even text: they are numbers, codes, links and emojis.',
        },
        {
          type: 'code',
          value: `// Language decision layer: turns evidence into state.
// The concrete detector is injected; what matters here is the policy.

const SUPPORTED_LANGUAGES = new Set(['pt', 'es', 'en']);
const MIN_USEFUL_CHARS = 12;
const MIN_CONFIDENCE = 0.75;
const MESSAGES_TO_SWITCH = 2;

// Strips whatever carries no language signal: URLs, codes, numbers,
// emojis and punctuation. What is left is text that can be classified.
const usefulText = (message) =>
  message
    .replace(/https?:\\/\\/\\S+/g, ' ')
    .replace(/[A-Z0-9]{6,}/g, ' ')
    .replace(/[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]/gu, ' ')
    .replace(/[^\\p{L}\\s]/gu, ' ')
    .replace(/\\s+/g, ' ')
    .trim();

// Returns the language OR null. Null here means "I do not know", and is a
// legitimate answer that keeps the conversation from switching on noise.
export const detectLanguage = (message, detector) => {
  const text = usefulText(message);
  if (text.length < MIN_USEFUL_CHARS) return null;

  const { language, confidence } = detector(text);
  if (!SUPPORTED_LANGUAGES.has(language)) return null;
  if (confidence < MIN_CONFIDENCE) return null;

  return language;
};

// Applies the evidence to the state. Switches only on an explicit request
// or on repeated evidence; otherwise returns the state unchanged.
export const applyEvidence = (state, message, detector, explicitRequest) => {
  if (explicitRequest && SUPPORTED_LANGUAGES.has(explicitRequest)) {
    return { language: explicitRequest, confirmed: true, candidate: null, streak: 0 };
  }

  const detected = detectLanguage(message, detector);
  if (!detected) return state;

  if (!state.language) {
    return { language: detected, confirmed: false, candidate: null, streak: 0 };
  }

  if (detected === state.language) {
    return { ...state, confirmed: true, candidate: null, streak: 0 };
  }

  const streak = state.candidate === detected ? state.streak + 1 : 1;
  if (streak >= MESSAGES_TO_SWITCH) {
    return { language: detected, confirmed: true, candidate: null, streak: 0 };
  }

  return { ...state, candidate: detected, streak };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Two decisions in this layer deserve attention. The first is that text cleanup comes before the detector, not after: filtering tracking codes and links in preprocessing removes most false positives at zero model cost. The second is that the switch candidate is kept in the state. Without that field, "two consecutive messages" would become a history lookup on every turn, and the rule would stop being cheap precisely on the hot path.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth acknowledging the honest limit of this approach: a customer who mixes two languages in the same sentence, common in border regions and bilingual communities, is not solved by per-message classification. For that case the practical answer is not a fancier detector, it is recording the ambiguity in the state and answering in the language the customer used to phrase the question itself, treating the rest as context.',
        },
      ],
    },
    {
      title: 'Retrieval: the knowledge base is the real bottleneck',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The expensive part of multilingual support is not the answer, it is the knowledge backing the answer. The model writes in Spanish effortlessly, but if the base is in Portuguese and retrieval runs on the customer Spanish text, keyword search finds practically nothing and vector search finds less than it should. The symptom is characteristic and misleading: the bot answers in impeccable Spanish, with the wrong content, and the language evaluation scores high while the correctness evaluation collapses.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'What it requires', 'When it pays off'],
          rows: [
            [
              'Translate the question into the base language',
              'One short translation call before retrieval',
              'Large single-language base and moderate volume per language',
            ],
            [
              'Multilingual embeddings in the same index',
              'An embedding model trained across languages',
              'Semantically equivalent content and vector-dominant search',
            ],
            [
              'Separate index per language',
              'Content actually written in each language and curated',
              'Rules that change per country, not just the wording',
            ],
            [
              'Translate the retrieved passage before generating',
              'One translation per passage, on the hot path',
              'Few passages per answer and a base that changes often',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The choice among them is almost never technical. If the content is the same across markets and only the wording changes, multilingual embeddings or query translation solve it with little operational effort. If the rules change per country, and in support they change a lot, return windows, taxes, refund policy, available support channels, then a separate index stops being a preference and becomes an obligation: translating the Brazilian policy into Spanish produces a fluent and factually wrong answer for the customer in Mexico, which is the worst possible outcome because it looks right.',
        },
        {
          type: 'diagram',
          value: `Customer message
        |
        v
[text cleanup] --> empty/short? --> keeps language from state
        |
        v
[detector with abstention] --> null --> keeps language from state
        |
        v
[switching policy] --> conversation language (persisted state)
        |
        +--> [retrieval] --> per-language index OR translated query
        |                       |
        |                       v
        |                 passages + source language of each passage
        |
        +--> [generation] --> answers in the conversation language
        |
        +--> [channel] --> template approved in this language?
        |                     no --> uses the declared fallback language
        |
        +--> [handoff] --> queue with an agent for the language
                              none available --> explicit waiting policy`,
        },
      ],
    },
    {
      title: 'Generation: instructing the language without letting the prompt choose',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the language resolved in the state, generation becomes almost trivial, provided the prompt is explicit about the asymmetry sitting there. The model receives a mandatory output language and context passages that may be in another language. Without a clear instruction, two errors show up often: the model mirrors the language of the retrieved context instead of the requested language, and the model translates proper nouns, product codes and order statuses that must stay exactly as they are in the system.',
        },
        {
          type: 'code',
          value: `// Prompt assembly with an explicit language and context possibly in
// another language. The instruction separates output language from source language.

const buildPrompt = ({ conversationLanguage, passages, question, literalNames }) => {
  const context = passages
    .map((p, i) => \`[\${i + 1}] (source language: \${p.language})\\n\${p.text}\`)
    .join('\\n\\n');

  const system = [
    \`ALWAYS answer in \${conversationLanguage}, regardless of the language of the context passages.\`,
    'The passages may be in another language. Use their content, translate the meaning, never copy the original text.',
    \`Do not translate or rewrite these literal values: \${literalNames.join(', ')}.\`,
    'If the passages do not contain the information, say so in the answer language instead of inferring.',
  ].join('\\n');

  return {
    system,
    user: \`Context:\\n\${context}\\n\\nCustomer question:\\n\${question}\`,
  };
};

// Post-generation check: does the answer language match the request?
// Failing here is rare, but it is cheap to check and avoids shipping wrong.
export const answerWithGuaranteedLanguage = async ({ state, passages, question, callModel, detector }) => {
  const literalNames = passages.flatMap((p) => p.identifiers ?? []);
  const prompt = buildPrompt({
    conversationLanguage: state.language,
    passages,
    question,
    literalNames,
  });

  const answer = await callModel(prompt);
  const outputLanguage = detectLanguage(answer, detector);

  // Only reprocess when the detector is certain the language is wrong.
  // If the detector abstained, accept the answer: reprocessing on doubt
  // doubles cost and latency with no evidence of an error.
  if (outputLanguage && outputLanguage !== state.language) {
    return callModel({
      ...prompt,
      system: \`\${prompt.system}\\nThe previous answer came out in the wrong language. Answer strictly in \${state.language}.\`,
    });
  }

  return answer;
};`,
        },
        {
          type: 'paragraph',
          value:
            'The post-generation check is cheap because the bot answer is usually long enough for the detector to be confident, which is precisely the case where it works well. Note that reprocessing only happens when the detector asserts a different language, never when it abstains: treating abstention as an error would double the cost of a meaningful share of answers with no evidence that anything went wrong.',
        },
      ],
    },
    {
      title: 'Channel and handoff: where multilingual stops being a model problem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Outside the model sit the two constraints that most often sink multilingual projects in production, and neither is solved with a prompt. The first is the template. On channels like the WhatsApp Cloud API, a business-initiated message outside the service window requires an approved template, and approval is per language. A template approved in Portuguese simply does not exist in Spanish until someone submits it and approval comes through. That means the template-per-language matrix is an operations item with its own lead time, and the code has to check availability before attempting to send, with a fallback language declared per template instead of letting the send fail.',
        },
        {
          type: 'ordered',
          items: [
            'Before sending, check template availability in the conversation language, do not assume it exists.',
            'If it does not exist, use the fallback language declared for that template and record the substitution in the send event.',
            'If not even the fallback exists, do not send the template: convert it into a message inside the service window or postpone it.',
            'Monitor the substitution rate per language, because it is the leading indicator that an entire market is being served in the wrong language.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The second constraint is the handoff. Escalating to a human in multilingual support requires the queue to know the language and requires someone able to serve it right now, which is rarely true across every shift of the day. The common mistake is treating this as a routing detail and finding out at 3am that the Spanish conversation sat waiting for an agent who only clocks in at nine. The decision must be explicit and written before it happens: either the conversation waits with an honest notice of the expected time, or it is served in a common language with the customer consent, or it enters an asynchronous callback flow. Any of the three is acceptable, and none of them is acceptable when the customer discovers it mid-wait.',
        },
        {
          type: 'table',
          columns: ['Handoff situation', 'Bad policy', 'Defensible policy'],
          rows: [
            [
              'No agent for the language on the current shift',
              'Queue it and leave the customer waiting with no notice',
              'State the real wait and offer an async callback or another language',
            ],
            [
              'There is an agent, but the queue is long',
              'Promise immediate service so as not to lose the customer',
              'Show the position and keep the bot solving what it can solve',
            ],
            [
              'Customer accepts being served in another language',
              'Switch silently and record nothing',
              'Record the consent in the state and mark the conversation as language-converted',
            ],
            [
              'Conversation history is in a language the agent does not read',
              'Hand over the raw history and hope they manage',
              'Attach a translated summary, preserving the original for audit',
            ],
          ],
        },
      ],
    },
    {
      title: 'Measure per language, because the average hides the market that is broken',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A multilingual bot with ninety percent of the volume in one language and ten percent spread across the others has a structural measurement problem: any aggregate metric is, in practice, the metric of the dominant language. The smaller market can be running far below on resolution and the general dashboard will not move enough for anyone to notice. When the drop is discovered it usually arrives as a commercial complaint months later, and by then the data needed to diagnose the root cause has already rotated out.',
        },
        {
          type: 'list',
          items: [
            'Segment every outcome metric by conversation language: resolution without a human, handoffs, customer returning about the same issue and cost per conversation.',
            'Track the language-switch rate per conversation: a rising value signals an unstable detector, not an indecisive customer.',
            'Measure retrieval coverage per language, counting answers generated with no passage retrieved above the minimum acceptable score.',
            'Monitor the template substitution rate per language, which reveals the market being notified in the wrong language before any complaint.',
            'Keep an evaluation set per language with cases written by native speakers, not translated from the dominant-language set, because translation preserves the structure of the original question and drops exactly the ways of asking that only exist in that language.',
            'Alert per language with its own threshold and minimum volume, so the small market produces signal without flooding the alert channel with statistical noise.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The most frequently ignored item on that list is the last one about the evaluation set. Translating the test cases is the cheap path and produces an evaluation that approves the system while it fails in production, because translated cases inherit the structure of the original question. The customer in Mexico does not ask the same thing translated, they ask something else, with different vocabulary, about different rules. A set of thirty real cases written by a native speaker says more about quality in that market than three hundred translated ones.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why not detect the language on every message and answer in the detected language?',
      answer:
        'Because a good share of support messages carry no language signal at all. Short confirmations, order numbers, tracking codes, links and emojis make any statistical detector return a weak guess, and since most detectors always return some language, that guess becomes an undue switch in the middle of the conversation. The customer reads that as a serious failure even when the content is correct. The modeling that survives production keeps the language as a conversation state field, with associated confidence, and treats per-message detection as evidence only: a message without enough useful text is still served but does not move the state, and the switch happens only on an explicit customer request or on two consecutive messages with enough text in the same new language.',
    },
    {
      question: 'Does the knowledge base have to be translated for every language served?',
      answer:
        'It depends on whether the content changes or only the wording changes. If the information is the same across markets, you can avoid translating the base by using multilingual embeddings in the same index or translating the customer question into the base language before retrieval, which costs one short call per query. If the rules change per country, and in support they change a lot, return windows, taxes, refund policy and available channels, then a separate index per language stops being a preference and becomes a necessity: a translation of the Brazilian policy produces a fluent and factually wrong answer for the customer in Mexico, which is the worst possible outcome because it looks correct and triggers no verification. The sign that you are in the wrong case is an answer that comes out impeccable in language and wrong in content.',
    },
    {
      question: 'What do you do when the customer needs a human and no agent speaks their language?',
      answer:
        'Decide beforehand, not at the moment the conversation is already waiting. The three defensible options are stating the real wait until an agent for that language comes on shift, offering service in a common language with explicit consent recorded in the conversation state, or converting to an asynchronous flow with a scheduled callback. All are acceptable to the customer when declared upfront; none is acceptable when they figure it out alone after twenty minutes in the queue. Whichever you choose, the history handed to the agent should come with a summary in the language they read, preserving the original for audit, otherwise the handoff merely transfers the language problem from the bot to the person.',
    },
  ],
  conclusion: {
    title: 'Multilingual is a state decision, not a prompt instruction',
    description:
      'The model already speaks your market languages, and that is exactly why the problem goes unnoticed until production. What breaks is retrieval searching in one language and answering in another, the template that is not approved in that language, the detector flipping the conversation language over an "ok", and the human queue with nobody on shift at 3am. Treating language as a conversation state field, with an explicit switching policy, language-aware retrieval, a monitored template matrix and a written handoff policy, is what separates the convincing demo from support that works in the third market.',
    cta: 'Want to serve more than one language without quality collapsing in the smaller market? I can design that language layer in your support flow, from detection with abstention to segmented measurement, so the expansion is not discovered by the customer.',
  },
  related: [
    {
      label: 'A context window shared across channels: WhatsApp, web and phone',
      to: '/blog/janela-contexto-compartilhada-entre-canais-whatsapp-web-telefone',
    },
    {
      label: 'Template governance in large teams',
      to: '/blog/governanca-templates-times-grandes',
    },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
};

const es = {
  intro:
    'Un bot que atiende en tres idiomas parece un problema de traducción, y ahí es donde el proyecto arranca mal. El modelo ya responde en cualquier idioma sin que se lo pidas, así que el código da la impresión de estar listo en la primera prueba: escribes en español, responde en español, y la demo convence a todos. Lo que se rompe después no es la fluidez del modelo, es todo lo que está alrededor. La base de conocimiento está escrita en un idioma y el retrieval devuelve fragmentos que el cliente no lee. La plantilla de WhatsApp fue aprobada en un solo idioma y no se puede enviar en el otro. El cliente manda un mensaje de dos palabras y el detector cambia el idioma de toda la conversación por eso. Y cuando la atención escala a un humano, nadie sabe si hay alguien en la fila que hable ese idioma ahora. Este artículo trata el multiidioma como lo que realmente es: una decisión de estado de la conversación que atraviesa detección, recuperación, generación, canal y traspaso, y no una instrucción al final del prompt.',
  sections: [
    {
      title: 'El idioma no es un atributo del mensaje, es estado de la conversación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La implementación ingenua detecta el idioma de cada mensaje que llega y responde en ese idioma. Funciona en los textos largos y falla justo donde ocurre la atención. Un cliente que conversa en español responde "ok" a una pregunta, y "ok" no es español para ningún detector estadístico. Otro escribe "no" para negar algo, y "no" es una palabra inglesa perfectamente válida. Un tercero pega el código de seguimiento del pedido, solo, y ahí no hay idioma alguno. En todos esos casos un detector por mensaje devuelve algo distinto del idioma real de la conversación y el bot cambia de idioma a mitad, lo que el cliente lee como una falla grave aunque el contenido sea correcto.',
        },
        {
          type: 'paragraph',
          value:
            'El modelado correcto separa dos conceptos que la implementación ingenua confunde. El idioma de la conversación es un campo del estado, con un valor y un nivel de confianza, y gobierna en qué idioma responde el bot. El idioma detectado en el mensaje es apenas una evidencia más que puede o no actualizar ese campo. El mensaje corto se sigue procesando con normalidad, solo que no tiene peso suficiente para mover la palanca. El efecto práctico es que la conversación queda estable: el bot elige el idioma una vez, con evidencia suficiente, y solo cambia cuando hay evidencia clara de que el cliente cambió a propósito.',
        },
        {
          type: 'table',
          columns: ['Señal', 'Qué dice de verdad', 'Peso en la decisión'],
          rows: [
            [
              'Idioma declarado en el perfil o la cuenta',
              'Preferencia explícita del cliente, estable en el tiempo',
              'Alto, y le gana al detector mientras no haya contradicción clara',
            ],
            [
              'Detector estadístico en el mensaje largo',
              'Buena estimación cuando hay decenas de caracteres de texto corrido',
              'Alto por encima de un mínimo de caracteres y de confianza',
            ],
            [
              'Detector en el mensaje corto o sin palabras',
              'Ruido: confirmaciones, números, códigos y emojis no tienen idioma',
              'Ninguno, el mensaje se atiende pero no mueve el estado',
            ],
            [
              'Idioma del primer mensaje de la atención',
              'Punto de partida razonable cuando no hay perfil',
              'Medio, sirve de valor inicial con confianza baja',
            ],
            [
              'Pedido explícito de cambiar de idioma',
              'Intención declarada, más fuerte que cualquier estadística',
              'Máximo, cambio inmediato y registrado en la conversación',
            ],
            [
              'Idioma de la plantilla o del canal de entrada',
              'Dice por dónde llegó el cliente, no qué habla',
              'Bajo, solo desempate cuando todo lo demás está vacío',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La regla de cambio tiene que ser explícita en el código, y no emerger de un umbral suelto en el detector. Una formulación que funciona bien en atención: cambia el idioma de la conversación cuando el cliente lo pida con palabras, o cuando dos mensajes consecutivos con texto suficiente se detecten en el mismo idioma nuevo con confianza por encima del umbral. Un único mensaje largo en otro idioma no alcanza, porque su causa más común no es un cambio de idioma, es el cliente pegando un texto de un tercero, un correo recibido o un mensaje de error del sistema.',
        },
      ],
    },
    {
      title: 'Detección con abstención: el detector debe poder decir que no sabe',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La mayoría de los detectores siempre devuelve un idioma, incluso cuando la entrada no tiene información suficiente para sostener conjetura alguna. Ese comportamiento es razonable en clasificación de documentos y pésimo en atención, donde la mitad de los mensajes es corta. El detector útil acá es el que tiene una tercera salida además de "portugués" y "español": "indeterminado". Poner la abstención antes del clasificador es más barato y más confiable que intentar calibrar umbrales después, porque buena parte de los mensajes que causan cambios indebidos ni siquiera llega a ser texto: son números, códigos, enlaces y emojis.',
        },
        {
          type: 'code',
          value: `// Capa de decisión de idioma: convierte evidencia en estado.
// El detector concreto se inyecta; lo que importa acá es la política.

const IDIOMAS_SOPORTADOS = new Set(['pt', 'es', 'en']);
const MIN_CARACTERES_UTILES = 12;
const MIN_CONFIANZA = 0.75;
const MENSAJES_PARA_CAMBIAR = 2;

// Quita lo que no lleva señal de idioma: URLs, códigos, números,
// emojis y puntuación. Queda el texto que sí se puede clasificar.
const textoUtil = (mensaje) =>
  mensaje
    .replace(/https?:\\/\\/\\S+/g, ' ')
    .replace(/[A-Z0-9]{6,}/g, ' ')
    .replace(/[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]/gu, ' ')
    .replace(/[^\\p{L}\\s]/gu, ' ')
    .replace(/\\s+/g, ' ')
    .trim();

// Devuelve el idioma O null. Null acá significa "no sé", y es una
// respuesta legítima que impide que la conversación cambie por ruido.
export const detectarIdioma = (mensaje, detector) => {
  const texto = textoUtil(mensaje);
  if (texto.length < MIN_CARACTERES_UTILES) return null;

  const { idioma, confianza } = detector(texto);
  if (!IDIOMAS_SOPORTADOS.has(idioma)) return null;
  if (confianza < MIN_CONFIANZA) return null;

  return idioma;
};

// Aplica la evidencia al estado. Solo cambia con pedido explícito o con
// evidencia repetida; si no, devuelve el estado sin alterar.
export const aplicarEvidencia = (estado, mensaje, detector, pedidoExplicito) => {
  if (pedidoExplicito && IDIOMAS_SOPORTADOS.has(pedidoExplicito)) {
    return { idioma: pedidoExplicito, confirmado: true, candidato: null, racha: 0 };
  }

  const detectado = detectarIdioma(mensaje, detector);
  if (!detectado) return estado;

  if (!estado.idioma) {
    return { idioma: detectado, confirmado: false, candidato: null, racha: 0 };
  }

  if (detectado === estado.idioma) {
    return { ...estado, confirmado: true, candidato: null, racha: 0 };
  }

  const racha = estado.candidato === detectado ? estado.racha + 1 : 1;
  if (racha >= MENSAJES_PARA_CAMBIAR) {
    return { idioma: detectado, confirmado: true, candidato: null, racha: 0 };
  }

  return { ...estado, candidato: detectado, racha };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Dos decisiones de esa capa merecen atención. La primera es que la limpieza del texto va antes del detector, no después: filtrar código de seguimiento y enlaces en el preprocesamiento elimina la mayor parte de los falsos positivos sin costo alguno de modelo. La segunda es que el candidato al cambio queda guardado en el estado. Sin ese campo, "dos mensajes consecutivos" se volvería una consulta al historial en cada turno, y la regla dejaría de ser barata justamente en el camino caliente.',
        },
        {
          type: 'paragraph',
          value:
            'Vale reconocer el límite honesto de este enfoque: el cliente que mezcla dos idiomas en la misma frase, algo común en zonas de frontera y en comunidades bilingües, no se resuelve con clasificación por mensaje. Para ese caso la salida práctica no es sofisticar el detector, es registrar la ambigüedad en el estado y responder en el idioma que el cliente usó para formular la pregunta en sí, dejando el resto como contexto.',
        },
      ],
    },
    {
      title: 'Recuperación: la base de conocimiento es el cuello de botella real',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La parte cara del multiidioma no es la respuesta, es el conocimiento que la sostiene. El modelo escribe en español sin esfuerzo, pero si la base está en portugués y el retrieval se hace con el texto en español del cliente, la búsqueda por términos prácticamente no encuentra nada y la búsqueda vectorial encuentra menos de lo que debería. El síntoma es característico y engañoso: el bot responde en un español impecable, con el contenido equivocado, y la evaluación por idioma da nota alta mientras la evaluación por corrección se desploma.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Qué exige', 'Cuándo compensa'],
          rows: [
            [
              'Traducir la pregunta al idioma de la base',
              'Una llamada de traducción corta antes del retrieval',
              'Base grande en un solo idioma y volumen moderado por idioma',
            ],
            [
              'Embeddings multilingües en el mismo índice',
              'Modelo de embedding entrenado entre idiomas',
              'Contenido semánticamente equivalente y búsqueda vectorial dominante',
            ],
            [
              'Índice separado por idioma',
              'Contenido realmente escrito en cada idioma y curado',
              'Reglas que cambian por país, no solo la redacción',
            ],
            [
              'Traducir el fragmento recuperado antes de generar',
              'Una traducción por fragmento, en el camino caliente',
              'Pocos fragmentos por respuesta y base que cambia seguido',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La elección entre ellas casi nunca es técnica. Si el contenido es el mismo en todos los mercados y solo cambia la redacción, embedding multilingüe o traducción de la consulta lo resuelven con poco esfuerzo operativo. Si las reglas cambian por país, y en atención cambian mucho, plazo de cambio, impuesto, política de reembolso, canal de soporte disponible, entonces el índice separado deja de ser preferencia y pasa a ser obligación: traducir la política brasileña al español produce una respuesta fluida y factualmente equivocada para el cliente de México, que es el peor desenlace posible porque parece correcto.',
        },
        {
          type: 'diagram',
          value: `Mensaje del cliente
        |
        v
[limpieza del texto] --> vacío/corto? --> mantiene idioma del estado
        |
        v
[detector con abstención] --> null --> mantiene idioma del estado
        |
        v
[política de cambio] --> idioma de la conversación (estado persistido)
        |
        +--> [retrieval] --> índice del idioma O consulta traducida
        |                       |
        |                       v
        |                 fragmentos + idioma de origen del fragmento
        |
        +--> [generación] --> responde en el idioma de la conversación
        |
        +--> [canal] --> plantilla aprobada en ese idioma?
        |                   no --> usa el idioma de respaldo declarado
        |
        +--> [traspaso] --> fila con agente del idioma
                               no hay --> política explícita de espera`,
        },
      ],
    },
    {
      title: 'Generación: instruir el idioma sin dejar que el prompt elija solo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con el idioma resuelto en el estado, la generación queda casi trivial, siempre que el prompt sea explícito sobre la asimetría que hay ahí. El modelo recibe un idioma de respuesta obligatorio y fragmentos de contexto que pueden estar en otro idioma. Sin instrucción clara aparecen dos errores con frecuencia: el modelo refleja el idioma del contexto recuperado en vez del idioma pedido, y el modelo traduce nombres propios, códigos de producto y estados de pedido que deben quedar exactamente como están en el sistema.',
        },
        {
          type: 'code',
          value: `// Armado del prompt con idioma explícito y contexto posiblemente en
// otro idioma. La instrucción separa idioma de salida de idioma de fuente.

const armarPrompt = ({ idiomaConversacion, fragmentos, pregunta, nombresLiterales }) => {
  const contexto = fragmentos
    .map((f, i) => \`[\${i + 1}] (idioma de la fuente: \${f.idioma})\\n\${f.texto}\`)
    .join('\\n\\n');

  const system = [
    \`Responde SIEMPRE en \${idiomaConversacion}, sin importar el idioma de los fragmentos de contexto.\`,
    'Los fragmentos pueden estar en otro idioma. Usa su contenido, traduce el sentido, nunca copies el texto original.',
    \`No traduzcas ni reescribas estos valores literales: \${nombresLiterales.join(', ')}.\`,
    'Si los fragmentos no contienen la información, dilo en el idioma de la respuesta en vez de inferir.',
  ].join('\\n');

  return {
    system,
    user: \`Contexto:\\n\${contexto}\\n\\nPregunta del cliente:\\n\${pregunta}\`,
  };
};

// Verificación posterior: el idioma de la respuesta coincide con el pedido?
// Fallar acá es raro, pero es barato de comprobar y evita entregar mal.
export const responderConIdiomaGarantizado = async ({ estado, fragmentos, pregunta, llamarModelo, detector }) => {
  const nombresLiterales = fragmentos.flatMap((f) => f.identificadores ?? []);
  const prompt = armarPrompt({
    idiomaConversacion: estado.idioma,
    fragmentos,
    pregunta,
    nombresLiterales,
  });

  const respuesta = await llamarModelo(prompt);
  const idiomaSalida = detectarIdioma(respuesta, detector);

  // Solo reprocesa cuando el detector afirma que el idioma está mal.
  // Si el detector se abstuvo, acepta la respuesta: reprocesar por duda
  // duplica costo y latencia sin evidencia de error.
  if (idiomaSalida && idiomaSalida !== estado.idioma) {
    return llamarModelo({
      ...prompt,
      system: \`\${prompt.system}\\nLa respuesta anterior salió en el idioma equivocado. Responde obligatoriamente en \${estado.idioma}.\`,
    });
  }

  return respuesta;
};`,
        },
        {
          type: 'paragraph',
          value:
            'La verificación posterior a la generación es barata porque la respuesta del bot suele ser lo bastante larga para que el detector tenga confianza, que es justamente el caso en el que funciona bien. Nota que el reprocesamiento solo ocurre cuando el detector afirma un idioma distinto, nunca cuando se abstiene: tratar la abstención como error duplicaría el costo de una fracción relevante de las respuestas sin ninguna evidencia de que algo salió mal.',
        },
      ],
    },
    {
      title: 'Canal y traspaso: donde el multiidioma deja de ser problema de modelo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Fuera del modelo están las dos restricciones que más tumban proyectos multiidioma en producción, y ninguna se resuelve con prompt. La primera es la plantilla. En canales como la WhatsApp Cloud API, el mensaje iniciado por la empresa fuera de la ventana de atención necesita una plantilla aprobada, y la aprobación es por idioma. Una plantilla aprobada en portugués simplemente no existe en español hasta que alguien la envíe y salga la aprobación. Eso significa que la matriz de plantillas por idioma es un ítem de operación con plazo propio, y que el código debe consultar la disponibilidad antes de intentar enviar, con un idioma de respaldo declarado por plantilla en vez de dejar que el envío falle.',
        },
        {
          type: 'ordered',
          items: [
            'Antes de enviar, consulta la disponibilidad de la plantilla en el idioma de la conversación, no presumas que existe.',
            'Si no existe, usa el idioma de respaldo declarado en esa plantilla y registra la sustitución en el evento de envío.',
            'Si ni el respaldo existe, no envíes la plantilla: conviértela en un mensaje dentro de la ventana de atención o posponla.',
            'Monitorea la tasa de sustitución por idioma, porque es el indicador anticipado de que un mercado entero está siendo atendido en el idioma equivocado.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La segunda restricción es el traspaso. Escalar a un humano en atención multiidioma exige que la fila conozca el idioma y que haya alguien capaz de atenderlo ahora, lo que rara vez es cierto en todos los turnos del día. El error común es tratar esto como detalle de enrutamiento y descubrir de madrugada que la conversación en español quedó parada esperando a un agente que recién entra a las nueve. La decisión tiene que ser explícita y escrita antes de que ocurra: o la conversación espera con un aviso honesto del plazo, o se atiende en un idioma común con el consentimiento del cliente, o entra en un flujo asíncrono de devolución de llamada. Cualquiera de las tres es aceptable, y ninguna lo es cuando el cliente la descubre en plena espera.',
        },
        {
          type: 'table',
          columns: ['Situación en el traspaso', 'Política mala', 'Política defendible'],
          rows: [
            [
              'No hay agente del idioma en el turno actual',
              'Encolar y dejar al cliente esperando sin aviso',
              'Informar el plazo real y ofrecer devolución asíncrona u otro idioma',
            ],
            [
              'Hay agente, pero la fila está larga',
              'Prometer atención inmediata para no perder al cliente',
              'Mostrar la posición y mantener al bot resolviendo lo que se pueda',
            ],
            [
              'El cliente acepta ser atendido en otro idioma',
              'Cambiar en silencio y no registrar nada',
              'Registrar el consentimiento en el estado y marcar la conversación como idioma convertido',
            ],
            [
              'El historial está en un idioma que el agente no lee',
              'Entregar el historial crudo y esperar que se arregle',
              'Adjuntar un resumen traducido, preservando el original para auditoría',
            ],
          ],
        },
      ],
    },
    {
      title: 'Medir por idioma, porque el promedio esconde el mercado que está roto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un bot multiidioma con noventa por ciento del volumen en un idioma y diez por ciento repartido en los demás tiene un problema estructural de medición: cualquier métrica agregada es, en la práctica, la métrica del idioma dominante. El mercado menor puede estar con una resolución muy por debajo y el panel general no se mueve lo suficiente para que alguien lo note. Cuando la caída se descubre, suele llegar como reclamo comercial meses después, y a esa altura el dato para diagnosticar la causa raíz ya rotó.',
        },
        {
          type: 'list',
          items: [
            'Segmenta todas las métricas de desenlace por idioma de la conversación: resolución sin humano, traspasos, retorno del cliente por el mismo asunto y costo por conversación.',
            'Sigue la tasa de cambios de idioma por conversación: un valor que sube indica detector inestable, no cliente indeciso.',
            'Mide la cobertura del retrieval por idioma, contando las respuestas generadas sin ningún fragmento recuperado con puntaje mínimo aceptable.',
            'Monitorea la tasa de sustitución de plantilla por idioma, que revela el mercado notificado en el idioma equivocado antes de cualquier reclamo.',
            'Mantén un conjunto de evaluación por idioma con casos escritos por hablantes nativos, y no traducidos del conjunto del idioma dominante, porque la traducción preserva la estructura de la pregunta original y elimina justamente las formas de preguntar que solo existen en ese idioma.',
            'Alerta por idioma con umbral propio y volumen mínimo, para que el mercado pequeño genere señal sin inundar el canal de alertas con ruido estadístico.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El punto más ignorado de esa lista es el último, sobre el conjunto de evaluación. Traducir los casos de prueba es el camino barato y produce una evaluación que aprueba el sistema mientras falla en producción, porque los casos traducidos heredan la estructura de la pregunta original. El cliente mexicano no pregunta lo mismo traducido, pregunta otra cosa, con otro vocabulario, sobre otras reglas. Un conjunto de treinta casos reales escritos por un hablante nativo dice más sobre la calidad en ese mercado que trescientos casos traducidos.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no detectar el idioma en cada mensaje y responder en el idioma detectado?',
      answer:
        'Porque buena parte de los mensajes de una atención no lleva señal de idioma alguna. Confirmaciones cortas, números de pedido, códigos de seguimiento, enlaces y emojis hacen que cualquier detector estadístico devuelva una conjetura débil, y como la mayoría de los detectores siempre devuelve algún idioma, esa conjetura se vuelve un cambio indebido a mitad de la conversación. El cliente lo lee como falla grave aunque el contenido sea correcto. El modelado que aguanta producción guarda el idioma como campo del estado de la conversación, con confianza asociada, y trata la detección de cada mensaje solo como evidencia: un mensaje sin texto útil suficiente se atiende con normalidad pero no mueve el estado, y el cambio solo ocurre con pedido explícito del cliente o con dos mensajes consecutivos de texto suficiente en el mismo idioma nuevo.',
    },
    {
      question: '¿La base de conocimiento tiene que traducirse para cada idioma atendido?',
      answer:
        'Depende de si cambia el contenido o solo cambia la redacción. Si la información es la misma en todos los mercados, evitas traducir la base usando embeddings multilingües en el mismo índice o traduciendo la pregunta del cliente al idioma de la base antes del retrieval, lo que cuesta una llamada corta por consulta. Si las reglas cambian por país, y en atención cambian bastante, plazo de cambio, impuesto, política de reembolso y canales disponibles, entonces el índice separado por idioma deja de ser preferencia y pasa a ser necesidad: una traducción de la política brasileña produce una respuesta fluida y factualmente equivocada para el cliente de México, que es el peor desenlace posible porque parece correcto y no dispara ninguna verificación. La señal de que estás en el caso equivocado es que la respuesta sale impecable en el idioma y equivocada en el contenido.',
    },
    {
      question: '¿Qué hacer cuando el cliente necesita un humano y no hay agente de su idioma?',
      answer:
        'Decidirlo antes, y no en el momento en que la conversación ya está esperando. Las tres salidas defendibles son informar el plazo real de espera hasta que entre un agente de ese idioma, ofrecer atención en un idioma común con consentimiento explícito registrado en el estado de la conversación, o convertir a un flujo asíncrono con devolución agendada. Todas son aceptables para el cliente cuando se declaran al momento; ninguna lo es cuando él lo descubre solo, después de veinte minutos en la fila. Sea cual sea la elección, el historial entregado al agente debe venir con un resumen en el idioma que él lee, preservando el original para auditoría, si no el traspaso apenas transfiere el problema de idioma del bot a la persona.',
    },
  ],
  conclusion: {
    title: 'El multiidioma es decisión de estado, no instrucción en el prompt',
    description:
      'El modelo ya habla los idiomas de tu mercado, y por eso el problema pasa desapercibido hasta llegar a producción. Lo que se rompe es el retrieval buscando en un idioma y respondiendo en otro, la plantilla que no está aprobada en ese idioma, el detector cambiando el idioma de la conversación por un "ok", y la fila de humanos que no tiene a nadie a las tres de la mañana. Tratar el idioma como campo del estado de la conversación, con política explícita de cambio, retrieval consciente del idioma, matriz de plantillas monitoreada y traspaso con política escrita, es lo que separa la demo convincente de la atención que funciona en el tercer mercado.',
    cta: '¿Quieres atender en más de un idioma sin que la calidad caiga en el mercado menor? Puedo diseñar esa capa de idioma en tu flujo de atención, desde la detección con abstención hasta la medición segmentada, para que la expansión no la descubra el cliente.',
  },
  related: [
    {
      label: 'Ventana de contexto compartida entre canales: WhatsApp, web y teléfono',
      to: '/blog/janela-contexto-compartilhada-entre-canais-whatsapp-web-telefone',
    },
    {
      label: 'Gobernanza de plantillas en equipos grandes',
      to: '/blog/governanca-templates-times-grandes',
    },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

export default { pt, en, es };
