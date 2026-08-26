// Conteudo do artigo: cache invalidado errado e o custo real do dado velho.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O cache entrou no sistema para resolver um problema de latência e resolveu, mas trouxe junto um problema que ninguém mediu: agora existe uma segunda cópia da verdade, e ela envelhece sozinha. O sintoma clássico chega pelo suporte e não pelo alerta: um cliente vê o saldo antigo depois de pagar, um vendedor vê o estoque que não existe mais, um usuário some da lista de bloqueados e volta a mandar mensagem. Este artigo mostra por que TTL é uma aposta e não uma estratégia, por que invalidar no lugar errado transforma um cache em uma fonte de erro consistente, qual é a diferença prática entre invalidar e sobrescrever, por que o cache de dois níveis multiplica o problema em vez de dividi-lo, como calcular o custo do dado velho antes de escolher a política, e qual é o padrão que resolve estampida sem trocar um incidente por outro.',
  sections: [
    {
      title: 'Cache não é otimização, é uma segunda fonte de verdade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A forma como o cache costuma entrar no projeto esconde o que ele realmente é. Alguém mede uma consulta lenta, coloca uma leitura de Redis na frente dela, o gráfico de latência melhora e o pull request é aprovado como otimização de performance. O que acabou de acontecer, porém, é que o sistema passou a ter duas cópias do mesmo dado, mantidas por caminhos diferentes, com garantias diferentes e sem nenhum mecanismo que force as duas a concordarem. Isso não é uma otimização, é uma decisão de arquitetura de dados, e ela deveria ser revisada com o mesmo rigor de uma replicação.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática é que a pergunta certa nunca é se o cache está rápido, e sim quanto tempo o sistema tolera servir uma resposta errada. Essa tolerância varia de forma brutal dentro da mesma aplicação. Uma listagem de produtos aguenta trinta segundos de defasagem sem que ninguém perceba. Um saldo disponível não aguenta dois segundos, porque o usuário acabou de fazer a transferência e está olhando para a tela. Uma lista de números bloqueados não aguenta defasagem nenhuma, porque a consequência de errar é mandar mensagem para quem pediu para não receber, o que é problema jurídico e não problema de UX.',
        },
        {
          type: 'table',
          columns: ['Dado em cache', 'Tolerância a defasagem', 'Custo de servir o valor velho', 'Política adequada'],
          rows: [
            [
              'Catálogo de produtos',
              'Minutos',
              'Baixo: usuário vê preço antigo por pouco tempo',
              'TTL simples, revalidação em segundo plano',
            ],
            [
              'Estoque disponível',
              'Segundos',
              'Médio: venda de item inexistente, estorno manual',
              'TTL curto mais invalidação na escrita',
            ],
            [
              'Saldo de conta',
              'Zero em leitura do próprio dono',
              'Alto: perda de confiança imediata',
              'Leitura consistente para o autor da escrita, cache para terceiros',
            ],
            [
              'Permissões e papéis',
              'Segundos, mas só para conceder',
              'Crítico: acesso após revogação',
              'Invalidação na escrita, TTL curto como rede de segurança',
            ],
            [
              'Lista de bloqueio (opt-out)',
              'Zero',
              'Crítico: risco jurídico e multa',
              'Nunca cachear negativa, ou invalidar de forma síncrona',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A tabela não é um detalhe de documentação, ela é o artefato que decide o desenho. Quando essa classificação não existe, todos os dados acabam recebendo a mesma política, e a política escolhida é sempre a mais conveniente para o caso mais comum. É assim que uma lista de opt-out termina com o mesmo TTL de cinco minutos que o catálogo, e ninguém percebe até o dia em que uma campanha dispara para dez mil números que haviam saído na hora anterior.',
        },
      ],
    },
    {
      title: 'TTL é uma aposta sobre uma frequência que você não controla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O TTL é a política mais usada porque é a mais fácil de implementar e a que menos exige acoplamento. Ele também é a política que menos garante alguma coisa. Um TTL de sessenta segundos não significa que o dado tem no máximo sessenta segundos de idade, significa que o dado tem no máximo sessenta segundos de idade contados a partir do momento em que ele entrou no cache, o que é diferente. Se a escrita aconteceu um milissegundo depois da leitura que populou a entrada, a janela de erro é o TTL inteiro. O tempo médio de defasagem é metade do TTL, mas ninguém sofre com a média, sofre com o pior caso, e o pior caso é o TTL completo.',
        },
        {
          type: 'paragraph',
          value:
            'Existe ainda um efeito de segunda ordem que costuma passar despercebido. O TTL faz uma aposta implícita sobre a frequência de escrita: ele funciona bem quando o dado muda com frequência muito menor que o TTL, e desperdiça quando o dado muda com frequência muito maior. Se um registro muda a cada dez minutos e o TTL é de um minuto, nove entre dez expirações recarregam exatamente o mesmo valor, gastando consulta ao banco sem reduzir defasagem alguma. Se o mesmo registro passa a mudar a cada dois segundos, o TTL de um minuto entrega dado velho em praticamente toda leitura. O parâmetro não se adapta, o comportamento do dado é que mudou.',
        },
        {
          type: 'diagram',
          value: `JANELA DE ERRO DO TTL (TTL = 60s)

  t=0    leitura popula o cache com valor A
  t=1s   escrita muda o valor no banco para B
  |
  |      cache serve A --------------------------> 59 segundos errado
  |
  t=60s  entrada expira, proxima leitura busca B

  ^ a janela de erro nao depende do TTL medio,
    depende de quando a escrita cai dentro da janela


INVALIDACAO NA ESCRITA (mesmo cenario)

  t=0    leitura popula o cache com valor A
  t=1s   escrita muda para B  ->  DELETE da chave
  t=1s   proxima leitura encontra falha e busca B

  ^ janela de erro = duracao da propria escrita
    custo = acoplamento entre quem escreve e quem cacheia`,
        },
        {
          type: 'paragraph',
          value:
            'Daí vem a conclusão que orienta o resto do desenho: TTL sozinho serve para dado cuja defasagem é tolerável por definição, não para dado cuja defasagem é tolerável na maior parte do tempo. Para todo o resto, o TTL continua útil, mas com outro papel. Ele deixa de ser a política e passa a ser a rede de segurança que limita o estrago quando a invalidação falha, e a invalidação vai falhar, porque ela depende de uma operação de rede que não participa da transação do banco.',
        },
      ],
    },
    {
      title: 'Invalidar no lugar errado é pior que não invalidar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro mais comum na invalidação não é esquecer de invalidar, é invalidar no lugar errado da sequência. A ordem entre commit no banco e remoção da chave no cache decide se o sistema tem uma janela de erro de milissegundos ou uma entrada envenenada que sobrevive até o TTL expirar. Quando a invalidação acontece antes do commit, existe um intervalo em que a chave já foi removida e o banco ainda não confirmou a mudança, e qualquer leitura concorrente que cair nesse intervalo vai buscar o valor antigo no banco e gravá-lo de volta no cache como se fosse novo. O resultado é um cache que contém o valor velho com o carimbo de recém-carregado, e nenhuma escrita futura vai corrigi-lo, porque a escrita que deveria invalidar já aconteceu.',
        },
        {
          type: 'code',
          value: `// ERRADO: invalida antes do commit.
// Uma leitura concorrente reintroduz o valor antigo e ele fica ate o TTL.
async function atualizarPrecoErrado(produtoId, novoPreco) {
  await cache.del(\`produto:\${produtoId}\`);   // (1) chave removida
  await db.transaction(async (tx) => {         // (2) commit so termina aqui
    await tx.produtos.update(produtoId, { preco: novoPreco });
  });
}

// Entre (1) e (2), outra requisicao executa:
//   miss -> SELECT (le o preco ANTIGO) -> SET no cache
// e o cache passa a servir o preco antigo ate o TTL expirar.


// CERTO: commit primeiro, invalidacao depois, com retentativa durável.
// A janela de erro passa a ser a duracao da propria escrita.
async function atualizarPreco(produtoId, novoPreco) {
  await db.transaction(async (tx) => {
    await tx.produtos.update(produtoId, { preco: novoPreco });
    // Enfileirar na MESMA transacao: se o commit falhar, a invalidacao
    // tambem some. Se o commit passar, a invalidacao esta garantida.
    await tx.outbox.insert({
      tipo: 'cache.invalidate',
      chave: \`produto:\${produtoId}\`,
      criadoEm: new Date(),
    });
  });

  // Caminho rapido: tenta invalidar imediatamente. Se falhar, tudo bem,
  // o worker do outbox faz de novo em no maximo alguns segundos.
  try {
    await cache.del(\`produto:\${produtoId}\`);
  } catch (erro) {
    logger.warn({ erro, produtoId }, 'invalidacao imediata falhou, outbox assume');
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'A tabela outbox no exemplo não é excesso de engenharia, ela resolve a única falha que o TTL não cobre bem. Sem ela, uma indisponibilidade momentânea do Redis no instante exato da escrita deixa a entrada velha viva pelo TTL inteiro, e se o TTL for longo porque o dado era considerado estável, o estrago dura minutos. Com ela, a invalidação passa a ter a mesma durabilidade do commit: ou as duas coisas aconteceram, ou nenhuma. O custo é um worker a mais e algumas dezenas de linhas, e o benefício é que a política de TTL volta a ser uma escolha de performance em vez de um limite superior de erro.',
        },
        {
          type: 'paragraph',
          value:
            'Vale registrar a variação que troca invalidação por sobrescrita, porque ela parece melhor e quase nunca é. Escrever o novo valor direto no cache junto com o commit elimina o miss seguinte e parece mais eficiente. O problema é que a sobrescrita não é comutativa: se duas escritas concorrentes acontecem, a ordem em que elas chegam ao cache pode ser diferente da ordem em que elas chegaram ao banco, e o cache termina com o valor da escrita mais antiga. O delete não tem esse problema porque duas remoções concorrentes produzem o mesmo estado, e o estado depois delas é sempre buscar do banco. A regra prática é simples: invalidar por padrão, sobrescrever apenas quando existe uma versão monotônica para comparar e descartar a escrita fora de ordem.',
        },
      ],
    },
    {
      title: 'Estampida: o incidente que a invalidação correta provoca',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe uma ironia previsível no caminho: quanto melhor a invalidação, mais concentrado fica o miss. Uma chave popular que é invalidada às dez da manhã tem centenas de requisições simultâneas descobrindo a falha no mesmo milissegundo, e todas elas vão ao banco fazer exatamente a mesma consulta. Isso é a estampida de cache, e ela é pior do que a lentidão que o cache resolvia, porque agora o banco recebe um pico coordenado em vez de uma carga distribuída. O caso extremo acontece quando várias chaves compartilham o mesmo instante de expiração, o que é comum quando um deploy popula tudo ao mesmo tempo.',
        },
        {
          type: 'paragraph',
          value:
            'A solução tem três peças que resolvem problemas diferentes e costumam ser confundidas. A primeira é o jitter no TTL, que espalha as expirações no tempo e evita que um grupo inteiro de chaves caia junto. A segunda é o bloqueio de recarga, que garante que apenas uma requisição vá ao banco enquanto as outras esperam ou servem o valor antigo. A terceira é a revalidação em segundo plano, que recarrega a entrada antes de ela expirar de fato, para que nenhuma requisição de usuário pague o custo do miss. Nenhuma das três substitui as outras, e implementar só a primeira é o erro mais comum porque é a mais fácil.',
        },
        {
          type: 'code',
          value: `// Leitura com protecao contra estampida:
// 1) jitter no TTL, 2) lock de recarga, 3) valor antigo servido enquanto recarrega.
const TTL_BASE = 300;          // 5 minutos
const JITTER_MAX = 60;         // ate 1 minuto de dispersao
const JANELA_STALE = 30;       // servir valor antigo por ate 30s durante recarga

function ttlComJitter(sementeChave) {
  // Jitter deterministico por chave: mesma chave recebe sempre o mesmo
  // deslocamento, entao entradas diferentes expiram em momentos diferentes
  // sem que uma unica chave fique com TTL instavel entre recargas.
  let hash = 0;
  for (let i = 0; i < sementeChave.length; i += 1) {
    hash = (hash * 31 + sementeChave.charCodeAt(i)) | 0;
  }
  return TTL_BASE + (Math.abs(hash) % JITTER_MAX);
}

async function lerComProtecao(chave, buscarNoBanco) {
  const bruto = await cache.get(chave);

  if (bruto) {
    const entrada = JSON.parse(bruto);
    const idadeSegundos = (Date.now() - entrada.gravadoEm) / 1000;

    // Ainda dentro da validade logica: resposta direta.
    if (idadeSegundos < entrada.ttl) return entrada.valor;

    // Expirado ha pouco: serve o antigo e dispara recarga em background.
    // Apenas quem conseguir o lock recarrega; os outros seguem com o antigo.
    if (idadeSegundos < entrada.ttl + JANELA_STALE) {
      const lock = await cache.set(\`lock:\${chave}\`, '1', { nx: true, ex: 10 });
      if (lock) {
        recarregar(chave, buscarNoBanco).catch((erro) =>
          logger.error({ erro, chave }, 'recarga em background falhou'),
        );
      }
      return entrada.valor;
    }
  }

  // Miss real ou entrada velha demais: apenas um vai ao banco.
  const lock = await cache.set(\`lock:\${chave}\`, '1', { nx: true, ex: 10 });
  if (!lock) {
    // Perdeu a corrida: espera curta e tenta ler o que o vencedor gravou.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const segundaTentativa = await cache.get(chave);
    if (segundaTentativa) return JSON.parse(segundaTentativa).valor;
  }

  return recarregar(chave, buscarNoBanco);
}

async function recarregar(chave, buscarNoBanco) {
  try {
    const valor = await buscarNoBanco();
    const ttl = ttlComJitter(chave);
    await cache.set(
      chave,
      JSON.stringify({ valor, gravadoEm: Date.now(), ttl }),
      // TTL fisico maior que o logico: a entrada sobrevive para poder
      // ser servida como stale enquanto a recarga acontece.
      { ex: ttl + JANELA_STALE + 10 },
    );
    return valor;
  } finally {
    await cache.del(\`lock:\${chave}\`);
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que faz esse código funcionar é a separação entre TTL lógico e TTL físico. A entrada guarda o próprio prazo de validade dentro do valor e continua existindo no Redis por mais alguns segundos depois disso, e é essa folga que permite servir o valor antigo enquanto a recarga acontece. Se o TTL do Redis fosse o único prazo, a expiração apagaria a entrada e não haveria valor antigo para servir, o que devolveria o problema da estampida exatamente onde ele estava.',
        },
      ],
    },
    {
      title: 'Dois níveis de cache, dois níveis de dado velho',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando o Redis vira gargalo ou quando o custo de rede por leitura começa a pesar, a resposta natural é adicionar um cache local dentro do processo. É uma decisão correta em termos de latência e é também o momento em que o problema de invalidação muda de natureza. Com o cache distribuído, invalidar era remover uma chave em um lugar. Com o cache local, invalidar passa a ser remover a mesma chave em todos os processos vivos, e não existe operação de remoção que alcance todos eles de forma síncrona e confiável.',
        },
        {
          type: 'diagram',
          value: `CAMINHO DA INVALIDACAO EM DOIS NIVEIS

  escrita
    |
    +--> commit no banco
    |
    +--> DELETE no Redis                     <- imediato, um lugar
    |
    +--> PUBLISH invalidate:produto:42       <- broadcast, sem garantia
           |
           +--> pod A  recebe -> limpa L1    (~1ms)
           +--> pod B  recebe -> limpa L1    (~1ms)
           +--> pod C  reiniciando, PERDE a mensagem
                  |
                  +--> serve valor velho ate o TTL do L1 expirar

  ^ por isso o TTL do L1 precisa ser curto:
    ele e o limite superior do erro quando o broadcast falha`,
        },
        {
          type: 'paragraph',
          value:
            'A regra que sai desse desenho é que o TTL do cache local não é um parâmetro de performance, é o tempo máximo de inconsistência que o sistema aceita quando a mensagem de invalidação se perde. Um processo que estava reiniciando, uma partição de rede de dois segundos ou um consumidor lento são suficientes para perder o broadcast, e nesse caso o único mecanismo que corrige o estado é a expiração. Por isso um cache local com TTL de cinco minutos e broadcast de invalidação é, no pior caso, um cache com cinco minutos de defasagem, e é assim que ele deve ser documentado, e não como um cache invalidado na escrita.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Cache local (L1)', 'Cache distribuído (L2)'],
          rows: [
            ['Latência típica', 'Nanossegundos a microssegundos', 'Sub-milissegundo mais rede'],
            ['Invalidação', 'Broadcast sem entrega garantida', 'Remoção direta e confiável'],
            ['Pior caso de defasagem', 'O TTL local inteiro', 'A duração da escrita'],
            ['Comportamento no deploy', 'Frio a cada processo novo', 'Preservado entre deploys'],
            ['Consumo de memória', 'Multiplicado pelo número de processos', 'Único e compartilhado'],
            ['Uso adequado', 'Dado quente, pequeno e tolerante a segundos', 'Dado compartilhado e maior'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha resume o critério de escolha. O cache local rende quando o conjunto quente é pequeno, muito lido e tolerante a alguns segundos de defasagem, como configuração de tenant, tabela de feature flags ou catálogo de tipos. Ele é a escolha errada para qualquer dado cuja leitura errada tenha consequência externa, porque a inconsistência dele não é corrigível por invalidação, só por tempo.',
        },
      ],
    },
    {
      title: 'Medir defasagem em vez de confiar na taxa de acerto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A métrica que todo painel de cache mostra é a taxa de acerto, e ela é praticamente inútil para o problema discutido aqui. Uma taxa de acerto de noventa e oito por cento pode significar um cache saudável ou um cache que serve dado velho com muita eficiência, e o gráfico é idêntico nos dois casos. Pior: quando a invalidação quebra, a taxa de acerto sobe, porque as entradas param de ser removidas. O indicador que deveria disparar o alerta se move na direção que parece boa.',
        },
        {
          type: 'paragraph',
          value:
            'O que precisa ser medido é a taxa de divergência, e ela se obtém por amostragem. Uma fração pequena das leituras que acertam o cache, algo entre um décimo e um por cento dependendo do volume, busca também o valor no banco, compara os dois e registra a diferença sem alterar a resposta enviada ao usuário. O custo é uma consulta extra em uma leitura entre mil, e o retorno é a única métrica que responde à pergunta que importa, que é com que frequência o sistema mente e por quanto tempo.',
        },
        {
          type: 'code',
          value: `// Amostragem de divergencia: mede quanto o cache mente, sem afetar a resposta.
const TAXA_AMOSTRAGEM = 0.005; // 0,5% das leituras com acerto

async function lerComAuditoria(chave, buscarNoBanco, metadados) {
  const valorEmCache = await lerComProtecao(chave, buscarNoBanco);

  if (Math.random() < TAXA_AMOSTRAGEM) {
    // Fora do caminho da resposta: nunca aumenta a latencia do usuario.
    setImmediate(async () => {
      try {
        const valorReal = await buscarNoBanco();
        const divergente =
          JSON.stringify(valorEmCache) !== JSON.stringify(valorReal);

        metrics.increment('cache.amostra', {
          entidade: metadados.entidade,
          resultado: divergente ? 'divergente' : 'igual',
        });

        if (divergente) {
          // A idade da entrada e o dado mais util do alerta: ela diz se o
          // problema e TTL longo demais ou invalidacao que nao aconteceu.
          const entrada = JSON.parse((await cache.get(chave)) || '{}');
          logger.warn(
            {
              chave,
              entidade: metadados.entidade,
              idadeMs: entrada.gravadoEm ? Date.now() - entrada.gravadoEm : null,
            },
            'divergencia entre cache e banco',
          );
        }
      } catch (erro) {
        logger.debug({ erro, chave }, 'auditoria de amostra falhou');
      }
    });
  }

  return valorEmCache;
}`,
        },
        {
          type: 'paragraph',
          value:
            'O campo de idade no log é o que transforma a métrica em diagnóstico. Se as divergências aparecem sempre em entradas com idade próxima do TTL, o problema é que o TTL está longo demais para a frequência de escrita daquela entidade, e a correção é ajustar o parâmetro. Se as divergências aparecem em entradas recém-gravadas, o problema é a invalidação: alguma escrita não está removendo a chave, ou está removendo antes do commit e sofrendo a reintrodução descrita antes. São duas causas distintas com duas correções distintas, e sem a idade o alerta apenas informa que algo está errado.',
        },
        {
          type: 'paragraph',
          value:
            'Vale definir o alerta por entidade e não de forma global, porque o limiar aceitável muda com a classificação feita na primeira seção. Divergência de meio por cento no catálogo é ruído esperado. A mesma divergência na lista de bloqueio é incidente, e o alerta precisa acordar alguém.',
        },
      ],
    },
    {
      title: 'A leitura do próprio autor precisa ser consistente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe um caso que concentra quase todas as reclamações de suporte e que quase nenhuma política de TTL resolve: o usuário que acabou de escrever e imediatamente lê o resultado. Ele fez a transferência e abriu o extrato, mudou o endereço e voltou para o perfil, cancelou o pedido e atualizou a página. Nesse caso não existe tolerância a defasagem, porque a expectativa não é sobre o sistema em geral, é sobre a ação que a pessoa acabou de tomar. É o mesmo raciocínio de consistência de leitura da própria escrita que se aplica a réplicas de leitura, e a solução tem a mesma forma.',
        },
        {
          type: 'ordered',
          items: [
            'Na conclusão de uma escrita, gravar uma marca de recência associada ao autor, tipicamente sessão ou identificador do usuário, com validade curta na casa de poucos segundos.',
            'Em toda leitura, verificar se existe marca ativa para aquele autor e entidade antes de consultar o cache.',
            'Se a marca existir, ignorar o cache e ler direto da fonte primária, aceitando a latência maior para aquela requisição específica.',
            'Se a marca não existir, seguir o caminho normal de cache, que atende a maioria esmagadora do tráfego.',
            'Dimensionar a validade da marca pelo maior atraso de replicação observado no percentil noventa e nove, e não pela média, porque é o pior caso que gera a reclamação.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A vantagem desse desenho é que ele paga o custo da consistência apenas onde ela é percebida. O volume de leituras que acontecem logo depois de uma escrita do mesmo autor costuma ser uma fração muito pequena do total, entre um e três por cento na maioria dos produtos, e é justamente essa fração que gera quase todos os tickets de suporte relacionados a cache. Trocar cache por consulta direta nesse recorte tem impacto desprezível na carga do banco e resolve a categoria de reclamação mais cara de investigar, porque ela nunca reproduz em ambiente de teste.',
        },
        {
          type: 'paragraph',
          value:
            'A mesma marca de recência serve para um segundo propósito que vale aproveitar. Quando ela existe, o sistema sabe que aquela entidade acabou de mudar, e isso é exatamente a informação necessária para decidir se vale ou não repopular o cache imediatamente. Repopular durante uma sequência de escritas do mesmo autor é desperdício, porque a próxima escrita vai invalidar de novo em segundos. Esperar a marca expirar antes de voltar a cachear evita esse ciclo e é uma linha a mais de condição.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Como escolher o TTL quando o dado não tem uma frequência de mudança previsível?',
      answer:
        'A pergunta em si aponta para o erro: quando a frequência de mudança é imprevisível, o TTL não deve ser a política principal, e sim o limite de segurança de uma política baseada em invalidação. Ainda assim é preciso escolher um número, e a forma de fazer isso sem chutar é medir a distribuição real. Registre por uma semana o intervalo entre escritas consecutivas de cada entidade e olhe para o percentil dez, ou seja, o intervalo abaixo do qual estão os dez por cento de mudanças mais rápidas. Um TTL próximo desse valor faz com que a expiração raramente aconteça antes de uma mudança real, o que reduz recargas inúteis, ao mesmo tempo em que limita a janela de erro para o caso em que a invalidação falhou. Existe uma variação que funciona bem para entidades com comportamento heterogêneo, que é derivar o TTL da própria idade do dado: uma entidade que não muda há semanas provavelmente vai continuar assim e pode receber TTL longo, enquanto uma que mudou há dois minutos merece TTL curto. Isso se implementa comparando o timestamp de última atualização do registro com o momento da leitura e aplicando faixas, o que custa nada porque o timestamp já está no registro carregado. O que não funciona é escolher cinco minutos porque é o valor que apareceu no exemplo da biblioteca.',
    },
    {
      question: 'Vale a pena cachear resultado de consulta ou apenas entidades por identificador?',
      answer:
        'Cachear entidade por identificador é simples porque a invalidação é óbvia: quem escreve a entidade sabe exatamente qual chave remover. Cachear resultado de consulta, como uma listagem filtrada e paginada, é uma decisão diferente e muito mais cara, porque uma única escrita pode invalidar um número indeterminado de chaves e não existe forma barata de saber quais. Uma mudança de preço de um produto afeta toda listagem ordenada por preço que continha aquele produto, toda listagem filtrada por faixa de preço que passa a incluí-lo ou excluí-lo, e todas as páginas subsequentes de cada uma delas. Existem três saídas usadas na prática. A primeira é aceitar defasagem em consultas e usar TTL curto sem tentar invalidar, o que funciona quando a listagem é navegação e não decisão. A segunda é versionar o conjunto: manter um contador por entidade ou por tenant que entra na composição da chave da consulta, de modo que qualquer escrita incremente o contador e torne todas as chaves antigas inalcançáveis de uma vez, ficando a limpeza por conta do TTL. A terceira é cachear apenas os identificadores retornados pela consulta e resolver as entidades individualmente pelo cache por identificador, o que reduz a invalidação da consulta a mudanças que afetam o conjunto ou a ordem, e não a mudanças de conteúdo. A segunda opção é a que costuma dar melhor relação entre esforço e resultado, e a terceira é a que melhor aproveita o cache que já existe.',
    },
    {
      question: 'Quando é melhor remover o cache em vez de continuar corrigindo a política?',
      answer:
        'O sinal mais confiável é quando o esforço de manter a coerência passa a ser maior que o ganho de latência, e isso é mensurável em vez de subjetivo. Meça a latência real da consulta que o cache protege, no percentil noventa e cinco e com o volume atual, e não com o volume de quando o cache foi introduzido. É comum que a consulta tenha ficado rápida por outros motivos, um índice que entrou depois, uma normalização, uma redução de volume por arquivamento, e que o cache tenha continuado ali por inércia protegendo algo que já não é lento. Um segundo sinal é a proporção entre escrita e leitura: se a mesma entidade recebe escritas em ritmo comparável ao das leituras, o cache passa a gastar mais em invalidação do que economiza em consulta, e além disso mantém uma janela de erro sem entregar quase nada. Um terceiro sinal, mais qualitativo mas igualmente válido, é o número de casos especiais acumulados na camada de cache: quando existem mais condições para decidir se pode cachear do que lógica de negócio no mesmo arquivo, o cache virou o problema. Antes de remover, meça o impacto real desligando por trás de uma flag em uma fração do tráfego e comparando latência e carga do banco. É comum que a remoção não seja detectável nos gráficos, e é justamente esse resultado que autoriza apagar o código com segurança.',
    },
  ],
  conclusion: {
    title: 'Cache é uma decisão de consistência disfarçada de performance',
    description:
      'Todo cache introduz uma segunda fonte de verdade, e a única pergunta que importa é por quanto tempo o sistema pode servir a versão errada dela sem consequência. Responder isso por entidade, em vez de aplicar o mesmo TTL a tudo, é o que separa um cache que economiza banco de um que produz incidente de dados. Posso classificar as entidades do seu sistema por tolerância a defasagem, desenhar a invalidação durável que sobrevive a falha do Redis, implementar a proteção contra estampida com revalidação em segundo plano, instrumentar a amostragem de divergência que revela o problema antes do suporte e definir o caminho de leitura consistente para quem acabou de escrever.',
    cta: 'Falar sobre a estratégia de cache do meu sistema',
  },
  related: [
    {
      label: 'Cache semântico para reduzir custo de LLM',
      to: '/blog/cache-semantico-reduzir-custo-llm',
    },
    {
      label: 'Orçamento de latência por etapa: onde cortar quando a resposta demora',
      to: '/blog/orcamento-latencia-por-etapa-onde-cortar-quando-resposta-demora',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The cache entered the system to solve a latency problem and it did, but it brought along a problem nobody measured: there is now a second copy of the truth, and it ages on its own. The classic symptom arrives through support and not through an alert: a customer sees the old balance after paying, a salesperson sees stock that no longer exists, a user disappears from the blocklist and starts receiving messages again. This article shows why TTL is a bet and not a strategy, why invalidating in the wrong place turns a cache into a consistent source of error, what the practical difference is between invalidating and overwriting, why a two-level cache multiplies the problem instead of dividing it, how to calculate the cost of stale data before choosing the policy, and which pattern solves stampede without trading one incident for another.',
  sections: [
    {
      title: 'A cache is not an optimization, it is a second source of truth',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The way a cache usually enters a project hides what it actually is. Someone measures a slow query, puts a Redis read in front of it, the latency chart improves and the pull request is approved as a performance optimization. What just happened, however, is that the system now has two copies of the same data, maintained through different paths, with different guarantees and no mechanism forcing the two to agree. That is not an optimization, it is a data architecture decision, and it deserves the same scrutiny as a replication setup.',
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence is that the right question is never whether the cache is fast, but how long the system tolerates serving a wrong answer. That tolerance varies brutally within the same application. A product listing survives thirty seconds of staleness without anyone noticing. An available balance does not survive two seconds, because the user just made the transfer and is staring at the screen. A list of blocked numbers tolerates no staleness at all, because the consequence of getting it wrong is messaging someone who asked not to be contacted, which is a legal problem and not a UX problem.',
        },
        {
          type: 'table',
          columns: ['Cached data', 'Staleness tolerance', 'Cost of serving the old value', 'Suitable policy'],
          rows: [
            [
              'Product catalog',
              'Minutes',
              'Low: user sees an old price briefly',
              'Plain TTL with background revalidation',
            ],
            [
              'Available stock',
              'Seconds',
              'Medium: selling a nonexistent item, manual refund',
              'Short TTL plus write-time invalidation',
            ],
            [
              'Account balance',
              'Zero when read by its own owner',
              'High: immediate loss of trust',
              'Consistent read for the writer, cache for third parties',
            ],
            [
              'Permissions and roles',
              'Seconds, but only for grants',
              'Critical: access after revocation',
              'Write-time invalidation, short TTL as a safety net',
            ],
            [
              'Blocklist (opt-out)',
              'Zero',
              'Critical: legal risk and fines',
              'Never cache the negative, or invalidate synchronously',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'That table is not a documentation detail, it is the artifact that drives the design. When the classification does not exist, every piece of data ends up under the same policy, and the chosen policy is always the one most convenient for the most common case. That is how an opt-out list ends up with the same five minute TTL as the catalog, and nobody notices until the day a campaign fires at ten thousand numbers that opted out an hour earlier.',
        },
      ],
    },
    {
      title: 'TTL is a bet on a frequency you do not control',
      blocks: [
        {
          type: 'paragraph',
          value:
            'TTL is the most used policy because it is the easiest to implement and the one that requires the least coupling. It is also the policy that guarantees the least. A sixty second TTL does not mean the data is at most sixty seconds old, it means the data is at most sixty seconds old counting from the moment it entered the cache, which is different. If the write happened one millisecond after the read that populated the entry, the error window is the entire TTL. Average staleness is half the TTL, but nobody suffers from the average, they suffer from the worst case, and the worst case is the full TTL.',
        },
        {
          type: 'paragraph',
          value:
            'There is also a second order effect that usually goes unnoticed. TTL makes an implicit bet on write frequency: it works well when the data changes far less often than the TTL, and it wastes work when the data changes far more often. If a record changes every ten minutes and the TTL is one minute, nine out of ten expirations reload exactly the same value, spending a database query without reducing staleness at all. If that same record starts changing every two seconds, a one minute TTL serves stale data on practically every read. The parameter does not adapt, it was the behavior of the data that changed.',
        },
        {
          type: 'diagram',
          value: `TTL ERROR WINDOW (TTL = 60s)

  t=0    read populates the cache with value A
  t=1s   write changes the value in the database to B
  |
  |      cache serves A --------------------------> 59 seconds wrong
  |
  t=60s  entry expires, next read fetches B

  ^ the error window does not depend on the average TTL,
    it depends on where the write falls inside the window


WRITE-TIME INVALIDATION (same scenario)

  t=0    read populates the cache with value A
  t=1s   write changes to B  ->  DELETE of the key
  t=1s   next read misses and fetches B

  ^ error window = duration of the write itself
    cost = coupling between whoever writes and whoever caches`,
        },
        {
          type: 'paragraph',
          value:
            'From that comes the conclusion driving the rest of the design: TTL alone is for data whose staleness is tolerable by definition, not for data whose staleness is tolerable most of the time. For everything else TTL is still useful, but with a different role. It stops being the policy and becomes the safety net that bounds the damage when invalidation fails, and invalidation will fail, because it depends on a network operation that does not participate in the database transaction.',
        },
      ],
    },
    {
      title: 'Invalidating in the wrong place is worse than not invalidating',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common invalidation mistake is not forgetting to invalidate, it is invalidating at the wrong point in the sequence. The order between the database commit and the cache key removal decides whether the system has a millisecond error window or a poisoned entry that survives until the TTL expires. When invalidation happens before the commit, there is an interval where the key is already gone and the database has not confirmed the change yet, and any concurrent read landing in that interval will fetch the old value from the database and write it back into the cache as if it were fresh. The result is a cache holding the old value stamped as recently loaded, and no future write will fix it, because the write that should have invalidated already happened.',
        },
        {
          type: 'code',
          value: `// WRONG: invalidates before the commit.
// A concurrent read reintroduces the old value and it stays until the TTL.
async function updatePriceWrong(productId, newPrice) {
  await cache.del(\`product:\${productId}\`);   // (1) key removed
  await db.transaction(async (tx) => {         // (2) commit only ends here
    await tx.products.update(productId, { price: newPrice });
  });
}

// Between (1) and (2), another request runs:
//   miss -> SELECT (reads the OLD price) -> SET into the cache
// and the cache serves the old price until the TTL expires.


// RIGHT: commit first, invalidate after, with durable retry.
// The error window becomes the duration of the write itself.
async function updatePrice(productId, newPrice) {
  await db.transaction(async (tx) => {
    await tx.products.update(productId, { price: newPrice });
    // Enqueue in the SAME transaction: if the commit fails, the invalidation
    // disappears too. If the commit succeeds, the invalidation is guaranteed.
    await tx.outbox.insert({
      type: 'cache.invalidate',
      key: \`product:\${productId}\`,
      createdAt: new Date(),
    });
  });

  // Fast path: try to invalidate immediately. If it fails, that is fine,
  // the outbox worker will do it again within a few seconds.
  try {
    await cache.del(\`product:\${productId}\`);
  } catch (error) {
    logger.warn({ error, productId }, 'immediate invalidation failed, outbox takes over');
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'The outbox table in the example is not over engineering, it solves the one failure TTL does not cover well. Without it, a momentary Redis outage at the exact instant of the write leaves the stale entry alive for the entire TTL, and if the TTL is long because the data was considered stable, the damage lasts minutes. With it, invalidation gains the same durability as the commit: either both happened or neither did. The cost is one more worker and a few dozen lines, and the benefit is that the TTL policy goes back to being a performance choice instead of an upper bound on error.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth noting the variation that replaces invalidation with overwriting, because it looks better and almost never is. Writing the new value straight into the cache alongside the commit removes the next miss and seems more efficient. The problem is that overwriting is not commutative: if two concurrent writes happen, the order in which they reach the cache may differ from the order in which they reached the database, and the cache ends up holding the older write. Delete does not have that problem because two concurrent removals produce the same state, and the state after them is always to fetch from the database. The practical rule is simple: invalidate by default, overwrite only when there is a monotonic version to compare against so out of order writes can be discarded.',
        },
      ],
    },
    {
      title: 'Stampede: the incident that correct invalidation causes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is a predictable irony along the way: the better the invalidation, the more concentrated the miss becomes. A popular key invalidated at ten in the morning has hundreds of simultaneous requests discovering the miss in the same millisecond, and all of them go to the database to run exactly the same query. That is cache stampede, and it is worse than the slowness the cache was solving, because the database now takes a coordinated spike instead of a distributed load. The extreme case happens when several keys share the same expiration instant, which is common when a deploy populates everything at once.',
        },
        {
          type: 'paragraph',
          value:
            'The solution has three pieces that solve different problems and are often confused. The first is TTL jitter, which spreads expirations over time and prevents an entire group of keys from falling together. The second is a reload lock, which ensures only one request goes to the database while the others wait or serve the old value. The third is background revalidation, which reloads the entry before it actually expires so no user request pays the cost of the miss. None of the three replaces the others, and implementing only the first is the most common mistake because it is the easiest.',
        },
        {
          type: 'code',
          value: `// Read with stampede protection:
// 1) TTL jitter, 2) reload lock, 3) stale value served while reloading.
const TTL_BASE = 300;          // 5 minutes
const JITTER_MAX = 60;         // up to 1 minute of spread
const STALE_WINDOW = 30;       // serve the old value for up to 30s while reloading

function ttlWithJitter(keySeed) {
  // Deterministic per-key jitter: the same key always gets the same offset,
  // so different entries expire at different moments without any single key
  // having an unstable TTL across reloads.
  let hash = 0;
  for (let i = 0; i < keySeed.length; i += 1) {
    hash = (hash * 31 + keySeed.charCodeAt(i)) | 0;
  }
  return TTL_BASE + (Math.abs(hash) % JITTER_MAX);
}

async function readProtected(key, fetchFromDatabase) {
  const raw = await cache.get(key);

  if (raw) {
    const entry = JSON.parse(raw);
    const ageSeconds = (Date.now() - entry.storedAt) / 1000;

    // Still within logical validity: answer directly.
    if (ageSeconds < entry.ttl) return entry.value;

    // Recently expired: serve the old value and trigger a background reload.
    // Only whoever wins the lock reloads; the others keep the old value.
    if (ageSeconds < entry.ttl + STALE_WINDOW) {
      const lock = await cache.set(\`lock:\${key}\`, '1', { nx: true, ex: 10 });
      if (lock) {
        reload(key, fetchFromDatabase).catch((error) =>
          logger.error({ error, key }, 'background reload failed'),
        );
      }
      return entry.value;
    }
  }

  // Real miss or entry too old: only one goes to the database.
  const lock = await cache.set(\`lock:\${key}\`, '1', { nx: true, ex: 10 });
  if (!lock) {
    // Lost the race: short wait, then read what the winner stored.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const secondTry = await cache.get(key);
    if (secondTry) return JSON.parse(secondTry).value;
  }

  return reload(key, fetchFromDatabase);
}

async function reload(key, fetchFromDatabase) {
  try {
    const value = await fetchFromDatabase();
    const ttl = ttlWithJitter(key);
    await cache.set(
      key,
      JSON.stringify({ value, storedAt: Date.now(), ttl }),
      // Physical TTL longer than the logical one: the entry survives so it
      // can be served as stale while the reload happens.
      { ex: ttl + STALE_WINDOW + 10 },
    );
    return value;
  } finally {
    await cache.del(\`lock:\${key}\`);
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'The detail that makes this code work is the separation between logical TTL and physical TTL. The entry carries its own validity deadline inside the value and keeps existing in Redis for a few extra seconds beyond it, and that slack is what allows serving the old value while the reload happens. If the Redis TTL were the only deadline, expiration would erase the entry and there would be no old value to serve, which would put the stampede problem right back where it started.',
        },
      ],
    },
    {
      title: 'Two cache levels, two levels of stale data',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When Redis becomes the bottleneck or when the network cost per read starts to matter, the natural answer is to add an in-process local cache. It is a correct decision in latency terms and it is also the moment when the invalidation problem changes nature. With a distributed cache, invalidating meant removing one key in one place. With a local cache, invalidating means removing the same key in every live process, and there is no removal operation that reaches all of them synchronously and reliably.',
        },
        {
          type: 'diagram',
          value: `INVALIDATION PATH ACROSS TWO LEVELS

  write
    |
    +--> commit in the database
    |
    +--> DELETE in Redis                     <- immediate, one place
    |
    +--> PUBLISH invalidate:product:42       <- broadcast, no guarantee
           |
           +--> pod A  receives -> clears L1  (~1ms)
           +--> pod B  receives -> clears L1  (~1ms)
           +--> pod C  restarting, MISSES the message
                  |
                  +--> serves the old value until the L1 TTL expires

  ^ that is why the L1 TTL has to be short:
    it is the upper bound on error when the broadcast fails`,
        },
        {
          type: 'paragraph',
          value:
            'The rule that comes out of this design is that the local cache TTL is not a performance parameter, it is the maximum inconsistency the system accepts when the invalidation message is lost. A process that was restarting, a two second network partition or a slow consumer are enough to miss the broadcast, and in that case the only mechanism that repairs the state is expiration. So a local cache with a five minute TTL and invalidation broadcast is, in the worst case, a cache with five minutes of staleness, and that is how it should be documented, not as a cache invalidated on write.',
        },
        {
          type: 'table',
          columns: ['Aspect', 'Local cache (L1)', 'Distributed cache (L2)'],
          rows: [
            ['Typical latency', 'Nanoseconds to microseconds', 'Sub-millisecond plus network'],
            ['Invalidation', 'Broadcast with no delivery guarantee', 'Direct and reliable removal'],
            ['Worst case staleness', 'The entire local TTL', 'The duration of the write'],
            ['Behavior on deploy', 'Cold on every new process', 'Preserved across deploys'],
            ['Memory usage', 'Multiplied by the number of processes', 'Single and shared'],
            ['Suitable use', 'Hot, small data tolerant to seconds', 'Shared and larger data'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row summarizes the selection criterion. A local cache pays off when the hot set is small, heavily read and tolerant to a few seconds of staleness, such as tenant configuration, a feature flag table or a type catalog. It is the wrong choice for any data whose wrong read has an external consequence, because its inconsistency is not fixable by invalidation, only by time.',
        },
      ],
    },
    {
      title: 'Measure staleness instead of trusting the hit rate',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The metric every cache dashboard shows is the hit rate, and it is practically useless for the problem discussed here. A ninety eight percent hit rate can mean a healthy cache or a cache serving stale data very efficiently, and the chart is identical in both cases. Worse: when invalidation breaks, the hit rate goes up, because entries stop being removed. The indicator that should trigger the alert moves in the direction that looks good.',
        },
        {
          type: 'paragraph',
          value:
            'What needs to be measured is the divergence rate, and it comes from sampling. A small fraction of the reads that hit the cache, something between a tenth of a percent and one percent depending on volume, also fetches the value from the database, compares the two and records the difference without changing the answer sent to the user. The cost is one extra query in one read out of a thousand, and the return is the only metric that answers the question that matters, which is how often the system lies and for how long.',
        },
        {
          type: 'code',
          value: `// Divergence sampling: measures how much the cache lies, without affecting the answer.
const SAMPLING_RATE = 0.005; // 0.5% of the reads that hit

async function readAudited(key, fetchFromDatabase, metadata) {
  const cachedValue = await readProtected(key, fetchFromDatabase);

  if (Math.random() < SAMPLING_RATE) {
    // Off the response path: never adds latency for the user.
    setImmediate(async () => {
      try {
        const realValue = await fetchFromDatabase();
        const diverged =
          JSON.stringify(cachedValue) !== JSON.stringify(realValue);

        metrics.increment('cache.sample', {
          entity: metadata.entity,
          result: diverged ? 'diverged' : 'equal',
        });

        if (diverged) {
          // The entry age is the most useful part of the alert: it tells you
          // whether the problem is an overly long TTL or a missing invalidation.
          const entry = JSON.parse((await cache.get(key)) || '{}');
          logger.warn(
            {
              key,
              entity: metadata.entity,
              ageMs: entry.storedAt ? Date.now() - entry.storedAt : null,
            },
            'divergence between cache and database',
          );
        }
      } catch (error) {
        logger.debug({ error, key }, 'sample audit failed');
      }
    });
  }

  return cachedValue;
}`,
        },
        {
          type: 'paragraph',
          value:
            'The age field in the log is what turns the metric into a diagnosis. If divergences always appear in entries whose age is close to the TTL, the problem is that the TTL is too long for that entity write frequency, and the fix is to adjust the parameter. If divergences appear in freshly stored entries, the problem is invalidation: some write is not removing the key, or is removing it before the commit and suffering the reintroduction described earlier. Those are two distinct causes with two distinct fixes, and without the age the alert only says something is wrong.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth defining the alert per entity rather than globally, because the acceptable threshold changes with the classification made in the first section. Half a percent divergence in the catalog is expected noise. The same divergence in the blocklist is an incident, and the alert needs to wake someone up.',
        },
      ],
    },
    {
      title: 'The writer own read has to be consistent',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is one case that concentrates nearly every support complaint and that almost no TTL policy solves: the user who just wrote and immediately reads the result. They made the transfer and opened the statement, changed the address and went back to the profile, cancelled the order and refreshed the page. There is no staleness tolerance in that case, because the expectation is not about the system in general, it is about the action the person just took. It is the same read your writes reasoning that applies to read replicas, and the solution takes the same shape.',
        },
        {
          type: 'ordered',
          items: [
            'On write completion, store a recency marker tied to the author, typically session or user identifier, with a short validity in the range of a few seconds.',
            'On every read, check whether an active marker exists for that author and entity before consulting the cache.',
            'If the marker exists, bypass the cache and read straight from the primary source, accepting the higher latency for that specific request.',
            'If the marker does not exist, follow the normal cache path, which serves the overwhelming majority of traffic.',
            'Size the marker validity by the highest replication lag observed at the ninety ninth percentile, not by the average, because the worst case is what generates the complaint.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The advantage of this design is that it pays the cost of consistency only where it is perceived. The volume of reads happening right after a write by the same author is usually a very small fraction of the total, between one and three percent in most products, and that fraction is exactly what generates nearly every cache related support ticket. Trading cache for a direct query in that slice has negligible impact on database load and resolves the most expensive category of complaint to investigate, because it never reproduces in a test environment.',
        },
        {
          type: 'paragraph',
          value:
            'The same recency marker serves a second purpose worth taking advantage of. When it exists, the system knows that entity just changed, and that is exactly the information needed to decide whether it is worth repopulating the cache immediately. Repopulating during a sequence of writes by the same author is waste, because the next write will invalidate it again within seconds. Waiting for the marker to expire before caching again avoids that cycle and is one extra line of condition.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'How do you choose the TTL when the data has no predictable change frequency?',
      answer:
        'The question itself points to the mistake: when change frequency is unpredictable, TTL should not be the main policy but the safety bound of an invalidation based policy. Even so a number has to be chosen, and the way to do it without guessing is to measure the real distribution. Record for a week the interval between consecutive writes of each entity and look at the tenth percentile, that is, the interval below which the ten percent fastest changes sit. A TTL close to that value makes expiration rarely happen before a real change, which reduces useless reloads, while bounding the error window for the case where invalidation failed. There is a variation that works well for entities with heterogeneous behavior, which is deriving the TTL from the age of the data itself: an entity that has not changed in weeks will probably stay that way and can take a long TTL, while one that changed two minutes ago deserves a short one. This is implemented by comparing the record last updated timestamp with the read moment and applying bands, which costs nothing because the timestamp is already in the loaded record. What does not work is picking five minutes because that is the value in the library example.',
    },
    {
      question: 'Is it worth caching query results or only entities by identifier?',
      answer:
        'Caching an entity by identifier is simple because invalidation is obvious: whoever writes the entity knows exactly which key to remove. Caching query results, such as a filtered and paginated listing, is a different and far more expensive decision, because a single write can invalidate an indeterminate number of keys and there is no cheap way to know which. A price change on one product affects every listing sorted by price that contained it, every listing filtered by price range that now includes or excludes it, and every subsequent page of each of those. There are three approaches used in practice. The first is to accept staleness in queries and use a short TTL without trying to invalidate, which works when the listing is navigation and not decision. The second is to version the set: keep a counter per entity or per tenant that becomes part of the query key, so that any write increments the counter and makes all old keys unreachable at once, leaving cleanup to the TTL. The third is to cache only the identifiers returned by the query and resolve the entities individually through the per identifier cache, which reduces query invalidation to changes affecting the set or the ordering rather than changes in content. The second option usually gives the best effort to result ratio, and the third makes the best use of the cache that already exists.',
    },
    {
      question: 'When is it better to remove the cache instead of continuing to fix the policy?',
      answer:
        'The most reliable signal is when the effort of maintaining coherence exceeds the latency gain, and that is measurable rather than subjective. Measure the real latency of the query the cache protects, at the ninety fifth percentile and with current volume, not with the volume from when the cache was introduced. It is common for the query to have become fast for other reasons, an index added later, a normalization, a volume reduction through archiving, while the cache stayed there out of inertia protecting something that is no longer slow. A second signal is the write to read ratio: if the same entity receives writes at a rate comparable to reads, the cache starts spending more on invalidation than it saves on queries, and on top of that it keeps an error window while delivering almost nothing. A third signal, more qualitative but equally valid, is the number of special cases accumulated in the caching layer: when there are more conditions deciding whether something can be cached than business logic in the same file, the cache became the problem. Before removing it, measure the real impact by turning it off behind a flag for a fraction of traffic and comparing latency and database load. It is common for the removal to be undetectable in the charts, and that result is exactly what authorizes deleting the code safely.',
    },
  ],
  conclusion: {
    title: 'A cache is a consistency decision disguised as performance',
    description:
      'Every cache introduces a second source of truth, and the only question that matters is how long the system can serve the wrong version of it without consequence. Answering that per entity, instead of applying the same TTL to everything, is what separates a cache that saves the database from one that produces a data incident. I can classify your system entities by staleness tolerance, design the durable invalidation that survives a Redis failure, implement stampede protection with background revalidation, instrument the divergence sampling that exposes the problem before support does, and define the consistent read path for whoever just wrote.',
    cta: 'Talk about the caching strategy in my system',
  },
  related: [
    {
      label: 'Semantic cache to cut LLM cost',
      to: '/blog/cache-semantico-reduzir-custo-llm',
    },
    {
      label: 'Latency budget per stage: where to cut when the answer is slow',
      to: '/blog/orcamento-latencia-por-etapa-onde-cortar-quando-resposta-demora',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'La caché entró en el sistema para resolver un problema de latencia y lo resolvió, pero trajo consigo un problema que nadie midió: ahora existe una segunda copia de la verdad, y envejece sola. El síntoma clásico llega por soporte y no por la alerta: un cliente ve el saldo antiguo después de pagar, un vendedor ve stock que ya no existe, un usuario desaparece de la lista de bloqueados y vuelve a recibir mensajes. Este artículo muestra por qué el TTL es una apuesta y no una estrategia, por qué invalidar en el lugar equivocado convierte una caché en una fuente consistente de error, cuál es la diferencia práctica entre invalidar y sobrescribir, por qué la caché de dos niveles multiplica el problema en vez de dividirlo, cómo calcular el costo del dato viejo antes de elegir la política, y qué patrón resuelve la estampida sin cambiar un incidente por otro.',
  sections: [
    {
      title: 'La caché no es una optimización, es una segunda fuente de verdad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La forma en que la caché suele entrar en el proyecto esconde lo que realmente es. Alguien mide una consulta lenta, coloca una lectura de Redis delante de ella, el gráfico de latencia mejora y el pull request se aprueba como optimización de rendimiento. Lo que acaba de ocurrir, sin embargo, es que el sistema pasó a tener dos copias del mismo dato, mantenidas por caminos distintos, con garantías distintas y sin ningún mecanismo que obligue a las dos a coincidir. Eso no es una optimización, es una decisión de arquitectura de datos, y merece el mismo rigor que una replicación.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica es que la pregunta correcta nunca es si la caché está rápida, sino cuánto tiempo el sistema tolera servir una respuesta equivocada. Esa tolerancia varía de forma brutal dentro de la misma aplicación. Un listado de productos aguanta treinta segundos de desfase sin que nadie lo note. Un saldo disponible no aguanta dos segundos, porque el usuario acaba de hacer la transferencia y está mirando la pantalla. Una lista de números bloqueados no aguanta ningún desfase, porque la consecuencia de equivocarse es enviar mensaje a quien pidió no recibirlo, lo cual es un problema jurídico y no un problema de UX.',
        },
        {
          type: 'table',
          columns: ['Dato en caché', 'Tolerancia al desfase', 'Costo de servir el valor viejo', 'Política adecuada'],
          rows: [
            [
              'Catálogo de productos',
              'Minutos',
              'Bajo: el usuario ve un precio antiguo poco tiempo',
              'TTL simple con revalidación en segundo plano',
            ],
            [
              'Stock disponible',
              'Segundos',
              'Medio: venta de un ítem inexistente, reembolso manual',
              'TTL corto más invalidación en la escritura',
            ],
            [
              'Saldo de cuenta',
              'Cero en la lectura del propio dueño',
              'Alto: pérdida de confianza inmediata',
              'Lectura consistente para el autor de la escritura, caché para terceros',
            ],
            [
              'Permisos y roles',
              'Segundos, pero solo para conceder',
              'Crítico: acceso después de la revocación',
              'Invalidación en la escritura, TTL corto como red de seguridad',
            ],
            [
              'Lista de bloqueo (opt-out)',
              'Cero',
              'Crítico: riesgo jurídico y multa',
              'Nunca cachear la negativa, o invalidar de forma síncrona',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Esa tabla no es un detalle de documentación, es el artefacto que decide el diseño. Cuando esa clasificación no existe, todos los datos terminan recibiendo la misma política, y la política elegida es siempre la más conveniente para el caso más común. Así es como una lista de opt-out termina con el mismo TTL de cinco minutos que el catálogo, y nadie lo nota hasta el día en que una campaña dispara a diez mil números que salieron una hora antes.',
        },
      ],
    },
    {
      title: 'El TTL es una apuesta sobre una frecuencia que no controlas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El TTL es la política más usada porque es la más fácil de implementar y la que menos acoplamiento exige. También es la política que menos garantiza. Un TTL de sesenta segundos no significa que el dato tiene como máximo sesenta segundos de antigüedad, significa que tiene como máximo sesenta segundos contados desde el momento en que entró en la caché, lo cual es distinto. Si la escritura ocurrió un milisegundo después de la lectura que pobló la entrada, la ventana de error es el TTL entero. El desfase promedio es la mitad del TTL, pero nadie sufre con el promedio, sufre con el peor caso, y el peor caso es el TTL completo.',
        },
        {
          type: 'paragraph',
          value:
            'Existe además un efecto de segundo orden que suele pasar desapercibido. El TTL hace una apuesta implícita sobre la frecuencia de escritura: funciona bien cuando el dato cambia con una frecuencia mucho menor que el TTL, y desperdicia trabajo cuando el dato cambia con una frecuencia mucho mayor. Si un registro cambia cada diez minutos y el TTL es de un minuto, nueve de cada diez expiraciones recargan exactamente el mismo valor, gastando consulta a la base sin reducir desfase alguno. Si ese mismo registro pasa a cambiar cada dos segundos, el TTL de un minuto entrega dato viejo en prácticamente toda lectura. El parámetro no se adapta, lo que cambió fue el comportamiento del dato.',
        },
        {
          type: 'diagram',
          value: `VENTANA DE ERROR DEL TTL (TTL = 60s)

  t=0    la lectura puebla la cache con el valor A
  t=1s   la escritura cambia el valor en la base a B
  |
  |      la cache sirve A ------------------------> 59 segundos equivocada
  |
  t=60s  la entrada expira, la proxima lectura busca B

  ^ la ventana de error no depende del TTL promedio,
    depende de donde cae la escritura dentro de la ventana


INVALIDACION EN LA ESCRITURA (mismo escenario)

  t=0    la lectura puebla la cache con el valor A
  t=1s   la escritura cambia a B  ->  DELETE de la clave
  t=1s   la proxima lectura falla y busca B

  ^ ventana de error = duracion de la propia escritura
    costo = acoplamiento entre quien escribe y quien cachea`,
        },
        {
          type: 'paragraph',
          value:
            'De ahí sale la conclusión que orienta el resto del diseño: el TTL solo sirve para dato cuyo desfase es tolerable por definición, no para dato cuyo desfase es tolerable la mayor parte del tiempo. Para todo lo demás el TTL sigue siendo útil, pero con otro papel. Deja de ser la política y pasa a ser la red de seguridad que limita el daño cuando la invalidación falla, y la invalidación va a fallar, porque depende de una operación de red que no participa de la transacción de la base.',
        },
      ],
    },
    {
      title: 'Invalidar en el lugar equivocado es peor que no invalidar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error más común en la invalidación no es olvidarse de invalidar, es invalidar en el punto equivocado de la secuencia. El orden entre el commit en la base y la eliminación de la clave en la caché decide si el sistema tiene una ventana de error de milisegundos o una entrada envenenada que sobrevive hasta que expire el TTL. Cuando la invalidación ocurre antes del commit, existe un intervalo en el que la clave ya fue eliminada y la base todavía no confirmó el cambio, y cualquier lectura concurrente que caiga en ese intervalo va a buscar el valor antiguo en la base y a grabarlo de vuelta en la caché como si fuera nuevo. El resultado es una caché que contiene el valor viejo con el sello de recién cargado, y ninguna escritura futura lo va a corregir, porque la escritura que debía invalidar ya ocurrió.',
        },
        {
          type: 'code',
          value: `// INCORRECTO: invalida antes del commit.
// Una lectura concurrente reintroduce el valor antiguo y queda hasta el TTL.
async function actualizarPrecioIncorrecto(productoId, nuevoPrecio) {
  await cache.del(\`producto:\${productoId}\`); // (1) clave eliminada
  await db.transaction(async (tx) => {         // (2) el commit solo termina aqui
    await tx.productos.update(productoId, { precio: nuevoPrecio });
  });
}

// Entre (1) y (2), otra peticion ejecuta:
//   miss -> SELECT (lee el precio ANTIGUO) -> SET en la cache
// y la cache pasa a servir el precio antiguo hasta que expire el TTL.


// CORRECTO: commit primero, invalidacion despues, con reintento durable.
// La ventana de error pasa a ser la duracion de la propia escritura.
async function actualizarPrecio(productoId, nuevoPrecio) {
  await db.transaction(async (tx) => {
    await tx.productos.update(productoId, { precio: nuevoPrecio });
    // Encolar en la MISMA transaccion: si el commit falla, la invalidacion
    // tambien desaparece. Si el commit pasa, la invalidacion esta garantizada.
    await tx.outbox.insert({
      tipo: 'cache.invalidate',
      clave: \`producto:\${productoId}\`,
      creadoEn: new Date(),
    });
  });

  // Camino rapido: intenta invalidar de inmediato. Si falla, no importa,
  // el worker del outbox lo hace de nuevo en pocos segundos.
  try {
    await cache.del(\`producto:\${productoId}\`);
  } catch (error) {
    logger.warn({ error, productoId }, 'la invalidacion inmediata fallo, el outbox asume');
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'La tabla outbox del ejemplo no es exceso de ingeniería, resuelve la única falla que el TTL no cubre bien. Sin ella, una indisponibilidad momentánea de Redis en el instante exacto de la escritura deja la entrada vieja viva durante el TTL entero, y si el TTL es largo porque el dato se consideraba estable, el daño dura minutos. Con ella, la invalidación pasa a tener la misma durabilidad del commit: o las dos cosas ocurrieron, o ninguna. El costo es un worker más y algunas decenas de líneas, y el beneficio es que la política de TTL vuelve a ser una elección de rendimiento en vez de un límite superior de error.',
        },
        {
          type: 'paragraph',
          value:
            'Vale registrar la variación que cambia invalidación por sobrescritura, porque parece mejor y casi nunca lo es. Escribir el nuevo valor directo en la caché junto con el commit elimina el siguiente miss y parece más eficiente. El problema es que la sobrescritura no es conmutativa: si ocurren dos escrituras concurrentes, el orden en que llegan a la caché puede ser distinto del orden en que llegaron a la base, y la caché termina con el valor de la escritura más antigua. El delete no tiene ese problema porque dos eliminaciones concurrentes producen el mismo estado, y el estado después de ellas es siempre buscar en la base. La regla práctica es simple: invalidar por defecto, sobrescribir solo cuando existe una versión monotónica para comparar y descartar la escritura fuera de orden.',
        },
      ],
    },
    {
      title: 'Estampida: el incidente que provoca la invalidación correcta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe una ironía previsible en el camino: cuanto mejor la invalidación, más concentrado queda el miss. Una clave popular invalidada a las diez de la mañana tiene cientos de peticiones simultáneas descubriendo la falla en el mismo milisegundo, y todas van a la base a hacer exactamente la misma consulta. Eso es la estampida de caché, y es peor que la lentitud que la caché resolvía, porque ahora la base recibe un pico coordinado en vez de una carga distribuida. El caso extremo ocurre cuando varias claves comparten el mismo instante de expiración, algo común cuando un despliegue puebla todo al mismo tiempo.',
        },
        {
          type: 'paragraph',
          value:
            'La solución tiene tres piezas que resuelven problemas distintos y suelen confundirse. La primera es el jitter en el TTL, que dispersa las expiraciones en el tiempo y evita que un grupo entero de claves caiga junto. La segunda es el bloqueo de recarga, que garantiza que solo una petición vaya a la base mientras las otras esperan o sirven el valor antiguo. La tercera es la revalidación en segundo plano, que recarga la entrada antes de que expire de hecho, para que ninguna petición de usuario pague el costo del miss. Ninguna de las tres sustituye a las otras, e implementar solo la primera es el error más común porque es la más fácil.',
        },
        {
          type: 'code',
          value: `// Lectura con proteccion contra estampida:
// 1) jitter en el TTL, 2) lock de recarga, 3) valor antiguo servido mientras recarga.
const TTL_BASE = 300;          // 5 minutos
const JITTER_MAX = 60;         // hasta 1 minuto de dispersion
const VENTANA_STALE = 30;      // servir el valor antiguo hasta 30s durante la recarga

function ttlConJitter(semillaClave) {
  // Jitter determinista por clave: la misma clave recibe siempre el mismo
  // desplazamiento, entonces entradas distintas expiran en momentos distintos
  // sin que una sola clave quede con TTL inestable entre recargas.
  let hash = 0;
  for (let i = 0; i < semillaClave.length; i += 1) {
    hash = (hash * 31 + semillaClave.charCodeAt(i)) | 0;
  }
  return TTL_BASE + (Math.abs(hash) % JITTER_MAX);
}

async function leerConProteccion(clave, buscarEnLaBase) {
  const bruto = await cache.get(clave);

  if (bruto) {
    const entrada = JSON.parse(bruto);
    const edadSegundos = (Date.now() - entrada.grabadoEn) / 1000;

    // Todavia dentro de la validez logica: respuesta directa.
    if (edadSegundos < entrada.ttl) return entrada.valor;

    // Expirado hace poco: sirve el antiguo y dispara la recarga en background.
    // Solo quien consiga el lock recarga; los demas siguen con el antiguo.
    if (edadSegundos < entrada.ttl + VENTANA_STALE) {
      const lock = await cache.set(\`lock:\${clave}\`, '1', { nx: true, ex: 10 });
      if (lock) {
        recargar(clave, buscarEnLaBase).catch((error) =>
          logger.error({ error, clave }, 'la recarga en background fallo'),
        );
      }
      return entrada.valor;
    }
  }

  // Miss real o entrada demasiado vieja: solo uno va a la base.
  const lock = await cache.set(\`lock:\${clave}\`, '1', { nx: true, ex: 10 });
  if (!lock) {
    // Perdio la carrera: espera corta e intenta leer lo que grabo el ganador.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const segundoIntento = await cache.get(clave);
    if (segundoIntento) return JSON.parse(segundoIntento).valor;
  }

  return recargar(clave, buscarEnLaBase);
}

async function recargar(clave, buscarEnLaBase) {
  try {
    const valor = await buscarEnLaBase();
    const ttl = ttlConJitter(clave);
    await cache.set(
      clave,
      JSON.stringify({ valor, grabadoEn: Date.now(), ttl }),
      // TTL fisico mayor que el logico: la entrada sobrevive para poder
      // ser servida como stale mientras ocurre la recarga.
      { ex: ttl + VENTANA_STALE + 10 },
    );
    return valor;
  } finally {
    await cache.del(\`lock:\${clave}\`);
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que hace funcionar ese código es la separación entre TTL lógico y TTL físico. La entrada guarda su propio plazo de validez dentro del valor y sigue existiendo en Redis por algunos segundos más después de eso, y es ese margen el que permite servir el valor antiguo mientras ocurre la recarga. Si el TTL de Redis fuera el único plazo, la expiración borraría la entrada y no habría valor antiguo para servir, lo que devolvería el problema de la estampida exactamente donde estaba.',
        },
      ],
    },
    {
      title: 'Dos niveles de caché, dos niveles de dato viejo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando Redis se vuelve el cuello de botella o cuando el costo de red por lectura empieza a pesar, la respuesta natural es agregar una caché local dentro del proceso. Es una decisión correcta en términos de latencia y es también el momento en que el problema de invalidación cambia de naturaleza. Con la caché distribuida, invalidar era eliminar una clave en un lugar. Con la caché local, invalidar pasa a ser eliminar la misma clave en todos los procesos vivos, y no existe operación de eliminación que alcance a todos ellos de forma síncrona y confiable.',
        },
        {
          type: 'diagram',
          value: `CAMINO DE LA INVALIDACION EN DOS NIVELES

  escritura
    |
    +--> commit en la base
    |
    +--> DELETE en Redis                     <- inmediato, un lugar
    |
    +--> PUBLISH invalidate:producto:42      <- broadcast, sin garantia
           |
           +--> pod A  recibe -> limpia L1   (~1ms)
           +--> pod B  recibe -> limpia L1   (~1ms)
           +--> pod C  reiniciando, PIERDE el mensaje
                  |
                  +--> sirve el valor viejo hasta que expire el TTL de L1

  ^ por eso el TTL de L1 tiene que ser corto:
    es el limite superior del error cuando el broadcast falla`,
        },
        {
          type: 'paragraph',
          value:
            'La regla que sale de ese diseño es que el TTL de la caché local no es un parámetro de rendimiento, es el tiempo máximo de inconsistencia que el sistema acepta cuando el mensaje de invalidación se pierde. Un proceso que estaba reiniciando, una partición de red de dos segundos o un consumidor lento bastan para perder el broadcast, y en ese caso el único mecanismo que corrige el estado es la expiración. Por eso una caché local con TTL de cinco minutos y broadcast de invalidación es, en el peor caso, una caché con cinco minutos de desfase, y así debe documentarse, no como una caché invalidada en la escritura.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Caché local (L1)', 'Caché distribuida (L2)'],
          rows: [
            ['Latencia típica', 'Nanosegundos a microsegundos', 'Submilisegundo más red'],
            ['Invalidación', 'Broadcast sin garantía de entrega', 'Eliminación directa y confiable'],
            ['Peor caso de desfase', 'El TTL local entero', 'La duración de la escritura'],
            ['Comportamiento en el despliegue', 'Frío en cada proceso nuevo', 'Preservado entre despliegues'],
            ['Consumo de memoria', 'Multiplicado por el número de procesos', 'Único y compartido'],
            ['Uso adecuado', 'Dato caliente, pequeño y tolerante a segundos', 'Dato compartido y más grande'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila resume el criterio de elección. La caché local rinde cuando el conjunto caliente es pequeño, muy leído y tolerante a algunos segundos de desfase, como la configuración de tenant, la tabla de feature flags o un catálogo de tipos. Es la elección equivocada para cualquier dato cuya lectura errónea tenga consecuencia externa, porque su inconsistencia no se corrige por invalidación, solo por tiempo.',
        },
      ],
    },
    {
      title: 'Medir el desfase en vez de confiar en la tasa de acierto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La métrica que todo panel de caché muestra es la tasa de acierto, y es prácticamente inútil para el problema tratado aquí. Una tasa de acierto del noventa y ocho por ciento puede significar una caché sana o una caché que sirve dato viejo con mucha eficiencia, y el gráfico es idéntico en los dos casos. Peor: cuando la invalidación se rompe, la tasa de acierto sube, porque las entradas dejan de ser eliminadas. El indicador que debería disparar la alerta se mueve en la dirección que parece buena.',
        },
        {
          type: 'paragraph',
          value:
            'Lo que hay que medir es la tasa de divergencia, y se obtiene por muestreo. Una fracción pequeña de las lecturas que aciertan la caché, algo entre una décima y un uno por ciento según el volumen, busca también el valor en la base, compara los dos y registra la diferencia sin alterar la respuesta enviada al usuario. El costo es una consulta extra en una lectura entre mil, y el retorno es la única métrica que responde a la pregunta que importa, que es con qué frecuencia el sistema miente y por cuánto tiempo.',
        },
        {
          type: 'code',
          value: `// Muestreo de divergencia: mide cuanto miente la cache, sin afectar la respuesta.
const TASA_MUESTREO = 0.005; // 0,5% de las lecturas con acierto

async function leerConAuditoria(clave, buscarEnLaBase, metadatos) {
  const valorEnCache = await leerConProteccion(clave, buscarEnLaBase);

  if (Math.random() < TASA_MUESTREO) {
    // Fuera del camino de la respuesta: nunca aumenta la latencia del usuario.
    setImmediate(async () => {
      try {
        const valorReal = await buscarEnLaBase();
        const divergente =
          JSON.stringify(valorEnCache) !== JSON.stringify(valorReal);

        metrics.increment('cache.muestra', {
          entidad: metadatos.entidad,
          resultado: divergente ? 'divergente' : 'igual',
        });

        if (divergente) {
          // La edad de la entrada es el dato mas util de la alerta: dice si el
          // problema es un TTL demasiado largo o una invalidacion que no ocurrio.
          const entrada = JSON.parse((await cache.get(clave)) || '{}');
          logger.warn(
            {
              clave,
              entidad: metadatos.entidad,
              edadMs: entrada.grabadoEn ? Date.now() - entrada.grabadoEn : null,
            },
            'divergencia entre cache y base',
          );
        }
      } catch (error) {
        logger.debug({ error, clave }, 'la auditoria de muestra fallo');
      }
    });
  }

  return valorEnCache;
}`,
        },
        {
          type: 'paragraph',
          value:
            'El campo de edad en el log es lo que transforma la métrica en diagnóstico. Si las divergencias aparecen siempre en entradas con edad cercana al TTL, el problema es que el TTL está demasiado largo para la frecuencia de escritura de esa entidad, y la corrección es ajustar el parámetro. Si las divergencias aparecen en entradas recién grabadas, el problema es la invalidación: alguna escritura no está eliminando la clave, o la está eliminando antes del commit y sufriendo la reintroducción descrita antes. Son dos causas distintas con dos correcciones distintas, y sin la edad la alerta solo informa que algo está mal.',
        },
        {
          type: 'paragraph',
          value:
            'Conviene definir la alerta por entidad y no de forma global, porque el umbral aceptable cambia con la clasificación hecha en la primera sección. Media décima de divergencia en el catálogo es ruido esperado. La misma divergencia en la lista de bloqueo es un incidente, y la alerta necesita despertar a alguien.',
        },
      ],
    },
    {
      title: 'La lectura del propio autor tiene que ser consistente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe un caso que concentra casi todas las quejas de soporte y que casi ninguna política de TTL resuelve: el usuario que acaba de escribir e inmediatamente lee el resultado. Hizo la transferencia y abrió el extracto, cambió la dirección y volvió al perfil, canceló el pedido y actualizó la página. En ese caso no existe tolerancia al desfase, porque la expectativa no es sobre el sistema en general, es sobre la acción que la persona acaba de tomar. Es el mismo razonamiento de consistencia de lectura de la propia escritura que se aplica a las réplicas de lectura, y la solución tiene la misma forma.',
        },
        {
          type: 'ordered',
          items: [
            'Al concluir una escritura, grabar una marca de recencia asociada al autor, típicamente sesión o identificador de usuario, con validez corta del orden de pocos segundos.',
            'En toda lectura, verificar si existe una marca activa para ese autor y esa entidad antes de consultar la caché.',
            'Si la marca existe, ignorar la caché y leer directo de la fuente primaria, aceptando la mayor latencia para esa petición específica.',
            'Si la marca no existe, seguir el camino normal de caché, que atiende a la abrumadora mayoría del tráfico.',
            'Dimensionar la validez de la marca por el mayor atraso de replicación observado en el percentil noventa y nueve, y no por el promedio, porque es el peor caso el que genera la queja.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La ventaja de ese diseño es que paga el costo de la consistencia solo donde se percibe. El volumen de lecturas que ocurren justo después de una escritura del mismo autor suele ser una fracción muy pequeña del total, entre uno y tres por ciento en la mayoría de los productos, y es justamente esa fracción la que genera casi todos los tickets de soporte relacionados con caché. Cambiar caché por consulta directa en ese recorte tiene un impacto despreciable en la carga de la base y resuelve la categoría de queja más cara de investigar, porque nunca se reproduce en el ambiente de pruebas.',
        },
        {
          type: 'paragraph',
          value:
            'La misma marca de recencia sirve para un segundo propósito que vale aprovechar. Cuando existe, el sistema sabe que esa entidad acaba de cambiar, y esa es exactamente la información necesaria para decidir si vale o no repoblar la caché de inmediato. Repoblar durante una secuencia de escrituras del mismo autor es desperdicio, porque la próxima escritura la va a invalidar de nuevo en segundos. Esperar a que la marca expire antes de volver a cachear evita ese ciclo y es una línea más de condición.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cómo elegir el TTL cuando el dato no tiene una frecuencia de cambio previsible?',
      answer:
        'La pregunta en sí apunta al error: cuando la frecuencia de cambio es imprevisible, el TTL no debe ser la política principal, sino el límite de seguridad de una política basada en invalidación. Aun así hay que elegir un número, y la forma de hacerlo sin adivinar es medir la distribución real. Registre durante una semana el intervalo entre escrituras consecutivas de cada entidad y mire el percentil diez, es decir, el intervalo por debajo del cual están el diez por ciento de los cambios más rápidos. Un TTL cercano a ese valor hace que la expiración raramente ocurra antes de un cambio real, lo que reduce recargas inútiles, al mismo tiempo que limita la ventana de error para el caso en que la invalidación falló. Existe una variación que funciona bien para entidades con comportamiento heterogéneo, que es derivar el TTL de la propia antigüedad del dato: una entidad que no cambia hace semanas probablemente va a seguir así y puede recibir TTL largo, mientras que una que cambió hace dos minutos merece TTL corto. Eso se implementa comparando el timestamp de última actualización del registro con el momento de la lectura y aplicando franjas, lo que no cuesta nada porque el timestamp ya está en el registro cargado. Lo que no funciona es elegir cinco minutos porque es el valor que apareció en el ejemplo de la biblioteca.',
    },
    {
      question: '¿Vale la pena cachear resultados de consulta o solo entidades por identificador?',
      answer:
        'Cachear entidad por identificador es simple porque la invalidación es obvia: quien escribe la entidad sabe exactamente qué clave eliminar. Cachear resultado de consulta, como un listado filtrado y paginado, es una decisión distinta y mucho más cara, porque una sola escritura puede invalidar un número indeterminado de claves y no existe forma barata de saber cuáles. Un cambio de precio de un producto afecta a todo listado ordenado por precio que lo contenía, a todo listado filtrado por rango de precio que pasa a incluirlo o excluirlo, y a todas las páginas siguientes de cada uno de ellos. Existen tres salidas usadas en la práctica. La primera es aceptar desfase en las consultas y usar TTL corto sin intentar invalidar, lo que funciona cuando el listado es navegación y no decisión. La segunda es versionar el conjunto: mantener un contador por entidad o por tenant que entra en la composición de la clave de la consulta, de modo que cualquier escritura incremente el contador y vuelva inalcanzables todas las claves antiguas de una vez, quedando la limpieza a cargo del TTL. La tercera es cachear solo los identificadores devueltos por la consulta y resolver las entidades individualmente por la caché por identificador, lo que reduce la invalidación de la consulta a cambios que afectan al conjunto o al orden, y no a cambios de contenido. La segunda opción suele dar la mejor relación entre esfuerzo y resultado, y la tercera es la que mejor aprovecha la caché que ya existe.',
    },
    {
      question: '¿Cuándo es mejor quitar la caché en vez de seguir corrigiendo la política?',
      answer:
        'La señal más confiable es cuando el esfuerzo de mantener la coherencia pasa a ser mayor que la ganancia de latencia, y eso es medible en vez de subjetivo. Mida la latencia real de la consulta que la caché protege, en el percentil noventa y cinco y con el volumen actual, y no con el volumen de cuando la caché fue introducida. Es común que la consulta se haya vuelto rápida por otros motivos, un índice que entró después, una normalización, una reducción de volumen por archivado, y que la caché haya seguido ahí por inercia protegiendo algo que ya no es lento. Una segunda señal es la proporción entre escritura y lectura: si la misma entidad recibe escrituras a un ritmo comparable al de las lecturas, la caché pasa a gastar más en invalidación de lo que ahorra en consulta, y además mantiene una ventana de error sin entregar casi nada. Una tercera señal, más cualitativa pero igualmente válida, es el número de casos especiales acumulados en la capa de caché: cuando existen más condiciones para decidir si se puede cachear que lógica de negocio en el mismo archivo, la caché se volvió el problema. Antes de quitarla, mida el impacto real apagándola detrás de una flag en una fracción del tráfico y comparando latencia y carga de la base. Es común que la remoción no sea detectable en los gráficos, y es justamente ese resultado el que autoriza borrar el código con seguridad.',
    },
  ],
  conclusion: {
    title: 'La caché es una decisión de consistencia disfrazada de rendimiento',
    description:
      'Toda caché introduce una segunda fuente de verdad, y la única pregunta que importa es por cuánto tiempo el sistema puede servir la versión equivocada de ella sin consecuencia. Responder eso por entidad, en vez de aplicar el mismo TTL a todo, es lo que separa una caché que ahorra base de datos de una que produce un incidente de datos. Puedo clasificar las entidades de su sistema por tolerancia al desfase, diseñar la invalidación durable que sobrevive a una falla de Redis, implementar la protección contra estampida con revalidación en segundo plano, instrumentar el muestreo de divergencia que revela el problema antes que soporte y definir el camino de lectura consistente para quien acaba de escribir.',
    cta: 'Hablar sobre la estrategia de caché de mi sistema',
  },
  related: [
    {
      label: 'Caché semántica para reducir el costo de LLM',
      to: '/blog/cache-semantico-reduzir-custo-llm',
    },
    {
      label: 'Presupuesto de latencia por etapa: dónde cortar cuando la respuesta demora',
      to: '/blog/orcamento-latencia-por-etapa-onde-cortar-quando-resposta-demora',
    },
    {
      label: 'Arquitectura y modernización de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
