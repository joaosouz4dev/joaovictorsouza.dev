// Conteudo do artigo: esgotamento de porta efemera e o servidor que para de
// abrir conexao de saida sem que o trafego de entrada tenha mudado.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O serviço passou a devolver erro de conexão às onze e vinte de uma terça-feira comum, sem pico de tráfego, sem deploy, sem alerta de CPU e com o banco respondendo em dois milissegundos. O log dizia que não foi possível atribuir o endereço solicitado, o time reiniciou o processo, tudo voltou por quarenta minutos e quebrou de novo no mesmo formato. O que estava acabando não era memória, nem conexão de banco, nem descritor de arquivo: era porta de saída, um recurso finito que quase ninguém dimensiona e que ninguém monitora até o dia em que ele acaba. Este artigo mostra por que o esgotamento de porta efêmera é invisível nos painéis usuais e por que o gráfico de tráfego de entrada permanece plano enquanto ele acontece, qual é a tupla que realmente define a capacidade e por que o número de portas é só um dos quatro fatores, por que o estado de espera final existe e o que o encurtamento dele quebra de verdade, por que o cliente HTTP sem reuso de conexão é a causa em oito de cada dez incidentes e o que muda quando existe tradução de endereço no caminho, qual é a sequência de diagnóstico que separa fuga de conexão de demanda legítima, e quais indicadores dão antecedência suficiente para agir antes do primeiro erro.',
  sections: [
    {
      title: 'O recurso que acaba primeiro não aparece em nenhum painel padrão',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo painel de serviço mede as mesmas quatro coisas: uso de processador, uso de memória, latência e taxa de erro. Quando a porta efêmera acaba, três dessas quatro permanecem exatamente onde estavam. O processador fica baixo porque o processo não está trabalhando, está falhando cedo. A memória não se move porque nenhuma alocação nova aconteceu. A latência do que ainda passa continua normal porque o serviço que responde está saudável. Apenas a taxa de erro sobe, e ela sobe com uma mensagem que raramente é associada à sua causa real, porque a mensagem fala em endereço e a causa fala em porta.',
        },
        {
          type: 'paragraph',
          value:
            'A mensagem que o sistema operacional devolve é a de que não foi possível atribuir o endereço solicitado. Ela é gerada no momento em que o processo pede uma conexão de saída e o núcleo não encontra nenhuma porta de origem livre para associar àquela conexão. Nada nessa frase menciona porta, esgotamento ou limite, e é por isso que o erro é tão frequentemente diagnosticado como problema de rede, de DNS ou de firewall. O time olha para fora quando o recurso que acabou está dentro da própria máquina.',
        },
        {
          type: 'paragraph',
          value:
            'A segunda propriedade desagradável desse incidente é o formato de recuperação. Reiniciar o processo funciona, porque o reinício fecha todos os soquetes abertos pelo processo e libera as portas associadas. Isso cria uma narrativa enganosa dentro do time: o problema é resolvido por reinício, logo deve ser vazamento de memória, ou algum estado corrompido, ou uma biblioteca com defeito. Na verdade o reinício está apenas devolvendo o recurso ao sistema, e o intervalo entre reinícios é exatamente o tempo que o serviço leva para consumir a faixa inteira de portas de novo. Um intervalo estável de quarenta minutos entre falhas é uma assinatura forte desse esgotamento, porque ele indica consumo linear de um recurso finito e não um defeito aleatório.',
        },
        {
          type: 'table',
          columns: ['Sintoma observado', 'Diagnóstico usual do time', 'Causa real quando é porta efêmera', 'Verificação que separa os dois'],
          rows: [
            [
              'Erro de atribuição de endereço nas chamadas de saída',
              'Problema de rede ou de resolução de nome',
              'Nenhuma porta de origem livre na faixa configurada',
              'Contar soquetes por estado na máquina de origem, não testar conectividade',
            ],
            [
              'Reinício resolve por dezenas de minutos e o erro volta',
              'Vazamento de memória ou estado corrompido',
              'Consumo linear da faixa até o limite, zerado pelo reinício',
              'Medir o intervalo entre falhas: estável indica recurso finito',
            ],
            [
              'Tráfego de entrada plano durante todo o incidente',
              'Falha do serviço de destino',
              'Cada requisição de entrada abre várias conexões de saída novas',
              'Comparar requisições por segundo com conexões de saída por segundo',
            ],
            [
              'Milhares de soquetes em espera final',
              'Conexões travadas que precisam ser mortas',
              'Comportamento normal do protocolo após fechamento ativo',
              'Verificar se o total se aproxima do tamanho da faixa de portas',
            ],
            [
              'Só uma instância falha enquanto as outras seguem bem',
              'Instância defeituosa, basta substituir',
              'Distribuição desigual de destinos entre instâncias',
              'Agrupar conexões por endereço de destino em cada instância',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha da tabela é a que mais atrasa diagnóstico em ambiente com várias réplicas. Como o esgotamento depende da combinação entre origem e destino, e não apenas do volume total, é perfeitamente possível que uma instância que conversa predominantemente com um único destino quebre enquanto as vizinhas, com a mesma carga mas destinos mais espalhados, continuem saudáveis. Substituir a instância faz o sintoma sumir por alguns minutos e reforça a conclusão errada de que o problema era da máquina.',
        },
      ],
    },
    {
      title: 'A capacidade real é uma tupla de quatro elementos, não um número de portas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A intuição de que existem sessenta e poucos mil portas e que portanto cabem sessenta e poucos mil conexões é errada em duas direções ao mesmo tempo, e entender por quê é o que permite dimensionar corretamente. Uma conexão é identificada por quatro valores: endereço de origem, porta de origem, endereço de destino e porta de destino. O que precisa ser único no sistema é a combinação dos quatro, e não a porta de origem isoladamente.',
        },
        {
          type: 'paragraph',
          value:
            'Isso significa que a mesma porta de origem pode ser reutilizada para destinos diferentes sem nenhum conflito. Uma máquina com trinta mil portas efêmeras disponíveis pode manter trinta mil conexões com um banco de dados e outras trinta mil com um serviço de pagamento simultaneamente, porque as tuplas diferem no endereço de destino. O limite prático, portanto, não é por máquina: é por par de origem e destino. Um serviço que fala com um único destino tem a capacidade mais baixa possível, e um serviço que espalha chamadas entre muitos destinos tem capacidade muito maior sem mudar nada na configuração.',
        },
        {
          type: 'paragraph',
          value:
            'Na direção contrária, a capacidade efetiva é menor do que a faixa sugere por causa do tempo de retenção. Uma porta liberada não volta imediatamente ao conjunto disponível: ela fica retida durante o estado de espera final, que em sistemas derivados de Linux dura sessenta segundos por padrão. A conta que interessa não é quantas portas existem, e sim quantas conexões novas por segundo podem ser abertas para o mesmo destino sem que a taxa de criação supere a taxa de liberação. O número é simples e costuma surpreender: a faixa dividida pelo tempo de retenção.',
        },
        {
          type: 'code',
          value: `// Capacidade de conexoes novas por segundo para um mesmo destino.
// O limite nao e o numero de portas, e a taxa de reciclagem delas.

/**
 * @param {number} portaInicial primeiro valor da faixa efemera
 * @param {number} portaFinal   ultimo valor da faixa efemera
 * @param {number} retencaoSeg  segundos em espera final apos o fechamento
 * @param {number} destinos     quantos pares endereco:porta distintos recebem trafego
 */
export function capacidadeDeConexoesNovas({
  portaInicial = 32768,
  portaFinal = 60999,
  retencaoSeg = 60,
  destinos = 1,
}) {
  const faixa = portaFinal - portaInicial + 1;

  // Por destino distinto a faixa inteira volta a ficar disponivel, porque a
  // unicidade exigida e a da tupla de quatro elementos e nao a da porta.
  const portasUteis = faixa * destinos;

  // Uma porta fechada de forma ativa so retorna ao conjunto depois da
  // espera final. Em regime permanente, a taxa sustentavel e a razao
  // entre o estoque e o tempo que cada unidade fica indisponivel.
  const novasPorSegundo = Math.floor(portasUteis / retencaoSeg);

  return {
    faixa,
    portasUteis,
    novasPorSegundo,
    // Ponto de saturacao: acima disso o estoque encolhe a cada segundo
    // ate zerar, e o erro aparece quando ele zera, nao quando a taxa sobe.
    observacao: \`Acima de \${novasPorSegundo} conexoes novas por segundo para \${destinos} destino(s), o estoque de portas encolhe de forma monotona.\`,
  };
}

// Caso tipico de servico que fala com um unico balanceador interno:
// 28232 portas / 60s = 470 conexoes novas por segundo.
// Um servico que atende 500 req/s e abre uma conexao nova por requisicao
// ja esta acima do ponto de saturacao, com trafego de entrada considerado
// baixo por qualquer painel.`,
        },
        {
          type: 'paragraph',
          value:
            'O resultado desse cálculo é o número mais útil do incidente inteiro, porque ele transforma uma discussão vaga sobre carga em um limite concreto que pode ser comparado com a métrica de requisições. Uma faixa padrão de vinte e oito mil portas com sessenta segundos de retenção sustenta pouco menos de quinhentas conexões novas por segundo para um mesmo destino. Um serviço que recebe quinhentas requisições por segundo e abre uma conexão nova a cada uma delas está exatamente no ponto de virada, e qualquer crescimento de cinco por cento no tráfego passa a consumir estoque em vez de reciclar.',
        },
        {
          type: 'diagram',
          value: `ESTOQUE DE PORTAS EM REGIME PERMANENTE

  faixa = 28.232 portas    retencao = 60s
  taxa sustentavel = 28.232 / 60 = 470 conexoes novas/s

  taxa de abertura < 470/s          taxa de abertura > 470/s
  -----------------------           -----------------------
  disponivel  ~~~~~~~~~~~~~         disponivel  \\
              estavel                            \\
                                                  \\
  espera final ~~~~~~~~~~~                          \\____ 0
              plato                    erro aparece aqui,
                                       minutos depois da
                                       mudanca de taxa

  A defasagem entre a mudanca de taxa e o erro e o que faz o
  incidente parecer desconectado de qualquer alteracao recente.`,
        },
        {
          type: 'paragraph',
          value:
            'A defasagem representada no diagrama é a razão pela qual esse incidente quase nunca é associado ao deploy que o causou. Se a faixa tem vinte e oito mil portas e o excesso é de cem conexões por segundo acima da taxa sustentável, o estoque leva quase cinco minutos para zerar. Se o excesso for de dez conexões por segundo, leva quase cinquenta minutos. Um deploy feito às dez horas produz erro às dez e cinquenta, e a essa altura ninguém mais está olhando para ele.',
        },
      ],
    },
    {
      title: 'A espera final não é desperdício, e encurtá-la tem preço',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira reação de quase todo time diante de milhares de soquetes em espera final é tratá-los como lixo acumulado e procurar a configuração que os elimina. Vale entender antes por que esse estado existe, porque ele resolve dois problemas concretos e desativá-lo sem saber disso troca um incidente visível por um incidente silencioso e muito pior de diagnosticar.',
        },
        {
          type: 'paragraph',
          value:
            'O primeiro problema é o do pacote atrasado. A rede pode entregar fora de ordem e com atraso arbitrário, então um segmento da conexão antiga pode chegar depois que ela foi encerrada. Se a mesma tupla de quatro elementos já tiver sido reutilizada por uma conexão nova, esse segmento atrasado é entregue à conexão errada, e o resultado é corrupção de dados no nível da aplicação, não erro de rede. A espera final mantém a tupla reservada por tempo suficiente para que qualquer pacote antigo já tenha expirado na rede.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo problema é o da confirmação perdida. Quem fecha ativamente precisa garantir que a confirmação final chegue ao outro lado, e se ela se perder o outro lado retransmite o pedido de fechamento. Sem a espera final, essa retransmissão chega a uma tupla que não existe mais e recebe uma recusa, o que faz o lado remoto encerrar a conexão de forma abrupta em vez de ordenada. Em um servidor que mantém estado por conexão, isso vira acúmulo de conexões meio abertas do outro lado do fio.',
        },
        {
          type: 'table',
          columns: ['Ajuste considerado', 'O que ele realmente faz', 'Risco que introduz', 'Quando é defensável'],
          rows: [
            [
              'Ampliar a faixa de portas efêmeras',
              'Aumenta o estoque, elevando a taxa sustentável na mesma proporção',
              'Conflito com portas de serviço fixas acima de trinta e dois mil',
              'Sempre, desde que a faixa não invada portas já usadas por serviços locais',
            ],
            [
              'Reutilizar soquete em espera final para conexão de saída',
              'Permite reusar a tupla quando a nova conexão é comprovadamente posterior',
              'Baixo em saída, exige marcação de tempo ativa nas duas pontas',
              'Ajuste padrão recomendado antes de qualquer outro',
            ],
            [
              'Reciclagem agressiva por origem',
              'Descarta conexões com marcação de tempo considerada antiga',
              'Quebra clientes atrás de tradução de endereço compartilhada',
              'Praticamente nunca: removido de núcleos recentes por causar mais dano que benefício',
            ],
            [
              'Reduzir o tempo de espera final',
              'Encurta a janela de proteção contra pacote atrasado',
              'Corrupção silenciosa em rede com reordenação real',
              'Rede interna controlada e de latência baixa, como último recurso',
            ],
            [
              'Reusar conexão em vez de abrir nova',
              'Elimina a criação de tuplas, atacando a causa',
              'Nenhum, além de exigir configuração correta de tempo ocioso',
              'Sempre: é a correção real, os demais são mitigação',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A hierarquia da tabela é deliberada. A última linha é a única correção que remove a causa, e as quatro anteriores compram tempo com graus diferentes de risco. Um time que aplica apenas as mitigações resolve o incidente de hoje e reencontra o mesmo problema quando o tráfego dobrar, com a diferença de que não sobra mais nenhum parâmetro para ajustar.',
        },
      ],
    },
    {
      title: 'O cliente que abre conexão nova a cada chamada é a causa em oito de cada dez casos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando a investigação chega ao código, o achado quase sempre é o mesmo: um cliente HTTP instanciado dentro da função que faz a chamada. Cada requisição cria um cliente, o cliente cria um pool próprio, o pool abre uma conexão, a resposta é lida e o cliente é descartado junto com a conexão. Do ponto de vista do desenvolvedor não há erro nenhum: o código é limpo, não tem estado global e não vaza memória. Do ponto de vista do sistema operacional, cada requisição de entrada acabou de consumir uma porta que ficará indisponível pelo próximo minuto.',
        },
        {
          type: 'paragraph',
          value:
            'Existe uma variação mais sutil que aparece em serviços que já usam cliente compartilhado e mesmo assim esgotam. O pool tem um limite de conexões ociosas mantidas, e quando esse limite é menor do que a concorrência real, as conexões que excedem o limite são fechadas em vez de devolvidas ao pool. O comportamento observado é um reuso parcial, com uma fração estável do tráfego abrindo conexão nova, e essa fração é suficiente para esgotar a faixa se a concorrência for alta. O sintoma distintivo é que o número de conexões em espera final cresce proporcionalmente ao tráfego, mas com um coeficiente menor que um.',
        },
        {
          type: 'code',
          value: `// Cliente HTTP com reuso real de conexao em Node.js.
// O ponto critico nao e criar o agente, e dimensionar as conexoes
// ociosas para acima da concorrencia esperada.

import http from 'node:http';
import https from 'node:https';

// Concorrencia media esperada por instancia contra este destino.
// Abaixo dela o pool fecha conexoes que seriam reutilizadas, e a
// fracao fechada vira consumo continuo de portas efemeras.
const CONCORRENCIA_ESPERADA = 64;

const opcoesDeAgente = {
  keepAlive: true,

  // Conexoes ociosas mantidas. Se ficar abaixo da concorrencia, o
  // excedente e fechado ao inves de devolvido, e cada fechamento
  // custa uma porta retida por toda a espera final.
  maxSockets: CONCORRENCIA_ESPERADA * 2,
  maxFreeSockets: CONCORRENCIA_ESPERADA,

  // Tempo ocioso antes de fechar. Precisa ser menor que o tempo de
  // ociosidade aceito pelo servidor remoto, senao o cliente reusa uma
  // conexao que a outra ponta ja fechou e recebe erro de socket morto.
  keepAliveMsecs: 15_000,
  timeout: 30_000,

  // Distribui as requisicoes entre as conexoes livres em vez de
  // empilhar tudo na primeira, o que mantem o pool aquecido por igual.
  scheduling: 'lifo',
};

export const agenteHttp = new http.Agent(opcoesDeAgente);
export const agenteHttps = new https.Agent(opcoesDeAgente);

/**
 * Cliente de modulo, criado uma vez. Criar por requisicao e o erro que
 * produz esgotamento de porta sem nenhum sintoma no codigo.
 */
export async function chamarServicoInterno(caminho, corpo) {
  const resposta = await fetch(\`https://servico-interno.local\${caminho}\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
    // Em Node, fetch usa o dispatcher global; para http/https nativos
    // o agente acima e passado diretamente nas opcoes da requisicao.
    dispatcher: undefined,
  });

  if (!resposta.ok) {
    // Ler o corpo mesmo em erro. Uma resposta cujo corpo nunca e
    // consumido pode manter a conexao ocupada ate o timeout, o que
    // reduz o pool efetivo e empurra o excedente para conexao nova.
    await resposta.text().catch(() => '');
    throw new Error(\`servico interno respondeu \${resposta.status}\`);
  }

  return resposta.json();
}`,
        },
        {
          type: 'paragraph',
          value:
            'O comentário sobre consumir o corpo da resposta mesmo em caso de erro não é detalhe de estilo. Uma conexão cujo corpo não foi lido até o fim não pode ser devolvida ao pool, porque o protocolo não sabe onde termina a mensagem anterior. Muitos clientes tratam isso fechando a conexão, e o resultado é que o caminho de erro do serviço consome portas em um ritmo muito maior do que o caminho de sucesso. Isso produz um comportamento de realimentação cruel: uma degradação parcial no destino aumenta a taxa de erro, a taxa de erro aumenta o consumo de portas, e o esgotamento de portas transforma a degradação parcial em indisponibilidade total.',
        },
        {
          type: 'paragraph',
          value:
            'O outro cuidado é o tempo ocioso. Se o cliente mantém a conexão por mais tempo do que o servidor remoto aceita, o servidor fecha primeiro e o cliente descobre isso apenas ao tentar usar a conexão, recebendo um erro de soquete encerrado. Times que encontram esse erro costumam desligar o reuso inteiro para fazê-lo sumir, o que reintroduz o esgotamento. A correção correta é manter o tempo ocioso do cliente confortavelmente abaixo do tempo aceito pelo servidor, com uma diferença de pelo menos cinco segundos para cobrir variação de relógio e atraso de rede.',
        },
      ],
    },
    {
      title: 'Tradução de endereço muda o dono do problema e o lugar onde ele aparece',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Em ambiente de contêiner e de nuvem, o tráfego de saída raramente vai direto da máquina para o destino. Ele passa por uma camada de tradução de endereço, seja o gateway da rede virtual, seja a regra local que mascara o endereço do contêiner pelo endereço do nó. Essa camada precisa alocar uma porta própria para cada conexão traduzida, e é essa alocação, não a do processo, que passa a ser o recurso escasso.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática é que o esgotamento deixa de ser um problema de uma máquina e passa a ser um problema compartilhado por todos os contêineres que saem pelo mesmo endereço traduzido. Um serviço barulhento pode consumir a faixa do gateway e derrubar conexões de serviços vizinhos que não mudaram nada, o que é exatamente o padrão de dano colateral que aparece em limite de taxa global. O diagnóstico fica mais difícil porque o erro aparece em um processo que não é o causador, e a métrica que explicaria o fenômeno está no gateway, geralmente fora do alcance do time de aplicação.',
        },
        {
          type: 'paragraph',
          value:
            'Existe ainda uma armadilha de contagem. Muitos gateways gerenciados publicam um número de portas por instância traduzida, e esse número é alocado em blocos por destino. Um serviço que conversa com poucos destinos, o caso comum de uma aplicação que fala com um banco gerenciado e um cache, consome um bloco inteiro por destino e atinge o teto com uma fração pequena do total anunciado. A leitura ingênua do número publicado leva o time a concluir que sobra capacidade enquanto o gateway já está recusando.',
        },
        {
          type: 'list',
          items: [
            'Mapeie por onde o tráfego de saída sai de fato: direto, por gateway gerenciado ou por mascaramento no nó, porque o recurso finito fica em lugares diferentes em cada caso.',
            'Prefira ponto de acesso privado ao destino quando ele existir, porque isso remove a tradução do caminho e devolve a contagem de portas para a própria máquina.',
            'Trate a faixa do gateway como recurso compartilhado com orçamento por serviço, não como capacidade infinita, e monitore a alocação por destino e não só o total.',
            'Distribua os destinos quando possível, porque cada endereço de destino distinto multiplica a capacidade de tuplas disponível sem nenhuma mudança de configuração.',
            'Verifique se a tradução está fazendo conexão de longa duração sobreviver ao tempo ocioso do próprio gateway, porque uma conexão derrubada silenciosamente vira reabertura e consumo de porta.',
          ],
        },
      ],
    },
    {
      title: 'A sequência de diagnóstico que separa fuga de demanda legítima',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Diante do erro, a tentação é ampliar a faixa de portas imediatamente. Isso funciona e é a coisa certa a fazer para conter o incidente, mas se for a única ação o problema volta com tráfego maior. A sequência abaixo é a que produz, no mesmo incidente, tanto a contenção quanto a evidência que orienta a correção definitiva.',
        },
        {
          type: 'ordered',
          items: [
            'Confirme o recurso que acabou contando soquetes por estado na máquina que emitiu o erro, não na máquina de destino. Um total em espera final próximo do tamanho da faixa confirma o diagnóstico em segundos e elimina toda a investigação de rede.',
            'Agrupe as conexões por endereço de destino. Se um destino concentra a maior parte, a correção é reuso de conexão naquele cliente específico; se estão espalhadas, o caminho é ampliar faixa e revisar o tempo de retenção.',
            'Compare a taxa de conexões novas por segundo com a taxa de requisições recebidas. Uma razão próxima de um é a assinatura de cliente sem reuso, e uma razão muito maior que um indica que cada requisição abre várias conexões, tipicamente por chamada em série a serviços distintos.',
            'Contenha ampliando a faixa efêmera e habilitando o reuso de soquete em espera final para conexões de saída, que é o ajuste de menor risco e devolve capacidade imediata sem tocar na janela de proteção do protocolo.',
            'Corrija a causa movendo o cliente para escopo de módulo com reuso de conexão habilitado, e dimensione as conexões ociosas acima da concorrência esperada para evitar o reuso parcial que engana o diagnóstico.',
            'Feche o ciclo instrumentando a métrica de portas em uso como fração da faixa, porque é ela que transforma o próximo episódio em alerta com antecedência de minutos em vez de erro sem aviso.',
          ],
        },
        {
          type: 'code',
          value: `#!/usr/bin/env bash
# Diagnostico de esgotamento de porta efemera.
# Rode na maquina que emitiu o erro de atribuicao de endereco.
set -euo pipefail

FAIXA=$(cat /proc/sys/net/ipv4/ip_local_port_range)
INICIO=$(echo "$FAIXA" | awk '{print $1}')
FIM=$(echo "$FAIXA" | awk '{print $2}')
TOTAL=$(( FIM - INICIO + 1 ))

echo "Faixa efemera: $INICIO-$FIM ($TOTAL portas)"
echo

# 1) Quantos soquetes existem em cada estado. Um valor de TIME-WAIT
#    proximo de TOTAL confirma o esgotamento sem ambiguidade.
echo "== Soquetes por estado =="
ss -tan | awk 'NR > 1 { print $1 }' | sort | uniq -c | sort -rn
echo

# 2) Para onde eles estao indo. Um destino dominante aponta o cliente
#    que precisa de reuso de conexao.
echo "== Top 10 destinos em TIME-WAIT =="
ss -tan state time-wait | awk 'NR > 1 { print $5 }' \\
  | sed 's/:[0-9]*$//' | sort | uniq -c | sort -rn | head -10
echo

# 3) Ocupacao efetiva da faixa. Acima de 80 por cento ja e alerta,
#    porque a margem restante some em segundos sob rajada.
EM_USO=$(ss -tan | awk 'NR > 1 { print $4 }' \\
  | sed 's/.*://' | awk -v i="$INICIO" -v f="$FIM" \\
    '$1 >= i && $1 <= f { c++ } END { print c + 0 }')
PCT=$(awk -v e="$EM_USO" -v t="$TOTAL" 'BEGIN { printf "%.1f", (e / t) * 100 }')
echo "== Ocupacao =="
echo "Portas em uso na faixa: $EM_USO de $TOTAL ($PCT%)"
echo

# 4) Ajustes vigentes que mudam a taxa de reciclagem.
echo "== Parametros relevantes =="
echo "tcp_tw_reuse: $(cat /proc/sys/net/ipv4/tcp_tw_reuse)"
echo "tcp_fin_timeout: $(cat /proc/sys/net/ipv4/tcp_fin_timeout)"
echo "somaxconn: $(cat /proc/sys/net/core/somaxconn)"`,
        },
        {
          type: 'paragraph',
          value:
            'O terceiro bloco desse script é o que costuma ser adaptado para virar métrica permanente. Exportar a ocupação da faixa como um valor percentual e alertar em oitenta por cento dá uma antecedência que varia de minutos a dezenas de minutos, dependendo da velocidade de consumo, e é sempre maior que zero, que é a antecedência que o time tem hoje. Vale exportar junto a contagem agrupada por destino, porque quando o alerta disparar a primeira pergunta será para onde as conexões estão indo, e ter a resposta pronta economiza a parte mais demorada do diagnóstico.',
        },
        {
          type: 'paragraph',
          value:
            'Uma observação sobre o segundo passo que evita uma conclusão errada frequente. Um total alto em espera final não é por si só um problema: ele é o resultado esperado de um serviço que fecha muitas conexões ativamente e indica apenas que o fechamento está acontecendo do lado certo. O que caracteriza o incidente é a proporção entre esse total e o tamanho da faixa. Vinte mil soquetes em espera final com uma faixa de sessenta mil é operação normal, e os mesmos vinte mil com uma faixa de vinte e dois mil é um serviço a minutos de parar.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Ampliar a faixa de portas efêmeras para o máximo possível tem alguma desvantagem?',
      answer:
        'Tem uma, e ela é concreta o suficiente para merecer verificação antes de aplicar o ajuste em produção. A faixa efêmera é o conjunto de portas que o núcleo escolhe automaticamente quando ninguém pede uma porta específica, e ampliar o início dela para valores baixos faz com que o núcleo possa atribuir a uma conexão de saída exatamente a porta que algum serviço local pretende usar como porta de escuta. O resultado é um serviço que falha ao iniciar dizendo que o endereço já está em uso, de forma intermitente e dependente do momento do reinício, que é um dos modos de falha mais difíceis de reproduzir que existem. O procedimento seguro tem três partes. A primeira é inventariar todas as portas fixas usadas na máquina, incluindo as de agentes de monitoramento, as de ferramentas de depuração e as de qualquer serviço auxiliar que costuma ficar acima de trinta mil, porque a colisão quase sempre acontece nessa faixa alta e não nas portas conhecidas abaixo de mil. A segunda é declarar essas portas como reservadas no parâmetro apropriado do núcleo, o que faz a alocação automática pular exatamente esses valores mesmo que eles estejam dentro da faixa ampliada, resolvendo o conflito sem abrir mão da capacidade. A terceira é ampliar a faixa começando pelo limite superior, que costuma ser seguro por padrão, antes de mexer no limite inferior, onde mora o risco. Com esses cuidados, uma faixa que vai de dez mil a sessenta e cinco mil é perfeitamente operável e mais que dobra a taxa sustentável de conexões novas. Vale lembrar que essa ampliação continua sendo mitigação: ela empurra o ponto de saturação para frente, e o serviço que abre uma conexão nova por requisição vai reencontrá-lo com o dobro do tráfego.',
    },
    {
      question: 'Como isso aparece em um cluster de contêineres, onde cada pod tem a própria pilha de rede?',
      answer:
        'Aparece de três formas distintas, e confundi-las é o que faz o diagnóstico demorar. A primeira forma é a mais parecida com o caso tradicional: quando o pod tem o próprio espaço de rede com endereço roteável, a faixa efêmera é a do espaço de rede dele e o esgotamento é local, o que na prática é uma boa notícia porque isola o dano ao serviço causador e mantém o diagnóstico dentro do alcance do time. A segunda forma acontece quando a saída passa por mascaramento no nó, que é o padrão de muitas instalações: aí o recurso finito é a faixa do nó, compartilhada por todos os pods que saem por ele, e um serviço barulhento derruba vizinhos que não mudaram nada. O sintoma característico é o erro aparecer em pods de aplicações diferentes ao mesmo tempo, sem correlação entre elas a não ser o nó em que rodam, e a confirmação vem de contar as conexões no espaço de rede do nó em vez do pod. A terceira forma é a do gateway gerenciado de saída da nuvem, onde a alocação é feita em blocos por destino e o teto anunciado nunca é atingível na prática por um serviço que fala com poucos destinos; nesse caso a métrica que importa não existe dentro do cluster e precisa vir do provedor. As correções acompanham a forma: para a primeira, ajuste da faixa no espaço de rede do pod e reuso de conexão no cliente; para a segunda, a mesma coisa no nó mais um orçamento de conexões por pod para que o isolamento não dependa de boa vontade; para a terceira, ponto de acesso privado ao destino, que remove a tradução do caminho e é quase sempre também mais barato e mais rápido do que sair pela internet.',
    },
    {
      question: 'O mesmo problema existe em conexões de banco de dados com pool, ou o pool já resolve?',
      answer:
        'O pool resolve o caso normal e deixa passar três situações que produzem exatamente o mesmo esgotamento, e todas as três são comuns o bastante para valer a verificação. A primeira é o pool com validação agressiva, configurado para descartar e recriar conexões ociosas em intervalos curtos como forma de evitar conexões mortas. Se o intervalo for de poucos minutos e o pool tiver dezenas de conexões por instância, com dezenas de instâncias, a taxa de recriação vira um fluxo constante de tuplas novas para o mesmo destino, que é a pior configuração possível para porta efêmera. A segunda é o pool com tempo de vida máximo por conexão, um ajuste legítimo para permitir que mudanças de destino sejam absorvidas depois de um failover, mas que precisa vir com dispersão aleatória: sem ela todas as conexões criadas no mesmo momento do deploy expiram no mesmo momento, e a instância recria o pool inteiro de uma vez em uma rajada que pode consumir uma fração relevante da faixa em um segundo. A terceira, e a mais frequente, é o pool que não cobre todo o tráfego: consultas passam pelo pool, mas a migração, o script de manutenção, o processo de relatório e a verificação de saúde abrem conexões próprias fora dele, e uma verificação de saúde que abre e fecha uma conexão a cada cinco segundos por instância produz, com cem instâncias, vinte conexões novas por segundo para o mesmo destino sem que nenhuma métrica de aplicação registre isso. A recomendação prática é fazer a verificação de saúde reutilizar uma conexão do próprio pool em vez de abrir a sua, dispersar o tempo de vida máximo com uma variação aleatória de pelo menos dez por cento, e contar as conexões por destino em vez de confiar na métrica de conexões ativas do pool, que só enxerga o que passa por ele.',
    },
  ],
  conclusion: {
    title: 'Porta efêmera é capacidade, e capacidade que ninguém mede é capacidade que acaba sem aviso',
    description:
      'O esgotamento de porta de saída é o incidente que quebra um serviço saudável sem mover nenhum dos quatro indicadores que o painel mostra, e que se disfarça de problema de rede porque a mensagem de erro fala em endereço quando a causa é taxa de reciclagem. Entender que a capacidade é a faixa dividida pelo tempo de retenção, e multiplicada pelo número de destinos distintos, transforma uma discussão vaga em um limite comparável com a métrica de requisições. Ampliar a faixa contém, reusar conexão corrige, e medir a ocupação como fração da faixa é o que troca um erro sem aviso por um alerta com minutos de antecedência. Posso levantar onde o seu tráfego de saída realmente sai, calcular a taxa sustentável por destino, corrigir os clientes que abrem conexão por requisição e instrumentar os indicadores que dão antecedência antes do próximo episódio.',
    cta: 'Falar sobre a capacidade de saída do meu serviço',
  },
  related: [
    {
      label: 'Limite de conexões do banco esgotado: quando o pool vira o gargalo',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Timeout em cascata: quando o retry do cliente derruba o serviço',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'Observabilidade e Confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The service started returning connection errors at eleven twenty on an ordinary Tuesday, with no traffic spike, no deploy, no CPU alert and the database answering in two milliseconds. The log said the requested address could not be assigned, the team restarted the process, everything came back for forty minutes and broke again in the same shape. What was running out was not memory, nor database connections, nor file descriptors: it was outbound ports, a finite resource almost nobody sizes and nobody monitors until the day it runs out. This article shows why ephemeral port exhaustion is invisible on the usual dashboards and why the inbound traffic graph stays flat while it happens, which tuple actually defines capacity and why the port count is only one of four factors, why the final wait state exists and what shortening it really breaks, why an HTTP client without connection reuse is the cause in eight out of ten incidents and what changes when address translation sits in the path, which diagnostic sequence separates a connection leak from legitimate demand, and which indicators give enough warning to act before the first error.',
  sections: [
    {
      title: 'The resource that runs out first shows up on no standard dashboard',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every service dashboard measures the same four things: processor usage, memory usage, latency and error rate. When ephemeral ports run out, three of those four stay exactly where they were. The processor stays low because the process is not working, it is failing early. Memory does not move because no new allocation happened. The latency of what still gets through remains normal because the service answering is healthy. Only the error rate rises, and it rises with a message that is rarely associated with its real cause, because the message talks about an address while the cause is about a port.',
        },
        {
          type: 'paragraph',
          value:
            'The message the operating system returns is that the requested address could not be assigned. It is produced at the moment the process asks for an outbound connection and the kernel finds no free source port to bind to it. Nothing in that sentence mentions ports, exhaustion or limits, and that is why the error is so often diagnosed as a network, DNS or firewall problem. The team looks outward while the resource that ran out is inside the machine itself.',
        },
        {
          type: 'paragraph',
          value:
            'The second unpleasant property of this incident is the shape of the recovery. Restarting the process works, because the restart closes every socket the process opened and releases the associated ports. That creates a misleading narrative inside the team: the problem is fixed by a restart, therefore it must be a memory leak, or some corrupted state, or a defective library. In reality the restart is merely returning the resource to the system, and the interval between restarts is exactly how long the service takes to consume the whole port range again. A stable forty minute interval between failures is a strong signature of this exhaustion, because it indicates linear consumption of a finite resource rather than a random defect.',
        },
        {
          type: 'table',
          columns: ['Observed symptom', 'Usual team diagnosis', 'Real cause when it is ephemeral ports', 'Check that separates the two'],
          rows: [
            [
              'Address assignment error on outbound calls',
              'Network or name resolution problem',
              'No free source port in the configured range',
              'Count sockets by state on the source machine, not test connectivity',
            ],
            [
              'Restart fixes it for tens of minutes and the error returns',
              'Memory leak or corrupted state',
              'Linear consumption of the range up to the limit, reset by the restart',
              'Measure the interval between failures: a stable one indicates a finite resource',
            ],
            [
              'Inbound traffic flat throughout the incident',
              'Failure of the destination service',
              'Each inbound request opens several new outbound connections',
              'Compare requests per second with outbound connections per second',
            ],
            [
              'Thousands of sockets in the final wait state',
              'Stuck connections that need to be killed',
              'Normal protocol behavior after an active close',
              'Check whether the total approaches the size of the port range',
            ],
            [
              'Only one instance fails while the others stay fine',
              'Defective instance, just replace it',
              'Uneven distribution of destinations across instances',
              'Group connections by destination address on each instance',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row of the table is the one that delays diagnosis the most in an environment with several replicas. Because exhaustion depends on the combination of source and destination, and not only on total volume, it is entirely possible for an instance that talks predominantly to a single destination to break while its neighbors, under the same load but with more spread out destinations, stay healthy. Replacing the instance makes the symptom disappear for a few minutes and reinforces the wrong conclusion that the machine was the problem.',
        },
      ],
    },
    {
      title: 'Real capacity is a four element tuple, not a port count',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The intuition that there are sixty odd thousand ports and therefore sixty odd thousand connections fit is wrong in two directions at once, and understanding why is what allows correct sizing. A connection is identified by four values: source address, source port, destination address and destination port. What has to be unique in the system is the combination of the four, and not the source port on its own.',
        },
        {
          type: 'paragraph',
          value:
            'That means the same source port can be reused for different destinations with no conflict at all. A machine with thirty thousand available ephemeral ports can hold thirty thousand connections to a database and another thirty thousand to a payment service simultaneously, because the tuples differ in the destination address. The practical limit is therefore not per machine: it is per source and destination pair. A service that talks to a single destination has the lowest possible capacity, and a service that spreads calls across many destinations has far greater capacity without changing anything in the configuration.',
        },
        {
          type: 'paragraph',
          value:
            'In the opposite direction, effective capacity is smaller than the range suggests because of retention time. A released port does not return to the available pool immediately: it stays held during the final wait state, which on Linux derived systems lasts sixty seconds by default. The calculation that matters is not how many ports exist, but how many new connections per second can be opened to the same destination without the creation rate exceeding the release rate. The number is simple and usually surprising: the range divided by the retention time.',
        },
        {
          type: 'code',
          value: `// New connections per second capacity toward a single destination.
// The limit is not the number of ports, it is their recycling rate.

/**
 * @param {number} portaInicial first value of the ephemeral range
 * @param {number} portaFinal   last value of the ephemeral range
 * @param {number} retencaoSeg  seconds in the final wait state after closing
 * @param {number} destinos     how many distinct address:port pairs receive traffic
 */
export function capacidadeDeConexoesNovas({
  portaInicial = 32768,
  portaFinal = 60999,
  retencaoSeg = 60,
  destinos = 1,
}) {
  const faixa = portaFinal - portaInicial + 1;

  // Per distinct destination the whole range becomes available again,
  // because the required uniqueness is that of the four element tuple
  // and not that of the port.
  const portasUteis = faixa * destinos;

  // A port closed actively only returns to the pool after the final
  // wait. In steady state the sustainable rate is the ratio between
  // the stock and the time each unit stays unavailable.
  const novasPorSegundo = Math.floor(portasUteis / retencaoSeg);

  return {
    faixa,
    portasUteis,
    novasPorSegundo,
    // Saturation point: above this the stock shrinks every second
    // until it hits zero, and the error appears when it does, not
    // when the rate goes up.
    observacao: \`Above \${novasPorSegundo} new connections per second toward \${destinos} destination(s), the port stock shrinks monotonically.\`,
  };
}

// Typical case of a service talking to a single internal balancer:
// 28232 ports / 60s = 470 new connections per second.
// A service serving 500 req/s that opens a new connection per request
// is already past the saturation point, with inbound traffic any
// dashboard would consider low.`,
        },
        {
          type: 'paragraph',
          value:
            'The result of that calculation is the most useful number of the entire incident, because it turns a vague discussion about load into a concrete limit that can be compared against the request metric. A default range of twenty eight thousand ports with sixty seconds of retention sustains a little under five hundred new connections per second toward the same destination. A service receiving five hundred requests per second that opens a new connection for each of them is exactly at the tipping point, and any five percent growth in traffic starts consuming stock instead of recycling it.',
        },
        {
          type: 'diagram',
          value: `PORT STOCK IN STEADY STATE

  range = 28,232 ports    retention = 60s
  sustainable rate = 28,232 / 60 = 470 new connections/s

  open rate < 470/s                 open rate > 470/s
  -----------------------           -----------------------
  available   ~~~~~~~~~~~~~         available   \\
              stable                             \\
                                                  \\
  final wait  ~~~~~~~~~~~                           \\____ 0
              plateau                  error shows up here,
                                       minutes after the
                                       rate changed

  The lag between the rate change and the error is what makes the
  incident look disconnected from any recent change.`,
        },
        {
          type: 'paragraph',
          value:
            'The lag drawn in the diagram is why this incident is almost never associated with the deploy that caused it. If the range has twenty eight thousand ports and the excess is one hundred connections per second above the sustainable rate, the stock takes almost five minutes to reach zero. If the excess is ten connections per second, it takes almost fifty minutes. A deploy at ten in the morning produces an error at ten fifty, and by then nobody is looking at it anymore.',
        },
      ],
    },
    {
      title: 'The final wait state is not waste, and shortening it has a price',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first reaction of nearly every team faced with thousands of sockets in the final wait state is to treat them as accumulated garbage and look for the setting that removes them. It is worth understanding first why that state exists, because it solves two concrete problems and disabling it without knowing that trades a visible incident for a silent one that is far worse to diagnose.',
        },
        {
          type: 'paragraph',
          value:
            'The first problem is the delayed packet. The network can deliver out of order and with arbitrary delay, so a segment of the old connection may arrive after it was terminated. If the same four element tuple has already been reused by a new connection, that delayed segment is delivered to the wrong connection, and the result is data corruption at the application level, not a network error. The final wait keeps the tuple reserved long enough for any old packet to have expired on the network.',
        },
        {
          type: 'paragraph',
          value:
            'The second problem is the lost acknowledgment. Whoever closes actively has to guarantee the final acknowledgment reaches the other side, and if it is lost the other side retransmits the close request. Without the final wait, that retransmission reaches a tuple that no longer exists and receives a refusal, which makes the remote side terminate the connection abruptly instead of orderly. On a server that keeps per connection state, that turns into an accumulation of half open connections on the other end of the wire.',
        },
        {
          type: 'table',
          columns: ['Considered adjustment', 'What it actually does', 'Risk it introduces', 'When it is defensible'],
          rows: [
            [
              'Widen the ephemeral port range',
              'Increases the stock, raising the sustainable rate proportionally',
              'Conflict with fixed service ports above thirty two thousand',
              'Always, provided the range does not invade ports already used by local services',
            ],
            [
              'Reuse a socket in final wait for an outbound connection',
              'Allows reusing the tuple when the new connection is provably later',
              'Low on the outbound side, requires active timestamps on both ends',
              'The default adjustment to recommend before any other',
            ],
            [
              'Aggressive recycling by source',
              'Discards connections whose timestamp is considered old',
              'Breaks clients behind shared address translation',
              'Practically never: removed from recent kernels for causing more harm than good',
            ],
            [
              'Reduce the final wait time',
              'Shortens the protection window against delayed packets',
              'Silent corruption on a network with real reordering',
              'Controlled low latency internal network, as a last resort',
            ],
            [
              'Reuse connections instead of opening new ones',
              'Eliminates tuple creation, attacking the cause',
              'None, beyond requiring correct idle timeout configuration',
              'Always: it is the real fix, the others are mitigation',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The hierarchy in the table is deliberate. The last row is the only fix that removes the cause, and the four before it buy time at different degrees of risk. A team that applies only the mitigations fixes today incident and meets the same problem when traffic doubles, with the difference that there is no parameter left to tune.',
        },
      ],
    },
    {
      title: 'The client that opens a new connection per call is the cause in eight out of ten cases',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When the investigation reaches the code, the finding is almost always the same: an HTTP client instantiated inside the function that makes the call. Each request creates a client, the client creates its own pool, the pool opens a connection, the response is read and the client is discarded along with the connection. From the developer point of view there is no mistake at all: the code is clean, has no global state and leaks no memory. From the operating system point of view, each inbound request has just consumed a port that will be unavailable for the next minute.',
        },
        {
          type: 'paragraph',
          value:
            'There is a subtler variation that shows up in services that already use a shared client and still exhaust the range. The pool has a limit of idle connections it keeps, and when that limit is lower than real concurrency, the connections exceeding it are closed instead of returned to the pool. The observed behavior is partial reuse, with a stable fraction of traffic opening new connections, and that fraction is enough to exhaust the range if concurrency is high. The distinctive symptom is that the number of connections in final wait grows proportionally to traffic, but with a coefficient below one.',
        },
        {
          type: 'code',
          value: `// HTTP client with real connection reuse in Node.js.
// The critical point is not creating the agent, it is sizing the idle
// connections above expected concurrency.

import http from 'node:http';
import https from 'node:https';

// Average expected concurrency per instance toward this destination.
// Below it the pool closes connections that would be reused, and the
// closed fraction becomes continuous ephemeral port consumption.
const CONCORRENCIA_ESPERADA = 64;

const opcoesDeAgente = {
  keepAlive: true,

  // Idle connections kept. If it stays below concurrency, the excess
  // is closed instead of returned, and each close costs a port held
  // for the whole final wait.
  maxSockets: CONCORRENCIA_ESPERADA * 2,
  maxFreeSockets: CONCORRENCIA_ESPERADA,

  // Idle time before closing. It has to be shorter than the idle time
  // the remote server accepts, otherwise the client reuses a connection
  // the other end already closed and gets a dead socket error.
  keepAliveMsecs: 15_000,
  timeout: 30_000,

  // Spreads requests across free connections instead of piling them on
  // the first one, which keeps the pool evenly warm.
  scheduling: 'lifo',
};

export const agenteHttp = new http.Agent(opcoesDeAgente);
export const agenteHttps = new https.Agent(opcoesDeAgente);

/**
 * Module level client, created once. Creating it per request is the
 * mistake that produces port exhaustion with no symptom in the code.
 */
export async function chamarServicoInterno(caminho, corpo) {
  const resposta = await fetch(\`https://servico-interno.local\${caminho}\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
    // In Node, fetch uses the global dispatcher; for native http/https
    // the agent above is passed directly in the request options.
    dispatcher: undefined,
  });

  if (!resposta.ok) {
    // Read the body even on error. A response whose body is never
    // consumed can keep the connection busy until the timeout, which
    // shrinks the effective pool and pushes the excess to new
    // connections.
    await resposta.text().catch(() => '');
    throw new Error(\`internal service answered \${resposta.status}\`);
  }

  return resposta.json();
}`,
        },
        {
          type: 'paragraph',
          value:
            'The comment about consuming the response body even on error is not a style detail. A connection whose body was not read to the end cannot be returned to the pool, because the protocol does not know where the previous message ended. Many clients handle that by closing the connection, and the result is that the error path of the service consumes ports at a much higher rate than the success path. That produces a cruel feedback behavior: a partial degradation at the destination raises the error rate, the error rate raises port consumption, and port exhaustion turns the partial degradation into total unavailability.',
        },
        {
          type: 'paragraph',
          value:
            'The other concern is idle time. If the client keeps the connection longer than the remote server accepts, the server closes first and the client only discovers that when trying to use the connection, getting a closed socket error. Teams that hit that error usually turn reuse off entirely to make it go away, which reintroduces the exhaustion. The correct fix is keeping the client idle time comfortably below the time the server accepts, with a gap of at least five seconds to cover clock drift and network delay.',
        },
      ],
    },
    {
      title: 'Address translation changes who owns the problem and where it appears',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In container and cloud environments, outbound traffic rarely goes straight from the machine to the destination. It passes through an address translation layer, whether the virtual network gateway or the local rule that masquerades the container address behind the node address. That layer has to allocate a port of its own for every translated connection, and it is that allocation, not the process one, that becomes the scarce resource.',
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence is that exhaustion stops being one machine problem and becomes a problem shared by every container leaving through the same translated address. A noisy service can consume the gateway range and take down connections of neighboring services that changed nothing, which is exactly the collateral damage pattern that shows up in global rate limiting. Diagnosis gets harder because the error appears in a process that is not the culprit, and the metric that would explain the phenomenon lives on the gateway, usually out of reach of the application team.',
        },
        {
          type: 'paragraph',
          value:
            'There is also a counting trap. Many managed gateways publish a port count per translated instance, and that count is allocated in blocks per destination. A service talking to few destinations, the common case of an application talking to a managed database and a cache, consumes a whole block per destination and reaches the ceiling with a small fraction of the advertised total. A naive reading of the published number leads the team to conclude there is spare capacity while the gateway is already refusing.',
        },
        {
          type: 'list',
          items: [
            'Map how outbound traffic actually leaves: directly, through a managed gateway or through masquerading on the node, because the finite resource sits in a different place in each case.',
            'Prefer a private endpoint to the destination when one exists, because it removes translation from the path and returns port accounting to the machine itself.',
            'Treat the gateway range as a shared resource with a per service budget, not as infinite capacity, and monitor allocation per destination rather than only the total.',
            'Spread destinations when possible, because every distinct destination address multiplies the available tuple capacity with no configuration change at all.',
            'Check whether translation lets long lived connections survive the gateway own idle timeout, because a silently dropped connection becomes a reopen and port consumption.',
          ],
        },
      ],
    },
    {
      title: 'The diagnostic sequence that separates a leak from legitimate demand',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Faced with the error, the temptation is to widen the port range immediately. That works and is the right thing to do to contain the incident, but if it is the only action the problem comes back with more traffic. The sequence below produces, within the same incident, both the containment and the evidence that guides the definitive fix.',
        },
        {
          type: 'ordered',
          items: [
            'Confirm which resource ran out by counting sockets per state on the machine that emitted the error, not on the destination machine. A final wait total close to the range size confirms the diagnosis in seconds and eliminates the entire network investigation.',
            'Group connections by destination address. If one destination concentrates most of them, the fix is connection reuse in that specific client; if they are spread out, the path is widening the range and revisiting retention time.',
            'Compare the new connections per second rate with the received requests rate. A ratio close to one is the signature of a client without reuse, and a ratio much greater than one indicates each request opens several connections, typically through serial calls to distinct services.',
            'Contain by widening the ephemeral range and enabling socket reuse in final wait for outbound connections, which is the lowest risk adjustment and returns immediate capacity without touching the protocol protection window.',
            'Fix the cause by moving the client to module scope with connection reuse enabled, and size the idle connections above expected concurrency to avoid the partial reuse that misleads the diagnosis.',
            'Close the loop by instrumenting the ports in use metric as a fraction of the range, because that is what turns the next episode into an alert with minutes of warning instead of an error with none.',
          ],
        },
        {
          type: 'code',
          value: `#!/usr/bin/env bash
# Ephemeral port exhaustion diagnosis.
# Run it on the machine that emitted the address assignment error.
set -euo pipefail

FAIXA=$(cat /proc/sys/net/ipv4/ip_local_port_range)
INICIO=$(echo "$FAIXA" | awk '{print $1}')
FIM=$(echo "$FAIXA" | awk '{print $2}')
TOTAL=$(( FIM - INICIO + 1 ))

echo "Ephemeral range: $INICIO-$FIM ($TOTAL ports)"
echo

# 1) How many sockets exist in each state. A TIME-WAIT value close to
#    TOTAL confirms the exhaustion with no ambiguity.
echo "== Sockets per state =="
ss -tan | awk 'NR > 1 { print $1 }' | sort | uniq -c | sort -rn
echo

# 2) Where they are going. A dominant destination points at the client
#    that needs connection reuse.
echo "== Top 10 destinations in TIME-WAIT =="
ss -tan state time-wait | awk 'NR > 1 { print $5 }' \\
  | sed 's/:[0-9]*$//' | sort | uniq -c | sort -rn | head -10
echo

# 3) Effective range occupancy. Above 80 percent is already an alert,
#    because the remaining margin disappears in seconds under a burst.
EM_USO=$(ss -tan | awk 'NR > 1 { print $4 }' \\
  | sed 's/.*://' | awk -v i="$INICIO" -v f="$FIM" \\
    '$1 >= i && $1 <= f { c++ } END { print c + 0 }')
PCT=$(awk -v e="$EM_USO" -v t="$TOTAL" 'BEGIN { printf "%.1f", (e / t) * 100 }')
echo "== Occupancy =="
echo "Ports in use within the range: $EM_USO of $TOTAL ($PCT%)"
echo

# 4) Current settings that change the recycling rate.
echo "== Relevant parameters =="
echo "tcp_tw_reuse: $(cat /proc/sys/net/ipv4/tcp_tw_reuse)"
echo "tcp_fin_timeout: $(cat /proc/sys/net/ipv4/tcp_fin_timeout)"
echo "somaxconn: $(cat /proc/sys/net/core/somaxconn)"`,
        },
        {
          type: 'paragraph',
          value:
            'The third block of that script is the one usually adapted into a permanent metric. Exporting range occupancy as a percentage and alerting at eighty percent gives a warning that ranges from minutes to tens of minutes depending on consumption speed, and it is always greater than zero, which is the warning the team has today. It is worth exporting the count grouped by destination alongside it, because when the alert fires the first question will be where the connections are going, and having the answer ready saves the slowest part of the diagnosis.',
        },
        {
          type: 'paragraph',
          value:
            'One note about the second step that avoids a frequent wrong conclusion. A high total in final wait is not a problem in itself: it is the expected result of a service that closes many connections actively and indicates only that the closing is happening on the right side. What characterizes the incident is the proportion between that total and the size of the range. Twenty thousand sockets in final wait with a range of sixty thousand is normal operation, and the same twenty thousand with a range of twenty two thousand is a service minutes away from stopping.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does widening the ephemeral port range to the maximum have any downside?',
      answer:
        'It has one, and it is concrete enough to deserve verification before applying the change in production. The ephemeral range is the set of ports the kernel picks automatically when nobody asks for a specific one, and widening its lower bound to low values means the kernel may assign to an outbound connection exactly the port some local service intends to use as a listening port. The result is a service that fails to start saying the address is already in use, intermittently and depending on the moment of the restart, which is one of the hardest failure modes to reproduce that exists. The safe procedure has three parts. The first is inventorying every fixed port used on the machine, including those of monitoring agents, debugging tools and any auxiliary service that tends to sit above thirty thousand, because the collision almost always happens in that high range and not in the well known ports below one thousand. The second is declaring those ports as reserved in the appropriate kernel parameter, which makes automatic allocation skip exactly those values even if they fall inside the widened range, solving the conflict without giving up capacity. The third is widening the range starting from the upper bound, which is usually safe by default, before touching the lower bound, where the risk lives. With those precautions, a range from ten thousand to sixty five thousand is perfectly operable and more than doubles the sustainable rate of new connections. It is worth remembering that this widening is still mitigation: it pushes the saturation point forward, and a service that opens a new connection per request will meet it again at twice the traffic.',
    },
    {
      question: 'How does this show up in a container cluster, where each pod has its own network stack?',
      answer:
        'It shows up in three distinct forms, and confusing them is what makes diagnosis slow. The first form is the closest to the traditional case: when the pod has its own network namespace with a routable address, the ephemeral range is that of its namespace and the exhaustion is local, which in practice is good news because it isolates the damage to the causing service and keeps the diagnosis within reach of the team. The second form happens when outbound traffic goes through masquerading on the node, which is the default of many installations: then the finite resource is the node range, shared by every pod leaving through it, and a noisy service takes down neighbors that changed nothing. The characteristic symptom is the error appearing in pods of different applications at the same time, with no correlation between them other than the node they run on, and confirmation comes from counting connections in the node network namespace rather than the pod one. The third form is the managed cloud egress gateway, where allocation happens in blocks per destination and the advertised ceiling is never reachable in practice by a service talking to few destinations; in that case the metric that matters does not exist inside the cluster and has to come from the provider. The fixes follow the form: for the first, adjusting the range in the pod namespace and connection reuse in the client; for the second, the same thing on the node plus a per pod connection budget so isolation does not depend on good will; for the third, a private endpoint to the destination, which removes translation from the path and is almost always cheaper and faster than going out over the internet.',
    },
    {
      question: 'Does the same problem exist with pooled database connections, or does the pool already solve it?',
      answer:
        'The pool solves the normal case and lets three situations through that produce exactly the same exhaustion, and all three are common enough to be worth checking. The first is a pool with aggressive validation, configured to discard and recreate idle connections at short intervals as a way of avoiding dead connections. If the interval is a few minutes and the pool has dozens of connections per instance, across dozens of instances, the recreation rate becomes a constant flow of new tuples toward the same destination, which is the worst possible configuration for ephemeral ports. The second is a pool with a maximum connection lifetime, a legitimate setting to let destination changes be absorbed after a failover, but one that has to come with random jitter: without it every connection created at the same deploy moment expires at the same moment, and the instance recreates the whole pool at once in a burst that can consume a relevant fraction of the range in one second. The third, and the most frequent, is the pool that does not cover all traffic: queries go through the pool, but the migration, the maintenance script, the reporting process and the health check open their own connections outside it, and a health check that opens and closes a connection every five seconds per instance produces, with a hundred instances, twenty new connections per second toward the same destination without any application metric recording it. The practical recommendation is making the health check reuse a connection from the pool itself instead of opening its own, jittering the maximum lifetime by at least ten percent, and counting connections per destination rather than trusting the pool active connections metric, which only sees what goes through it.',
    },
  ],
  conclusion: {
    title: 'Ephemeral ports are capacity, and capacity nobody measures is capacity that runs out with no warning',
    description:
      'Outbound port exhaustion is the incident that breaks a healthy service without moving any of the four indicators the dashboard shows, and that disguises itself as a network problem because the error message talks about an address when the cause is a recycling rate. Understanding that capacity is the range divided by the retention time, multiplied by the number of distinct destinations, turns a vague discussion into a limit comparable against the request metric. Widening the range contains it, reusing connections fixes it, and measuring occupancy as a fraction of the range is what trades an error with no warning for an alert with minutes of lead time. I can map where your outbound traffic actually leaves, compute the sustainable rate per destination, fix the clients that open a connection per request and instrument the indicators that give lead time before the next episode.',
    cta: 'Talk about my service outbound capacity',
  },
  related: [
    {
      label: 'Exhausted database connection limits: when the pool becomes the bottleneck',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Cascading timeouts: when the client retry takes down the service',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'Observability and Reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'El servicio empezó a devolver errores de conexión a las once y veinte de un martes cualquiera, sin pico de tráfico, sin despliegue, sin alerta de CPU y con la base respondiendo en dos milisegundos. El log decía que no fue posible asignar la dirección solicitada, el equipo reinició el proceso, todo volvió durante cuarenta minutos y se rompió de nuevo con la misma forma. Lo que se estaba agotando no era memoria, ni conexiones de base, ni descriptores de archivo: eran puertos de salida, un recurso finito que casi nadie dimensiona y que nadie monitorea hasta el día en que se acaba. Este artículo muestra por qué el agotamiento de puertos efímeros es invisible en los paneles habituales y por qué el gráfico de tráfico de entrada permanece plano mientras ocurre, cuál es la tupla que realmente define la capacidad y por qué el número de puertos es solo uno de cuatro factores, por qué existe el estado de espera final y qué rompe de verdad acortarlo, por qué el cliente HTTP sin reutilización de conexión es la causa en ocho de cada diez incidentes y qué cambia cuando hay traducción de direcciones en el camino, cuál es la secuencia de diagnóstico que separa una fuga de conexiones de demanda legítima, y qué indicadores dan anticipación suficiente para actuar antes del primer error.',
  sections: [
    {
      title: 'El recurso que se agota primero no aparece en ningún panel estándar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo panel de servicio mide las mismas cuatro cosas: uso de procesador, uso de memoria, latencia y tasa de error. Cuando los puertos efímeros se agotan, tres de esas cuatro permanecen exactamente donde estaban. El procesador queda bajo porque el proceso no está trabajando, está fallando temprano. La memoria no se mueve porque no ocurrió ninguna asignación nueva. La latencia de lo que todavía pasa sigue normal porque el servicio que responde está sano. Solo la tasa de error sube, y sube con un mensaje que rara vez se asocia a su causa real, porque el mensaje habla de dirección y la causa habla de puerto.',
        },
        {
          type: 'paragraph',
          value:
            'El mensaje que devuelve el sistema operativo es que no fue posible asignar la dirección solicitada. Se genera en el momento en que el proceso pide una conexión de salida y el núcleo no encuentra ningún puerto de origen libre para asociar a esa conexión. Nada en esa frase menciona puerto, agotamiento ni límite, y por eso el error se diagnostica tan a menudo como problema de red, de DNS o de cortafuegos. El equipo mira hacia afuera cuando el recurso que se acabó está dentro de la propia máquina.',
        },
        {
          type: 'paragraph',
          value:
            'La segunda propiedad desagradable de este incidente es la forma de la recuperación. Reiniciar el proceso funciona, porque el reinicio cierra todos los sockets abiertos por el proceso y libera los puertos asociados. Eso crea una narrativa engañosa dentro del equipo: el problema se resuelve reiniciando, luego debe ser una fuga de memoria, o algún estado corrupto, o una biblioteca defectuosa. En realidad el reinicio solo está devolviendo el recurso al sistema, y el intervalo entre reinicios es exactamente el tiempo que el servicio tarda en consumir el rango entero de puertos otra vez. Un intervalo estable de cuarenta minutos entre fallos es una firma fuerte de este agotamiento, porque indica consumo lineal de un recurso finito y no un defecto aleatorio.',
        },
        {
          type: 'table',
          columns: ['Síntoma observado', 'Diagnóstico habitual del equipo', 'Causa real cuando son puertos efímeros', 'Verificación que separa ambos'],
          rows: [
            [
              'Error de asignación de dirección en las llamadas de salida',
              'Problema de red o de resolución de nombres',
              'Ningún puerto de origen libre en el rango configurado',
              'Contar sockets por estado en la máquina de origen, no probar conectividad',
            ],
            [
              'El reinicio lo resuelve por decenas de minutos y el error vuelve',
              'Fuga de memoria o estado corrupto',
              'Consumo lineal del rango hasta el límite, puesto a cero por el reinicio',
              'Medir el intervalo entre fallos: uno estable indica recurso finito',
            ],
            [
              'Tráfico de entrada plano durante todo el incidente',
              'Fallo del servicio de destino',
              'Cada petición de entrada abre varias conexiones de salida nuevas',
              'Comparar peticiones por segundo con conexiones de salida por segundo',
            ],
            [
              'Miles de sockets en espera final',
              'Conexiones colgadas que hay que matar',
              'Comportamiento normal del protocolo tras un cierre activo',
              'Verificar si el total se acerca al tamaño del rango de puertos',
            ],
            [
              'Solo una instancia falla mientras las demás siguen bien',
              'Instancia defectuosa, basta con reemplazarla',
              'Distribución desigual de destinos entre instancias',
              'Agrupar conexiones por dirección de destino en cada instancia',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila de la tabla es la que más retrasa el diagnóstico en entornos con varias réplicas. Como el agotamiento depende de la combinación entre origen y destino, y no solo del volumen total, es perfectamente posible que una instancia que habla predominantemente con un único destino se rompa mientras sus vecinas, con la misma carga pero destinos más repartidos, siguen sanas. Reemplazar la instancia hace desaparecer el síntoma por unos minutos y refuerza la conclusión equivocada de que el problema era de la máquina.',
        },
      ],
    },
    {
      title: 'La capacidad real es una tupla de cuatro elementos, no un número de puertos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La intuición de que existen sesenta y tantos mil puertos y que por lo tanto caben sesenta y tantas mil conexiones es errónea en dos direcciones a la vez, y entender por qué es lo que permite dimensionar correctamente. Una conexión se identifica por cuatro valores: dirección de origen, puerto de origen, dirección de destino y puerto de destino. Lo que debe ser único en el sistema es la combinación de los cuatro, y no el puerto de origen por sí solo.',
        },
        {
          type: 'paragraph',
          value:
            'Eso significa que el mismo puerto de origen puede reutilizarse para destinos diferentes sin ningún conflicto. Una máquina con treinta mil puertos efímeros disponibles puede mantener treinta mil conexiones con una base de datos y otras treinta mil con un servicio de pagos simultáneamente, porque las tuplas difieren en la dirección de destino. El límite práctico, por lo tanto, no es por máquina: es por par de origen y destino. Un servicio que habla con un único destino tiene la capacidad más baja posible, y un servicio que reparte llamadas entre muchos destinos tiene una capacidad mucho mayor sin cambiar nada en la configuración.',
        },
        {
          type: 'paragraph',
          value:
            'En la dirección contraria, la capacidad efectiva es menor de lo que el rango sugiere por culpa del tiempo de retención. Un puerto liberado no vuelve de inmediato al conjunto disponible: queda retenido durante el estado de espera final, que en sistemas derivados de Linux dura sesenta segundos por defecto. La cuenta que importa no es cuántos puertos existen, sino cuántas conexiones nuevas por segundo pueden abrirse hacia el mismo destino sin que la tasa de creación supere a la de liberación. El número es simple y suele sorprender: el rango dividido por el tiempo de retención.',
        },
        {
          type: 'code',
          value: `// Capacidad de conexiones nuevas por segundo hacia un mismo destino.
// El limite no es el numero de puertos, es su tasa de reciclaje.

/**
 * @param {number} portaInicial primer valor del rango efimero
 * @param {number} portaFinal   ultimo valor del rango efimero
 * @param {number} retencaoSeg  segundos en espera final tras el cierre
 * @param {number} destinos     cuantos pares direccion:puerto distintos reciben trafico
 */
export function capacidadeDeConexoesNovas({
  portaInicial = 32768,
  portaFinal = 60999,
  retencaoSeg = 60,
  destinos = 1,
}) {
  const faixa = portaFinal - portaInicial + 1;

  // Por destino distinto el rango entero vuelve a estar disponible,
  // porque la unicidad exigida es la de la tupla de cuatro elementos
  // y no la del puerto.
  const portasUteis = faixa * destinos;

  // Un puerto cerrado de forma activa solo vuelve al conjunto despues
  // de la espera final. En regimen permanente, la tasa sostenible es
  // la razon entre el stock y el tiempo que cada unidad queda
  // indisponible.
  const novasPorSegundo = Math.floor(portasUteis / retencaoSeg);

  return {
    faixa,
    portasUteis,
    novasPorSegundo,
    // Punto de saturacion: por encima de esto el stock encoge cada
    // segundo hasta llegar a cero, y el error aparece cuando llega a
    // cero, no cuando la tasa sube.
    observacao: \`Por encima de \${novasPorSegundo} conexiones nuevas por segundo hacia \${destinos} destino(s), el stock de puertos encoge de forma monotona.\`,
  };
}

// Caso tipico de servicio que habla con un unico balanceador interno:
// 28232 puertos / 60s = 470 conexiones nuevas por segundo.
// Un servicio que atiende 500 req/s y abre una conexion nueva por
// peticion ya esta por encima del punto de saturacion, con trafico de
// entrada considerado bajo por cualquier panel.`,
        },
        {
          type: 'paragraph',
          value:
            'El resultado de ese cálculo es el número más útil de todo el incidente, porque convierte una discusión vaga sobre carga en un límite concreto que puede compararse con la métrica de peticiones. Un rango por defecto de veintiocho mil puertos con sesenta segundos de retención sostiene poco menos de quinientas conexiones nuevas por segundo hacia el mismo destino. Un servicio que recibe quinientas peticiones por segundo y abre una conexión nueva en cada una está exactamente en el punto de inflexión, y cualquier crecimiento del cinco por ciento en el tráfico pasa a consumir stock en lugar de reciclar.',
        },
        {
          type: 'diagram',
          value: `STOCK DE PUERTOS EN REGIMEN PERMANENTE

  rango = 28.232 puertos    retencion = 60s
  tasa sostenible = 28.232 / 60 = 470 conexiones nuevas/s

  tasa de apertura < 470/s          tasa de apertura > 470/s
  -----------------------           -----------------------
  disponible  ~~~~~~~~~~~~~         disponible  \\
              estable                            \\
                                                  \\
  espera final ~~~~~~~~~~~                          \\____ 0
              meseta                   el error aparece aqui,
                                       minutos despues del
                                       cambio de tasa

  El desfase entre el cambio de tasa y el error es lo que hace que el
  incidente parezca desconectado de cualquier cambio reciente.`,
        },
        {
          type: 'paragraph',
          value:
            'El desfase representado en el diagrama es la razón por la que este incidente casi nunca se asocia al despliegue que lo causó. Si el rango tiene veintiocho mil puertos y el exceso es de cien conexiones por segundo por encima de la tasa sostenible, el stock tarda casi cinco minutos en llegar a cero. Si el exceso es de diez conexiones por segundo, tarda casi cincuenta minutos. Un despliegue hecho a las diez produce un error a las diez y cincuenta, y a esa altura ya nadie lo está mirando.',
        },
      ],
    },
    {
      title: 'La espera final no es desperdicio, y acortarla tiene precio',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera reacción de casi todo equipo ante miles de sockets en espera final es tratarlos como basura acumulada y buscar la configuración que los elimina. Conviene entender antes por qué existe ese estado, porque resuelve dos problemas concretos y desactivarlo sin saberlo cambia un incidente visible por uno silencioso y mucho peor de diagnosticar.',
        },
        {
          type: 'paragraph',
          value:
            'El primer problema es el del paquete retrasado. La red puede entregar fuera de orden y con retraso arbitrario, así que un segmento de la conexión antigua puede llegar después de que esta fue cerrada. Si la misma tupla de cuatro elementos ya fue reutilizada por una conexión nueva, ese segmento retrasado se entrega a la conexión equivocada, y el resultado es corrupción de datos a nivel de aplicación, no un error de red. La espera final mantiene la tupla reservada el tiempo suficiente para que cualquier paquete antiguo ya haya expirado en la red.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo problema es el del acuse perdido. Quien cierra de forma activa debe garantizar que el acuse final llegue al otro lado, y si se pierde el otro lado retransmite la petición de cierre. Sin la espera final, esa retransmisión llega a una tupla que ya no existe y recibe un rechazo, lo que hace que el lado remoto termine la conexión de forma abrupta en lugar de ordenada. En un servidor que mantiene estado por conexión, eso se convierte en acumulación de conexiones medio abiertas al otro lado del cable.',
        },
        {
          type: 'table',
          columns: ['Ajuste considerado', 'Qué hace realmente', 'Riesgo que introduce', 'Cuándo es defendible'],
          rows: [
            [
              'Ampliar el rango de puertos efímeros',
              'Aumenta el stock, elevando la tasa sostenible en la misma proporción',
              'Conflicto con puertos de servicio fijos por encima de treinta y dos mil',
              'Siempre, mientras el rango no invada puertos ya usados por servicios locales',
            ],
            [
              'Reutilizar socket en espera final para conexión de salida',
              'Permite reusar la tupla cuando la conexión nueva es demostrablemente posterior',
              'Bajo en salida, exige marcas de tiempo activas en ambos extremos',
              'Ajuste por defecto recomendado antes que cualquier otro',
            ],
            [
              'Reciclaje agresivo por origen',
              'Descarta conexiones con marca de tiempo considerada antigua',
              'Rompe clientes detrás de traducción de direcciones compartida',
              'Prácticamente nunca: retirado de núcleos recientes por causar más daño que beneficio',
            ],
            [
              'Reducir el tiempo de espera final',
              'Acorta la ventana de protección contra paquetes retrasados',
              'Corrupción silenciosa en redes con reordenamiento real',
              'Red interna controlada y de baja latencia, como último recurso',
            ],
            [
              'Reusar conexión en lugar de abrir una nueva',
              'Elimina la creación de tuplas, atacando la causa',
              'Ninguno, más allá de exigir configuración correcta de tiempo ocioso',
              'Siempre: es la corrección real, las demás son mitigación',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La jerarquía de la tabla es deliberada. La última fila es la única corrección que elimina la causa, y las cuatro anteriores compran tiempo con grados distintos de riesgo. Un equipo que aplica solo las mitigaciones resuelve el incidente de hoy y se reencuentra con el mismo problema cuando el tráfico se duplique, con la diferencia de que ya no queda ningún parámetro por ajustar.',
        },
      ],
    },
    {
      title: 'El cliente que abre una conexión nueva en cada llamada es la causa en ocho de cada diez casos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando la investigación llega al código, el hallazgo casi siempre es el mismo: un cliente HTTP instanciado dentro de la función que hace la llamada. Cada petición crea un cliente, el cliente crea su propio pool, el pool abre una conexión, la respuesta se lee y el cliente se descarta junto con la conexión. Desde el punto de vista del desarrollador no hay ningún error: el código es limpio, no tiene estado global y no filtra memoria. Desde el punto de vista del sistema operativo, cada petición de entrada acaba de consumir un puerto que quedará indisponible durante el próximo minuto.',
        },
        {
          type: 'paragraph',
          value:
            'Existe una variación más sutil que aparece en servicios que ya usan un cliente compartido y aun así agotan el rango. El pool tiene un límite de conexiones ociosas que mantiene, y cuando ese límite es menor que la concurrencia real, las conexiones que lo exceden se cierran en lugar de devolverse al pool. El comportamiento observado es una reutilización parcial, con una fracción estable del tráfico abriendo conexión nueva, y esa fracción basta para agotar el rango si la concurrencia es alta. El síntoma distintivo es que el número de conexiones en espera final crece proporcionalmente al tráfico, pero con un coeficiente menor que uno.',
        },
        {
          type: 'code',
          value: `// Cliente HTTP con reutilizacion real de conexion en Node.js.
// El punto critico no es crear el agente, es dimensionar las conexiones
// ociosas por encima de la concurrencia esperada.

import http from 'node:http';
import https from 'node:https';

// Concurrencia media esperada por instancia hacia este destino.
// Por debajo de ella el pool cierra conexiones que se reutilizarian, y
// la fraccion cerrada se convierte en consumo continuo de puertos
// efimeros.
const CONCORRENCIA_ESPERADA = 64;

const opcoesDeAgente = {
  keepAlive: true,

  // Conexiones ociosas mantenidas. Si queda por debajo de la
  // concurrencia, el excedente se cierra en lugar de devolverse, y cada
  // cierre cuesta un puerto retenido durante toda la espera final.
  maxSockets: CONCORRENCIA_ESPERADA * 2,
  maxFreeSockets: CONCORRENCIA_ESPERADA,

  // Tiempo ocioso antes de cerrar. Debe ser menor que el tiempo de
  // ociosidad aceptado por el servidor remoto, o el cliente reusa una
  // conexion que el otro extremo ya cerro y recibe error de socket
  // muerto.
  keepAliveMsecs: 15_000,
  timeout: 30_000,

  // Reparte las peticiones entre las conexiones libres en lugar de
  // apilarlo todo en la primera, lo que mantiene el pool caliente por
  // igual.
  scheduling: 'lifo',
};

export const agenteHttp = new http.Agent(opcoesDeAgente);
export const agenteHttps = new https.Agent(opcoesDeAgente);

/**
 * Cliente de modulo, creado una vez. Crearlo por peticion es el error
 * que produce agotamiento de puertos sin ningun sintoma en el codigo.
 */
export async function chamarServicoInterno(caminho, corpo) {
  const resposta = await fetch(\`https://servico-interno.local\${caminho}\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
    // En Node, fetch usa el dispatcher global; para http/https nativos
    // el agente anterior se pasa directamente en las opciones.
    dispatcher: undefined,
  });

  if (!resposta.ok) {
    // Leer el cuerpo incluso en error. Una respuesta cuyo cuerpo nunca
    // se consume puede mantener la conexion ocupada hasta el timeout,
    // lo que reduce el pool efectivo y empuja el excedente hacia
    // conexiones nuevas.
    await resposta.text().catch(() => '');
    throw new Error(\`el servicio interno respondio \${resposta.status}\`);
  }

  return resposta.json();
}`,
        },
        {
          type: 'paragraph',
          value:
            'El comentario sobre consumir el cuerpo de la respuesta incluso en caso de error no es un detalle de estilo. Una conexión cuyo cuerpo no fue leído hasta el final no puede devolverse al pool, porque el protocolo no sabe dónde termina el mensaje anterior. Muchos clientes lo manejan cerrando la conexión, y el resultado es que el camino de error del servicio consume puertos a un ritmo mucho mayor que el camino de éxito. Eso produce una realimentación cruel: una degradación parcial en el destino aumenta la tasa de error, la tasa de error aumenta el consumo de puertos, y el agotamiento de puertos convierte la degradación parcial en indisponibilidad total.',
        },
        {
          type: 'paragraph',
          value:
            'La otra precaución es el tiempo ocioso. Si el cliente mantiene la conexión más tiempo del que acepta el servidor remoto, el servidor cierra primero y el cliente lo descubre solo al intentar usar la conexión, recibiendo un error de socket cerrado. Los equipos que encuentran ese error suelen apagar la reutilización entera para hacerlo desaparecer, lo que reintroduce el agotamiento. La corrección correcta es mantener el tiempo ocioso del cliente cómodamente por debajo del tiempo aceptado por el servidor, con una diferencia de al menos cinco segundos para cubrir variación de reloj y retraso de red.',
        },
      ],
    },
    {
      title: 'La traducción de direcciones cambia al dueño del problema y el lugar donde aparece',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En entornos de contenedores y de nube, el tráfico de salida rara vez va directo de la máquina al destino. Pasa por una capa de traducción de direcciones, sea la puerta de enlace de la red virtual, sea la regla local que enmascara la dirección del contenedor detrás de la del nodo. Esa capa debe asignar un puerto propio para cada conexión traducida, y es esa asignación, no la del proceso, la que se vuelve el recurso escaso.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica es que el agotamiento deja de ser un problema de una máquina y pasa a ser un problema compartido por todos los contenedores que salen por la misma dirección traducida. Un servicio ruidoso puede consumir el rango de la puerta de enlace y tumbar conexiones de servicios vecinos que no cambiaron nada, que es exactamente el patrón de daño colateral que aparece en los límites de tasa globales. El diagnóstico se vuelve más difícil porque el error aparece en un proceso que no es el causante, y la métrica que explicaría el fenómeno vive en la puerta de enlace, normalmente fuera del alcance del equipo de aplicación.',
        },
        {
          type: 'paragraph',
          value:
            'Existe además una trampa de conteo. Muchas puertas de enlace gestionadas publican un número de puertos por instancia traducida, y ese número se asigna en bloques por destino. Un servicio que habla con pocos destinos, el caso común de una aplicación que habla con una base gestionada y una caché, consume un bloque entero por destino y alcanza el techo con una fracción pequeña del total anunciado. La lectura ingenua del número publicado lleva al equipo a concluir que sobra capacidad mientras la puerta de enlace ya está rechazando.',
        },
        {
          type: 'list',
          items: [
            'Mapee por dónde sale realmente el tráfico de salida: directo, por puerta de enlace gestionada o por enmascaramiento en el nodo, porque el recurso finito está en lugares distintos en cada caso.',
            'Prefiera un punto de acceso privado al destino cuando exista, porque eso quita la traducción del camino y devuelve la contabilidad de puertos a la propia máquina.',
            'Trate el rango de la puerta de enlace como recurso compartido con presupuesto por servicio, no como capacidad infinita, y monitoree la asignación por destino y no solo el total.',
            'Reparta los destinos cuando sea posible, porque cada dirección de destino distinta multiplica la capacidad de tuplas disponible sin ningún cambio de configuración.',
            'Verifique si la traducción deja que las conexiones de larga duración sobrevivan al tiempo ocioso de la propia puerta de enlace, porque una conexión caída en silencio se convierte en reapertura y consumo de puerto.',
          ],
        },
      ],
    },
    {
      title: 'La secuencia de diagnóstico que separa una fuga de la demanda legítima',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ante el error, la tentación es ampliar el rango de puertos de inmediato. Eso funciona y es lo correcto para contener el incidente, pero si es la única acción el problema vuelve con más tráfico. La secuencia siguiente produce, dentro del mismo incidente, tanto la contención como la evidencia que orienta la corrección definitiva.',
        },
        {
          type: 'ordered',
          items: [
            'Confirme qué recurso se agotó contando sockets por estado en la máquina que emitió el error, no en la de destino. Un total en espera final cercano al tamaño del rango confirma el diagnóstico en segundos y elimina toda la investigación de red.',
            'Agrupe las conexiones por dirección de destino. Si un destino concentra la mayoría, la corrección es reutilización de conexión en ese cliente específico; si están repartidas, el camino es ampliar el rango y revisar el tiempo de retención.',
            'Compare la tasa de conexiones nuevas por segundo con la tasa de peticiones recibidas. Una razón cercana a uno es la firma de un cliente sin reutilización, y una razón mucho mayor que uno indica que cada petición abre varias conexiones, típicamente por llamadas en serie a servicios distintos.',
            'Contenga ampliando el rango efímero y habilitando la reutilización de socket en espera final para conexiones de salida, que es el ajuste de menor riesgo y devuelve capacidad inmediata sin tocar la ventana de protección del protocolo.',
            'Corrija la causa moviendo el cliente a ámbito de módulo con reutilización de conexión habilitada, y dimensione las conexiones ociosas por encima de la concurrencia esperada para evitar la reutilización parcial que engaña al diagnóstico.',
            'Cierre el ciclo instrumentando la métrica de puertos en uso como fracción del rango, porque es ella la que convierte el próximo episodio en una alerta con minutos de anticipación en lugar de un error sin aviso.',
          ],
        },
        {
          type: 'code',
          value: `#!/usr/bin/env bash
# Diagnostico de agotamiento de puertos efimeros.
# Ejecutar en la maquina que emitio el error de asignacion de direccion.
set -euo pipefail

FAIXA=$(cat /proc/sys/net/ipv4/ip_local_port_range)
INICIO=$(echo "$FAIXA" | awk '{print $1}')
FIM=$(echo "$FAIXA" | awk '{print $2}')
TOTAL=$(( FIM - INICIO + 1 ))

echo "Rango efimero: $INICIO-$FIM ($TOTAL puertos)"
echo

# 1) Cuantos sockets existen en cada estado. Un valor de TIME-WAIT
#    cercano a TOTAL confirma el agotamiento sin ambiguedad.
echo "== Sockets por estado =="
ss -tan | awk 'NR > 1 { print $1 }' | sort | uniq -c | sort -rn
echo

# 2) Hacia donde van. Un destino dominante senala al cliente que
#    necesita reutilizacion de conexion.
echo "== Top 10 destinos en TIME-WAIT =="
ss -tan state time-wait | awk 'NR > 1 { print $5 }' \\
  | sed 's/:[0-9]*$//' | sort | uniq -c | sort -rn | head -10
echo

# 3) Ocupacion efectiva del rango. Por encima del 80 por ciento ya es
#    alerta, porque el margen restante desaparece en segundos bajo
#    rafaga.
EM_USO=$(ss -tan | awk 'NR > 1 { print $4 }' \\
  | sed 's/.*://' | awk -v i="$INICIO" -v f="$FIM" \\
    '$1 >= i && $1 <= f { c++ } END { print c + 0 }')
PCT=$(awk -v e="$EM_USO" -v t="$TOTAL" 'BEGIN { printf "%.1f", (e / t) * 100 }')
echo "== Ocupacion =="
echo "Puertos en uso en el rango: $EM_USO de $TOTAL ($PCT%)"
echo

# 4) Ajustes vigentes que cambian la tasa de reciclaje.
echo "== Parametros relevantes =="
echo "tcp_tw_reuse: $(cat /proc/sys/net/ipv4/tcp_tw_reuse)"
echo "tcp_fin_timeout: $(cat /proc/sys/net/ipv4/tcp_fin_timeout)"
echo "somaxconn: $(cat /proc/sys/net/core/somaxconn)"`,
        },
        {
          type: 'paragraph',
          value:
            'El tercer bloque de ese script es el que suele adaptarse para convertirse en métrica permanente. Exportar la ocupación del rango como un valor porcentual y alertar al ochenta por ciento da una anticipación que varía de minutos a decenas de minutos según la velocidad de consumo, y siempre es mayor que cero, que es la anticipación que el equipo tiene hoy. Conviene exportar junto el conteo agrupado por destino, porque cuando la alerta se dispare la primera pregunta será hacia dónde van las conexiones, y tener la respuesta lista ahorra la parte más lenta del diagnóstico.',
        },
        {
          type: 'paragraph',
          value:
            'Una observación sobre el segundo paso que evita una conclusión equivocada frecuente. Un total alto en espera final no es por sí mismo un problema: es el resultado esperado de un servicio que cierra muchas conexiones de forma activa e indica solo que el cierre está ocurriendo del lado correcto. Lo que caracteriza el incidente es la proporción entre ese total y el tamaño del rango. Veinte mil sockets en espera final con un rango de sesenta mil es operación normal, y los mismos veinte mil con un rango de veintidós mil es un servicio a minutos de detenerse.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Ampliar el rango de puertos efímeros al máximo posible tiene alguna desventaja?',
      answer:
        'Tiene una, y es lo bastante concreta como para merecer verificación antes de aplicar el ajuste en producción. El rango efímero es el conjunto de puertos que el núcleo elige automáticamente cuando nadie pide uno específico, y ampliar su límite inferior hacia valores bajos hace que el núcleo pueda asignar a una conexión de salida exactamente el puerto que algún servicio local pretende usar como puerto de escucha. El resultado es un servicio que falla al arrancar diciendo que la dirección ya está en uso, de forma intermitente y dependiente del momento del reinicio, que es uno de los modos de fallo más difíciles de reproducir que existen. El procedimiento seguro tiene tres partes. La primera es inventariar todos los puertos fijos usados en la máquina, incluyendo los de agentes de monitoreo, los de herramientas de depuración y los de cualquier servicio auxiliar que suela quedar por encima de treinta mil, porque la colisión casi siempre ocurre en ese rango alto y no en los puertos conocidos por debajo de mil. La segunda es declarar esos puertos como reservados en el parámetro apropiado del núcleo, lo que hace que la asignación automática salte exactamente esos valores aunque estén dentro del rango ampliado, resolviendo el conflicto sin renunciar a la capacidad. La tercera es ampliar el rango empezando por el límite superior, que suele ser seguro por defecto, antes de tocar el límite inferior, donde vive el riesgo. Con esos cuidados, un rango que va de diez mil a sesenta y cinco mil es perfectamente operable y más que duplica la tasa sostenible de conexiones nuevas. Conviene recordar que esa ampliación sigue siendo mitigación: empuja el punto de saturación hacia adelante, y el servicio que abre una conexión nueva por petición volverá a encontrarlo con el doble de tráfico.',
    },
    {
      question: '¿Cómo aparece esto en un clúster de contenedores, donde cada pod tiene su propia pila de red?',
      answer:
        'Aparece de tres formas distintas, y confundirlas es lo que hace lento el diagnóstico. La primera forma es la más parecida al caso tradicional: cuando el pod tiene su propio espacio de nombres de red con dirección enrutable, el rango efímero es el de su espacio y el agotamiento es local, lo que en la práctica es buena noticia porque aísla el daño al servicio causante y mantiene el diagnóstico al alcance del equipo. La segunda forma ocurre cuando la salida pasa por enmascaramiento en el nodo, que es el comportamiento por defecto de muchas instalaciones: entonces el recurso finito es el rango del nodo, compartido por todos los pods que salen por él, y un servicio ruidoso tumba vecinos que no cambiaron nada. El síntoma característico es que el error aparece en pods de aplicaciones diferentes al mismo tiempo, sin correlación entre ellas más allá del nodo en que corren, y la confirmación viene de contar las conexiones en el espacio de nombres del nodo en lugar del pod. La tercera forma es la de la puerta de enlace de salida gestionada de la nube, donde la asignación se hace en bloques por destino y el techo anunciado nunca es alcanzable en la práctica por un servicio que habla con pocos destinos; en ese caso la métrica que importa no existe dentro del clúster y debe venir del proveedor. Las correcciones acompañan a la forma: para la primera, ajuste del rango en el espacio del pod y reutilización de conexión en el cliente; para la segunda, lo mismo en el nodo más un presupuesto de conexiones por pod para que el aislamiento no dependa de la buena voluntad; para la tercera, punto de acceso privado al destino, que quita la traducción del camino y casi siempre es también más barato y más rápido que salir por internet.',
    },
    {
      question: '¿El mismo problema existe con conexiones de base de datos con pool, o el pool ya lo resuelve?',
      answer:
        'El pool resuelve el caso normal y deja pasar tres situaciones que producen exactamente el mismo agotamiento, y las tres son bastante comunes como para merecer la verificación. La primera es el pool con validación agresiva, configurado para descartar y recrear conexiones ociosas en intervalos cortos como forma de evitar conexiones muertas. Si el intervalo es de pocos minutos y el pool tiene decenas de conexiones por instancia, con decenas de instancias, la tasa de recreación se convierte en un flujo constante de tuplas nuevas hacia el mismo destino, que es la peor configuración posible para puertos efímeros. La segunda es el pool con tiempo de vida máximo por conexión, un ajuste legítimo para permitir que los cambios de destino se absorban tras un failover, pero que debe venir con dispersión aleatoria: sin ella todas las conexiones creadas en el mismo momento del despliegue expiran en el mismo momento, y la instancia recrea el pool entero de una vez en una ráfaga que puede consumir una fracción relevante del rango en un segundo. La tercera, y la más frecuente, es el pool que no cubre todo el tráfico: las consultas pasan por el pool, pero la migración, el script de mantenimiento, el proceso de reportes y la verificación de salud abren conexiones propias fuera de él, y una verificación de salud que abre y cierra una conexión cada cinco segundos por instancia produce, con cien instancias, veinte conexiones nuevas por segundo hacia el mismo destino sin que ninguna métrica de aplicación lo registre. La recomendación práctica es hacer que la verificación de salud reutilice una conexión del propio pool en lugar de abrir la suya, dispersar el tiempo de vida máximo con una variación aleatoria de al menos el diez por ciento, y contar las conexiones por destino en lugar de confiar en la métrica de conexiones activas del pool, que solo ve lo que pasa por él.',
    },
  ],
  conclusion: {
    title: 'El puerto efímero es capacidad, y la capacidad que nadie mide es capacidad que se acaba sin aviso',
    description:
      'El agotamiento de puertos de salida es el incidente que rompe un servicio sano sin mover ninguno de los cuatro indicadores que muestra el panel, y que se disfraza de problema de red porque el mensaje de error habla de dirección cuando la causa es la tasa de reciclaje. Entender que la capacidad es el rango dividido por el tiempo de retención, y multiplicado por el número de destinos distintos, convierte una discusión vaga en un límite comparable con la métrica de peticiones. Ampliar el rango contiene, reutilizar conexiones corrige, y medir la ocupación como fracción del rango es lo que cambia un error sin aviso por una alerta con minutos de anticipación. Puedo levantar por dónde sale realmente su tráfico de salida, calcular la tasa sostenible por destino, corregir los clientes que abren una conexión por petición e instrumentar los indicadores que dan anticipación antes del próximo episodio.',
    cta: 'Hablar sobre la capacidad de salida de mi servicio',
  },
  related: [
    {
      label: 'Límite de conexiones de la base agotado: cuándo el pool se vuelve el cuello de botella',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Timeout en cascada: cuándo el retry del cliente tumba el servicio',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'Observabilidad y Confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
