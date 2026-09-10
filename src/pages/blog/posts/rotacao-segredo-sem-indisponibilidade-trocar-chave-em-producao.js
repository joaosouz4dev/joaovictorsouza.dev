// Conteudo do artigo: rotacao de segredo sem indisponibilidade.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A chave da integração de pagamentos foi trocada às vinte e duas horas de uma quinta-feira, dentro de uma janela combinada com o parceiro, e o novo valor entrou em produção em quarenta segundos. Às vinte e duas e três minutos, quarenta por cento dos webhooks recebidos passaram a ser rejeitados por assinatura inválida, e às vinte e duas e onze o time reverteu para a chave antiga, que já tinha sido revogada do outro lado. Este artigo mostra por que a troca atômica de segredo é a origem da indisponibilidade e não a solução dela, por que verificar precisa aceitar um conjunto de chaves enquanto emitir usa apenas uma, quais são as quatro fases da rotação e qual delas concentra todos os incidentes, o que impede na prática a retirada da chave antiga mesmo depois de todo mundo ter migrado, como a métrica de uso por identificador de chave transforma a retirada numa decisão observável em vez de um palpite, e quais alertas separam uma rotação que terminou de uma que apenas parou de doer.',
  sections: [
    {
      title: 'A troca atômica é a causa da indisponibilidade, não a solução',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O modelo mental que produz o incidente é o de que um segredo é um valor único, guardado num lugar único, e que rotacionar significa substituir esse valor por outro num instante determinado. Esse modelo funcionaria se o sistema fosse um único processo lendo uma única variável, e é falso em qualquer arquitetura que tenha mais de uma instância. Na prática o segredo está simultaneamente no gerenciador de segredos, na variável de ambiente do contêiner que subiu há três dias, no cache em memória do processo que leu a variável uma vez na inicialização, no painel de configuração do parceiro externo, no token que já foi emitido e ainda não expirou, e na fila de mensagens que guarda uma requisição assinada esperando processamento. Trocar o valor na origem não troca nenhuma dessas cópias no mesmo instante.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência é que existe sempre uma janela de propagação, e ela não é um detalhe operacional que pode ser encurtado até desaparecer. Ela é composta pelo tempo de detecção do gerenciador de segredos, pelo tempo de reinício ou de recarga de cada instância, pelo tempo de vida do cache local, pelo tempo de vida dos tokens já emitidos e pelo tempo que o parceiro externo leva para aplicar a mudança do lado dele, que pode ser de dias. Durante essa janela, parte do sistema conhece a chave nova e parte conhece a antiga, e as duas partes precisam conseguir conversar. Uma troca atômica declara por decreto que a janela tem duração zero, e todo tráfego que cai dentro dela falha.',
        },
        {
          type: 'diagram',
          value: `TROCA ATOMICA (o que quebra)

  t0: chave K1 em todo lugar          verificacao: aceita K1
  t1: gerenciador passa a servir K2   emissao: K2 em 2 de 12 instancias
      |
      +-> instancia A (reiniciada)  assina com K2 -> receptor so aceita K1  FALHA
      +-> instancia B (nao reiniciada) assina com K1 -> parceiro so aceita K2  FALHA
      +-> webhook em voo assinado com K1 chega em t1+3s                      FALHA
      +-> token JWT emitido em t0-600s ainda valido por mais 3000s           FALHA

  Janela de falha = max(propagacao interna, TTL de token, aplicacao no parceiro)


ROTACAO POR CONJUNTO (o que funciona)

  fase 1  verifica: {K1, K2}   assina: K1     <- K2 introduzida, ninguem usa ainda
  fase 2  verifica: {K1, K2}   assina: K1     <- propaga ate 100% conhecer K2
  fase 3  verifica: {K1, K2}   assina: K2     <- promocao: so muda quem EMITE
  fase 4  verifica: {K2}       assina: K2     <- retirada, apos uso de K1 zerar

  Em nenhuma fase existe instante em que quem verifica desconhece
  a chave que alguem esta usando para assinar.`,
        },
        {
          type: 'paragraph',
          value:
            'A inversão que resolve o problema é simples de enunciar e incômoda de aceitar: durante a rotação, o segredo deixa de ser um valor e passa a ser um conjunto. Quem verifica aceita todos os membros válidos do conjunto, quem emite escolhe exatamente um. Como verificar é uma operação tolerante e emitir é uma operação exclusiva, é possível introduzir uma chave nova sem que nada mude de comportamento, propagar essa introdução no ritmo que a infraestrutura permitir e só então mover a emissão. A troca deixa de ser um evento instantâneo e vira uma transição com quatro estados observáveis, e a indisponibilidade desaparece porque em nenhum momento existe alguém verificando com um conjunto que não contém a chave que o outro lado está usando.',
        },
      ],
    },
    {
      title: 'Verificar aceita o conjunto, emitir escolhe um: a assimetria que sustenta tudo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A implementação dessa ideia exige uma mudança pequena no código e uma mudança grande no formato do que trafega. A mudança no código é aceitar uma lista de chaves na verificação em vez de uma só. A mudança no formato é que a mensagem precisa carregar o identificador da chave que a assinou, porque sem esse identificador a verificação vira uma tentativa por força bruta contra todos os membros do conjunto, e isso custa tempo de CPU proporcional ao tamanho do conjunto além de destruir a possibilidade de medir quem ainda usa o quê. O identificador de chave não é um enfeite, ele é o que torna a rotação observável.',
        },
        {
          type: 'paragraph',
          value:
            'Vale insistir num ponto de segurança que costuma ser tratado como detalhe: a comparação da assinatura precisa ser feita em tempo constante. Uma comparação de bytes que retorna assim que encontra a primeira diferença vaza, pelo tempo de resposta, quantos bytes iniciais estavam corretos, e isso permite que um atacante descubra a assinatura correta byte a byte com um número de tentativas linear em vez de exponencial. Em rotação isso importa ainda mais, porque o conjunto de chaves aceitas aumenta a superfície: cada chave adicional é mais uma comparação, e uma implementação ingênua que testa a chave nova primeiro e a antiga depois acaba respondendo mais devagar para mensagens assinadas com a chave antiga, o que por si só já revela informação sobre o estado da rotação.',
        },
        {
          type: 'code',
          value: `import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

// O segredo e um CONJUNTO. Cada membro tem identificador, estado e material.
// Estados: 'pending'   -> aceita na verificacao, nunca escolhida para assinar
//          'active'    -> aceita na verificacao, escolhida para assinar
//          'retiring'  -> aceita na verificacao, nao assina mais
//          'revoked'   -> fora do conjunto, rejeitada
const chaveiro = {
  'k-2026-03': { estado: 'retiring', material: process.env.SIGNING_KEY_2026_03 },
  'k-2026-09': { estado: 'active', material: process.env.SIGNING_KEY_2026_09 },
};

const assinar = (corpo) => {
  const entrada = Object.entries(chaveiro).find(([, k]) => k.estado === 'active');
  if (!entrada) throw new Error('chaveiro sem chave ativa: emissao bloqueada');

  const [kid, chave] = entrada;
  const assinatura = createHmac('sha256', chave.material).update(corpo).digest('hex');

  // O kid viaja com a mensagem. Sem ele nao ha como medir uso por chave
  // nem como verificar em tempo O(1) em vez de O(tamanho do conjunto).
  return { kid, assinatura };
};

const comparaConstante = (a, b) => {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual exige mesmo tamanho: compara o tamanho antes, sem vazar
  // o conteudo, e so entao compara os bytes em tempo constante.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

const verificar = ({ corpo, kid, assinatura }) => {
  const chave = chaveiro[kid];

  // Chave desconhecida ou revogada: rejeita sem tentar as outras.
  if (!chave || chave.estado === 'revoked') {
    metricas.assinaturaRejeitada({ kid, motivo: 'kid_desconhecido' });
    return false;
  }

  const esperada = createHmac('sha256', chave.material).update(corpo).digest('hex');
  const valida = comparaConstante(assinatura, esperada);

  // A metrica por kid e o que permite decidir a retirada com evidencia.
  metricas.verificacao({ kid, estado: chave.estado, valida });
  return valida;
};

// Emissao de uma chave nova: entra como 'pending', nunca como 'active'.
// Promover na mesma operacao em que se introduz e repetir a troca atomica.
const introduzirChave = () => ({
  kid: \`k-\${new Date().toISOString().slice(0, 7)}\`,
  estado: 'pending',
  material: randomBytes(32).toString('hex'),
});`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que mais evita retrabalho está na última função do exemplo. Uma chave nova entra sempre no estado que é aceito na verificação mas nunca escolhido para assinar, e a promoção é uma operação separada, executada depois. Times que introduzem e promovem no mesmo passo reconstroem exatamente a troca atômica que estavam tentando evitar, com a diferença de que agora acreditam estar protegidos porque o código tem um chaveiro. A separação entre introduzir e promover é o que dá à infraestrutura o tempo de propagação de que ela precisa, e é o que permite que a promoção seja revertida em segundos sem que nada tenha sido revogado.',
        },
      ],
    },
    {
      title: 'As quatro fases e a única delas que causa incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A rotação bem executada tem quatro fases, e cada uma responde a uma pergunta diferente com um critério de saída objetivo. A fase de introdução coloca a chave nova no conjunto aceito por todos os verificadores, sem que ninguém a use para assinar. A fase de propagação espera até que a introdução tenha alcançado cem por cento das instâncias, réplicas e parceiros. A fase de promoção move a emissão para a chave nova, mantendo a antiga aceita. A fase de retirada remove a chave antiga do conjunto aceito. Três dessas fases são reversíveis em segundos e praticamente não produzem incidentes. A quarta é irreversível e concentra quase todas as falhas.',
        },
        {
          type: 'table',
          columns: ['Fase', 'Pergunta que ela responde', 'Critério de saída', 'Reversível?'],
          rows: [
            [
              'Introdução',
              'Todos os verificadores já conhecem a chave nova?',
              'A chave nova aparece no chaveiro carregado de todas as instâncias',
              'Sim, basta remover do conjunto: ninguém assina com ela ainda',
            ],
            [
              'Propagação',
              'A introdução alcançou réplicas, filas e parceiros?',
              'Tempo decorrido maior que o maior tempo de vida de cache e de token',
              'Sim, nada mudou de comportamento',
            ],
            [
              'Promoção',
              'A emissão já usa a chave nova?',
              'Assinaturas emitidas com a chave nova acima de noventa e nove por cento',
              'Sim, voltar a emitir com a antiga, que continua aceita',
            ],
            [
              'Retirada',
              'Alguém ainda verifica algo assinado com a chave antiga?',
              'Uso da chave antiga em zero por um período maior que o token mais longo',
              'Não. Depois de revogada, tudo que foi assinado com ela falha',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A leitura dessa tabela costuma reorganizar a discussão dentro do time. O risco não está distribuído pelo processo, ele está inteiro na última linha, e é exatamente ali que a pressa aparece, porque a retirada é a fase que fecha a tarefa e que satisfaz o requisito de auditoria. Depois da promoção, a rotação parece pronta: o tráfego novo já usa a chave nova, os painéis estão verdes e o incidente que motivou a rotação já foi endereçado. A tentação de revogar a chave antiga no mesmo dia vem justamente daí. Manter a chave antiga aceita por mais alguns dias custa muito pouco e evita a única falha irreversível do processo.',
        },
        {
          type: 'ordered',
          items: [
            'Gerar a chave nova e adicionar ao conjunto no estado que é aceito na verificação e nunca escolhido para assinar, sem tocar em quem emite.',
            'Implantar e confirmar, por métrica e não por suposição, que cem por cento das instâncias carregaram o chaveiro contendo a chave nova.',
            'Aguardar o maior entre o tempo de vida do cache de segredos, o tempo de vida do token mais longo e o prazo que o parceiro externo declara para aplicar a mudança.',
            'Promover a chave nova a ativa, mantendo a antiga aceita, e observar a proporção de assinaturas emitidas por identificador de chave subir para o valor esperado.',
            'Mover a chave antiga para o estado que ainda aceita na verificação mas não assina, e aguardar o uso dela cair a zero de forma sustentada.',
            'Revogar a chave antiga apenas depois de um período de uso zero maior que o tempo de vida do artefato assinado mais longo do sistema, e manter o registro da revogação para auditoria.',
          ],
        },
      ],
    },
    {
      title: 'O que segura a chave antiga viva depois que todo mundo já migrou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O uso da chave antiga costuma cair rápido logo após a promoção e depois estacionar num valor baixo que não chega a zero, e é esse resíduo que decide o calendário da retirada. Ele quase nunca vem de instâncias que não reiniciaram, porque essas aparecem cedo e são corrigidas no mesmo dia. Ele vem de artefatos assinados que continuam válidos e de cópias do segredo em lugares que ninguém inventariou. Um token de acesso com validade de sete dias emitido no dia anterior à promoção vai ser apresentado por sete dias, e cada apresentação é uma verificação que exige a chave antiga no conjunto. Um webhook que falhou e entrou em política de nova tentativa com espera exponencial pode voltar dezoito horas depois carregando a assinatura original.',
        },
        {
          type: 'paragraph',
          value:
            'Há ainda três origens que produzem resíduo indefinido e que precisam ser tratadas como bloqueio explícito, não como ruído. A primeira é o parceiro externo que aplica a mudança em ritmo próprio, às vezes exigindo um chamado formal e uma janela de várias semanas, e que em alguns casos simplesmente não suporta duas chaves ao mesmo tempo do lado dele. A segunda é o segredo copiado para fora do gerenciador, num arquivo de configuração de um serviço legado, num trabalho agendado que ninguém executa há meses, ou num script de operação que alguém guardou. A terceira, mais traiçoeira, é o dado em repouso cifrado ou assinado com a chave antiga: revogar a chave nesse caso não interrompe uma integração, ele torna o dado ilegível de forma permanente.',
        },
        {
          type: 'code',
          value: `// Descoberta do que ainda depende da chave antiga, feita por evidencia
// e nao por inventario manual. Roda antes de qualquer revogacao.

const AGORA = Date.now();
const HORA = 3600 * 1000;

// 1) Uso observado por chave, vindo da metrica emitida na verificacao.
const usoPorChave = await metricas.consultar({
  metrica: 'verificacao_assinatura_total',
  agruparPor: ['kid', 'origem'],
  janela: '72h',
});

// 2) Artefatos assinados que ainda podem ser apresentados no futuro.
//    Este e o prazo minimo de sobrevida da chave antiga.
const artefatos = [
  { nome: 'token_de_acesso', ttlHoras: 24 },
  { nome: 'token_de_atualizacao', ttlHoras: 24 * 30 },
  { nome: 'link_de_convite_assinado', ttlHoras: 24 * 7 },
  { nome: 'retentativa_de_webhook', ttlHoras: 18 },
];

const sobrevidaMinimaHoras = Math.max(...artefatos.map((a) => a.ttlHoras));

// 3) Criterio objetivo de retirada, avaliado por origem.
const bloqueios = usoPorChave
  .filter((linha) => linha.kid === 'k-2026-03' && linha.total > 0)
  .map((linha) => ({
    origem: linha.origem,
    total: linha.total,
    ultimoUsoHaHoras: Math.round((AGORA - linha.ultimoUso) / HORA),
  }));

const podeRevogar =
  bloqueios.length === 0 &&
  horasDesdeAPromocao() > sobrevidaMinimaHoras;

if (!podeRevogar) {
  console.error('revogacao bloqueada. dependencias vivas na chave antiga:');
  console.table(bloqueios);
  console.error(\`sobrevida minima exigida: \${sobrevidaMinimaHoras}h\`);
  process.exit(1);
}

// 4) Dado em repouso: verificacao separada, porque aqui a revogacao
//    nao causa indisponibilidade e sim perda permanente de acesso.
const registrosComChaveAntiga = await db.contar({
  tabela: 'documentos_cifrados',
  onde: { kid_da_chave: 'k-2026-03' },
});

if (registrosComChaveAntiga > 0) {
  console.error(
    \`\${registrosComChaveAntiga} registros ainda cifrados com a chave antiga. \` +
      'Recifre antes de revogar: revogar aqui e perda de dado, nao queda de servico.',
  );
  process.exit(1);
}`,
        },
        {
          type: 'paragraph',
          value:
            'A separação entre as duas verificações finais do exemplo é deliberada e vale ser explicada em qualquer revisão de código. Uma chave usada para autenticar tráfego e uma chave usada para cifrar dado em repouso têm perfis de risco opostos na retirada. No primeiro caso, revogar cedo demais causa uma falha ruidosa, imediata e reversível: a integração cai, alguém percebe em minutos e a chave volta ao conjunto. No segundo, revogar cedo demais causa uma falha silenciosa e definitiva, que só aparece quando alguém tenta ler um documento antigo, possivelmente meses depois, quando o material da chave já não existe em lugar nenhum. Por isso a rotação de chave de cifragem exige recifragem completa antes da revogação, e não apenas uma janela de espera.',
        },
      ],
    },
    {
      title: 'Medir uso por identificador de chave transforma retirada em decisão',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A pergunta que decide a retirada é sempre a mesma: alguém ainda depende da chave antiga? Sem instrumentação, essa pergunta é respondida por argumento de autoridade, por leitura de código ou por memória de quem participou da implantação, e as três formas erram. A instrumentação que responde de fato é um contador de verificações rotulado pelo identificador da chave e pela origem da requisição, e ele custa uma linha na função de verificação. A partir dele a retirada deixa de ser uma decisão de calendário e passa a ser uma decisão de evidência: a chave antiga sai do conjunto quando o contador dela está em zero há mais tempo que o artefato assinado mais longo do sistema.',
        },
        {
          type: 'paragraph',
          value:
            'O rótulo de origem é o que separa uma métrica útil de um número agregado inútil. Saber que a chave antiga foi usada duzentas vezes nas últimas vinte e quatro horas não permite agir. Saber que cento e noventa e oito dessas vezes vieram de um único parceiro e duas vieram de um trabalho agendado interno permite abrir um chamado com o parceiro e corrigir o trabalho agendado no mesmo dia. Vale limitar a cardinalidade desse rótulo a um conjunto pequeno e conhecido, como o nome do serviço chamador ou o identificador do parceiro, e nunca usar algo aberto como o endereço de origem, que multiplica séries temporais sem adicionar poder de decisão.',
        },
        {
          type: 'list',
          items: [
            'Verificações com identificador de chave desconhecido acima de zero por cinco minutos: alguém está assinando com uma chave que saiu do conjunto cedo demais, ou a chave nova não chegou a todos os verificadores.',
            'Proporção de emissões com a chave antiga acima de um por cento vinte e quatro horas depois da promoção: existe instância que não recarregou o chaveiro e ela vai falhar no momento da retirada.',
            'Falhas de verificação com identificador de chave conhecido acima de zero de forma sustentada: o material da chave difere entre os lados, o que costuma ser erro de cópia ou de codificação e não problema de propagação.',
            'Idade da chave ativa acima do prazo definido na política, medida em dias: a rotação preventiva não aconteceu, e o alerta precisa disparar antes do vencimento e não depois.',
            'Qualquer chave em estado que aceita mas não assina há mais tempo que o dobro da sobrevida mínima: a retirada travou por algum bloqueio que ninguém está acompanhando.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O último item dessa lista existe porque o modo de falha mais comum de uma rotação bem projetada não é o incidente, é o abandono. A promoção resolve o problema visível, o painel fica verde, a tarefa sai do quadro e a chave antiga permanece aceita indefinidamente, às vezes por anos. O resultado é um sistema que acumula chaves válidas, o que anula boa parte do benefício de segurança que motivou a rotação, já que a chave possivelmente comprometida continua funcionando. Um alerta sobre chaves paradas no estado intermediário é o que transforma a rotação de um evento em um processo que realmente termina.',
        },
      ],
    },
    {
      title: 'O caso do parceiro externo que só aceita uma chave',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Toda a estratégia descrita até aqui depende de que o verificador aceite um conjunto, e existe um caso em que isso não está sob controle: o parceiro externo cujo painel tem um único campo de segredo. Nesse arranjo, o momento em que o valor é salvo do lado dele é uma troca atômica de verdade, e a única pergunta que importa é quem verifica o quê. Se o parceiro envia webhooks assinados para o sistema e a verificação acontece do lado de dentro, o problema é confortável, porque o conjunto está sob controle: basta aceitar as duas chaves e pedir que o parceiro troque quando quiser. Se o sistema é que assina requisições enviadas ao parceiro, o controle está do outro lado e o conjunto não existe.',
        },
        {
          type: 'paragraph',
          value:
            'Nesse segundo caso, a técnica que funciona é deslocar a atomicidade para um ponto onde a reversão é barata. Em vez de trocar a chave e torcer, o cliente que chama o parceiro passa a tratar a falha de autenticação como sinal de rotação em andamento e a tentar a outra chave uma única vez, registrando qual delas funcionou. Isso converte uma janela de indisponibilidade total numa janela de latência ligeiramente maior para uma fração das requisições, e ela se fecha sozinha assim que a chave nova passa a funcionar de forma consistente. Duas salvaguardas tornam a técnica segura: a segunda tentativa acontece apenas para erro de autenticação, nunca para outros erros, e apenas para requisições idempotentes ou que carreguem chave de idempotência, sob risco de duplicar um efeito colateral no parceiro.',
        },
        {
          type: 'code',
          value: `// Cliente resiliente a rotacao quando o parceiro so aceita UMA chave.
// Converte janela de indisponibilidade em janela de latencia.

const CHAVES = [
  { kid: 'k-2026-09', material: process.env.PARTNER_KEY_NEW },
  { kid: 'k-2026-03', material: process.env.PARTNER_KEY_OLD },
];

// Lembra qual chave funcionou por ultimo para nao pagar a tentativa extra
// em toda requisicao. Comeca pela nova, que e a esperada apos a promocao.
let kidPreferido = CHAVES[0].kid;

const ordenarChaves = () => {
  const preferida = CHAVES.find((c) => c.kid === kidPreferido);
  const demais = CHAVES.filter((c) => c.kid !== kidPreferido);
  return preferida ? [preferida, ...demais] : CHAVES;
};

const chamarParceiro = async ({ caminho, corpo, chaveIdempotencia }) => {
  const tentativas = ordenarChaves();
  let ultimaResposta;

  for (const chave of tentativas) {
    const resposta = await fetch(\`https://api.parceiro.com\${caminho}\`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // A chave de idempotencia e o que torna a segunda tentativa segura:
        // sem ela, repetir uma requisicao que ja teve efeito duplica a acao.
        'idempotency-key': chaveIdempotencia,
        'x-signature': assinarCom(chave.material, corpo),
      },
      body: corpo,
    });

    ultimaResposta = resposta;

    // Sucesso: fixa a preferencia e sai.
    if (resposta.ok) {
      if (kidPreferido !== chave.kid) {
        kidPreferido = chave.kid;
        metricas.rotacaoParceiro({ kid: chave.kid, evento: 'preferencia_trocada' });
      }
      return resposta;
    }

    // So 401 e 403 indicam chave errada. Repetir em 500 ou em 429
    // com a outra chave nao corrige nada e dobra a carga no parceiro.
    if (resposta.status !== 401 && resposta.status !== 403) return resposta;

    metricas.rotacaoParceiro({ kid: chave.kid, evento: 'auth_recusada' });
  }

  // Nenhuma chave funcionou: e falha de verdade, nao rotacao.
  return ultimaResposta;
};`,
        },
        {
          type: 'paragraph',
          value:
            'A restrição de status no penúltimo bloco do exemplo é a linha que impede que essa técnica se transforme num amplificador de incidente. Repetir com a outra chave diante de um erro de servidor ou de um limite de taxa não corrige nada, porque o problema não é a chave, e dobra a carga enviada a um parceiro que já está sinalizando dificuldade, o que é exatamente o comportamento que transforma uma degradação em queda. A segunda tentativa só faz sentido quando o parceiro afirmou explicitamente que a credencial não serve, e mesmo assim apenas uma vez por requisição.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Se o segredo já vazou, ainda faz sentido rotacionar por fases em vez de revogar imediatamente?',
      answer:
        'Faz, mas com uma inversão importante na ordem das prioridades, e a decisão depende de separar dois objetivos que costumam ser confundidos: interromper o acesso do atacante e manter o serviço de pé. Numa rotação preventiva os dois objetivos são compatíveis e a fase de retirada pode esperar dias. Numa resposta a vazamento confirmado, interromper o acesso é o objetivo dominante, e aceitar a chave comprometida por mais uma semana significa dar ao atacante mais uma semana de acesso legítimo. Ainda assim, revogar em pânico raramente é a melhor jogada, porque derrubar a própria integração cria um segundo incidente simultâneo e costuma atrapalhar a contenção mais do que ajuda. O que funciona é comprimir as fases em vez de eliminá-las: introduzir e propagar a chave nova em minutos usando um mecanismo de recarga sem reinício, promover assim que a propagação for confirmada e revogar a chave antiga logo em seguida, aceitando conscientemente a falha dos artefatos assinados que ainda estavam válidos. A diferença entre essa sequência e a revogação imediata é que ela leva talvez trinta minutos a mais e evita que o sistema fique indisponível durante a resposta ao incidente. Vale acrescentar que uma resposta madura a vazamento não termina na rotação: ela inclui invalidar as sessões e os tokens emitidos com a chave comprometida, o que é uma ação separada e que muita gente esquece, porque revogar a chave de assinatura não invalida por si só um token que já foi aceito e cujo estado de sessão vive em outro lugar.',
    },
    {
      question: 'Como rotacionar um segredo compartilhado entre dezenas de serviços sem coordenar todos os times?',
      answer:
        'A resposta estrutural é que um segredo compartilhado entre dezenas de serviços é o problema real, e a rotação apenas o revela. Enquanto o mesmo material de chave é usado por serviços com donos diferentes, qualquer rotação exige coordenação global, o custo de comprometimento é a soma de todos os serviços e a métrica de uso não consegue apontar responsáveis. O caminho que resolve de vez é usar a própria rotação como oportunidade para dividir: em vez de trocar a chave compartilhada por outra chave compartilhada, emitir uma chave por consumidor durante a fase de introdução, de modo que cada serviço passe a assinar com material próprio identificado por um kid distinto. O verificador continua aceitando um conjunto, o que torna a migração incremental e sem coordenação, já que cada time promove a sua chave no seu ritmo enquanto a antiga continua aceita. Depois que a métrica por kid mostrar que todos migraram, a chave compartilhada é retirada e o sistema fica com material segregado, no qual comprometer um consumidor não obriga a rotacionar todos os outros. Quando a divisão não é viável no curto prazo, o mínimo aceitável é publicar o chaveiro num local que todos os serviços leiam dinamicamente, com recarga periódica em vez de leitura na inicialização, porque isso reduz a propagação de um ciclo de implantação de todos os times para o tempo de vida do cache, e transforma a coordenação global numa espera passiva.',
    },
    {
      question: 'Qual é o intervalo correto de rotação e como saber se a política atual está adequada?',
      answer:
        'O intervalo correto é aquele em que a organização consegue executar a rotação sem que ela vire um projeto, e essa é uma medida de capacidade e não de calendário. Uma política que exige rotação trimestral num sistema onde cada rotação consome uma semana de trabalho manual e gera risco de indisponibilidade não vai ser cumprida, e o resultado prático é uma chave com três anos de idade e uma política no papel que ninguém audita. O sinal de que a política está adequada não é a frequência declarada, é o tempo médio entre a decisão de rotacionar e a retirada concluída: se esse tempo for de horas, a frequência pode ser alta e a resposta a um vazamento será rápida porque o caminho já é conhecido e exercitado. Se for de semanas, aumentar a frequência declarada apenas aumenta a dívida. O investimento que muda o número é a automação das quatro fases com critério de saída verificável, mais um exercício periódico de rotação em ambiente de produção com tráfego real, no mesmo espírito de um teste de restauração de backup: uma rotação que nunca foi executada não é um procedimento, é uma intenção documentada. Como referência prática, chaves de assinatura de curta duração com automação completa costumam ser rotacionadas em dias, credenciais de integração com parceiro externo em meses por limitação do outro lado, e chaves de cifragem de dado em repouso no prazo que a recifragem do volume existente permitir, que é o único caso em que o custo cresce com o tamanho da base.',
    },
  ],
  conclusion: {
    title: 'Rotação é uma transição observável, não um evento instantâneo',
    description:
      'A indisponibilidade durante a troca de uma chave vem quase sempre de tratar o segredo como um valor único que muda num instante, quando ele é um conjunto que atravessa quatro estados em ritmos diferentes. Aceitar múltiplas chaves na verificação, carregar o identificador de chave na mensagem, separar introdução de promoção e decidir a retirada por evidência de uso eliminam a janela de falha sem exigir janela de manutenção. Posso modelar o chaveiro do seu sistema com estados e identificador de chave, instrumentar o uso por chave e por origem, automatizar as quatro fases com critério de saída verificável, tratar o caso do parceiro que aceita uma chave só e configurar os alertas que impedem que a rotação seja promovida e nunca concluída.',
    cta: 'Falar sobre a rotação de segredos do meu sistema',
  },
  related: [
    {
      label: 'Migração de banco sem janela: expandir, migrar, contrair',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Contrato de API sem versão: evoluir o payload sem quebrar o cliente antigo',
      to: '/blog/contrato-api-sem-versao-evoluir-payload-sem-quebrar-cliente-antigo',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The payment integration key was replaced at ten in the evening on a Thursday, inside a window agreed with the partner, and the new value reached production in forty seconds. At three minutes past ten, forty percent of incoming webhooks started being rejected for invalid signatures, and at eleven minutes past ten the team rolled back to the old key, which had already been revoked on the other side. This article shows why an atomic secret swap is the cause of the outage rather than the cure for it, why verification has to accept a set of keys while signing uses exactly one, what the four phases of a rotation are and which one concentrates every incident, what actually keeps the old key alive long after everyone has migrated, how per key usage metrics turn retirement into an observable decision instead of a guess, and which alerts separate a rotation that finished from one that merely stopped hurting.',
  sections: [
    {
      title: 'The atomic swap is the cause of the outage, not the cure',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The mental model that produces the incident is that a secret is a single value, stored in a single place, and that rotating means replacing that value with another one at a determined instant. That model would work if the system were a single process reading a single variable, and it is false in any architecture with more than one instance. In practice the secret lives simultaneously in the secret manager, in the environment variable of a container that started three days ago, in the in memory cache of a process that read the variable once at startup, in the external partner configuration panel, in a token that was already issued and has not expired yet, and in a message queue holding a signed request waiting to be processed. Replacing the value at the source replaces none of those copies at the same instant.',
        },
        {
          type: 'paragraph',
          value:
            'The consequence is that a propagation window always exists, and it is not an operational detail that can be shortened until it disappears. It is made of the secret manager detection time, the restart or reload time of each instance, the local cache lifetime, the lifetime of tokens already issued, and the time the external partner takes to apply the change on their side, which can be days. During that window, part of the system knows the new key and part knows the old one, and both parts still need to talk to each other. An atomic swap declares by decree that the window has zero duration, and every request that lands inside it fails.',
        },
        {
          type: 'diagram',
          value: `ATOMIC SWAP (what breaks)

  t0: key K1 everywhere               verification: accepts K1
  t1: manager starts serving K2       signing: K2 on 2 of 12 instances
      |
      +-> instance A (restarted)    signs with K2 -> receiver only accepts K1  FAIL
      +-> instance B (not restarted) signs with K1 -> partner only accepts K2  FAIL
      +-> in flight webhook signed with K1 arrives at t1+3s                    FAIL
      +-> JWT issued at t0-600s still valid for another 3000s                  FAIL

  Failure window = max(internal propagation, token TTL, partner apply time)


SET BASED ROTATION (what works)

  phase 1  verifies: {K1, K2}   signs: K1    <- K2 introduced, nobody uses it yet
  phase 2  verifies: {K1, K2}   signs: K1    <- propagate until 100% knows K2
  phase 3  verifies: {K1, K2}   signs: K2    <- promotion: only the SIGNER changes
  phase 4  verifies: {K2}       signs: K2    <- retirement, after K1 usage hits zero

  At no phase is there an instant where the verifier does not know
  the key someone else is currently signing with.`,
        },
        {
          type: 'paragraph',
          value:
            'The inversion that solves the problem is easy to state and uncomfortable to accept: during a rotation, the secret stops being a value and becomes a set. Whoever verifies accepts every valid member of the set, whoever signs picks exactly one. Because verifying is a tolerant operation and signing is an exclusive one, a new key can be introduced without any behavior changing, that introduction can propagate at whatever pace the infrastructure allows, and only then does signing move. The swap stops being an instantaneous event and becomes a transition with four observable states, and the outage disappears because at no point is anyone verifying with a set that lacks the key the other side is using.',
        },
      ],
    },
    {
      title: 'Verification accepts the set, signing picks one: the asymmetry that carries everything',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Implementing that idea requires a small change in the code and a large change in what travels on the wire. The code change is accepting a list of keys during verification instead of a single one. The wire change is that the message has to carry the identifier of the key that signed it, because without that identifier verification degenerates into brute forcing every member of the set, which costs CPU time proportional to the set size and destroys any ability to measure who still uses what. The key identifier is not decoration, it is what makes the rotation observable.',
        },
        {
          type: 'paragraph',
          value:
            'One security point deserves insistence because it is usually treated as a detail: the signature comparison must run in constant time. A byte comparison that returns as soon as it finds the first difference leaks, through response time, how many leading bytes were correct, which lets an attacker recover the correct signature byte by byte with a linear number of attempts instead of an exponential one. During a rotation this matters even more, because the set of accepted keys widens the surface: every extra key is one more comparison, and a naive implementation that tries the new key first and the old one second ends up answering more slowly for messages signed with the old key, which by itself reveals information about the state of the rotation.',
        },
        {
          type: 'code',
          value: `import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

// The secret is a SET. Each member has an identifier, a state and material.
// States: 'pending'   -> accepted on verification, never picked for signing
//         'active'    -> accepted on verification, picked for signing
//         'retiring'  -> accepted on verification, no longer signs
//         'revoked'   -> out of the set, rejected
const keyring = {
  'k-2026-03': { state: 'retiring', material: process.env.SIGNING_KEY_2026_03 },
  'k-2026-09': { state: 'active', material: process.env.SIGNING_KEY_2026_09 },
};

const sign = (body) => {
  const entry = Object.entries(keyring).find(([, k]) => k.state === 'active');
  if (!entry) throw new Error('keyring has no active key: signing is blocked');

  const [kid, key] = entry;
  const signature = createHmac('sha256', key.material).update(body).digest('hex');

  // The kid travels with the message. Without it there is no way to measure
  // per key usage and no way to verify in O(1) instead of O(set size).
  return { kid, signature };
};

const constantTimeEquals = (a, b) => {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual requires equal lengths: compare the length first, which
  // leaks nothing about the content, and only then compare bytes safely.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

const verify = ({ body, kid, signature }) => {
  const key = keyring[kid];

  // Unknown or revoked key: reject without trying the others.
  if (!key || key.state === 'revoked') {
    metrics.signatureRejected({ kid, reason: 'unknown_kid' });
    return false;
  }

  const expected = createHmac('sha256', key.material).update(body).digest('hex');
  const valid = constantTimeEquals(signature, expected);

  // The per kid metric is what allows retirement to be decided on evidence.
  metrics.verification({ kid, state: key.state, valid });
  return valid;
};

// Minting a new key: it enters as 'pending', never as 'active'.
// Promoting in the same operation that introduces is the atomic swap again.
const introduceKey = () => ({
  kid: \`k-\${new Date().toISOString().slice(0, 7)}\`,
  state: 'pending',
  material: randomBytes(32).toString('hex'),
});`,
        },
        {
          type: 'paragraph',
          value:
            'The detail that saves the most rework sits in the last function of the example. A new key always enters in the state that is accepted during verification but never picked for signing, and promotion is a separate operation performed later. Teams that introduce and promote in the same step rebuild exactly the atomic swap they were trying to avoid, except now they believe they are protected because the code has a keyring. Separating introduction from promotion is what gives the infrastructure the propagation time it needs, and it is what allows promotion to be reverted in seconds without anything having been revoked.',
        },
      ],
    },
    {
      title: 'The four phases and the only one that causes incidents',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A well executed rotation has four phases, and each one answers a different question with an objective exit criterion. Introduction puts the new key into the set accepted by every verifier, without anyone signing with it. Propagation waits until that introduction has reached one hundred percent of instances, replicas and partners. Promotion moves signing to the new key while the old one stays accepted. Retirement removes the old key from the accepted set. Three of those phases are reversible in seconds and produce almost no incidents. The fourth is irreversible and concentrates nearly every failure.',
        },
        {
          type: 'table',
          columns: ['Phase', 'Question it answers', 'Exit criterion', 'Reversible?'],
          rows: [
            [
              'Introduction',
              'Do all verifiers already know the new key?',
              'The new key appears in the keyring loaded by every instance',
              'Yes, just drop it from the set: nobody signs with it yet',
            ],
            [
              'Propagation',
              'Has the introduction reached replicas, queues and partners?',
              'Elapsed time greater than the longest cache and token lifetime',
              'Yes, no behavior has changed',
            ],
            [
              'Promotion',
              'Is signing already using the new key?',
              'Signatures issued with the new key above ninety nine percent',
              'Yes, sign with the old one again, it is still accepted',
            ],
            [
              'Retirement',
              'Is anything still verified against the old key?',
              'Old key usage at zero for longer than the longest lived token',
              'No. Once revoked, everything signed with it fails',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Reading that table usually reorganizes the discussion inside the team. Risk is not spread across the process, it sits entirely in the last row, and that is exactly where haste shows up, because retirement is the phase that closes the ticket and satisfies the audit requirement. After promotion the rotation looks finished: new traffic already uses the new key, dashboards are green and the incident that motivated the rotation has been addressed. The temptation to revoke the old key the same day comes precisely from there. Keeping the old key accepted for a few more days costs very little and avoids the one irreversible failure in the process.',
        },
        {
          type: 'ordered',
          items: [
            'Generate the new key and add it to the set in the state that is accepted during verification and never picked for signing, without touching the signer.',
            'Deploy and confirm, through metrics rather than assumption, that one hundred percent of instances loaded a keyring containing the new key.',
            'Wait for the maximum of the secret cache lifetime, the lifetime of the longest lived token, and the deadline the external partner states for applying the change.',
            'Promote the new key to active while the old one stays accepted, and watch the share of signatures issued per key identifier rise to the expected value.',
            'Move the old key to the state that still verifies but no longer signs, and wait for its usage to fall to zero in a sustained way.',
            'Revoke the old key only after a period of zero usage longer than the lifetime of the longest lived signed artifact in the system, and keep the revocation record for audit.',
          ],
        },
      ],
    },
    {
      title: 'What keeps the old key alive after everyone has migrated',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Old key usage tends to drop quickly right after promotion and then plateau at a small nonzero value, and that residue is what dictates the retirement schedule. It almost never comes from instances that failed to restart, because those show up early and get fixed the same day. It comes from signed artifacts that are still valid and from copies of the secret in places nobody inventoried. An access token with a seven day lifetime issued the day before promotion will be presented for seven days, and every presentation is a verification that requires the old key in the set. A webhook that failed and entered an exponential backoff retry policy can come back eighteen hours later carrying its original signature.',
        },
        {
          type: 'paragraph',
          value:
            'Three further sources produce open ended residue and must be treated as explicit blockers rather than noise. The first is the external partner who applies the change at their own pace, sometimes requiring a formal ticket and a window of several weeks, and who in some cases simply cannot hold two keys at once on their side. The second is the secret copied outside the manager, into a legacy service configuration file, into a scheduled job nobody has run in months, or into an operations script someone saved. The third, and the most treacherous, is data at rest encrypted or signed with the old key: revoking that key does not break an integration, it makes the data permanently unreadable.',
        },
        {
          type: 'code',
          value: `// Discovering what still depends on the old key, driven by evidence
// rather than manual inventory. Runs before any revocation.

const NOW = Date.now();
const HOUR = 3600 * 1000;

// 1) Observed usage per key, from the metric emitted during verification.
const usageByKey = await metrics.query({
  metric: 'signature_verification_total',
  groupBy: ['kid', 'source'],
  window: '72h',
});

// 2) Signed artifacts that can still be presented in the future.
//    This is the minimum survival period for the old key.
const artifacts = [
  { name: 'access_token', ttlHours: 24 },
  { name: 'refresh_token', ttlHours: 24 * 30 },
  { name: 'signed_invite_link', ttlHours: 24 * 7 },
  { name: 'webhook_retry', ttlHours: 18 },
];

const minimumSurvivalHours = Math.max(...artifacts.map((a) => a.ttlHours));

// 3) Objective retirement criterion, evaluated per source.
const blockers = usageByKey
  .filter((row) => row.kid === 'k-2026-03' && row.total > 0)
  .map((row) => ({
    source: row.source,
    total: row.total,
    lastUsedHoursAgo: Math.round((NOW - row.lastUsed) / HOUR),
  }));

const canRevoke =
  blockers.length === 0 &&
  hoursSincePromotion() > minimumSurvivalHours;

if (!canRevoke) {
  console.error('revocation blocked. live dependencies on the old key:');
  console.table(blockers);
  console.error(\`minimum required survival: \${minimumSurvivalHours}h\`);
  process.exit(1);
}

// 4) Data at rest: a separate check, because here revocation does not
//    cause an outage, it causes permanent loss of access.
const recordsWithOldKey = await db.count({
  table: 'encrypted_documents',
  where: { key_id: 'k-2026-03' },
});

if (recordsWithOldKey > 0) {
  console.error(
    \`\${recordsWithOldKey} records are still encrypted with the old key. \` +
      'Re encrypt before revoking: revoking here is data loss, not downtime.',
  );
  process.exit(1);
}`,
        },
        {
          type: 'paragraph',
          value:
            'The separation between the two final checks in the example is deliberate and worth explaining in any code review. A key used to authenticate traffic and a key used to encrypt data at rest have opposite risk profiles at retirement. In the first case, revoking too early causes a loud, immediate and reversible failure: the integration breaks, someone notices within minutes and the key goes back into the set. In the second, revoking too early causes a silent and permanent failure that only surfaces when someone tries to read an old document, possibly months later, when the key material no longer exists anywhere. That is why rotating an encryption key requires full re encryption before revocation, not merely a waiting window.',
        },
      ],
    },
    {
      title: 'Measuring usage per key identifier turns retirement into a decision',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The question that decides retirement is always the same: does anything still depend on the old key? Without instrumentation, that question gets answered by appeal to authority, by reading code, or by the memory of whoever ran the deployment, and all three are wrong often enough to matter. The instrumentation that actually answers it is a verification counter labeled with the key identifier and the request source, and it costs one line inside the verification function. From that point on, retirement stops being a calendar decision and becomes an evidence based one: the old key leaves the set when its counter has been at zero for longer than the longest lived signed artifact in the system.',
        },
        {
          type: 'paragraph',
          value:
            'The source label is what separates a useful metric from a useless aggregate. Knowing that the old key was used two hundred times in the last twenty four hours does not enable action. Knowing that one hundred and ninety eight of those came from a single partner and two came from an internal scheduled job lets you open a ticket with the partner and fix the job the same day. That label should be limited to a small, known set, such as the calling service name or the partner identifier, and never something open ended like the source address, which multiplies time series without adding decision power.',
        },
        {
          type: 'list',
          items: [
            'Verifications with an unknown key identifier above zero for five minutes: someone is signing with a key that left the set too early, or the new key never reached every verifier.',
            'Share of signatures issued with the old key above one percent twenty four hours after promotion: some instance never reloaded the keyring and it will fail at retirement time.',
            'Verification failures with a known key identifier sustained above zero: the key material differs between the two sides, which is usually a copy or encoding mistake rather than a propagation problem.',
            'Age of the active key above the limit defined in the policy, measured in days: preventive rotation never happened, and the alert has to fire before the deadline rather than after it.',
            'Any key sitting in the verify but do not sign state for longer than twice the minimum survival period: retirement is stuck on a blocker nobody is tracking.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last item on that list exists because the most common failure mode of a well designed rotation is not an incident, it is abandonment. Promotion solves the visible problem, the dashboard turns green, the ticket leaves the board and the old key stays accepted indefinitely, sometimes for years. The result is a system that accumulates valid keys, which cancels most of the security benefit that motivated the rotation, since the possibly compromised key still works. An alert on keys stuck in the intermediate state is what turns rotation from an event into a process that actually finishes.',
        },
      ],
    },
    {
      title: 'The case of the external partner that accepts only one key',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Everything described so far depends on the verifier accepting a set, and there is one case where that is not under your control: the external partner whose panel has a single secret field. In that arrangement, the moment the value is saved on their side is a genuine atomic swap, and the only question that matters is who verifies what. If the partner sends signed webhooks to your system and verification happens on your side, the situation is comfortable, because the set is under your control: accept both keys and let the partner switch whenever they like. If your system is the one signing requests sent to the partner, control sits on the other side and the set does not exist.',
        },
        {
          type: 'paragraph',
          value:
            'In that second case, the technique that works is moving the atomicity to a point where reversal is cheap. Instead of swapping the key and hoping, the client calling the partner treats an authentication failure as a signal that a rotation is in flight and retries once with the other key, recording which one worked. That converts a window of total unavailability into a window of slightly higher latency for a fraction of requests, and it closes itself as soon as the new key starts working consistently. Two safeguards make the technique safe: the second attempt happens only for authentication errors, never for other errors, and only for idempotent requests or ones carrying an idempotency key, otherwise you risk duplicating a side effect on the partner.',
        },
        {
          type: 'code',
          value: `// Client resilient to rotation when the partner accepts only ONE key.
// Converts an unavailability window into a latency window.

const KEYS = [
  { kid: 'k-2026-09', material: process.env.PARTNER_KEY_NEW },
  { kid: 'k-2026-03', material: process.env.PARTNER_KEY_OLD },
];

// Remembers which key worked last so the extra attempt is not paid on every
// request. Starts with the new one, which is the expectation after promotion.
let preferredKid = KEYS[0].kid;

const orderedKeys = () => {
  const preferred = KEYS.find((k) => k.kid === preferredKid);
  const rest = KEYS.filter((k) => k.kid !== preferredKid);
  return preferred ? [preferred, ...rest] : KEYS;
};

const callPartner = async ({ path, body, idempotencyKey }) => {
  const attempts = orderedKeys();
  let lastResponse;

  for (const key of attempts) {
    const response = await fetch(\`https://api.partner.com\${path}\`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The idempotency key is what makes the second attempt safe: without
        // it, repeating a request that already took effect duplicates it.
        'idempotency-key': idempotencyKey,
        'x-signature': signWith(key.material, body),
      },
      body,
    });

    lastResponse = response;

    // Success: pin the preference and return.
    if (response.ok) {
      if (preferredKid !== key.kid) {
        preferredKid = key.kid;
        metrics.partnerRotation({ kid: key.kid, event: 'preference_switched' });
      }
      return response;
    }

    // Only 401 and 403 mean wrong key. Retrying a 500 or a 429 with the
    // other key fixes nothing and doubles the load on the partner.
    if (response.status !== 401 && response.status !== 403) return response;

    metrics.partnerRotation({ kid: key.kid, event: 'auth_refused' });
  }

  // No key worked: this is a real failure, not a rotation.
  return lastResponse;
};`,
        },
        {
          type: 'paragraph',
          value:
            'The status restriction near the end of the example is the line that stops this technique from becoming an incident amplifier. Retrying with the other key on a server error or a rate limit fixes nothing, because the key is not the problem, and it doubles the load sent to a partner that is already signaling distress, which is exactly the behavior that turns degradation into an outage. The second attempt only makes sense when the partner has explicitly stated that the credential is not acceptable, and even then only once per request.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'If the secret has already leaked, does phased rotation still make sense instead of revoking immediately?',
      answer:
        'It does, but with an important inversion in priorities, and the decision depends on separating two goals that often get conflated: cutting off the attacker and keeping the service up. In a preventive rotation both goals are compatible and retirement can wait for days. In a response to a confirmed leak, cutting off access is the dominant goal, and accepting the compromised key for another week means granting the attacker another week of legitimate access. Even so, panic revocation is rarely the best move, because taking down your own integration creates a second simultaneous incident and usually hinders containment more than it helps. What works is compressing the phases rather than eliminating them: introduce and propagate the new key within minutes using a reload mechanism that does not require a restart, promote as soon as propagation is confirmed, and revoke the old key right after, consciously accepting the failure of signed artifacts that were still valid. The difference between that sequence and immediate revocation is perhaps thirty extra minutes, and it prevents the system from being down during incident response. It is worth adding that a mature leak response does not end at rotation: it includes invalidating the sessions and tokens issued with the compromised key, which is a separate action that many teams forget, because revoking a signing key does not by itself invalidate a token that was already accepted and whose session state lives somewhere else.',
    },
    {
      question: 'How do you rotate a secret shared across dozens of services without coordinating every team?',
      answer:
        'The structural answer is that a secret shared across dozens of services is the real problem, and rotation merely exposes it. As long as the same key material is used by services with different owners, any rotation requires global coordination, the blast radius of a compromise is the sum of all those services, and usage metrics cannot point at anyone in particular. The path that fixes it for good is using the rotation itself as the opportunity to split: instead of replacing the shared key with another shared key, mint one key per consumer during the introduction phase, so each service starts signing with its own material under a distinct kid. The verifier keeps accepting a set, which makes the migration incremental and uncoordinated, since each team promotes its own key at its own pace while the old one remains accepted. Once the per kid metric shows everyone has migrated, the shared key is retired and the system ends up with segregated material, where compromising one consumer no longer forces rotating all the others. When splitting is not feasible in the short term, the minimum acceptable step is publishing the keyring somewhere every service reads dynamically, with periodic reload rather than a read at startup, because that shrinks propagation from a deployment cycle across every team down to the cache lifetime, and turns global coordination into passive waiting.',
    },
    {
      question: 'What is the right rotation interval and how do you know the current policy is adequate?',
      answer:
        'The right interval is the one the organization can execute without the rotation becoming a project, and that is a measure of capability rather than of calendar. A policy demanding quarterly rotation in a system where each rotation consumes a week of manual work and risks an outage will not be followed, and the practical outcome is a three year old key alongside a paper policy nobody audits. The signal that a policy is adequate is not the stated frequency, it is the mean time between deciding to rotate and completing retirement: if that time is hours, the frequency can be high and the response to a leak will be fast because the path is known and exercised. If it is weeks, raising the stated frequency only increases the debt. The investment that moves that number is automating the four phases with verifiable exit criteria, plus a periodic rotation drill in production with real traffic, in the same spirit as a backup restore test: a rotation that has never been executed is not a procedure, it is a documented intention. As a practical reference, short lived signing keys with full automation are typically rotated in days, partner integration credentials in months because of constraints on the other side, and encryption keys for data at rest on whatever schedule re encrypting the existing volume allows, which is the one case where the cost grows with the size of the dataset.',
    },
  ],
  conclusion: {
    title: 'Rotation is an observable transition, not an instantaneous event',
    description:
      'Downtime during a key swap almost always comes from treating the secret as a single value that changes at an instant, when it is really a set moving through four states at different speeds. Accepting multiple keys during verification, carrying the key identifier in the message, separating introduction from promotion and deciding retirement on usage evidence remove the failure window without requiring a maintenance window. I can model your keyring with states and key identifiers, instrument usage per key and per source, automate the four phases with verifiable exit criteria, handle the partner that accepts only one key, and configure the alerts that stop a rotation from being promoted and never completed.',
    cta: 'Talk about secret rotation in my system',
  },
  related: [
    {
      label: 'Database migration without a maintenance window: expand, migrate, contract',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Unversioned API contracts: evolving the payload without breaking old clients',
      to: '/blog/contrato-api-sem-versao-evoluir-payload-sem-quebrar-cliente-antigo',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'La clave de la integración de pagos se cambió a las veintidós horas de un jueves, dentro de una ventana acordada con el socio, y el nuevo valor llegó a producción en cuarenta segundos. A las veintidós y tres minutos, el cuarenta por ciento de los webhooks recibidos empezó a ser rechazado por firma inválida, y a las veintidós y once el equipo revirtió a la clave antigua, que ya había sido revocada del otro lado. Este artículo muestra por qué el cambio atómico de secreto es el origen de la indisponibilidad y no su solución, por qué verificar necesita aceptar un conjunto de claves mientras firmar usa solo una, cuáles son las cuatro fases de la rotación y cuál de ellas concentra todos los incidentes, qué mantiene viva en la práctica la clave antigua incluso después de que todos migraron, cómo la métrica de uso por identificador de clave convierte el retiro en una decisión observable en lugar de una corazonada, y qué alertas separan una rotación que terminó de una que solo dejó de doler.',
  sections: [
    {
      title: 'El cambio atómico es la causa de la indisponibilidad, no la solución',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El modelo mental que produce el incidente es que un secreto es un valor único, guardado en un lugar único, y que rotar significa sustituir ese valor por otro en un instante determinado. Ese modelo funcionaría si el sistema fuera un solo proceso leyendo una sola variable, y es falso en cualquier arquitectura con más de una instancia. En la práctica el secreto está simultáneamente en el gestor de secretos, en la variable de entorno del contenedor que arrancó hace tres días, en la caché en memoria del proceso que leyó la variable una vez al iniciar, en el panel de configuración del socio externo, en un token que ya fue emitido y todavía no expiró, y en una cola de mensajes que guarda una petición firmada esperando ser procesada. Cambiar el valor en el origen no cambia ninguna de esas copias en el mismo instante.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia es que siempre existe una ventana de propagación, y no es un detalle operativo que pueda acortarse hasta desaparecer. Está compuesta por el tiempo de detección del gestor de secretos, el tiempo de reinicio o de recarga de cada instancia, el tiempo de vida de la caché local, el tiempo de vida de los tokens ya emitidos y el tiempo que el socio externo tarda en aplicar el cambio de su lado, que puede ser de días. Durante esa ventana, una parte del sistema conoce la clave nueva y otra conoce la antigua, y ambas partes necesitan seguir comunicándose. Un cambio atómico declara por decreto que la ventana dura cero, y todo el tráfico que cae dentro de ella falla.',
        },
        {
          type: 'diagram',
          value: `CAMBIO ATOMICO (lo que se rompe)

  t0: clave K1 en todas partes         verificacion: acepta K1
  t1: el gestor pasa a servir K2       firma: K2 en 2 de 12 instancias
      |
      +-> instancia A (reiniciada)    firma con K2 -> receptor solo acepta K1  FALLA
      +-> instancia B (no reiniciada) firma con K1 -> socio solo acepta K2     FALLA
      +-> webhook en vuelo firmado con K1 llega en t1+3s                       FALLA
      +-> JWT emitido en t0-600s sigue valido otros 3000s                      FALLA

  Ventana de fallo = max(propagacion interna, TTL de token, aplicacion del socio)


ROTACION POR CONJUNTO (lo que funciona)

  fase 1  verifica: {K1, K2}   firma: K1   <- K2 introducida, nadie la usa aun
  fase 2  verifica: {K1, K2}   firma: K1   <- propagar hasta que el 100% conozca K2
  fase 3  verifica: {K1, K2}   firma: K2   <- promocion: solo cambia QUIEN FIRMA
  fase 4  verifica: {K2}       firma: K2   <- retiro, tras el uso de K1 en cero

  En ninguna fase existe un instante en que quien verifica desconozca
  la clave que otro esta usando para firmar.`,
        },
        {
          type: 'paragraph',
          value:
            'La inversión que resuelve el problema es fácil de enunciar e incómoda de aceptar: durante la rotación, el secreto deja de ser un valor y pasa a ser un conjunto. Quien verifica acepta todos los miembros válidos del conjunto, quien firma elige exactamente uno. Como verificar es una operación tolerante y firmar es una operación exclusiva, se puede introducir una clave nueva sin que nada cambie de comportamiento, propagar esa introducción al ritmo que la infraestructura permita y solo entonces mover la firma. El cambio deja de ser un evento instantáneo y se convierte en una transición con cuatro estados observables, y la indisponibilidad desaparece porque en ningún momento hay alguien verificando con un conjunto que no contiene la clave que el otro lado está usando.',
        },
      ],
    },
    {
      title: 'Verificar acepta el conjunto, firmar elige una: la asimetría que sostiene todo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Implementar esa idea exige un cambio pequeño en el código y un cambio grande en el formato de lo que viaja. El cambio en el código es aceptar una lista de claves en la verificación en lugar de una sola. El cambio en el formato es que el mensaje debe llevar el identificador de la clave que lo firmó, porque sin ese identificador la verificación degenera en probar por fuerza bruta contra todos los miembros del conjunto, lo que cuesta tiempo de CPU proporcional al tamaño del conjunto y destruye la posibilidad de medir quién usa todavía qué. El identificador de clave no es un adorno, es lo que vuelve observable la rotación.',
        },
        {
          type: 'paragraph',
          value:
            'Conviene insistir en un punto de seguridad que suele tratarse como detalle: la comparación de la firma debe hacerse en tiempo constante. Una comparación de bytes que retorna en cuanto encuentra la primera diferencia filtra, a través del tiempo de respuesta, cuántos bytes iniciales eran correctos, y eso permite que un atacante descubra la firma correcta byte a byte con un número de intentos lineal en vez de exponencial. En una rotación esto importa aún más, porque el conjunto de claves aceptadas amplía la superficie: cada clave adicional es una comparación más, y una implementación ingenua que prueba primero la clave nueva y después la antigua acaba respondiendo más lento para mensajes firmados con la clave antigua, lo que por sí solo ya revela información sobre el estado de la rotación.',
        },
        {
          type: 'code',
          value: `import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

// El secreto es un CONJUNTO. Cada miembro tiene identificador, estado y material.
// Estados: 'pending'   -> aceptada en la verificacion, nunca elegida para firmar
//          'active'    -> aceptada en la verificacion, elegida para firmar
//          'retiring'  -> aceptada en la verificacion, ya no firma
//          'revoked'   -> fuera del conjunto, rechazada
const llavero = {
  'k-2026-03': { estado: 'retiring', material: process.env.SIGNING_KEY_2026_03 },
  'k-2026-09': { estado: 'active', material: process.env.SIGNING_KEY_2026_09 },
};

const firmar = (cuerpo) => {
  const entrada = Object.entries(llavero).find(([, k]) => k.estado === 'active');
  if (!entrada) throw new Error('llavero sin clave activa: firma bloqueada');

  const [kid, clave] = entrada;
  const firma = createHmac('sha256', clave.material).update(cuerpo).digest('hex');

  // El kid viaja con el mensaje. Sin el no hay forma de medir el uso por clave
  // ni de verificar en O(1) en lugar de O(tamano del conjunto).
  return { kid, firma };
};

const comparaConstante = (a, b) => {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual exige el mismo tamano: compara la longitud antes, sin
  // filtrar el contenido, y solo entonces compara los bytes de forma segura.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

const verificar = ({ cuerpo, kid, firma }) => {
  const clave = llavero[kid];

  // Clave desconocida o revocada: rechaza sin probar las demas.
  if (!clave || clave.estado === 'revoked') {
    metricas.firmaRechazada({ kid, motivo: 'kid_desconocido' });
    return false;
  }

  const esperada = createHmac('sha256', clave.material).update(cuerpo).digest('hex');
  const valida = comparaConstante(firma, esperada);

  // La metrica por kid es lo que permite decidir el retiro con evidencia.
  metricas.verificacion({ kid, estado: clave.estado, valida });
  return valida;
};

// Emision de una clave nueva: entra como 'pending', nunca como 'active'.
// Promover en la misma operacion en que se introduce es repetir el cambio atomico.
const introducirClave = () => ({
  kid: \`k-\${new Date().toISOString().slice(0, 7)}\`,
  estado: 'pending',
  material: randomBytes(32).toString('hex'),
});`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que más evita retrabajo está en la última función del ejemplo. Una clave nueva entra siempre en el estado que se acepta en la verificación pero nunca se elige para firmar, y la promoción es una operación separada, ejecutada después. Los equipos que introducen y promueven en el mismo paso reconstruyen exactamente el cambio atómico que intentaban evitar, con la diferencia de que ahora creen estar protegidos porque el código tiene un llavero. Separar la introducción de la promoción es lo que da a la infraestructura el tiempo de propagación que necesita, y es lo que permite revertir la promoción en segundos sin que nada haya sido revocado.',
        },
      ],
    },
    {
      title: 'Las cuatro fases y la única que causa incidentes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una rotación bien ejecutada tiene cuatro fases, y cada una responde a una pregunta distinta con un criterio de salida objetivo. La introducción coloca la clave nueva en el conjunto aceptado por todos los verificadores, sin que nadie la use para firmar. La propagación espera hasta que esa introducción haya alcanzado el cien por ciento de las instancias, réplicas y socios. La promoción mueve la firma a la clave nueva, manteniendo la antigua aceptada. El retiro elimina la clave antigua del conjunto aceptado. Tres de esas fases son reversibles en segundos y casi no producen incidentes. La cuarta es irreversible y concentra casi todos los fallos.',
        },
        {
          type: 'table',
          columns: ['Fase', 'Pregunta que responde', 'Criterio de salida', '¿Reversible?'],
          rows: [
            [
              'Introducción',
              '¿Todos los verificadores ya conocen la clave nueva?',
              'La clave nueva aparece en el llavero cargado por todas las instancias',
              'Sí, basta con quitarla del conjunto: nadie firma con ella todavía',
            ],
            [
              'Propagación',
              '¿La introducción alcanzó réplicas, colas y socios?',
              'Tiempo transcurrido mayor que la mayor vida de caché y de token',
              'Sí, nada cambió de comportamiento',
            ],
            [
              'Promoción',
              '¿La firma ya usa la clave nueva?',
              'Firmas emitidas con la clave nueva por encima del noventa y nueve por ciento',
              'Sí, volver a firmar con la antigua, que sigue aceptada',
            ],
            [
              'Retiro',
              '¿Alguien verifica todavía algo firmado con la clave antigua?',
              'Uso de la clave antigua en cero durante más que el token más largo',
              'No. Una vez revocada, todo lo firmado con ella falla',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Leer esa tabla suele reorganizar la discusión dentro del equipo. El riesgo no está repartido por el proceso, está entero en la última fila, y es exactamente ahí donde aparece la prisa, porque el retiro es la fase que cierra la tarea y satisface el requisito de auditoría. Después de la promoción la rotación parece terminada: el tráfico nuevo ya usa la clave nueva, los paneles están en verde y el incidente que motivó la rotación ya fue atendido. La tentación de revocar la clave antigua el mismo día viene justamente de ahí. Mantener la clave antigua aceptada unos días más cuesta muy poco y evita el único fallo irreversible del proceso.',
        },
        {
          type: 'ordered',
          items: [
            'Generar la clave nueva y añadirla al conjunto en el estado que se acepta en la verificación y nunca se elige para firmar, sin tocar a quien firma.',
            'Desplegar y confirmar, mediante métricas y no por suposición, que el cien por ciento de las instancias cargaron un llavero que contiene la clave nueva.',
            'Esperar el máximo entre la vida de la caché de secretos, la vida del token más largo y el plazo que el socio externo declara para aplicar el cambio.',
            'Promover la clave nueva a activa, manteniendo la antigua aceptada, y observar que la proporción de firmas emitidas por identificador de clave suba al valor esperado.',
            'Mover la clave antigua al estado que aún verifica pero ya no firma, y esperar a que su uso caiga a cero de forma sostenida.',
            'Revocar la clave antigua solo después de un periodo de uso cero mayor que la vida del artefacto firmado más largo del sistema, y conservar el registro de la revocación para auditoría.',
          ],
        },
      ],
    },
    {
      title: 'Qué mantiene viva la clave antigua después de que todos migraron',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El uso de la clave antigua suele caer rápido justo después de la promoción y luego estancarse en un valor bajo que no llega a cero, y ese residuo es el que decide el calendario del retiro. Casi nunca proviene de instancias que no se reiniciaron, porque esas aparecen temprano y se corrigen el mismo día. Proviene de artefactos firmados que siguen siendo válidos y de copias del secreto en lugares que nadie inventarió. Un token de acceso con validez de siete días emitido el día anterior a la promoción se presentará durante siete días, y cada presentación es una verificación que exige la clave antigua en el conjunto. Un webhook que falló y entró en una política de reintento con espera exponencial puede volver dieciocho horas después llevando su firma original.',
        },
        {
          type: 'paragraph',
          value:
            'Hay además tres orígenes que producen residuo indefinido y que deben tratarse como bloqueo explícito, no como ruido. El primero es el socio externo que aplica el cambio a su propio ritmo, a veces exigiendo un ticket formal y una ventana de varias semanas, y que en algunos casos simplemente no admite dos claves a la vez de su lado. El segundo es el secreto copiado fuera del gestor, en un archivo de configuración de un servicio heredado, en una tarea programada que nadie ejecuta desde hace meses, o en un script de operación que alguien guardó. El tercero, el más traicionero, es el dato en reposo cifrado o firmado con la clave antigua: revocar esa clave no interrumpe una integración, vuelve el dato ilegible de forma permanente.',
        },
        {
          type: 'code',
          value: `// Descubrimiento de lo que aun depende de la clave antigua, guiado por
// evidencia y no por inventario manual. Se ejecuta antes de cualquier revocacion.

const AHORA = Date.now();
const HORA = 3600 * 1000;

// 1) Uso observado por clave, desde la metrica emitida en la verificacion.
const usoPorClave = await metricas.consultar({
  metrica: 'verificacion_firma_total',
  agruparPor: ['kid', 'origen'],
  ventana: '72h',
});

// 2) Artefactos firmados que aun pueden presentarse en el futuro.
//    Este es el plazo minimo de supervivencia de la clave antigua.
const artefactos = [
  { nombre: 'token_de_acceso', ttlHoras: 24 },
  { nombre: 'token_de_refresco', ttlHoras: 24 * 30 },
  { nombre: 'enlace_de_invitacion_firmado', ttlHoras: 24 * 7 },
  { nombre: 'reintento_de_webhook', ttlHoras: 18 },
];

const supervivenciaMinimaHoras = Math.max(...artefactos.map((a) => a.ttlHoras));

// 3) Criterio objetivo de retiro, evaluado por origen.
const bloqueos = usoPorClave
  .filter((fila) => fila.kid === 'k-2026-03' && fila.total > 0)
  .map((fila) => ({
    origen: fila.origen,
    total: fila.total,
    ultimoUsoHaceHoras: Math.round((AHORA - fila.ultimoUso) / HORA),
  }));

const puedeRevocar =
  bloqueos.length === 0 &&
  horasDesdeLaPromocion() > supervivenciaMinimaHoras;

if (!puedeRevocar) {
  console.error('revocacion bloqueada. dependencias vivas en la clave antigua:');
  console.table(bloqueos);
  console.error(\`supervivencia minima exigida: \${supervivenciaMinimaHoras}h\`);
  process.exit(1);
}

// 4) Dato en reposo: verificacion separada, porque aqui la revocacion
//    no causa indisponibilidad sino perdida permanente de acceso.
const registrosConClaveAntigua = await db.contar({
  tabla: 'documentos_cifrados',
  donde: { id_de_clave: 'k-2026-03' },
});

if (registrosConClaveAntigua > 0) {
  console.error(
    \`\${registrosConClaveAntigua} registros siguen cifrados con la clave antigua. \` +
      'Recifra antes de revocar: revocar aqui es perdida de datos, no caida de servicio.',
  );
  process.exit(1);
}`,
        },
        {
          type: 'paragraph',
          value:
            'La separación entre las dos verificaciones finales del ejemplo es deliberada y vale la pena explicarla en cualquier revisión de código. Una clave usada para autenticar tráfico y una clave usada para cifrar datos en reposo tienen perfiles de riesgo opuestos en el retiro. En el primer caso, revocar demasiado pronto causa un fallo ruidoso, inmediato y reversible: la integración se cae, alguien lo nota en minutos y la clave vuelve al conjunto. En el segundo, revocar demasiado pronto causa un fallo silencioso y definitivo, que solo aparece cuando alguien intenta leer un documento antiguo, quizá meses después, cuando el material de la clave ya no existe en ninguna parte. Por eso la rotación de una clave de cifrado exige recifrado completo antes de la revocación, y no solo una ventana de espera.',
        },
      ],
    },
    {
      title: 'Medir el uso por identificador de clave convierte el retiro en decisión',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La pregunta que decide el retiro es siempre la misma: ¿algo depende todavía de la clave antigua? Sin instrumentación, esa pregunta se responde por argumento de autoridad, por lectura de código o por la memoria de quien participó en el despliegue, y las tres fallan con suficiente frecuencia como para importar. La instrumentación que de verdad responde es un contador de verificaciones etiquetado por el identificador de la clave y por el origen de la petición, y cuesta una línea dentro de la función de verificación. A partir de ahí el retiro deja de ser una decisión de calendario y pasa a ser una decisión basada en evidencia: la clave antigua sale del conjunto cuando su contador lleva en cero más tiempo que el artefacto firmado más largo del sistema.',
        },
        {
          type: 'paragraph',
          value:
            'La etiqueta de origen es lo que separa una métrica útil de un número agregado inútil. Saber que la clave antigua se usó doscientas veces en las últimas veinticuatro horas no permite actuar. Saber que ciento noventa y ocho de esas veces vinieron de un único socio y dos de una tarea programada interna permite abrir un ticket con el socio y corregir la tarea el mismo día. Conviene limitar la cardinalidad de esa etiqueta a un conjunto pequeño y conocido, como el nombre del servicio llamante o el identificador del socio, y nunca usar algo abierto como la dirección de origen, que multiplica series temporales sin añadir poder de decisión.',
        },
        {
          type: 'list',
          items: [
            'Verificaciones con identificador de clave desconocido por encima de cero durante cinco minutos: alguien firma con una clave que salió del conjunto demasiado pronto, o la clave nueva no llegó a todos los verificadores.',
            'Proporción de firmas emitidas con la clave antigua por encima del uno por ciento veinticuatro horas después de la promoción: hay una instancia que no recargó el llavero y fallará en el momento del retiro.',
            'Fallos de verificación con identificador de clave conocido sostenidos por encima de cero: el material de la clave difiere entre los dos lados, lo que suele ser un error de copia o de codificación y no un problema de propagación.',
            'Edad de la clave activa por encima del plazo definido en la política, medida en días: la rotación preventiva no ocurrió, y la alerta debe dispararse antes del vencimiento y no después.',
            'Cualquier clave detenida en el estado que verifica pero no firma durante más del doble de la supervivencia mínima: el retiro se atascó en un bloqueo que nadie está siguiendo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El último elemento de esa lista existe porque el modo de fallo más común de una rotación bien diseñada no es el incidente, es el abandono. La promoción resuelve el problema visible, el panel queda en verde, la tarea sale del tablero y la clave antigua permanece aceptada indefinidamente, a veces durante años. El resultado es un sistema que acumula claves válidas, lo que anula buena parte del beneficio de seguridad que motivó la rotación, ya que la clave posiblemente comprometida sigue funcionando. Una alerta sobre claves detenidas en el estado intermedio es lo que convierte la rotación de un evento en un proceso que realmente termina.',
        },
      ],
    },
    {
      title: 'El caso del socio externo que solo acepta una clave',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Toda la estrategia descrita hasta aquí depende de que el verificador acepte un conjunto, y existe un caso en que eso no está bajo control: el socio externo cuyo panel tiene un único campo de secreto. En ese arreglo, el momento en que el valor se guarda de su lado es un cambio atómico de verdad, y la única pregunta que importa es quién verifica qué. Si el socio envía webhooks firmados al sistema y la verificación ocurre del lado de dentro, el problema es cómodo, porque el conjunto está bajo control: basta con aceptar ambas claves y pedir al socio que cambie cuando quiera. Si es el sistema el que firma peticiones enviadas al socio, el control está del otro lado y el conjunto no existe.',
        },
        {
          type: 'paragraph',
          value:
            'En ese segundo caso, la técnica que funciona es desplazar la atomicidad a un punto donde revertir sea barato. En lugar de cambiar la clave y confiar en la suerte, el cliente que llama al socio trata el fallo de autenticación como señal de rotación en curso y reintenta una sola vez con la otra clave, registrando cuál funcionó. Eso convierte una ventana de indisponibilidad total en una ventana de latencia ligeramente mayor para una fracción de las peticiones, y se cierra sola en cuanto la clave nueva empieza a funcionar de forma consistente. Dos salvaguardas hacen segura la técnica: el segundo intento ocurre solo ante errores de autenticación, nunca ante otros errores, y solo para peticiones idempotentes o que lleven clave de idempotencia, so pena de duplicar un efecto secundario en el socio.',
        },
        {
          type: 'code',
          value: `// Cliente resistente a la rotacion cuando el socio solo acepta UNA clave.
// Convierte una ventana de indisponibilidad en una ventana de latencia.

const CLAVES = [
  { kid: 'k-2026-09', material: process.env.PARTNER_KEY_NEW },
  { kid: 'k-2026-03', material: process.env.PARTNER_KEY_OLD },
];

// Recuerda cual clave funciono por ultima vez para no pagar el intento extra
// en cada peticion. Empieza por la nueva, que es lo esperado tras la promocion.
let kidPreferido = CLAVES[0].kid;

const ordenarClaves = () => {
  const preferida = CLAVES.find((c) => c.kid === kidPreferido);
  const demas = CLAVES.filter((c) => c.kid !== kidPreferido);
  return preferida ? [preferida, ...demas] : CLAVES;
};

const llamarSocio = async ({ ruta, cuerpo, claveIdempotencia }) => {
  const intentos = ordenarClaves();
  let ultimaRespuesta;

  for (const clave of intentos) {
    const respuesta = await fetch(\`https://api.socio.com\${ruta}\`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // La clave de idempotencia es lo que hace seguro el segundo intento:
        // sin ella, repetir una peticion que ya tuvo efecto lo duplica.
        'idempotency-key': claveIdempotencia,
        'x-signature': firmarCon(clave.material, cuerpo),
      },
      body: cuerpo,
    });

    ultimaRespuesta = respuesta;

    // Exito: fija la preferencia y sale.
    if (respuesta.ok) {
      if (kidPreferido !== clave.kid) {
        kidPreferido = clave.kid;
        metricas.rotacionSocio({ kid: clave.kid, evento: 'preferencia_cambiada' });
      }
      return respuesta;
    }

    // Solo 401 y 403 indican clave equivocada. Reintentar un 500 o un 429
    // con la otra clave no corrige nada y duplica la carga en el socio.
    if (respuesta.status !== 401 && respuesta.status !== 403) return respuesta;

    metricas.rotacionSocio({ kid: clave.kid, evento: 'auth_rechazada' });
  }

  // Ninguna clave funciono: es un fallo real, no una rotacion.
  return ultimaRespuesta;
};`,
        },
        {
          type: 'paragraph',
          value:
            'La restricción de estado cerca del final del ejemplo es la línea que impide que esta técnica se convierta en un amplificador de incidentes. Reintentar con la otra clave ante un error de servidor o un límite de tasa no corrige nada, porque el problema no es la clave, y duplica la carga enviada a un socio que ya está señalando dificultad, que es exactamente el comportamiento que convierte una degradación en una caída. El segundo intento solo tiene sentido cuando el socio afirmó explícitamente que la credencial no sirve, y aun así solo una vez por petición.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Si el secreto ya se filtró, ¿sigue teniendo sentido rotar por fases en lugar de revocar de inmediato?',
      answer:
        'Sí, pero con una inversión importante en el orden de las prioridades, y la decisión depende de separar dos objetivos que suelen confundirse: cortar el acceso del atacante y mantener el servicio en pie. En una rotación preventiva ambos objetivos son compatibles y el retiro puede esperar días. En una respuesta a una filtración confirmada, cortar el acceso es el objetivo dominante, y aceptar la clave comprometida una semana más significa dar al atacante una semana más de acceso legítimo. Aun así, revocar en pánico rara vez es la mejor jugada, porque tumbar la propia integración crea un segundo incidente simultáneo y suele estorbar la contención más de lo que ayuda. Lo que funciona es comprimir las fases en lugar de eliminarlas: introducir y propagar la clave nueva en minutos usando un mecanismo de recarga sin reinicio, promover en cuanto la propagación esté confirmada y revocar la clave antigua justo después, aceptando conscientemente el fallo de los artefactos firmados que seguían siendo válidos. La diferencia entre esa secuencia y la revocación inmediata es quizá media hora más, y evita que el sistema quede indisponible durante la respuesta al incidente. Conviene añadir que una respuesta madura a una filtración no termina en la rotación: incluye invalidar las sesiones y los tokens emitidos con la clave comprometida, que es una acción separada que mucha gente olvida, porque revocar la clave de firma no invalida por sí solo un token que ya fue aceptado y cuyo estado de sesión vive en otro lugar.',
    },
    {
      question: '¿Cómo rotar un secreto compartido entre decenas de servicios sin coordinar a todos los equipos?',
      answer:
        'La respuesta estructural es que un secreto compartido entre decenas de servicios es el problema real, y la rotación solo lo revela. Mientras el mismo material de clave sea usado por servicios con dueños distintos, cualquier rotación exige coordinación global, el radio de impacto de un compromiso es la suma de todos esos servicios y las métricas de uso no pueden señalar responsables. El camino que lo resuelve de verdad es usar la propia rotación como oportunidad para dividir: en lugar de sustituir la clave compartida por otra clave compartida, emitir una clave por consumidor durante la fase de introducción, de modo que cada servicio pase a firmar con material propio bajo un kid distinto. El verificador sigue aceptando un conjunto, lo que hace la migración incremental y sin coordinación, ya que cada equipo promueve su clave a su propio ritmo mientras la antigua sigue aceptada. Una vez que la métrica por kid muestre que todos migraron, la clave compartida se retira y el sistema queda con material segregado, donde comprometer a un consumidor ya no obliga a rotar a todos los demás. Cuando dividir no es viable a corto plazo, el mínimo aceptable es publicar el llavero en un lugar que todos los servicios lean dinámicamente, con recarga periódica en vez de lectura al iniciar, porque eso reduce la propagación de un ciclo de despliegue de todos los equipos al tiempo de vida de la caché, y convierte la coordinación global en una espera pasiva.',
    },
    {
      question: '¿Cuál es el intervalo correcto de rotación y cómo saber si la política actual es adecuada?',
      answer:
        'El intervalo correcto es aquel que la organización puede ejecutar sin que la rotación se convierta en un proyecto, y esa es una medida de capacidad y no de calendario. Una política que exige rotación trimestral en un sistema donde cada rotación consume una semana de trabajo manual y genera riesgo de indisponibilidad no se va a cumplir, y el resultado práctico es una clave de tres años junto a una política en papel que nadie audita. La señal de que la política es adecuada no es la frecuencia declarada, es el tiempo medio entre decidir rotar y completar el retiro: si ese tiempo es de horas, la frecuencia puede ser alta y la respuesta a una filtración será rápida porque el camino ya es conocido y ejercitado. Si es de semanas, aumentar la frecuencia declarada solo aumenta la deuda. La inversión que mueve ese número es automatizar las cuatro fases con criterios de salida verificables, más un ejercicio periódico de rotación en producción con tráfico real, en el mismo espíritu que una prueba de restauración de copia de seguridad: una rotación que nunca se ejecutó no es un procedimiento, es una intención documentada. Como referencia práctica, las claves de firma de corta duración con automatización completa suelen rotarse en días, las credenciales de integración con socios externos en meses por limitación del otro lado, y las claves de cifrado de datos en reposo en el plazo que permita el recifrado del volumen existente, que es el único caso en que el costo crece con el tamaño de la base.',
    },
  ],
  conclusion: {
    title: 'La rotación es una transición observable, no un evento instantáneo',
    description:
      'La indisponibilidad durante el cambio de una clave viene casi siempre de tratar el secreto como un valor único que cambia en un instante, cuando en realidad es un conjunto que atraviesa cuatro estados a ritmos distintos. Aceptar múltiples claves en la verificación, llevar el identificador de clave en el mensaje, separar introducción de promoción y decidir el retiro por evidencia de uso eliminan la ventana de fallo sin exigir ventana de mantenimiento. Puedo modelar el llavero de tu sistema con estados e identificador de clave, instrumentar el uso por clave y por origen, automatizar las cuatro fases con criterios de salida verificables, tratar el caso del socio que acepta una sola clave y configurar las alertas que impiden que una rotación quede promovida y nunca concluida.',
    cta: 'Hablar sobre la rotación de secretos de mi sistema',
  },
  related: [
    {
      label: 'Migración de base sin ventana: expandir, migrar, contraer',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Contrato de API sin versión: evolucionar el payload sin romper al cliente antiguo',
      to: '/blog/contrato-api-sem-versao-evoluir-payload-sem-quebrar-cliente-antigo',
    },
    {
      label: 'Observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
