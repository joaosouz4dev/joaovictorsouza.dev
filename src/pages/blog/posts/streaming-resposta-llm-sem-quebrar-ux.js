// Conteudo do artigo: streaming de resposta de LLM sem quebrar a UX.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Servidor e cliente mínimos de streaming de LLM sobre Server-Sent Events: o backend repassa os tokens do modelo em tempo real com heartbeat e cancelamento, e o cliente monta a resposta de forma incremental, trata reconexão e desiste da chamada quando o usuário sai, para mostrar a resposta enquanto ela é gerada sem travar a interface.',
  en: 'Minimal LLM streaming server and client over Server-Sent Events: the backend relays the model tokens in real time with heartbeat and cancellation, and the client assembles the answer incrementally, handles reconnection and drops the call when the user leaves, to show the answer as it is generated without freezing the interface.',
  es: 'Servidor y cliente mínimos de streaming de LLM sobre Server-Sent Events: el backend repasa los tokens del modelo en tiempo real con heartbeat y cancelación, y el cliente arma la respuesta de forma incremental, maneja reconexión y abandona la llamada cuando el usuario se va, para mostrar la respuesta mientras se genera sin trabar la interfaz.',
};

const repoUrl = 'https://github.com/joaosouz4dev/llm-stream-ux';

const pt = {
  intro:
    'Uma resposta de LLM que demora oito segundos para aparecer inteira parece um sistema travado; a mesma resposta, começando a surgir em trezentos milissegundos e escorrendo token a token, parece rápida mesmo levando os mesmos oito segundos até o fim. A diferença não está no modelo, está na entrega. Streaming é a técnica de mostrar a resposta enquanto ela é gerada, em vez de esperar o texto completo, e é o que separa uma interface de IA que parece viva de uma que parece congelada. Mas streaming feito de forma ingênua troca um problema por outro: a tela pisca a cada token, o scroll salta, o botão de parar não para nada, e quando a conexão cai no meio o usuário fica com meia resposta e nenhuma forma de continuar. O buffer errado engole a fluidez; o cancelamento ausente vaza custo depois que o usuário já foi embora; a reconexão mal feita duplica texto. Este artigo mostra como transmitir uma resposta de LLM do modelo até a tela sem quebrar a experiência: o protocolo de transporte, o servidor que repassa tokens com heartbeat e cancelamento, o cliente que monta o texto de forma incremental e as regras de UX que fazem o streaming parecer suave em vez de nervoso.',
  sections: [
    {
      title: 'Por que streaming muda a percepção de velocidade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O tempo que importa numa interface de IA não é quanto a resposta leva para terminar, é quanto leva para começar. Um modelo que gera a resposta completa em oito segundos e a devolve de uma vez faz o usuário encarar uma tela parada por oito segundos, sem sinal de que algo está acontecendo; a intuição dele é que o sistema travou. O mesmo modelo, transmitindo os tokens conforme os gera, entrega a primeira palavra em algumas centenas de milissegundos e mantém o texto escorrendo até o fim. O tempo total é idêntico, mas a percepção é oposta: o segundo parece rápido porque a espera é preenchida com progresso visível.',
        },
        {
          type: 'paragraph',
          value:
            'A métrica que captura essa diferença é o tempo até o primeiro token (TTFT), e ela é o que o streaming otimiza. Enquanto a latência total mede o fim da geração, o TTFT mede o início da resposta visível, e é o TTFT que governa a sensação de responsividade. A tabela abaixo separa as duas experiências para deixar claro o que muda.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Sem streaming (espera o texto todo)', 'Com streaming (token a token)'],
          rows: [
            [
              'Primeiro sinal na tela',
              'Só ao terminar tudo (segundos)',
              'Primeiro token em centenas de ms',
            ],
            [
              'Percepção do usuário',
              'Parece travado, tentado a recarregar',
              'Parece vivo, acompanha a geração',
            ],
            [
              'Abandono na espera',
              'Alto: silêncio longo sem feedback',
              'Baixo: progresso visível segura o usuário',
            ],
            [
              'Cancelar no meio',
              'Impossível: resposta é atômica',
              'Natural: pode parar a qualquer token',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O ganho do streaming não é só estético. Poder cancelar no meio significa parar de pagar tokens de uma resposta que o usuário já viu que não serve; ver o texto surgir dá ao usuário a chance de reformular a pergunta antes do fim; e o feedback contínuo reduz o abandono na espera, que é onde se perde usuário numa interface de IA. Streaming é, ao mesmo tempo, uma otimização de percepção, de custo e de retenção, e o resto do artigo é sobre entregá-lo sem introduzir os defeitos que o tornam pior do que a espera silenciosa.',
        },
      ],
    },
    {
      title: 'O transporte: SSE, WebSocket ou fetch com stream',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes do primeiro token chegar à tela, é preciso escolher como o servidor empurra os pedaços para o cliente. HTTP tradicional é uma requisição e uma resposta fechada, o que não serve para um fluxo aberto que pinga tokens ao longo do tempo. Três transportes resolvem isso, e a escolha certa depende do formato da conversa. Server-Sent Events (SSE) é um canal unidirecional do servidor para o cliente sobre HTTP comum, feito exatamente para o caso de empurrar uma sequência de eventos, e é o mais simples e o mais adequado para streaming de uma resposta de LLM. WebSocket abre um canal bidirecional persistente, e só vale a pena quando o cliente também precisa mandar dados no meio do fluxo (uma conversa de voz ao vivo, por exemplo). O fetch com ReadableStream lê o corpo da resposta em pedaços no próprio navegador, sem protocolo de eventos, e serve quando você controla as duas pontas e quer algo enxuto.',
        },
        {
          type: 'table',
          columns: ['Transporte', 'Direção', 'Quando usar', 'Custo de complexidade'],
          rows: [
            [
              'SSE',
              'Servidor para cliente',
              'Streaming de resposta de LLM, o caso padrão',
              'Baixo: reconexão automática, HTTP comum',
            ],
            [
              'WebSocket',
              'Bidirecional',
              'Cliente também emite durante o fluxo (voz)',
              'Alto: gerenciar estado da conexão',
            ],
            [
              'fetch + ReadableStream',
              'Servidor para cliente',
              'Controle das duas pontas, sem eventos nomeados',
              'Médio: parsing manual do stream',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Para a esmagadora maioria dos casos de streaming de resposta de LLM, SSE é a escolha certa: o fluxo é do servidor para o cliente, o transporte é HTTP comum que passa por qualquer proxy, e o próprio protocolo já traz reconexão automática e um formato de evento simples de emitir. O restante deste artigo usa SSE porque ele resolve o problema real com o mínimo de peças móveis, e reserva WebSocket para quando a bidirecionalidade for de fato necessária, não por reflexo.',
        },
      ],
    },
    {
      title: 'O servidor: repassar tokens com heartbeat e cancelamento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O papel do servidor no streaming é ser um cano fino e confiável: ele abre a chamada ao modelo em modo stream, recebe cada pedaço de texto e o repassa imediatamente ao cliente como um evento SSE, sem bufferizar a resposta inteira. Duas responsabilidades tornam esse cano robusto. A primeira é o heartbeat: se o modelo demora entre tokens, um comentário SSE periódico mantém a conexão viva e evita que proxies a derrubem por inatividade. A segunda, e mais importante para o custo, é o cancelamento: quando o cliente fecha a conexão (fechou a aba, cancelou a pergunta), o servidor precisa abortar a chamada ao modelo, senão continua pagando tokens de uma resposta que ninguém vai ler.',
        },
        {
          type: 'code',
          value: `// server/stream.js
// Repassa os tokens do modelo ao cliente via SSE, com heartbeat
// e cancelamento quando o cliente desconecta. Nao bufferiza a resposta.

export async function streamHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // AbortController liga a desconexao do cliente ao aborto da chamada ao modelo.
  const controller = new AbortController();
  req.on('close', () => controller.abort()); // cliente saiu: para de gerar.

  // Heartbeat: comentario SSE periodico mantem proxies de derrubarem a conexao.
  const heartbeat = setInterval(() => res.write(': keep-alive\\n\\n'), 15000);

  try {
    const stream = await model.stream({ messages: req.body.messages }, {
      signal: controller.signal,
    });

    for await (const chunk of stream) {
      const token = chunk.delta ?? '';
      if (token) res.write(\`data: \${JSON.stringify({ token })}\\n\\n\`);
    }
    res.write('event: done\\ndata: {}\\n\\n'); // sinaliza fim limpo ao cliente.
  } catch (err) {
    if (err.name !== 'AbortError') {
      res.write(\`event: error\\ndata: \${JSON.stringify({ message: 'stream falhou' })}\\n\\n\`);
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que separa esse servidor de uma versão ingênua é o par AbortController e req.on(close). Sem ele, quando o usuário fecha a aba no meio de uma resposta longa, a chamada ao modelo continua rodando até o fim no backend, gastando tokens que ninguém vai ver: o custo vaza silenciosamente e só aparece na fatura. Ligar a desconexão do cliente ao sinal de aborto do modelo transforma o fechar da aba num cancelamento real. O heartbeat resolve o problema oposto: quando o modelo pensa por vários segundos antes do próximo token, a conexão fica em silêncio, e proxies e balanceadores costumam derrubar conexões ociosas; um comentário SSE a cada poucos segundos mantém o cano aberto sem poluir o fluxo de dados.',
        },
      ],
    },
    {
      title: 'O cliente: montar a resposta de forma incremental',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Do lado do cliente, o trabalho é receber os tokens, acumulá-los numa string e atualizar a tela de forma que o texto pareça escorrer, não piscar. O erro mais comum aqui é substituir o conteúdo a cada token (o que causa flicker e re-render caro) em vez de anexar; o segundo erro é atualizar o DOM a cada token individual, quando dezenas chegam por segundo, saturando o render. A solução é acumular o texto num buffer e reconciliar a tela num ritmo controlado, além de tratar os três estados que o stream pode terminar: fim limpo, erro e cancelamento pelo usuário.',
        },
        {
          type: 'code',
          value: `// client/useStream.js
// Consome o SSE, acumula os tokens e expoe o texto crescente.
// Um AbortController local permite ao usuario cancelar a geracao.

export function startStream({ url, body, onToken, onDone, onError }) {
  const controller = new AbortController();
  let text = ''; // acumula: anexa token, nunca substitui a resposta inteira.

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal, // cancelar aqui aborta a chamada e libera o servidor.
  })
    .then(async (res) => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE separa eventos por linha em branco; processa os completos.
        const events = buffer.split('\\n\\n');
        buffer = events.pop() ?? ''; // guarda o fragmento incompleto.

        for (const evt of events) {
          if (evt.startsWith(': ')) continue; // heartbeat: ignora.
          if (evt.includes('event: done')) { onDone(text); return; }
          if (evt.includes('event: error')) { onError(new Error('stream falhou')); return; }
          const line = evt.split('\\n').find((l) => l.startsWith('data: '));
          if (line) {
            const { token } = JSON.parse(line.slice(6));
            text += token; // anexa.
            onToken(text); // entrega o texto crescente para a UI reconciliar.
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err); // aborto do usuario nao e erro.
    });

  return () => controller.abort(); // devolve a funcao de cancelar (botao parar).
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare que o cliente devolve uma função de cancelamento: é ela que o botão de parar chama, e ao abortar o fetch o cliente fecha a conexão, o que dispara o req.on(close) do servidor e aborta a chamada ao modelo. Assim o botão de parar não é decorativo: ele efetivamente interrompe a geração e para de gastar tokens, ponta a ponta. O outro detalhe é o buffer de eventos: SSE separa eventos por uma linha em branco, mas um pedaço lido pela rede pode cortar um evento no meio, então o cliente guarda o fragmento incompleto e só processa eventos completos. Sem esse cuidado, um token chega partido e o JSON.parse quebra.',
        },
      ],
    },
    {
      title: 'As regras de UX: fazer o streaming parecer suave',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ter os tokens chegando não garante uma boa experiência; um streaming tecnicamente correto ainda pode parecer nervoso se a UI reage a cada token de forma crua. Quatro regras transformam um fluxo de tokens numa resposta que parece digitada com fluidez, e todas tratam da tensão entre atualizar rápido e atualizar suave.',
        },
        {
          type: 'ordered',
          items: [
            'Anexe, nunca substitua: renderize o texto acumulado, adicionando os tokens novos ao fim, para que a resposta cresça sem piscar. Substituir o conteúdo inteiro a cada token causa flicker e re-render caro.',
            'Agrupe atualizações no ritmo do frame: dezenas de tokens chegam por segundo, mas a tela só desenha a sessenta quadros; acumule os tokens e reconcilie a UI uma vez por frame (via requestAnimationFrame) em vez de a cada token, para render suave sem custo.',
            'Segure o auto-scroll quando o usuário rolar para cima: rolar a tela para o fim a cada token é útil enquanto o usuário acompanha, mas vira sequestro de scroll se ele subiu para reler algo; detecte a rolagem manual e pause o auto-scroll até ele voltar ao fim.',
            'Mostre estado de parada e de erro com clareza: um cursor pulsando enquanto gera, o botão de parar sempre visível durante o fluxo, e uma mensagem de erro que preserva o texto já recebido em vez de apagá-lo, para o usuário nunca ficar com a tela em branco sem saber o que houve.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A regra que mais melhora a percepção é agrupar as atualizações no ritmo do frame. Um modelo rápido pode emitir dezenas de tokens por segundo, e atualizar o DOM a cada um satura o render e paradoxalmente deixa a interface mais travada do que o streaming deveria ser. Acumular os tokens num buffer e desenhar a tela uma vez por frame entrega toda a fluidez sem o custo, e é a diferença entre um texto que escorre suave e um que treme. O auto-scroll respeitoso é a segunda: sequestrar o scroll do usuário que subiu para reler é uma das frustrações mais citadas em interfaces de chat, e resolvê-la é só detectar a intenção dele e recuar.',
        },
      ],
    },
    {
      title: 'Reconexão, erro e cancelamento: os três finais do stream',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um stream não termina de uma só forma, e a robustez está em tratar os três finais possíveis sem deixar o usuário perdido. O primeiro é o fim limpo: o modelo terminou, o servidor enviou o evento de done, o cliente marca a resposta como completa e esconde o cursor. O segundo é o erro no meio: a rede caiu, o modelo falhou, o servidor mandou um evento de erro; aqui a regra de ouro é preservar o texto já recebido e sinalizar que a resposta ficou incompleta, nunca apagar o que o usuário já leu. O terceiro é o cancelamento pelo usuário: ele clicou em parar, e o esperado é congelar o texto no ponto onde estava, sem tratar isso como erro.',
        },
        {
          type: 'table',
          columns: ['Final do stream', 'O que fazer com o texto', 'O que mostrar'],
          rows: [
            [
              'Fim limpo (done)',
              'Manter completo',
              'Esconder cursor, resposta pronta',
            ],
            [
              'Erro no meio',
              'Preservar o parcial, marcar incompleto',
              'Aviso de falha com opção de repetir',
            ],
            [
              'Cancelado pelo usuário',
              'Congelar no ponto atual',
              'Texto parado, sem alarme de erro',
            ],
            [
              'Conexão caiu (reconectável)',
              'Manter o parcial, tentar retomar',
              'Indicador de reconexão discreto',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferença crítica entre esses finais é como o texto parcial é tratado. Um erro que apaga a resposta pela metade é pior que a espera silenciosa, porque destrói trabalho que o usuário estava lendo; o correto é sempre preservar o parcial e deixar claro que ele ficou incompleto, com opção de repetir. O cancelamento nunca deve virar um alarme de erro: o usuário pediu para parar, então parar é o comportamento certo, e mostrar um aviso de falha ali confunde. E a reconexão, quando o transporte a suporta (SSE reconecta sozinho), deve retomar de forma discreta sem duplicar o texto já recebido, o que exige que o servidor saiba de onde continuar ou que o cliente descarte o que já tem antes de retomar. Tratar os três finais é o que separa um streaming de demonstração de um que aguenta produção.',
        },
      ],
    },
    {
      title: 'Montar o streaming em produção sem quebrar a UX',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Streaming é uma das melhorias de maior impacto na experiência de uma interface de IA, porque ataca diretamente a percepção de velocidade sem tocar no modelo. Mas o ganho só é real se a entrega for suave e os finais forem tratados; um streaming nervoso ou que perde texto é pior que a espera limpa. A ordem de implantação abaixo entrega o valor cedo e blinda os pontos frágeis antes de escalar.',
        },
        {
          type: 'ordered',
          items: [
            'Comece pelo transporte certo: SSE resolve o caso padrão de streaming de resposta de LLM com o mínimo de complexidade; só use WebSocket se o cliente precisar emitir durante o fluxo.',
            'Ligue cancelamento ponta a ponta desde o dia um: o AbortController no cliente e o req.on(close) no servidor garantem que fechar a aba ou clicar em parar de fato aborta a chamada ao modelo, cortando custo vazado.',
            'Acumule e anexe, nunca substitua: renderize o texto crescente adicionando tokens ao fim e reconcilie a UI uma vez por frame, para que a resposta escorra suave em vez de piscar.',
            'Trate os três finais explicitamente: fim limpo esconde o cursor, erro preserva o parcial e oferece repetir, cancelamento congela sem alarme. Nunca apague texto que o usuário já leu.',
            'Adicione heartbeat e monitore o TTFT: o heartbeat mantém a conexão viva em modelos lentos, e o tempo até o primeiro token é a métrica que diz se o streaming está entregando a responsividade que promete.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferença entre um streaming que faz a interface parecer viva e um que a faz parecer nervosa está inteira no cliente: no anexar em vez de substituir, no reconciliar por frame em vez de por token, no auto-scroll que respeita o usuário e no tratamento dos três finais. O servidor é a parte fácil, um cano que repassa tokens com heartbeat e cancelamento. O que faz o streaming valer a pena é a disciplina de UX na ponta, mais o cancelamento ponta a ponta que impede o custo de vazar. Bem montado, o streaming transforma a espera pela resposta de um silêncio ansioso num progresso visível, e essa é a diferença entre uma interface de IA que o usuário confia e uma que ele recarrega achando que travou.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que usar SSE e não WebSocket para streaming de LLM?',
      answer:
        'Porque o fluxo de uma resposta de LLM é unidirecional: o servidor empurra tokens para o cliente, e o cliente não precisa emitir dados no meio da geração. SSE foi feito exatamente para isso, roda sobre HTTP comum que atravessa qualquer proxy, e já traz reconexão automática e um formato de evento simples. WebSocket abre um canal bidirecional persistente e só compensa quando o cliente também manda dados durante o fluxo, como numa conversa de voz ao vivo; para o caso padrão de streaming de texto, ele adiciona complexidade de gerenciar estado de conexão sem entregar nada que o SSE não resolva. A regra é usar o transporte mais simples que atende, e para streaming de resposta de LLM esse transporte é o SSE.',
    },
    {
      question: 'O que acontece com o custo quando o usuário fecha a aba no meio da resposta?',
      answer:
        'Sem cancelamento ponta a ponta, a chamada ao modelo continua rodando até o fim no backend mesmo que ninguém vá ler a resposta, e você paga por todos os tokens gerados após o usuário sair; esse custo vaza silenciosamente e só aparece na fatura. A correção é ligar a desconexão do cliente ao aborto da chamada ao modelo: no servidor, um AbortController que é acionado pelo evento de fechar da conexão (req.on close) interrompe a geração assim que o cliente some. No cliente, o mesmo AbortController alimenta o botão de parar, que ao abortar o fetch fecha a conexão e dispara o cancelamento no servidor. Assim, tanto fechar a aba quanto clicar em parar de fato interrompem a geração e param de gastar tokens.',
    },
    {
      question: 'Como evitar que o streaming deixe a interface nervosa e piscando?',
      answer:
        'Três cuidados no cliente resolvem. Primeiro, anexe os tokens ao texto acumulado em vez de substituir o conteúdo inteiro a cada token, o que elimina o flicker e o re-render caro. Segundo, agrupe as atualizações no ritmo do frame: um modelo rápido emite dezenas de tokens por segundo, mas a tela só desenha a sessenta quadros, então acumule os tokens num buffer e reconcilie a UI uma vez por frame (via requestAnimationFrame) em vez de a cada token; isso entrega toda a fluidez sem saturar o render. Terceiro, segure o auto-scroll quando o usuário rolar para cima para reler, retomando só quando ele voltar ao fim, para não sequestrar o scroll. Essas três regras transformam um fluxo cru de tokens numa resposta que parece digitada com fluidez.',
    },
  ],
  conclusion: {
    title: 'Streaming bem feito transforma a espera pela resposta de LLM em progresso visível',
    description:
      'Mostrar a resposta enquanto ela é gerada muda a percepção de velocidade sem tocar no modelo, mas só funciona com transporte certo, cancelamento ponta a ponta, anexação por frame e tratamento dos três finais. Posso desenhar essa camada de streaming no seu produto de IA, do servidor SSE às regras de UX, para uma interface que parece viva em vez de travada.',
    cta: 'Falar sobre streaming de LLM no meu produto de IA',
  },
  related: [
    { label: 'Roteamento de modelos: modelo certo para cada tarefa', to: '/blog/roteamento-modelos-modelo-certo-cada-tarefa' },
    { label: 'Observabilidade de LLM: tracing, custo e qualidade', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'llm-stream-ux', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'An LLM answer that takes eight seconds to appear all at once feels like a frozen system; the same answer, starting to show up in three hundred milliseconds and flowing token by token, feels fast even though it takes the same eight seconds to finish. The difference is not in the model, it is in the delivery. Streaming is the technique of showing the answer as it is generated, instead of waiting for the full text, and it is what separates an AI interface that feels alive from one that feels frozen. But streaming done naively trades one problem for another: the screen flickers on every token, the scroll jumps, the stop button stops nothing, and when the connection drops midway the user is left with half an answer and no way to continue. The wrong buffer swallows the smoothness; the missing cancellation leaks cost after the user is already gone; the botched reconnection duplicates text. This article shows how to transmit an LLM answer from the model to the screen without breaking the experience: the transport protocol, the server that relays tokens with heartbeat and cancellation, the client that assembles the text incrementally and the UX rules that make streaming feel smooth instead of nervous.',
  sections: [
    {
      title: 'Why streaming changes the perception of speed',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The time that matters in an AI interface is not how long the answer takes to finish, it is how long it takes to start. A model that generates the full answer in eight seconds and returns it all at once makes the user stare at a still screen for eight seconds, with no sign that anything is happening; their intuition is that the system froze. The same model, transmitting the tokens as it generates them, delivers the first word in a few hundred milliseconds and keeps the text flowing until the end. The total time is identical, but the perception is opposite: the second feels fast because the wait is filled with visible progress.',
        },
        {
          type: 'paragraph',
          value:
            'The metric that captures this difference is the time to first token (TTFT), and it is what streaming optimizes. While total latency measures the end of generation, TTFT measures the start of the visible answer, and it is TTFT that governs the sense of responsiveness. The table below separates the two experiences to make clear what changes.',
        },
        {
          type: 'table',
          columns: ['Aspect', 'No streaming (wait for full text)', 'With streaming (token by token)'],
          rows: [
            [
              'First signal on screen',
              'Only when everything finishes (seconds)',
              'First token in hundreds of ms',
            ],
            [
              'User perception',
              'Feels frozen, tempted to reload',
              'Feels alive, follows the generation',
            ],
            [
              'Abandonment while waiting',
              'High: long silence with no feedback',
              'Low: visible progress holds the user',
            ],
            [
              'Cancel midway',
              'Impossible: answer is atomic',
              'Natural: can stop at any token',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The gain from streaming is not only aesthetic. Being able to cancel midway means stopping payment for tokens of an answer the user already saw is useless; watching the text appear gives the user the chance to reformulate the question before the end; and the continuous feedback reduces the abandonment while waiting, which is where you lose users in an AI interface. Streaming is at once an optimization of perception, of cost and of retention, and the rest of the article is about delivering it without introducing the defects that make it worse than a silent wait.',
        },
      ],
    },
    {
      title: 'The transport: SSE, WebSocket or fetch with stream',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before the first token reaches the screen, you have to choose how the server pushes the chunks to the client. Traditional HTTP is one request and one closed response, which does not fit an open flow that drips tokens over time. Three transports solve this, and the right choice depends on the shape of the conversation. Server-Sent Events (SSE) is a unidirectional channel from server to client over plain HTTP, made exactly for pushing a sequence of events, and it is the simplest and most suitable for streaming an LLM answer. WebSocket opens a persistent bidirectional channel, and it only pays off when the client also needs to send data mid-flow (a live voice conversation, for example). The fetch with ReadableStream reads the response body in chunks in the browser itself, with no event protocol, and serves when you control both ends and want something lean.',
        },
        {
          type: 'table',
          columns: ['Transport', 'Direction', 'When to use', 'Complexity cost'],
          rows: [
            [
              'SSE',
              'Server to client',
              'Streaming an LLM answer, the default case',
              'Low: automatic reconnection, plain HTTP',
            ],
            [
              'WebSocket',
              'Bidirectional',
              'Client also emits during the flow (voice)',
              'High: managing connection state',
            ],
            [
              'fetch + ReadableStream',
              'Server to client',
              'Control of both ends, no named events',
              'Medium: manual stream parsing',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'For the overwhelming majority of LLM answer streaming cases, SSE is the right choice: the flow is server to client, the transport is plain HTTP that passes through any proxy, and the protocol itself already brings automatic reconnection and a simple event format to emit. The rest of this article uses SSE because it solves the real problem with the fewest moving parts, and reserves WebSocket for when bidirectionality is actually needed, not by reflex.',
        },
      ],
    },
    {
      title: 'The server: relay tokens with heartbeat and cancellation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The server role in streaming is to be a thin, reliable pipe: it opens the model call in stream mode, receives each chunk of text and relays it immediately to the client as an SSE event, without buffering the whole answer. Two responsibilities make that pipe robust. The first is the heartbeat: if the model is slow between tokens, a periodic SSE comment keeps the connection alive and prevents proxies from dropping it for inactivity. The second, and more important for cost, is cancellation: when the client closes the connection (closed the tab, cancelled the question), the server must abort the model call, or it keeps paying tokens for an answer nobody will read.',
        },
        {
          type: 'code',
          value: `// server/stream.js
// Relays the model tokens to the client via SSE, with heartbeat
// and cancellation when the client disconnects. Does not buffer the answer.

export async function streamHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // AbortController links the client disconnect to aborting the model call.
  const controller = new AbortController();
  req.on('close', () => controller.abort()); // client left: stop generating.

  // Heartbeat: periodic SSE comment keeps proxies from dropping the connection.
  const heartbeat = setInterval(() => res.write(': keep-alive\\n\\n'), 15000);

  try {
    const stream = await model.stream({ messages: req.body.messages }, {
      signal: controller.signal,
    });

    for await (const chunk of stream) {
      const token = chunk.delta ?? '';
      if (token) res.write(\`data: \${JSON.stringify({ token })}\\n\\n\`);
    }
    res.write('event: done\\ndata: {}\\n\\n'); // signals a clean end to the client.
  } catch (err) {
    if (err.name !== 'AbortError') {
      res.write(\`event: error\\ndata: \${JSON.stringify({ message: 'stream failed' })}\\n\\n\`);
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'The detail that separates this server from a naive version is the AbortController and req.on(close) pair. Without it, when the user closes the tab midway through a long answer, the model call keeps running to the end in the backend, spending tokens nobody will see: the cost leaks silently and only shows up on the invoice. Linking the client disconnect to the model abort signal turns closing the tab into a real cancellation. The heartbeat solves the opposite problem: when the model thinks for several seconds before the next token, the connection goes silent, and proxies and load balancers tend to drop idle connections; an SSE comment every few seconds keeps the pipe open without polluting the data flow.',
        },
      ],
    },
    {
      title: 'The client: assemble the answer incrementally',
      blocks: [
        {
          type: 'paragraph',
          value:
            'On the client side, the job is to receive the tokens, accumulate them into a string and update the screen so the text seems to flow, not flicker. The most common mistake here is replacing the content on every token (which causes flicker and expensive re-render) instead of appending; the second mistake is updating the DOM on every individual token, when dozens arrive per second, saturating the render. The solution is to accumulate the text in a buffer and reconcile the screen at a controlled pace, plus handle the three states the stream can end in: clean end, error and user cancellation.',
        },
        {
          type: 'code',
          value: `// client/useStream.js
// Consumes the SSE, accumulates the tokens and exposes the growing text.
// A local AbortController lets the user cancel the generation.

export function startStream({ url, body, onToken, onDone, onError }) {
  const controller = new AbortController();
  let text = ''; // accumulate: append token, never replace the whole answer.

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal, // cancelling here aborts the call and frees the server.
  })
    .then(async (res) => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE separates events by a blank line; process the complete ones.
        const events = buffer.split('\\n\\n');
        buffer = events.pop() ?? ''; // keep the incomplete fragment.

        for (const evt of events) {
          if (evt.startsWith(': ')) continue; // heartbeat: ignore.
          if (evt.includes('event: done')) { onDone(text); return; }
          if (evt.includes('event: error')) { onError(new Error('stream failed')); return; }
          const line = evt.split('\\n').find((l) => l.startsWith('data: '));
          if (line) {
            const { token } = JSON.parse(line.slice(6));
            text += token; // append.
            onToken(text); // hand the growing text to the UI to reconcile.
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err); // user abort is not an error.
    });

  return () => controller.abort(); // return the cancel function (stop button).
}`,
        },
        {
          type: 'paragraph',
          value:
            'Note that the client returns a cancel function: it is what the stop button calls, and by aborting the fetch the client closes the connection, which triggers the server req.on(close) and aborts the model call. So the stop button is not decorative: it effectively interrupts the generation and stops spending tokens, end to end. The other detail is the event buffer: SSE separates events by a blank line, but a chunk read from the network can cut an event in half, so the client keeps the incomplete fragment and only processes complete events. Without that care, a token arrives split and JSON.parse breaks.',
        },
      ],
    },
    {
      title: 'The UX rules: make streaming feel smooth',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Having the tokens arrive does not guarantee a good experience; a technically correct streaming can still feel nervous if the UI reacts to every token raw. Four rules turn a token flow into an answer that seems typed with fluency, and all of them deal with the tension between updating fast and updating smooth.',
        },
        {
          type: 'ordered',
          items: [
            'Append, never replace: render the accumulated text, adding the new tokens at the end, so the answer grows without flickering. Replacing the whole content on every token causes flicker and expensive re-render.',
            'Batch updates at frame rate: dozens of tokens arrive per second, but the screen only draws at sixty frames; accumulate the tokens and reconcile the UI once per frame (via requestAnimationFrame) instead of on every token, for smooth render without cost.',
            'Hold auto-scroll when the user scrolls up: scrolling the screen to the bottom on every token is helpful while the user follows along, but becomes scroll hijacking if they went up to reread something; detect the manual scroll and pause the auto-scroll until they return to the bottom.',
            'Show stop and error state clearly: a pulsing cursor while generating, the stop button always visible during the flow, and an error message that preserves the text already received instead of erasing it, so the user is never left with a blank screen not knowing what happened.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The rule that most improves perception is batching updates at frame rate. A fast model can emit dozens of tokens per second, and updating the DOM on each one saturates the render and paradoxically makes the interface more frozen than streaming should be. Accumulating the tokens in a buffer and drawing the screen once per frame delivers all the smoothness without the cost, and it is the difference between text that flows smooth and one that trembles. Respectful auto-scroll is the second: hijacking the scroll of a user who went up to reread is one of the most cited frustrations in chat interfaces, and solving it is just detecting their intent and backing off.',
        },
      ],
    },
    {
      title: 'Reconnection, error and cancellation: the three endings of the stream',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A stream does not end in a single way, and robustness lies in handling the three possible endings without leaving the user lost. The first is the clean end: the model finished, the server sent the done event, the client marks the answer as complete and hides the cursor. The second is the error midway: the network dropped, the model failed, the server sent an error event; here the golden rule is to preserve the text already received and signal that the answer is incomplete, never erase what the user already read. The third is user cancellation: they clicked stop, and the expected behavior is to freeze the text at the point it was, without treating it as an error.',
        },
        {
          type: 'table',
          columns: ['Stream ending', 'What to do with the text', 'What to show'],
          rows: [
            [
              'Clean end (done)',
              'Keep complete',
              'Hide cursor, answer ready',
            ],
            [
              'Error midway',
              'Preserve the partial, mark incomplete',
              'Failure notice with a retry option',
            ],
            [
              'Cancelled by user',
              'Freeze at the current point',
              'Text stopped, no error alarm',
            ],
            [
              'Connection dropped (reconnectable)',
              'Keep the partial, try to resume',
              'Discreet reconnection indicator',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The critical difference between these endings is how the partial text is treated. An error that erases the half-written answer is worse than the silent wait, because it destroys work the user was reading; the correct thing is to always preserve the partial and make clear it stayed incomplete, with a retry option. Cancellation should never become an error alarm: the user asked to stop, so stopping is the right behavior, and showing a failure notice there confuses. And reconnection, when the transport supports it (SSE reconnects on its own), should resume discreetly without duplicating the text already received, which requires the server to know where to continue or the client to discard what it has before resuming. Handling the three endings is what separates a demo streaming from one that holds up in production.',
        },
      ],
    },
    {
      title: 'Building streaming in production without breaking the UX',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Streaming is one of the highest-impact improvements to the experience of an AI interface, because it attacks the perception of speed directly without touching the model. But the gain is only real if the delivery is smooth and the endings are handled; a nervous streaming or one that loses text is worse than a clean wait. The rollout order below delivers the value early and shields the fragile points before scaling.',
        },
        {
          type: 'ordered',
          items: [
            'Start with the right transport: SSE solves the default LLM answer streaming case with the least complexity; only use WebSocket if the client needs to emit during the flow.',
            'Wire cancellation end to end from day one: the client AbortController and the server req.on(close) ensure closing the tab or clicking stop actually aborts the model call, cutting leaked cost.',
            'Accumulate and append, never replace: render the growing text by adding tokens at the end and reconcile the UI once per frame, so the answer flows smooth instead of flickering.',
            'Handle the three endings explicitly: clean end hides the cursor, error preserves the partial and offers retry, cancellation freezes without an alarm. Never erase text the user already read.',
            'Add heartbeat and monitor TTFT: the heartbeat keeps the connection alive on slow models, and the time to first token is the metric that tells whether streaming is delivering the responsiveness it promises.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The difference between a streaming that makes the interface feel alive and one that makes it feel nervous lives entirely in the client: in appending instead of replacing, in reconciling per frame instead of per token, in the auto-scroll that respects the user and in handling the three endings. The server is the easy part, a pipe that relays tokens with heartbeat and cancellation. What makes streaming worth it is the UX discipline at the edge, plus the end-to-end cancellation that stops cost from leaking. Well built, streaming turns the wait for the answer from an anxious silence into visible progress, and that is the difference between an AI interface the user trusts and one they reload thinking it froze.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why use SSE and not WebSocket for LLM streaming?',
      answer:
        'Because the flow of an LLM answer is unidirectional: the server pushes tokens to the client, and the client does not need to emit data mid-generation. SSE was made exactly for that, runs over plain HTTP that crosses any proxy, and already brings automatic reconnection and a simple event format. WebSocket opens a persistent bidirectional channel and only pays off when the client also sends data during the flow, like in a live voice conversation; for the default case of text streaming, it adds the complexity of managing connection state without delivering anything SSE does not solve. The rule is to use the simplest transport that fits, and for streaming an LLM answer that transport is SSE.',
    },
    {
      question: 'What happens to cost when the user closes the tab mid-answer?',
      answer:
        'Without end-to-end cancellation, the model call keeps running to the end in the backend even if nobody will read the answer, and you pay for all the tokens generated after the user leaves; that cost leaks silently and only shows up on the invoice. The fix is to link the client disconnect to aborting the model call: on the server, an AbortController triggered by the connection close event (req.on close) interrupts the generation as soon as the client disappears. On the client, the same AbortController feeds the stop button, which by aborting the fetch closes the connection and triggers the cancellation on the server. So both closing the tab and clicking stop actually interrupt the generation and stop spending tokens.',
    },
    {
      question: 'How do you keep streaming from making the interface nervous and flickering?',
      answer:
        'Three cares on the client solve it. First, append the tokens to the accumulated text instead of replacing the whole content on every token, which eliminates the flicker and expensive re-render. Second, batch updates at frame rate: a fast model emits dozens of tokens per second, but the screen only draws at sixty frames, so accumulate the tokens in a buffer and reconcile the UI once per frame (via requestAnimationFrame) instead of on every token; that delivers all the smoothness without saturating the render. Third, hold the auto-scroll when the user scrolls up to reread, resuming only when they return to the bottom, so you do not hijack the scroll. These three rules turn a raw token flow into an answer that seems typed with fluency.',
    },
  ],
  conclusion: {
    title: 'Well-done streaming turns the wait for the LLM answer into visible progress',
    description:
      'Showing the answer as it is generated changes the perception of speed without touching the model, but it only works with the right transport, end-to-end cancellation, per-frame appending and handling of the three endings. I can design that streaming layer in your AI product, from the SSE server to the UX rules, for an interface that feels alive instead of frozen.',
    cta: 'Talk about LLM streaming in my AI product',
  },
  related: [
    { label: 'Model routing: the right model for each task', to: '/blog/roteamento-modelos-modelo-certo-cada-tarefa' },
    { label: 'LLM observability: tracing, cost and quality', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'llm-stream-ux', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Una respuesta de LLM que tarda ocho segundos en aparecer entera parece un sistema trabado; la misma respuesta, empezando a surgir en trescientos milisegundos y escurriendo token a token, parece rápida aunque tarde los mismos ocho segundos hasta el final. La diferencia no está en el modelo, está en la entrega. El streaming es la técnica de mostrar la respuesta mientras se genera, en vez de esperar el texto completo, y es lo que separa una interfaz de IA que parece viva de una que parece congelada. Pero el streaming hecho de forma ingenua cambia un problema por otro: la pantalla parpadea a cada token, el scroll salta, el botón de parar no para nada, y cuando la conexión cae a la mitad el usuario queda con media respuesta y ninguna forma de continuar. El buffer equivocado se traga la fluidez; la cancelación ausente filtra costo después de que el usuario ya se fue; la reconexión mal hecha duplica texto. Este artículo muestra cómo transmitir una respuesta de LLM del modelo hasta la pantalla sin romper la experiencia: el protocolo de transporte, el servidor que repasa tokens con heartbeat y cancelación, el cliente que arma el texto de forma incremental y las reglas de UX que hacen que el streaming parezca suave en vez de nervioso.',
  sections: [
    {
      title: 'Por qué el streaming cambia la percepción de velocidad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El tiempo que importa en una interfaz de IA no es cuánto tarda la respuesta en terminar, es cuánto tarda en empezar. Un modelo que genera la respuesta completa en ocho segundos y la devuelve de una vez hace que el usuario mire una pantalla quieta por ocho segundos, sin señal de que algo pasa; su intuición es que el sistema se trabó. El mismo modelo, transmitiendo los tokens conforme los genera, entrega la primera palabra en algunos cientos de milisegundos y mantiene el texto escurriendo hasta el final. El tiempo total es idéntico, pero la percepción es opuesta: el segundo parece rápido porque la espera se llena con progreso visible.',
        },
        {
          type: 'paragraph',
          value:
            'La métrica que captura esa diferencia es el tiempo hasta el primer token (TTFT), y es lo que el streaming optimiza. Mientras la latencia total mide el fin de la generación, el TTFT mide el inicio de la respuesta visible, y es el TTFT el que gobierna la sensación de responsividad. La tabla de abajo separa las dos experiencias para dejar claro qué cambia.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Sin streaming (espera el texto entero)', 'Con streaming (token a token)'],
          rows: [
            [
              'Primera señal en pantalla',
              'Solo al terminar todo (segundos)',
              'Primer token en cientos de ms',
            ],
            [
              'Percepción del usuario',
              'Parece trabado, tentado a recargar',
              'Parece vivo, acompaña la generación',
            ],
            [
              'Abandono en la espera',
              'Alto: silencio largo sin feedback',
              'Bajo: progreso visible retiene al usuario',
            ],
            [
              'Cancelar a la mitad',
              'Imposible: la respuesta es atómica',
              'Natural: puede parar en cualquier token',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La ganancia del streaming no es solo estética. Poder cancelar a la mitad significa dejar de pagar tokens de una respuesta que el usuario ya vio que no sirve; ver el texto surgir le da al usuario la chance de reformular la pregunta antes del final; y el feedback continuo reduce el abandono en la espera, que es donde se pierde usuario en una interfaz de IA. El streaming es, a la vez, una optimización de percepción, de costo y de retención, y el resto del artículo es sobre entregarlo sin introducir los defectos que lo vuelven peor que la espera silenciosa.',
        },
      ],
    },
    {
      title: 'El transporte: SSE, WebSocket o fetch con stream',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de que el primer token llegue a la pantalla, hay que elegir cómo el servidor empuja los pedazos al cliente. HTTP tradicional es una request y una respuesta cerrada, lo que no sirve para un flujo abierto que gotea tokens a lo largo del tiempo. Tres transportes resuelven esto, y la elección correcta depende de la forma de la conversación. Server-Sent Events (SSE) es un canal unidireccional del servidor al cliente sobre HTTP común, hecho exactamente para el caso de empujar una secuencia de eventos, y es el más simple y el más adecuado para el streaming de una respuesta de LLM. WebSocket abre un canal bidireccional persistente, y solo vale la pena cuando el cliente también necesita mandar datos a la mitad del flujo (una conversación de voz en vivo, por ejemplo). El fetch con ReadableStream lee el cuerpo de la respuesta en pedazos en el propio navegador, sin protocolo de eventos, y sirve cuando controlás las dos puntas y querés algo escueto.',
        },
        {
          type: 'table',
          columns: ['Transporte', 'Dirección', 'Cuándo usar', 'Costo de complejidad'],
          rows: [
            [
              'SSE',
              'Servidor a cliente',
              'Streaming de respuesta de LLM, el caso estándar',
              'Bajo: reconexión automática, HTTP común',
            ],
            [
              'WebSocket',
              'Bidireccional',
              'El cliente también emite durante el flujo (voz)',
              'Alto: gestionar estado de la conexión',
            ],
            [
              'fetch + ReadableStream',
              'Servidor a cliente',
              'Control de las dos puntas, sin eventos nombrados',
              'Medio: parsing manual del stream',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Para la abrumadora mayoría de los casos de streaming de respuesta de LLM, SSE es la elección correcta: el flujo es del servidor al cliente, el transporte es HTTP común que pasa por cualquier proxy, y el propio protocolo ya trae reconexión automática y un formato de evento simple de emitir. El resto de este artículo usa SSE porque resuelve el problema real con el mínimo de piezas móviles, y reserva WebSocket para cuando la bidireccionalidad sea de hecho necesaria, no por reflejo.',
        },
      ],
    },
    {
      title: 'El servidor: repasar tokens con heartbeat y cancelación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El papel del servidor en el streaming es ser un caño fino y confiable: abre la llamada al modelo en modo stream, recibe cada pedazo de texto y lo repasa de inmediato al cliente como un evento SSE, sin bufferizar la respuesta entera. Dos responsabilidades vuelven robusto ese caño. La primera es el heartbeat: si el modelo tarda entre tokens, un comentario SSE periódico mantiene la conexión viva y evita que los proxies la tiren por inactividad. La segunda, y más importante para el costo, es la cancelación: cuando el cliente cierra la conexión (cerró la pestaña, canceló la pregunta), el servidor necesita abortar la llamada al modelo, si no sigue pagando tokens de una respuesta que nadie va a leer.',
        },
        {
          type: 'code',
          value: `// server/stream.js
// Repasa los tokens del modelo al cliente via SSE, con heartbeat
// y cancelacion cuando el cliente se desconecta. No bufferiza la respuesta.

export async function streamHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // AbortController liga la desconexion del cliente al aborto de la llamada al modelo.
  const controller = new AbortController();
  req.on('close', () => controller.abort()); // el cliente se fue: deja de generar.

  // Heartbeat: comentario SSE periodico evita que los proxies tiren la conexion.
  const heartbeat = setInterval(() => res.write(': keep-alive\\n\\n'), 15000);

  try {
    const stream = await model.stream({ messages: req.body.messages }, {
      signal: controller.signal,
    });

    for await (const chunk of stream) {
      const token = chunk.delta ?? '';
      if (token) res.write(\`data: \${JSON.stringify({ token })}\\n\\n\`);
    }
    res.write('event: done\\ndata: {}\\n\\n'); // senala fin limpio al cliente.
  } catch (err) {
    if (err.name !== 'AbortError') {
      res.write(\`event: error\\ndata: \${JSON.stringify({ message: 'stream fallo' })}\\n\\n\`);
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que separa este servidor de una versión ingenua es el par AbortController y req.on(close). Sin él, cuando el usuario cierra la pestaña a la mitad de una respuesta larga, la llamada al modelo sigue corriendo hasta el final en el backend, gastando tokens que nadie va a ver: el costo se filtra en silencio y solo aparece en la factura. Ligar la desconexión del cliente a la señal de aborto del modelo transforma el cerrar de la pestaña en una cancelación real. El heartbeat resuelve el problema opuesto: cuando el modelo piensa por varios segundos antes del próximo token, la conexión queda en silencio, y los proxies y balanceadores suelen tirar conexiones ociosas; un comentario SSE cada pocos segundos mantiene el caño abierto sin ensuciar el flujo de datos.',
        },
      ],
    },
    {
      title: 'El cliente: armar la respuesta de forma incremental',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Del lado del cliente, el trabajo es recibir los tokens, acumularlos en un string y actualizar la pantalla de modo que el texto parezca escurrir, no parpadear. El error más común acá es sustituir el contenido a cada token (lo que causa flicker y re-render caro) en vez de anexar; el segundo error es actualizar el DOM a cada token individual, cuando decenas llegan por segundo, saturando el render. La solución es acumular el texto en un buffer y reconciliar la pantalla a un ritmo controlado, además de tratar los tres estados en que el stream puede terminar: fin limpio, error y cancelación por el usuario.',
        },
        {
          type: 'code',
          value: `// client/useStream.js
// Consume el SSE, acumula los tokens y expone el texto creciente.
// Un AbortController local permite al usuario cancelar la generacion.

export function startStream({ url, body, onToken, onDone, onError }) {
  const controller = new AbortController();
  let text = ''; // acumula: anexa token, nunca sustituye la respuesta entera.

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal, // cancelar aqui aborta la llamada y libera el servidor.
  })
    .then(async (res) => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE separa eventos por linea en blanco; procesa los completos.
        const events = buffer.split('\\n\\n');
        buffer = events.pop() ?? ''; // guarda el fragmento incompleto.

        for (const evt of events) {
          if (evt.startsWith(': ')) continue; // heartbeat: ignora.
          if (evt.includes('event: done')) { onDone(text); return; }
          if (evt.includes('event: error')) { onError(new Error('stream fallo')); return; }
          const line = evt.split('\\n').find((l) => l.startsWith('data: '));
          if (line) {
            const { token } = JSON.parse(line.slice(6));
            text += token; // anexa.
            onToken(text); // entrega el texto creciente a la UI para reconciliar.
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err); // el aborto del usuario no es error.
    });

  return () => controller.abort(); // devuelve la funcion de cancelar (boton parar).
}`,
        },
        {
          type: 'paragraph',
          value:
            'Fijate que el cliente devuelve una función de cancelación: es la que el botón de parar llama, y al abortar el fetch el cliente cierra la conexión, lo que dispara el req.on(close) del servidor y aborta la llamada al modelo. Así el botón de parar no es decorativo: efectivamente interrumpe la generación y deja de gastar tokens, de punta a punta. El otro detalle es el buffer de eventos: SSE separa eventos por una línea en blanco, pero un pedazo leído por la red puede cortar un evento a la mitad, así que el cliente guarda el fragmento incompleto y solo procesa eventos completos. Sin ese cuidado, un token llega partido y el JSON.parse se rompe.',
        },
      ],
    },
    {
      title: 'Las reglas de UX: hacer que el streaming parezca suave',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tener los tokens llegando no garantiza una buena experiencia; un streaming técnicamente correcto todavía puede parecer nervioso si la UI reacciona a cada token de forma cruda. Cuatro reglas transforman un flujo de tokens en una respuesta que parece tipeada con fluidez, y todas tratan la tensión entre actualizar rápido y actualizar suave.',
        },
        {
          type: 'ordered',
          items: [
            'Anexa, nunca sustituyas: renderiza el texto acumulado, agregando los tokens nuevos al final, para que la respuesta crezca sin parpadear. Sustituir el contenido entero a cada token causa flicker y re-render caro.',
            'Agrupa las actualizaciones al ritmo del frame: decenas de tokens llegan por segundo, pero la pantalla solo dibuja a sesenta cuadros; acumula los tokens y reconcilia la UI una vez por frame (via requestAnimationFrame) en vez de a cada token, para render suave sin costo.',
            'Retén el auto-scroll cuando el usuario suba: bajar la pantalla al final a cada token es útil mientras el usuario acompaña, pero se vuelve secuestro de scroll si subió para releer algo; detecta el scroll manual y pausa el auto-scroll hasta que vuelva al final.',
            'Muestra estado de parada y de error con claridad: un cursor pulsando mientras genera, el botón de parar siempre visible durante el flujo, y un mensaje de error que preserva el texto ya recibido en vez de borrarlo, para que el usuario nunca quede con la pantalla en blanco sin saber qué pasó.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La regla que más mejora la percepción es agrupar las actualizaciones al ritmo del frame. Un modelo rápido puede emitir decenas de tokens por segundo, y actualizar el DOM a cada uno satura el render y paradójicamente deja la interfaz más trabada de lo que el streaming debería ser. Acumular los tokens en un buffer y dibujar la pantalla una vez por frame entrega toda la fluidez sin el costo, y es la diferencia entre un texto que escurre suave y uno que tiembla. El auto-scroll respetuoso es la segunda: secuestrar el scroll del usuario que subió para releer es una de las frustraciones más citadas en interfaces de chat, y resolverla es solo detectar su intención y retroceder.',
        },
      ],
    },
    {
      title: 'Reconexión, error y cancelación: los tres finales del stream',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un stream no termina de una sola forma, y la robustez está en tratar los tres finales posibles sin dejar al usuario perdido. El primero es el fin limpio: el modelo terminó, el servidor envió el evento de done, el cliente marca la respuesta como completa y esconde el cursor. El segundo es el error a la mitad: la red cayó, el modelo falló, el servidor mandó un evento de error; acá la regla de oro es preservar el texto ya recibido y señalar que la respuesta quedó incompleta, nunca borrar lo que el usuario ya leyó. El tercero es la cancelación por el usuario: hizo clic en parar, y lo esperado es congelar el texto en el punto donde estaba, sin tratarlo como error.',
        },
        {
          type: 'table',
          columns: ['Final del stream', 'Qué hacer con el texto', 'Qué mostrar'],
          rows: [
            [
              'Fin limpio (done)',
              'Mantener completo',
              'Esconder cursor, respuesta lista',
            ],
            [
              'Error a la mitad',
              'Preservar el parcial, marcar incompleto',
              'Aviso de falla con opción de repetir',
            ],
            [
              'Cancelado por el usuario',
              'Congelar en el punto actual',
              'Texto parado, sin alarma de error',
            ],
            [
              'Conexión cayó (reconectable)',
              'Mantener el parcial, intentar retomar',
              'Indicador de reconexión discreto',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia crítica entre esos finales es cómo se trata el texto parcial. Un error que borra la respuesta a la mitad es peor que la espera silenciosa, porque destruye trabajo que el usuario estaba leyendo; lo correcto es siempre preservar el parcial y dejar claro que quedó incompleto, con opción de repetir. La cancelación nunca debe volverse una alarma de error: el usuario pidió parar, así que parar es el comportamiento correcto, y mostrar un aviso de falla ahí confunde. Y la reconexión, cuando el transporte la soporta (SSE reconecta solo), debe retomar de forma discreta sin duplicar el texto ya recibido, lo que exige que el servidor sepa de dónde continuar o que el cliente descarte lo que ya tiene antes de retomar. Tratar los tres finales es lo que separa un streaming de demostración de uno que aguanta producción.',
        },
      ],
    },
    {
      title: 'Montar el streaming en producción sin romper la UX',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El streaming es una de las mejoras de mayor impacto en la experiencia de una interfaz de IA, porque ataca directamente la percepción de velocidad sin tocar el modelo. Pero la ganancia solo es real si la entrega es suave y los finales se tratan; un streaming nervioso o que pierde texto es peor que la espera limpia. El orden de despliegue de abajo entrega el valor temprano y blinda los puntos frágiles antes de escalar.',
        },
        {
          type: 'ordered',
          items: [
            'Empieza por el transporte correcto: SSE resuelve el caso estándar de streaming de respuesta de LLM con el mínimo de complejidad; solo usa WebSocket si el cliente necesita emitir durante el flujo.',
            'Liga la cancelación de punta a punta desde el día uno: el AbortController en el cliente y el req.on(close) en el servidor garantizan que cerrar la pestaña o hacer clic en parar de hecho aborta la llamada al modelo, cortando costo filtrado.',
            'Acumula y anexa, nunca sustituyas: renderiza el texto creciente agregando tokens al final y reconcilia la UI una vez por frame, para que la respuesta escurra suave en vez de parpadear.',
            'Trata los tres finales explícitamente: fin limpio esconde el cursor, error preserva el parcial y ofrece repetir, cancelación congela sin alarma. Nunca borres texto que el usuario ya leyó.',
            'Agrega heartbeat y monitorea el TTFT: el heartbeat mantiene la conexión viva en modelos lentos, y el tiempo hasta el primer token es la métrica que dice si el streaming está entregando la responsividad que promete.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre un streaming que hace que la interfaz parezca viva y uno que la hace parecer nerviosa está entera en el cliente: en el anexar en vez de sustituir, en el reconciliar por frame en vez de por token, en el auto-scroll que respeta al usuario y en el tratamiento de los tres finales. El servidor es la parte fácil, un caño que repasa tokens con heartbeat y cancelación. Lo que hace que el streaming valga la pena es la disciplina de UX en la punta, más la cancelación de punta a punta que impide que el costo se filtre. Bien montado, el streaming transforma la espera por la respuesta de un silencio ansioso en un progreso visible, y esa es la diferencia entre una interfaz de IA que el usuario confía y una que recarga creyendo que se trabó.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué usar SSE y no WebSocket para streaming de LLM?',
      answer:
        'Porque el flujo de una respuesta de LLM es unidireccional: el servidor empuja tokens al cliente, y el cliente no necesita emitir datos a la mitad de la generación. SSE fue hecho exactamente para eso, corre sobre HTTP común que atraviesa cualquier proxy, y ya trae reconexión automática y un formato de evento simple. WebSocket abre un canal bidireccional persistente y solo compensa cuando el cliente también manda datos durante el flujo, como en una conversación de voz en vivo; para el caso estándar de streaming de texto, agrega la complejidad de gestionar estado de conexión sin entregar nada que el SSE no resuelva. La regla es usar el transporte más simple que atiende, y para streaming de respuesta de LLM ese transporte es el SSE.',
    },
    {
      question: '¿Qué pasa con el costo cuando el usuario cierra la pestaña a la mitad de la respuesta?',
      answer:
        'Sin cancelación de punta a punta, la llamada al modelo sigue corriendo hasta el final en el backend aunque nadie vaya a leer la respuesta, y pagás por todos los tokens generados después de que el usuario se fue; ese costo se filtra en silencio y solo aparece en la factura. La corrección es ligar la desconexión del cliente al aborto de la llamada al modelo: en el servidor, un AbortController accionado por el evento de cierre de la conexión (req.on close) interrumpe la generación apenas el cliente desaparece. En el cliente, el mismo AbortController alimenta el botón de parar, que al abortar el fetch cierra la conexión y dispara la cancelación en el servidor. Así, tanto cerrar la pestaña como hacer clic en parar de hecho interrumpen la generación y dejan de gastar tokens.',
    },
    {
      question: '¿Cómo evitar que el streaming deje la interfaz nerviosa y parpadeando?',
      answer:
        'Tres cuidados en el cliente lo resuelven. Primero, anexa los tokens al texto acumulado en vez de sustituir el contenido entero a cada token, lo que elimina el flicker y el re-render caro. Segundo, agrupa las actualizaciones al ritmo del frame: un modelo rápido emite decenas de tokens por segundo, pero la pantalla solo dibuja a sesenta cuadros, así que acumula los tokens en un buffer y reconcilia la UI una vez por frame (via requestAnimationFrame) en vez de a cada token; eso entrega toda la fluidez sin saturar el render. Tercero, retén el auto-scroll cuando el usuario suba para releer, retomando solo cuando vuelva al final, para no secuestrar el scroll. Esas tres reglas transforman un flujo crudo de tokens en una respuesta que parece tipeada con fluidez.',
    },
  ],
  conclusion: {
    title: 'El streaming bien hecho transforma la espera por la respuesta de LLM en progreso visible',
    description:
      'Mostrar la respuesta mientras se genera cambia la percepción de velocidad sin tocar el modelo, pero solo funciona con el transporte correcto, cancelación de punta a punta, anexación por frame y tratamiento de los tres finales. Puedo diseñar esa capa de streaming en tu producto de IA, del servidor SSE a las reglas de UX, para una interfaz que parece viva en vez de trabada.',
    cta: 'Hablar sobre streaming de LLM en mi producto de IA',
  },
  related: [
    { label: 'Ruteo de modelos: el modelo correcto para cada tarea', to: '/blog/roteamento-modelos-modelo-certo-cada-tarefa' },
    { label: 'Observabilidad de LLM: tracing, costo y calidad', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'llm-stream-ux', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
