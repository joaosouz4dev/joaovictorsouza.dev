// Conteudo do artigo: migracao de autenticacao sem deslogar todo mundo, trocando
// o esquema de token em producao com convivencia, troca silenciosa e corte medido.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O deploy entrou às dez da manhã de uma terça-feira e trocava o token de acesso assinado com segredo compartilhado, válido por trinta dias, por um par moderno: token de acesso de quinze minutos assinado com chave assimétrica e token de renovação rotativo. O validador novo só entendia o formato novo. Às dez e quarenta, um milhão e quatrocentas mil sessões tinham virado 401, a taxa de login estava trinta vezes acima do normal, e o serviço de autenticação caiu sob o custo de verificar senha com uma função de hash deliberadamente lenta para todo mundo ao mesmo tempo. O rollback não resolveu, porque os usuários que já tinham recebido o token novo passaram a ser rejeitados pela versão antiga. Este artigo mostra por que trocar o esquema de token é uma migração de estado espalhado em dispositivos que você não controla e não uma troca de biblioteca, qual ordem de deploy permite voltar atrás sem deslogar ninguém, como escrever um validador que aceita os dois formatos sem abrir a brecha clássica de confusão de algoritmo, como converter o token antigo no próximo contato sem que duas abas abertas derrubem a sessão uma da outra, quais dependências escondidas no cliente quebram com um token maior ou diferente, e quais números dizem que é seguro desligar o caminho legado.',
  sections: [
    {
      title: 'Trocar o esquema de token é migrar estado que mora no cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando uma equipe decide trocar o esquema de autenticação, a conversa costuma girar em torno de biblioteca, algoritmo e formato: sai o segredo compartilhado, entra a assinatura assimétrica, sai a validade longa, entra o par de acesso curto e renovação rotativa. Tudo isso é código, e código se troca com um deploy. O que não se troca com deploy é a população de tokens já emitidos, que está guardada no armazenamento local de navegadores, no cofre de chaves de aplicativos móveis, em variáveis de ambiente de integrações de parceiros e em colunas de banco de sistemas que você nunca viu. Cada um desses tokens é uma promessa assinada que continua válida até expirar, e o servidor que para de reconhecê-la está quebrando a promessa de uma vez para todos.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática é que a duração mínima da migração não é decidida pela equipe, e sim pela maior validade de token que já foi emitida. Se o token legado vive trinta dias, existe token legado legítimo circulando por trinta dias depois da última emissão, e qualquer plano que desligue o formato antigo antes disso está escolhendo deslogar gente. Existe ainda uma população que não segue a validade: o token de renovação de aplicativo móvel que o usuário abre uma vez por mês, e a credencial de integração que foi colada num arquivo de configuração e nunca mais tocada.',
        },
        {
          type: 'table',
          columns: ['Onde o token vive', 'Quem controla a atualização', 'Validade típica', 'O que define a duração da migração'],
          rows: [
            [
              'Armazenamento local do navegador',
              'Você, no próximo carregamento da página',
              'Horas a dias',
              'A última aba aberta há dias que nunca recarregou',
            ],
            [
              'Cookie de sessão HttpOnly',
              'Você, em qualquer resposta',
              'Dias a semanas',
              'A validade do cookie, e o limite de tamanho dele',
            ],
            [
              'Cofre de chaves de aplicativo móvel',
              'O usuário, quando atualiza o app',
              'Semanas a meses no token de renovação',
              'A versão mais antiga do app que ainda abre',
            ],
            [
              'Configuração de integração de parceiro',
              'O parceiro, no ritmo dele',
              'Meses ou sem validade',
              'A próxima janela de mudança do parceiro',
            ],
            [
              'Fila, job agendado ou mensagem guardada',
              'Ninguém, até a mensagem ser processada',
              'A retenção da fila',
              'A mensagem mais antiga ainda não consumida',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O incidente da abertura tem um segundo componente que costuma ser subestimado: o custo do login em massa. Verificar senha com bcrypt, scrypt ou Argon2 é caro de propósito, na ordem de dezenas a centenas de milissegundos de CPU por tentativa, porque isso encarece ataque de força bruta. Um serviço dimensionado para algumas centenas de logins por minuto não sustenta dezenas de milhares, e a mesma propriedade que protege contra ataque transforma o deslogamento em massa em indisponibilidade. Somam-se a isso o pico de redefinição de senha dos usuários que não lembram a própria senha e o custo de SMS de segundo fator, que aparece na fatura do mês seguinte.',
        },
      ],
    },
    {
      title: 'Expandir antes de contrair: a ordem de deploy que deixa voltar atrás',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A regra que evita o rollback impossível é a mesma de qualquer migração de esquema com tráfego ligado: primeiro todos os leitores aprendem o formato novo, só depois algum escritor começa a produzi-lo. No caso de token, leitor é todo serviço que valida, e escritor é o serviço que emite. Se a emissão do formato novo começa enquanto existe uma única instância, ou uma única versão alvo de rollback, que não sabe validá-lo, o usuário que recebeu o token novo é deslogado assim que cai nessa instância ou assim que o rollback acontece.',
        },
        {
          type: 'diagram',
          value: `FASE 0  estado atual
        valida: legado            emite: legado

FASE 1  expandir (deploy de leitura, sem mudanca visivel)
        valida: legado + novo     emite: legado
        pre-requisito da fase 2: TODAS as instancias e a versao
        alvo de rollback aceitam os dois formatos

FASE 2  migrar
        valida: legado + novo     emite: novo   (clientes que entendem)
                                  emite: legado (endpoint antigo, apps antigos)
        troca silenciosa converte cada token legado no proximo contato
        rollback seguro: voltar para a FASE 1 nao desloga ninguem

FASE 3  drenar
        emissao legada desligada; populacao legada so decai
        espera minima = maior validade legada emitida + margem

FASE 4  contrair
        valida: novo              emite: novo
        segredo legado removido da configuracao e revogado`,
        },
        {
          type: 'paragraph',
          value:
            'A fase 1 é a que mais gente pula, porque ela não entrega nada visível. Ela existe para que o rollback da fase 2 seja trivial: voltar para uma versão que aceita os dois formatos não afeta ninguém, enquanto voltar para a fase 0 desloga todo mundo que já foi convertido. Na prática, a fase 1 precisa ficar em produção tempo suficiente para que nenhuma versão anterior a ela continue candidata a rollback, o que significa pelo menos um ciclo completo de deploy e a remoção dos artefatos antigos do registro de implantação.',
        },
        {
          type: 'ordered',
          items: [
            'Publicar a chave pública nova no endpoint de chaves antes de assinar qualquer coisa com ela, porque serviços que fazem cache desse endpoint podem levar minutos ou horas para enxergá-la.',
            'Implantar o validador duplo em todos os serviços que validam token, incluindo gateways, workers de fila e serviços internos que alguém esqueceu que também validam.',
            'Confirmar por métrica, e não por inventário, que todas as instâncias em execução reportam suporte ao formato novo antes de ligar a emissão.',
            'Ligar a emissão nova por coorte, começando por uma fração pequena de usuários, e observar a taxa de 401 por motivo e a taxa de login durante pelo menos um dia inteiro.',
            'Manter a emissão legada disponível no endpoint antigo enquanto houver versão de cliente que só entende o formato antigo, e medir essa população por versão.',
          ],
        },
      ],
    },
    {
      title: 'O validador duplo e a armadilha do algoritmo escolhido pelo token',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O validador que aceita dois formatos tem uma tentação perigosa: olhar o campo de algoritmo no cabeçalho do token e usar o que ele diz. Esse é o caminho para a confusão de algoritmo, uma vulnerabilidade conhecida em que o atacante pega a chave pública do esquema novo, que é pública por definição, e a usa como segredo para assinar um token com o algoritmo simétrico do esquema legado. Um validador que confia no cabeçalho vai tentar verificar esse token com a chave pública como se fosse segredo compartilhado, e a assinatura bate. Durante a convivência dos dois esquemas, a janela para esse erro está aberta justamente porque os dois algoritmos são aceitos ao mesmo tempo.',
        },
        {
          type: 'paragraph',
          value:
            'A defesa é inverter a fonte da verdade. O servidor mantém um mapa de chaves conhecidas, cada uma amarrada a um único algoritmo, e usa o cabeçalho do token apenas para escolher qual entrada do mapa consultar. O algoritmo passado para a verificação sai do mapa, numa lista de um elemento só, e o do token é apenas conferido contra ele. Assim a chave pública nunca é usada como segredo simétrico, porque não existe nenhuma entrada do mapa em que ela esteja associada a um algoritmo simétrico.',
        },
        {
          type: 'code',
          value: `// auth/validador-duplo.js
// Aceita o formato legado (HS256, sem kid) e o novo (ES256, com kid)
// durante a convivencia. O algoritmo vem do servidor, nunca do token.
import { createHash } from 'node:crypto';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';

const EMISSOR = 'https://auth.exemplo.com';
const AUDIENCIA = 'api';

// Chaves do esquema novo, indexadas por kid. Cada kid tem UM algoritmo.
const CHAVES_NOVAS = new Map([
  [
    '2026-09-es256',
    {
      esquema: 'novo',
      algoritmo: 'ES256',
      chave: await importSPKI(process.env.AUTH_CHAVE_PUBLICA_2026_09, 'ES256'),
      opcoes: { issuer: EMISSOR, audience: AUDIENCIA },
    },
  ],
]);

// O legado nao tinha kid, issuer nem audience. Ele so e aceito com o
// algoritmo que realmente usava e ate a data de corte planejada:
// ultima emissao legada + 30 dias de validade + margem.
const LEGADO = {
  esquema: 'legado',
  algoritmo: 'HS256',
  chave: new TextEncoder().encode(process.env.AUTH_SEGREDO_LEGADO),
  opcoes: {},
  aceitarAte: Date.parse(process.env.AUTH_LEGADO_ACEITAR_ATE || '2026-11-15T00:00:00Z'),
};

export class TokenInvalido extends Error {
  constructor(motivo) {
    super(motivo);
    this.motivo = motivo; // vira rotulo de metrica: 401 por motivo
  }
}

export const impressaoDoToken = (token) =>
  createHash('sha256').update(token).digest('hex');

function resolverEntrada(cabecalho) {
  if (cabecalho.kid) return CHAVES_NOVAS.get(cabecalho.kid) || null;
  if (cabecalho.alg !== LEGADO.algoritmo) return null;
  if (Date.now() >= LEGADO.aceitarAte) return null;
  return LEGADO;
}

export async function validarToken(token) {
  let cabecalho;
  try {
    cabecalho = decodeProtectedHeader(token);
  } catch {
    throw new TokenInvalido('formato');
  }

  const entrada = resolverEntrada(cabecalho);
  if (!entrada) throw new TokenInvalido('chave_desconhecida');

  try {
    const { payload } = await jwtVerify(token, entrada.chave, {
      algorithms: [entrada.algoritmo], // lista de um so elemento
      clockTolerance: 30,
      ...entrada.opcoes,
    });

    return {
      sujeito: payload.sub,
      esquema: entrada.esquema,
      expiraEm: payload.exp * 1000,
      // O legado pode nao ter jti: a impressao do proprio token o substitui.
      impressao: payload.jti || impressaoDoToken(token),
    };
  } catch (erro) {
    throw new TokenInvalido(erro.code || 'assinatura');
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Três detalhes desse código fazem diferença em produção. O primeiro é a data de corte do legado estar no próprio validador, lida de configuração: o caminho antigo se fecha sozinho na data planejada, sem depender de alguém lembrar de fazer um deploy de remoção, e a data pode ser adiada sem mudar código se a métrica mostrar população residual. O segundo é o motivo da rejeição virar rótulo de métrica, porque durante a migração a pergunta mais importante é quantos 401 são de token expirado, que é normal, e quantos são de chave desconhecida ou assinatura inválida, que indicam uma instância sem a chave nova ou um cliente mandando algo inesperado. O terceiro é a tolerância de relógio: tokens de quinze minutos tornam a diferença de relógio entre servidores relevante de um jeito que tokens de trinta dias nunca tornaram.',
        },
      ],
    },
    {
      title: 'A troca silenciosa e a corrida entre abas abertas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Esperar a população legada expirar sozinha funciona, mas desperdiça a oportunidade de convertê-la. A troca silenciosa aproveita o próximo contato do cliente atualizado: quando ele apresenta um token legado válido ao endpoint de renovação, o servidor devolve um par novo, e o usuário nunca percebe que houve migração. O ponto delicado é que o token legado precisa deixar de ser trocável depois da troca, senão um token roubado continua gerando pares novos indefinidamente, e é aqui que a maioria das implementações desloga usuários legítimos.',
        },
        {
          type: 'paragraph',
          value:
            'O motivo é concorrência do próprio cliente. Um usuário com três abas abertas, ou um aplicativo que dispara quatro requisições em paralelo ao voltar do segundo plano, apresenta o mesmo token legado várias vezes no mesmo segundo. Se a primeira requisição consome o token e as outras três recebem rejeição por reuso, o cliente interpreta essa rejeição como sessão inválida e manda o usuário para a tela de login. O mesmo problema existe na rotação de token de renovação no esquema novo, e a solução é a mesma nos dois casos: uma janela de graça em que requisições concorrentes com o mesmo token recebem exatamente o mesmo par, em vez de um par cada uma ou de uma rejeição.',
        },
        {
          type: 'code',
          value: `// auth/troca-legado.js
// Converte um token legado em par novo, uma unica vez, tolerando
// requisicoes concorrentes do mesmo cliente dentro da janela de graca.
import { createClient } from 'redis';
import { TokenInvalido, validarToken } from './validador-duplo.js';
import { emitirPar } from './emissor.js';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const JANELA_DE_GRACA_S = 120; // abas e requisicoes paralelas do mesmo cliente
const RESERVA_S = 10; // se o processo morrer no meio, a reserva expira sozinha
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export async function trocarTokenLegado(token, tentativa = 0) {
  const sessao = await validarToken(token);
  if (sessao.esquema !== 'legado') throw new TokenInvalido('nao_e_legado');

  const chave = \`troca:\${sessao.impressao}\`;
  const chavePar = \`\${chave}:par\`;
  const restanteS = Math.max(1, Math.ceil((sessao.expiraEm - Date.now()) / 1000));

  // 1) Quem conseguir a reserva emite. NX garante um unico emissor.
  const reservado = await redis.set(chave, 'pendente', { NX: true, EX: RESERVA_S });

  if (reservado) {
    const par = await emitirPar({ sujeito: sessao.sujeito, origem: 'troca_legado' });
    // Par e marca de consumo gravados juntos: quem vir 'trocado' acha o par.
    await redis
      .multi()
      .set(chavePar, JSON.stringify(par), { EX: JANELA_DE_GRACA_S })
      .set(chave, 'trocado', { EX: restanteS })
      .exec();
    return par;
  }

  // 2) Outra requisicao com o mesmo token chegou antes. Espera o resultado.
  for (let i = 0; i < 20; i += 1) {
    const estado = await redis.get(chave);

    if (estado === 'trocado') {
      const par = await redis.get(chavePar);
      if (par) return JSON.parse(par); // dentro da graca: o MESMO par
      // Fora da graca, reuso do token legado e sinal de copia do token.
      throw new TokenInvalido('legado_ja_trocado');
    }

    if (estado === null) {
      // A reserva expirou sem concluir (processo morreu): tenta assumir.
      if (tentativa >= 2) break;
      return trocarTokenLegado(token, tentativa + 1);
    }

    await esperar(100);
  }

  throw new TokenInvalido('troca_em_andamento'); // cliente deve repetir em breve
}`,
        },
        {
          type: 'paragraph',
          value:
            'A reserva curta de dez segundos e a marca de consumo longa são duas travas com objetivos diferentes. A reserva evita que duas instâncias emitam pares diferentes para o mesmo token ao mesmo tempo, e expira rápido para que uma falha no meio da emissão não bloqueie aquele usuário para sempre. A marca de consumo dura até o token legado expirar e é o que impede um token copiado de continuar gerando sessões. Gravar o par e a marca na mesma transação é o que torna a leitura consistente: nenhuma requisição concorrente vê o estado de trocado sem conseguir achar o par durante a janela de graça.',
        },
        {
          type: 'paragraph',
          value:
            'O par fica guardado por dois minutos no armazenamento compartilhado, e isso é uma decisão de segurança consciente, não um descuido. A alternativa seria rejeitar as requisições concorrentes, o que desloga usuário legítimo, ou emitir um par para cada uma, o que multiplica sessões e torna a detecção de reuso impossível. Dois minutos de retenção num armazenamento que já guarda sessões, com tempo de vida curto e acesso restrito, é um custo pequeno. Se o reuso aparecer depois da janela, o comportamento mais seguro é revogar também a família de tokens gerada pela troca, porque não há como saber qual das duas cópias é a legítima.',
        },
      ],
    },
    {
      title: 'As dependências escondidas no cliente que quebram com o token novo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O contrato implícito de um token não é apenas ser aceito pelo servidor. Clientes e intermediários criam dependências de formato, tamanho e conteúdo que ninguém documentou, e a migração é o momento em que todas elas aparecem ao mesmo tempo. Um token assinado com curva elíptica e com mais claims costuma ser maior do que o legado, e um token opaco no lugar de um JWT deixa de ser decodificável, e cada uma dessas mudanças quebra alguma coisa que dependia da forma antiga.',
        },
        {
          type: 'table',
          columns: ['Dependência escondida', 'Como quebra', 'Sintoma que chega ao suporte', 'Como detectar antes'],
          rows: [
            [
              'App decodifica o token para ler a expiração',
              'Token opaco não decodifica, ou expiração de 15 minutos dispara renovação em laço',
              'App pede login toda vez que abre, ou bateria e dados consumidos',
              'Taxa de renovação por sessão e por versão do app',
            ],
            [
              'Limite de 4096 bytes por cookie no navegador',
              'Cookie maior é descartado em silêncio, sem erro',
              'Login conclui e o usuário aparece deslogado na página seguinte',
              'Medir o tamanho do token emitido no pior caso de claims',
            ],
            [
              'Limite de tamanho de cabeçalho em proxy ou balanceador',
              'Requisição recusada com 431 ou 400 antes da aplicação',
              'Erro intermitente só para usuários com muitos papéis',
              'Teste com o token do usuário com mais permissões',
            ],
            [
              'Coluna de tamanho fixo no sistema do parceiro',
              'Token truncado ao gravar e rejeitado ao usar',
              'Integração falha dias depois, na primeira renovação',
              'Comunicar o tamanho máximo no contrato de integração',
            ],
            [
              'Expressão regular validando o formato do token',
              'Gateway ou SDK recusa o token antes de enviá-lo',
              'Erro no cliente, sem nenhum registro no servidor',
              'Canário com versões antigas de SDK em homologação',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A primeira linha tem uma consequência que muda o plano inteiro. Um aplicativo que não sabe lidar com o formato novo não pode receber o formato novo, e isso significa que a emissão legada precisa continuar existindo no endpoint antigo enquanto essa versão do aplicativo estiver em uso. A emissão passa a ser decidida pela capacidade do cliente, informada por um cabeçalho de versão ou pelo próprio endpoint chamado, e a fase de drenagem só começa quando a versão antiga cai abaixo de um limiar aceitável ou quando uma atualização obrigatória é publicada. É por isso que a data de corte do legado é uma decisão de produto além de técnica.',
        },
        {
          type: 'paragraph',
          value:
            'Integrações de parceiros merecem um canal próprio. Para elas, o token não circula por sessão de usuário, e sim por credencial de serviço, e a conversão silenciosa não acontece porque o parceiro não chama o endpoint de renovação. O caminho é tratar o novo esquema como uma versão do contrato de integração, com data anunciada, período de convivência medido em meses e uma métrica por parceiro mostrando quem ainda usa o formato antigo, para que a conversa aconteça antes do corte e não no chamado aberto depois dele.',
        },
      ],
    },
    {
      title: 'Quando é seguro desligar o caminho legado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O corte do legado deve ser uma decisão tomada por número e não por calendário, e os números precisam existir desde a fase 1. A métrica central é a população legada ativa: quantos sujeitos distintos apresentaram token legado válido nas últimas vinte e quatro horas, quebrado por versão de cliente e por parceiro. Essa curva deve cair de forma previsível depois que a emissão legada para, e o formato dela diz muito: queda rápida seguida de platô indica um grupo que não se converte sozinho, como uma versão antiga do aplicativo ou uma integração esquecida, e esse grupo precisa de ação direta antes do corte.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'O que responde', 'Valor saudável durante a migração', 'Sinal de alerta'],
          rows: [
            [
              '401 por motivo de rejeição',
              'Se a rejeição é expiração normal ou falha da migração',
              'Expiração domina; chave desconhecida perto de zero',
              'Qualquer crescimento de chave desconhecida ou assinatura',
            ],
            [
              'Logins por minuto',
              'Se usuários estão sendo deslogados em massa',
              'Dentro da faixa histórica do mesmo dia da semana',
              'Pico acima de duas vezes a faixa, mesmo que breve',
            ],
            [
              'População legada ativa por versão e parceiro',
              'Quanto falta converter e quem não converte sozinho',
              'Queda contínua depois que a emissão legada para',
              'Platô que não muda por mais de uma semana',
            ],
            [
              'Falhas de troca por motivo',
              'Se a conversão silenciosa está funcionando',
              'Reuso fora da graça raro e concentrado',
              'Troca em andamento ou reuso espalhado por muitos usuários',
            ],
            [
              'Renovações por sessão por hora',
              'Se algum cliente entrou em laço de renovação',
              'Perto de quatro para token de quinze minutos',
              'Dezenas por hora em uma versão específica de cliente',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O indicador de logins por minuto é o que detecta o problema mais rápido, porque ele reage em minutos enquanto a população legada reage em dias. Um alerta sobre ele, comparando com o mesmo horário da semana anterior, precisa estar ativo antes de qualquer fase que mude emissão ou validação, e o critério de reversão da fase precisa estar escrito antes de ela começar. Uma migração de autenticação que só descobre o deslogamento em massa pelo volume de chamados no suporte já perdeu a primeira hora do incidente.',
        },
        {
          type: 'ordered',
          items: [
            'Confirmar que a emissão legada está desligada há pelo menos a maior validade legada emitida, contada a partir da última emissão real registrada e não da data do deploy.',
            'Confirmar que a população legada ativa está abaixo do limiar combinado com produto, com a lista nominal de parceiros restantes já contatados.',
            'Antecipar a data de corte no validador em ambiente de homologação e rodar a suíte de testes de ponta a ponta com as versões de cliente ainda suportadas.',
            'Aplicar o corte em produção por configuração, sem deploy de código, mantendo por alguns dias a possibilidade de adiar a data se o indicador de logins reagir.',
            'Remover o segredo legado da configuração e revogá-lo na origem, porque um segredo que ninguém usa e que continua válido é só superfície de ataque.',
            'Remover o código do caminho legado num deploy separado, depois de um ciclo inteiro sem nenhuma validação legada registrada.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'A migração muda se o sistema atual usa sessão opaca guardada no servidor, e não JWT?',
      answer:
        'A estrutura de fases é a mesma, mas o risco muda de lugar. Com sessão opaca, o identificador não carrega informação e toda validação é uma consulta ao armazenamento de sessões, o que torna o validador duplo simples de despachar: um prefixo no identificador, como sess_ para o formato antigo, decide se a validação consulta o armazenamento ou verifica uma assinatura. A diferença importante é que a sessão opaca tem revogação imediata de graça, porque apagar a entrada no armazenamento encerra a sessão na próxima requisição, e o token assinado de curta duração perde essa propriedade. Se o produto depende de encerrar sessão na hora, como em troca de senha, desligamento de funcionário ou suspeita de fraude, a migração precisa trazer junto uma lista de revogação por identificador de token, consultada em toda validação e mantida só pelo tempo de vida do token de acesso, o que é barato quando esse tempo é de quinze minutos. Outro ponto é que a sessão opaca costuma guardar dados junto com a identidade, como carrinho, preferências e contexto de navegação, e a migração precisa decidir para onde esses dados vão, porque colocá-los dentro do token infla o tamanho e esbarra no limite de cookie descrito na tabela de dependências escondidas.',
    },
    {
      question: 'Não é mais simples forçar todo mundo a fazer login de novo numa madrugada?',
      answer:
        'Às vezes é, e vale fazer a conta antes de descartar a opção. Uma base pequena, um produto interno ou um sistema em que o login é por provedor de identidade corporativo com sessão única, onde o usuário é reautenticado sem digitar senha, toleram bem um corte seco. O custo cresce com três fatores: o número de usuários ativos, a proporção de clientes que você não consegue atualizar, como aplicativos móveis e integrações, e o custo de cada login, que inclui hash de senha deliberadamente caro, segundo fator por SMS cobrado por mensagem e um fluxo de redefinição de senha para quem não lembra a própria. Se a decisão for pelo corte, ele não deve ser simultâneo para toda a base. Distribuir o corte por coortes, usando um hash estável do identificador do usuário para decidir quem é deslogado em cada hora, transforma um pico de login impossível de absorver numa carga alta porém sustentável, e o serviço de autenticação deve ser escalado antes, porque a mesma lentidão que protege contra força bruta é a que derruba o serviço sob login legítimo em massa. Mesmo assim, integrações de parceiros quase nunca aceitam corte seco, e para elas a convivência continua obrigatória.',
    },
    {
      question: 'Depois da migração, como trocar a chave de assinatura sem repetir todo esse processo?',
      answer:
        'É exatamente para isso que o identificador de chave no cabeçalho existe, e ele é o maior ganho estrutural da migração. Com o validador escolhendo a chave pelo identificador, a rotação vira uma versão reduzida das mesmas fases: a chave pública nova é publicada no endpoint de chaves e passa a ser aceita por todos os validadores, depois de um intervalo maior que o tempo de cache desse endpoint a emissão passa a assinar com a chave nova, e a chave antiga continua publicada até que o último token assinado com ela expire, o que para token de acesso de quinze minutos é questão de horas e não de semanas. O token de renovação precisa de atenção separada, porque ele vive muito mais: ou ele é opaco e guardado no servidor, o que o desacopla da chave de assinatura, ou a chave antiga precisa continuar aceita para renovação pelo tempo de vida dele. O cuidado operacional é o mesmo do corte do legado, ou seja, remover a chave antiga só depois que a métrica de validações com o identificador dela chegar a zero, e nunca remover do endpoint de chaves antes de parar de assinar com ela.',
    },
  ],
  conclusion: {
    title: 'A migração de autenticação é medida em tokens vivos, não em deploys',
    description:
      'Trocar o esquema de token com um deploy só desloga todo mundo porque ignora que a população de tokens já emitidos mora em dispositivos, abas e integrações fora do seu controle. Expandir a validação antes de mudar a emissão, amarrar cada chave a um único algoritmo, converter o token antigo no próximo contato com uma janela de graça para requisições concorrentes, mapear as dependências escondidas no cliente e cortar o legado por métrica e não por calendário transformam a troca num processo que o usuário nunca percebe. Posso planejar as fases da migração a partir do inventário real de clientes e integrações, implementar o validador duplo e a troca silenciosa, instrumentar os indicadores que detectam deslogamento em massa em minutos e conduzir o corte do legado com critério de reversão definido antes de cada etapa.',
    cta: 'Falar sobre a migração de autenticação do meu produto',
  },
  related: [
    {
      label: 'Rotação de segredo sem indisponibilidade: trocar a chave em produção',
      to: '/blog/rotacao-segredo-sem-indisponibilidade-trocar-chave-em-producao',
    },
    {
      label: 'Contrato de API sem versão: evoluir o payload sem quebrar o cliente antigo',
      to: '/blog/contrato-api-sem-versao-evoluir-payload-sem-quebrar-cliente-antigo',
    },
    {
      label: 'Arquitetura e Modernização de Backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The deploy went out at ten on a Tuesday morning and replaced the access token signed with a shared secret, valid for thirty days, with a modern pair: a fifteen minute access token signed with an asymmetric key and a rotating refresh token. The new validator only understood the new format. By ten forty, one million four hundred thousand sessions had turned into 401s, the login rate was thirty times above normal, and the authentication service went down under the cost of checking passwords with a deliberately slow hash function for everyone at once. The rollback did not help, because the users who had already received the new token started being rejected by the old version. This article shows why swapping the token scheme is a migration of state scattered across devices you do not control rather than a library swap, which deploy order lets you roll back without logging anyone out, how to write a validator that accepts both formats without opening the classic algorithm confusion hole, how to convert the old token on the next contact without two open tabs killing each other\'s session, which hidden client dependencies break with a larger or different token, and which numbers tell you it is safe to turn the legacy path off.',
  sections: [
    {
      title: 'Swapping the token scheme means migrating state that lives in the client',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When a team decides to swap its authentication scheme, the conversation usually revolves around library, algorithm and format: out goes the shared secret, in comes the asymmetric signature, out goes the long lifetime, in comes the short access and rotating refresh pair. All of that is code, and code changes with a deploy. What does not change with a deploy is the population of tokens already issued, which sits in browser local storage, in the keychain of mobile apps, in environment variables of partner integrations and in database columns of systems you have never seen. Each of those tokens is a signed promise that remains valid until it expires, and the server that stops recognizing it is breaking the promise for everyone at once.',
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence is that the minimum duration of the migration is not decided by the team, but by the longest token lifetime ever issued. If the legacy token lives thirty days, legitimate legacy tokens keep circulating for thirty days after the last issuance, and any plan that turns off the old format before that is choosing to log people out. There is also a population that does not follow the lifetime at all: the refresh token of a mobile app the user opens once a month, and the integration credential pasted into a configuration file and never touched again.',
        },
        {
          type: 'table',
          columns: ['Where the token lives', 'Who controls the update', 'Typical lifetime', 'What sets the migration duration'],
          rows: [
            [
              'Browser local storage',
              'You, on the next page load',
              'Hours to days',
              'The last tab left open for days that never reloaded',
            ],
            [
              'HttpOnly session cookie',
              'You, on any response',
              'Days to weeks',
              'The cookie lifetime, and its size limit',
            ],
            [
              'Mobile app keychain',
              'The user, when they update the app',
              'Weeks to months for the refresh token',
              'The oldest app version that still opens',
            ],
            [
              'Partner integration configuration',
              'The partner, at their own pace',
              'Months or no expiry',
              'The partner\'s next change window',
            ],
            [
              'Queue, scheduled job or stored message',
              'Nobody, until the message is processed',
              'The queue retention',
              'The oldest message not yet consumed',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The opening incident has a second component that is usually underestimated: the cost of mass login. Checking a password with bcrypt, scrypt or Argon2 is expensive on purpose, in the order of tens to hundreds of milliseconds of CPU per attempt, because that makes brute force attacks costly. A service sized for a few hundred logins per minute cannot sustain tens of thousands, and the same property that protects against attacks turns a mass logout into an outage. Add to that the spike in password resets from users who do not remember their password and the cost of SMS based second factor, which shows up on the following month\'s bill.',
        },
      ],
    },
    {
      title: 'Expand before you contract: the deploy order that lets you roll back',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The rule that prevents an impossible rollback is the same as in any schema migration with live traffic: first every reader learns the new format, and only then does any writer start producing it. For tokens, a reader is every service that validates, and the writer is the service that issues. If issuance of the new format starts while there is a single instance, or a single rollback target version, that cannot validate it, the user who received the new token is logged out as soon as they hit that instance or as soon as the rollback happens.',
        },
        {
          type: 'diagram',
          value: `PHASE 0  current state
         validates: legacy            issues: legacy

PHASE 1  expand (read-side deploy, no visible change)
         validates: legacy + new      issues: legacy
         prerequisite for phase 2: ALL instances and the
         rollback target version accept both formats

PHASE 2  migrate
         validates: legacy + new      issues: new    (clients that understand it)
                                      issues: legacy (old endpoint, old apps)
         silent exchange converts each legacy token on next contact
         safe rollback: going back to PHASE 1 logs nobody out

PHASE 3  drain
         legacy issuance turned off; legacy population only decays
         minimum wait = longest legacy lifetime issued + margin

PHASE 4  contract
         validates: new               issues: new
         legacy secret removed from configuration and revoked`,
        },
        {
          type: 'paragraph',
          value:
            'Phase 1 is the one most people skip, because it delivers nothing visible. It exists so that rolling back phase 2 is trivial: going back to a version that accepts both formats affects nobody, while going back to phase 0 logs out everyone who has already been converted. In practice, phase 1 needs to stay in production long enough that no version older than it remains a rollback candidate, which means at least one full deploy cycle and removing the old artifacts from the deployment registry.',
        },
        {
          type: 'ordered',
          items: [
            'Publish the new public key on the keys endpoint before signing anything with it, because services that cache that endpoint may take minutes or hours to see it.',
            'Deploy the dual validator to every service that validates tokens, including gateways, queue workers and internal services someone forgot also validate.',
            'Confirm through metrics, not inventory, that every running instance reports support for the new format before turning issuance on.',
            'Turn on new issuance by cohort, starting with a small fraction of users, and watch the 401 rate by reason and the login rate for at least one full day.',
            'Keep legacy issuance available on the old endpoint while there is a client version that only understands the old format, and measure that population by version.',
          ],
        },
      ],
    },
    {
      title: 'The dual validator and the trap of the algorithm chosen by the token',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A validator that accepts two formats carries a dangerous temptation: reading the algorithm field in the token header and using whatever it says. That is the road to algorithm confusion, a well known vulnerability in which the attacker takes the public key of the new scheme, public by definition, and uses it as the secret to sign a token with the symmetric algorithm of the legacy scheme. A validator that trusts the header will try to verify that token using the public key as if it were a shared secret, and the signature matches. While both schemes coexist, the window for this mistake is open precisely because both algorithms are accepted at the same time.',
        },
        {
          type: 'paragraph',
          value:
            'The defense is to invert the source of truth. The server keeps a map of known keys, each one bound to a single algorithm, and uses the token header only to pick which map entry to look up. The algorithm passed to verification comes from the map, in a one element list, and the one in the token is merely checked against it. That way the public key is never used as a symmetric secret, because no map entry associates it with a symmetric algorithm.',
        },
        {
          type: 'code',
          value: `// auth/dual-validator.js
// Accepts the legacy format (HS256, no kid) and the new one (ES256, with kid)
// while they coexist. The algorithm comes from the server, never from the token.
import { createHash } from 'node:crypto';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';

const ISSUER = 'https://auth.example.com';
const AUDIENCE = 'api';

// New scheme keys, indexed by kid. Each kid has ONE algorithm.
const NEW_KEYS = new Map([
  [
    '2026-09-es256',
    {
      scheme: 'new',
      algorithm: 'ES256',
      key: await importSPKI(process.env.AUTH_PUBLIC_KEY_2026_09, 'ES256'),
      options: { issuer: ISSUER, audience: AUDIENCE },
    },
  ],
]);

// Legacy had no kid, issuer or audience. It is only accepted with the
// algorithm it actually used and until the planned cutoff date:
// last legacy issuance + 30 days of lifetime + margin.
const LEGACY = {
  scheme: 'legacy',
  algorithm: 'HS256',
  key: new TextEncoder().encode(process.env.AUTH_LEGACY_SECRET),
  options: {},
  acceptUntil: Date.parse(process.env.AUTH_LEGACY_ACCEPT_UNTIL || '2026-11-15T00:00:00Z'),
};

export class InvalidToken extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason; // becomes a metric label: 401 by reason
  }
}

export const tokenFingerprint = (token) =>
  createHash('sha256').update(token).digest('hex');

function resolveEntry(header) {
  if (header.kid) return NEW_KEYS.get(header.kid) || null;
  if (header.alg !== LEGACY.algorithm) return null;
  if (Date.now() >= LEGACY.acceptUntil) return null;
  return LEGACY;
}

export async function validateToken(token) {
  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new InvalidToken('format');
  }

  const entry = resolveEntry(header);
  if (!entry) throw new InvalidToken('unknown_key');

  try {
    const { payload } = await jwtVerify(token, entry.key, {
      algorithms: [entry.algorithm], // single element list
      clockTolerance: 30,
      ...entry.options,
    });

    return {
      subject: payload.sub,
      scheme: entry.scheme,
      expiresAt: payload.exp * 1000,
      // Legacy may have no jti: the token fingerprint stands in for it.
      fingerprint: payload.jti || tokenFingerprint(token),
    };
  } catch (error) {
    throw new InvalidToken(error.code || 'signature');
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Three details in this code make a difference in production. The first is that the legacy cutoff date lives in the validator itself, read from configuration: the old path closes on its own on the planned date, without depending on someone remembering to ship a removal deploy, and the date can be pushed back without changing code if the metrics show a residual population. The second is that the rejection reason becomes a metric label, because during the migration the most important question is how many 401s are expired tokens, which is normal, and how many are unknown key or invalid signature, which point to an instance without the new key or a client sending something unexpected. The third is clock tolerance: fifteen minute tokens make clock skew between servers relevant in a way thirty day tokens never did.',
        },
      ],
    },
    {
      title: 'The silent exchange and the race between open tabs',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Waiting for the legacy population to expire on its own works, but it wastes the chance to convert it. The silent exchange takes advantage of the next contact from an updated client: when it presents a valid legacy token to the refresh endpoint, the server returns a new pair, and the user never notices there was a migration. The delicate part is that the legacy token has to stop being exchangeable after the exchange, otherwise a stolen token keeps producing new pairs forever, and this is exactly where most implementations log legitimate users out.',
        },
        {
          type: 'paragraph',
          value:
            'The reason is concurrency from the client itself. A user with three open tabs, or an app that fires four parallel requests when it comes back from the background, presents the same legacy token several times within the same second. If the first request consumes the token and the other three get a reuse rejection, the client reads that rejection as an invalid session and sends the user to the login screen. The same problem exists with refresh token rotation in the new scheme, and the fix is the same in both cases: a grace window in which concurrent requests with the same token receive exactly the same pair, instead of one pair each or a rejection.',
        },
        {
          type: 'code',
          value: `// auth/legacy-exchange.js
// Converts a legacy token into a new pair, exactly once, tolerating
// concurrent requests from the same client within the grace window.
import { createClient } from 'redis';
import { InvalidToken, validateToken } from './dual-validator.js';
import { issuePair } from './issuer.js';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const GRACE_WINDOW_S = 120; // tabs and parallel requests from the same client
const RESERVATION_S = 10; // if the process dies midway, the reservation expires
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function exchangeLegacyToken(token, attempt = 0) {
  const session = await validateToken(token);
  if (session.scheme !== 'legacy') throw new InvalidToken('not_legacy');

  const key = \`exchange:\${session.fingerprint}\`;
  const pairKey = \`\${key}:pair\`;
  const remainingS = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));

  // 1) Whoever gets the reservation issues. NX guarantees a single issuer.
  const reserved = await redis.set(key, 'pending', { NX: true, EX: RESERVATION_S });

  if (reserved) {
    const pair = await issuePair({ subject: session.subject, origin: 'legacy_exchange' });
    // Pair and consumption mark written together: whoever sees 'exchanged' finds the pair.
    await redis
      .multi()
      .set(pairKey, JSON.stringify(pair), { EX: GRACE_WINDOW_S })
      .set(key, 'exchanged', { EX: remainingS })
      .exec();
    return pair;
  }

  // 2) Another request with the same token got there first. Wait for the result.
  for (let i = 0; i < 20; i += 1) {
    const state = await redis.get(key);

    if (state === 'exchanged') {
      const pair = await redis.get(pairKey);
      if (pair) return JSON.parse(pair); // within grace: the SAME pair
      // Outside grace, reusing the legacy token signals a copied token.
      throw new InvalidToken('legacy_already_exchanged');
    }

    if (state === null) {
      // The reservation expired without completing (process died): try to take over.
      if (attempt >= 2) break;
      return exchangeLegacyToken(token, attempt + 1);
    }

    await sleep(100);
  }

  throw new InvalidToken('exchange_in_progress'); // client should retry shortly
}`,
        },
        {
          type: 'paragraph',
          value:
            'The short ten second reservation and the long consumption mark are two locks with different goals. The reservation prevents two instances from issuing different pairs for the same token at the same time, and it expires quickly so that a failure in the middle of issuance does not lock that user out forever. The consumption mark lasts until the legacy token expires and is what stops a copied token from continuing to generate sessions. Writing the pair and the mark in the same transaction is what makes reads consistent: no concurrent request sees the exchanged state without being able to find the pair during the grace window.',
        },
        {
          type: 'paragraph',
          value:
            'The pair is kept for two minutes in the shared store, and that is a conscious security decision, not an oversight. The alternative would be to reject concurrent requests, which logs out a legitimate user, or to issue a pair for each of them, which multiplies sessions and makes reuse detection impossible. Two minutes of retention in a store that already holds sessions, with a short time to live and restricted access, is a small price. If reuse shows up after the window, the safest behavior is to also revoke the token family produced by the exchange, because there is no way to know which of the two copies is the legitimate one.',
        },
      ],
    },
    {
      title: 'The hidden client dependencies that break with the new token',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The implicit contract of a token is not just being accepted by the server. Clients and intermediaries build dependencies on format, size and content that nobody documented, and the migration is the moment all of them surface at once. A token signed with an elliptic curve and carrying more claims tends to be larger than the legacy one, and an opaque token in place of a JWT can no longer be decoded, and each of those changes breaks something that depended on the old shape.',
        },
        {
          type: 'table',
          columns: ['Hidden dependency', 'How it breaks', 'Symptom that reaches support', 'How to detect it earlier'],
          rows: [
            [
              'App decodes the token to read the expiry',
              'An opaque token does not decode, or a 15 minute expiry triggers a refresh loop',
              'App asks for login every time it opens, or drains battery and data',
              'Refresh rate per session and per app version',
            ],
            [
              'Browser limit of 4096 bytes per cookie',
              'A larger cookie is dropped silently, with no error',
              'Login succeeds and the user shows up logged out on the next page',
              'Measure the issued token size in the worst claims case',
            ],
            [
              'Header size limit in a proxy or load balancer',
              'Request refused with 431 or 400 before reaching the application',
              'Intermittent error only for users with many roles',
              'Test with the token of the user with the most permissions',
            ],
            [
              'Fixed length column in the partner\'s system',
              'Token truncated on write and rejected on use',
              'Integration fails days later, on the first refresh',
              'State the maximum size in the integration contract',
            ],
            [
              'Regular expression validating the token format',
              'Gateway or SDK refuses the token before sending it',
              'Client side error, with no record on the server',
              'Canary with old SDK versions in staging',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The first row has a consequence that changes the entire plan. An app that cannot handle the new format cannot receive the new format, which means legacy issuance has to keep existing on the old endpoint while that app version is still in use. Issuance becomes a decision based on client capability, signaled by a version header or by the endpoint being called, and the drain phase only starts when the old version falls below an acceptable threshold or when a mandatory update ships. That is why the legacy cutoff date is a product decision as well as a technical one.',
        },
        {
          type: 'paragraph',
          value:
            'Partner integrations deserve their own channel. For them, the token does not travel through a user session but through a service credential, and the silent exchange never happens because the partner never calls the refresh endpoint. The way forward is to treat the new scheme as a version of the integration contract, with an announced date, a coexistence period measured in months and a per partner metric showing who still uses the old format, so the conversation happens before the cutoff and not in the ticket opened after it.',
        },
      ],
    },
    {
      title: 'When it is safe to turn the legacy path off',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cutting the legacy path should be a decision made by numbers, not by calendar, and those numbers need to exist from phase 1 onward. The central metric is the active legacy population: how many distinct subjects presented a valid legacy token in the last twenty four hours, broken down by client version and by partner. That curve should fall predictably after legacy issuance stops, and its shape says a lot: a fast drop followed by a plateau indicates a group that does not convert on its own, such as an old app version or a forgotten integration, and that group needs direct action before the cutoff.',
        },
        {
          type: 'table',
          columns: ['Indicator', 'What it answers', 'Healthy value during the migration', 'Warning sign'],
          rows: [
            [
              '401 by rejection reason',
              'Whether rejection is normal expiry or a migration failure',
              'Expiry dominates; unknown key close to zero',
              'Any growth in unknown key or signature',
            ],
            [
              'Logins per minute',
              'Whether users are being logged out en masse',
              'Within the historical range for the same weekday',
              'Spike above twice the range, even a brief one',
            ],
            [
              'Active legacy population by version and partner',
              'How much is left to convert and who does not convert alone',
              'Continuous decline after legacy issuance stops',
              'A plateau that does not move for over a week',
            ],
            [
              'Exchange failures by reason',
              'Whether the silent exchange is working',
              'Reuse outside grace is rare and concentrated',
              'Exchange in progress or reuse spread across many users',
            ],
            [
              'Refreshes per session per hour',
              'Whether some client entered a refresh loop',
              'Close to four for a fifteen minute token',
              'Dozens per hour on a specific client version',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The logins per minute indicator is the one that detects the problem fastest, because it reacts in minutes while the legacy population reacts in days. An alert on it, compared with the same time the previous week, has to be active before any phase that changes issuance or validation, and the phase rollback criterion must be written down before the phase starts. An authentication migration that only discovers the mass logout through the volume of support tickets has already lost the first hour of the incident.',
        },
        {
          type: 'ordered',
          items: [
            'Confirm that legacy issuance has been off for at least the longest legacy lifetime issued, counted from the last actual recorded issuance and not from the deploy date.',
            'Confirm that the active legacy population is below the threshold agreed with product, with the named list of remaining partners already contacted.',
            'Bring the cutoff date forward in the staging validator and run the end to end test suite with the client versions still supported.',
            'Apply the cutoff in production through configuration, without a code deploy, keeping the option to push the date back for a few days if the login indicator reacts.',
            'Remove the legacy secret from configuration and revoke it at the source, because a secret nobody uses that is still valid is only attack surface.',
            'Remove the legacy path code in a separate deploy, after a full cycle with no legacy validation recorded.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does the migration change if the current system uses an opaque server side session rather than a JWT?',
      answer:
        'The phase structure is the same, but the risk moves elsewhere. With an opaque session, the identifier carries no information and every validation is a lookup in the session store, which makes the dual validator easy to dispatch: a prefix on the identifier, such as sess_ for the old format, decides whether validation queries the store or verifies a signature. The important difference is that opaque sessions get immediate revocation for free, because deleting the store entry ends the session on the next request, and a short lived signed token loses that property. If the product depends on ending a session right away, as in a password change, an employee offboarding or suspected fraud, the migration has to bring along a revocation list by token identifier, checked on every validation and kept only for the access token lifetime, which is cheap when that lifetime is fifteen minutes. Another point is that opaque sessions often store data alongside identity, such as a cart, preferences and navigation context, and the migration has to decide where that data goes, because putting it inside the token inflates its size and runs into the cookie limit described in the hidden dependencies table.',
    },
    {
      question: 'Is it not simpler to force everyone to log in again one night?',
      answer:
        'Sometimes it is, and it is worth doing the math before discarding the option. A small user base, an internal product or a system where login goes through a corporate identity provider with single sign on, where the user is reauthenticated without typing a password, tolerate a hard cutover well. The cost grows with three factors: the number of active users, the share of clients you cannot update, such as mobile apps and integrations, and the cost of each login, which includes a deliberately expensive password hash, SMS second factor billed per message and a password reset flow for those who do not remember theirs. If the decision is a cutover, it should not be simultaneous for the entire base. Spreading the cutover across cohorts, using a stable hash of the user identifier to decide who gets logged out in each hour, turns an impossible login spike into a high but sustainable load, and the authentication service should be scaled up beforehand, because the same slowness that protects against brute force is what takes the service down under legitimate mass login. Even then, partner integrations almost never accept a hard cutover, and for them coexistence remains mandatory.',
    },
    {
      question: 'After the migration, how do I rotate the signing key without repeating this whole process?',
      answer:
        'That is exactly what the key identifier in the header is for, and it is the biggest structural gain of the migration. With the validator picking the key by identifier, rotation becomes a reduced version of the same phases: the new public key is published on the keys endpoint and becomes accepted by every validator, after an interval longer than that endpoint\'s cache time issuance starts signing with the new key, and the old key remains published until the last token signed with it expires, which for a fifteen minute access token is a matter of hours rather than weeks. The refresh token needs separate attention, because it lives much longer: either it is opaque and stored on the server, which decouples it from the signing key, or the old key has to remain accepted for refresh for its whole lifetime. The operational care is the same as for the legacy cutoff, meaning you remove the old key only after the metric of validations with its identifier reaches zero, and never remove it from the keys endpoint before you stop signing with it.',
    },
  ],
  conclusion: {
    title: 'An authentication migration is measured in live tokens, not in deploys',
    description:
      'Swapping the token scheme in a single deploy logs everyone out because it ignores that the population of tokens already issued lives in devices, tabs and integrations outside your control. Expanding validation before changing issuance, binding each key to a single algorithm, converting the old token on next contact with a grace window for concurrent requests, mapping the hidden client dependencies and cutting the legacy path by metric rather than by calendar turn the swap into a process the user never notices. I can plan the migration phases from the real inventory of clients and integrations, implement the dual validator and the silent exchange, instrument the indicators that detect mass logout within minutes and lead the legacy cutoff with a rollback criterion defined before each step.',
    cta: 'Talk about my product\'s authentication migration',
  },
  related: [
    {
      label: 'Secret rotation without downtime: swapping the key in production',
      to: '/blog/rotacao-segredo-sem-indisponibilidade-trocar-chave-em-producao',
    },
    {
      label: 'Unversioned API contracts: evolving the payload without breaking old clients',
      to: '/blog/contrato-api-sem-versao-evoluir-payload-sem-quebrar-cliente-antigo',
    },
    {
      label: 'Backend Architecture and Modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'El despliegue salió a las diez de la mañana de un martes y reemplazaba el token de acceso firmado con secreto compartido, válido por treinta días, por un par moderno: token de acceso de quince minutos firmado con clave asimétrica y token de renovación rotativo. El validador nuevo solo entendía el formato nuevo. A las diez y cuarenta, un millón cuatrocientas mil sesiones se habían convertido en 401, la tasa de inicio de sesión estaba treinta veces por encima de lo normal, y el servicio de autenticación cayó bajo el costo de verificar contraseñas con una función de hash deliberadamente lenta para todo el mundo al mismo tiempo. El rollback no lo resolvió, porque los usuarios que ya habían recibido el token nuevo empezaron a ser rechazados por la versión antigua. Este artículo muestra por qué cambiar el esquema de token es una migración de estado repartido en dispositivos que no controlas y no un cambio de biblioteca, qué orden de despliegue permite volver atrás sin desconectar a nadie, cómo escribir un validador que acepte los dos formatos sin abrir la brecha clásica de confusión de algoritmo, cómo convertir el token antiguo en el siguiente contacto sin que dos pestañas abiertas se tiren la sesión entre sí, qué dependencias ocultas en el cliente se rompen con un token más grande o distinto, y qué números indican que es seguro apagar el camino heredado.',
  sections: [
    {
      title: 'Cambiar el esquema de token es migrar estado que vive en el cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando un equipo decide cambiar el esquema de autenticación, la conversación suele girar en torno a biblioteca, algoritmo y formato: sale el secreto compartido, entra la firma asimétrica, sale la validez larga, entra el par de acceso corto y renovación rotativa. Todo eso es código, y el código se cambia con un despliegue. Lo que no se cambia con un despliegue es la población de tokens ya emitidos, que está guardada en el almacenamiento local de navegadores, en el llavero de aplicaciones móviles, en variables de entorno de integraciones de socios y en columnas de base de datos de sistemas que nunca viste. Cada uno de esos tokens es una promesa firmada que sigue siendo válida hasta expirar, y el servidor que deja de reconocerla está rompiendo la promesa de golpe para todos.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica es que la duración mínima de la migración no la decide el equipo, sino la mayor validez de token que alguna vez se emitió. Si el token heredado vive treinta días, hay tokens heredados legítimos circulando durante treinta días después de la última emisión, y cualquier plan que apague el formato antiguo antes de eso está eligiendo desconectar a gente. Existe además una población que no sigue la validez: el token de renovación de la aplicación móvil que el usuario abre una vez al mes, y la credencial de integración pegada en un archivo de configuración que nadie volvió a tocar.',
        },
        {
          type: 'table',
          columns: ['Dónde vive el token', 'Quién controla la actualización', 'Validez típica', 'Qué define la duración de la migración'],
          rows: [
            [
              'Almacenamiento local del navegador',
              'Tú, en la siguiente carga de la página',
              'Horas a días',
              'La última pestaña abierta hace días que nunca recargó',
            ],
            [
              'Cookie de sesión HttpOnly',
              'Tú, en cualquier respuesta',
              'Días a semanas',
              'La validez de la cookie, y su límite de tamaño',
            ],
            [
              'Llavero de aplicación móvil',
              'El usuario, cuando actualiza la app',
              'Semanas a meses en el token de renovación',
              'La versión más antigua de la app que todavía abre',
            ],
            [
              'Configuración de integración de un socio',
              'El socio, a su propio ritmo',
              'Meses o sin caducidad',
              'La siguiente ventana de cambios del socio',
            ],
            [
              'Cola, job programado o mensaje almacenado',
              'Nadie, hasta que el mensaje se procesa',
              'La retención de la cola',
              'El mensaje más antiguo aún no consumido',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El incidente del inicio tiene un segundo componente que suele subestimarse: el costo del inicio de sesión masivo. Verificar una contraseña con bcrypt, scrypt o Argon2 es caro a propósito, del orden de decenas a cientos de milisegundos de CPU por intento, porque eso encarece los ataques de fuerza bruta. Un servicio dimensionado para algunos cientos de inicios de sesión por minuto no sostiene decenas de miles, y la misma propiedad que protege contra ataques convierte la desconexión masiva en indisponibilidad. A eso se suman el pico de restablecimiento de contraseña de los usuarios que no recuerdan la suya y el costo del segundo factor por SMS, que aparece en la factura del mes siguiente.',
        },
      ],
    },
    {
      title: 'Expandir antes de contraer: el orden de despliegue que permite volver atrás',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La regla que evita el rollback imposible es la misma de cualquier migración de esquema con tráfico en vivo: primero todos los lectores aprenden el formato nuevo, y solo después algún escritor empieza a producirlo. En el caso del token, lector es todo servicio que valida, y escritor es el servicio que emite. Si la emisión del formato nuevo empieza mientras existe una sola instancia, o una sola versión objetivo de rollback, que no sabe validarlo, el usuario que recibió el token nuevo queda desconectado en cuanto cae en esa instancia o en cuanto ocurre el rollback.',
        },
        {
          type: 'diagram',
          value: `FASE 0  estado actual
        valida: heredado             emite: heredado

FASE 1  expandir (despliegue de lectura, sin cambio visible)
        valida: heredado + nuevo     emite: heredado
        requisito de la fase 2: TODAS las instancias y la version
        objetivo de rollback aceptan los dos formatos

FASE 2  migrar
        valida: heredado + nuevo     emite: nuevo    (clientes que lo entienden)
                                     emite: heredado (endpoint antiguo, apps antiguas)
        el canje silencioso convierte cada token heredado en el siguiente contacto
        rollback seguro: volver a la FASE 1 no desconecta a nadie

FASE 3  drenar
        emision heredada apagada; la poblacion heredada solo decae
        espera minima = mayor validez heredada emitida + margen

FASE 4  contraer
        valida: nuevo                emite: nuevo
        secreto heredado eliminado de la configuracion y revocado`,
        },
        {
          type: 'paragraph',
          value:
            'La fase 1 es la que más gente se salta, porque no entrega nada visible. Existe para que el rollback de la fase 2 sea trivial: volver a una versión que acepta los dos formatos no afecta a nadie, mientras que volver a la fase 0 desconecta a todos los que ya fueron convertidos. En la práctica, la fase 1 tiene que permanecer en producción el tiempo suficiente para que ninguna versión anterior a ella siga siendo candidata a rollback, lo que significa al menos un ciclo completo de despliegue y la eliminación de los artefactos antiguos del registro de despliegues.',
        },
        {
          type: 'ordered',
          items: [
            'Publicar la clave pública nueva en el endpoint de claves antes de firmar nada con ella, porque los servicios que cachean ese endpoint pueden tardar minutos u horas en verla.',
            'Desplegar el validador doble en todos los servicios que validan tokens, incluidos gateways, workers de cola y servicios internos que alguien olvidó que también validan.',
            'Confirmar por métrica, y no por inventario, que todas las instancias en ejecución reportan soporte al formato nuevo antes de encender la emisión.',
            'Encender la emisión nueva por cohortes, empezando por una fracción pequeña de usuarios, y observar la tasa de 401 por motivo y la tasa de inicio de sesión durante al menos un día completo.',
            'Mantener la emisión heredada disponible en el endpoint antiguo mientras exista una versión de cliente que solo entienda el formato antiguo, y medir esa población por versión.',
          ],
        },
      ],
    },
    {
      title: 'El validador doble y la trampa del algoritmo elegido por el token',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El validador que acepta dos formatos tiene una tentación peligrosa: mirar el campo de algoritmo en la cabecera del token y usar lo que dice. Ese es el camino hacia la confusión de algoritmo, una vulnerabilidad conocida en la que el atacante toma la clave pública del esquema nuevo, pública por definición, y la usa como secreto para firmar un token con el algoritmo simétrico del esquema heredado. Un validador que confía en la cabecera intentará verificar ese token usando la clave pública como si fuera un secreto compartido, y la firma coincide. Durante la convivencia de los dos esquemas, la ventana para ese error está abierta precisamente porque los dos algoritmos se aceptan a la vez.',
        },
        {
          type: 'paragraph',
          value:
            'La defensa es invertir la fuente de verdad. El servidor mantiene un mapa de claves conocidas, cada una atada a un único algoritmo, y usa la cabecera del token solo para elegir qué entrada del mapa consultar. El algoritmo que se pasa a la verificación sale del mapa, en una lista de un solo elemento, y el del token solo se contrasta con él. Así la clave pública nunca se usa como secreto simétrico, porque no existe ninguna entrada del mapa que la asocie a un algoritmo simétrico.',
        },
        {
          type: 'code',
          value: `// auth/validador-doble.js
// Acepta el formato heredado (HS256, sin kid) y el nuevo (ES256, con kid)
// durante la convivencia. El algoritmo viene del servidor, nunca del token.
import { createHash } from 'node:crypto';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';

const EMISOR = 'https://auth.ejemplo.com';
const AUDIENCIA = 'api';

// Claves del esquema nuevo, indexadas por kid. Cada kid tiene UN algoritmo.
const CLAVES_NUEVAS = new Map([
  [
    '2026-09-es256',
    {
      esquema: 'nuevo',
      algoritmo: 'ES256',
      clave: await importSPKI(process.env.AUTH_CLAVE_PUBLICA_2026_09, 'ES256'),
      opciones: { issuer: EMISOR, audience: AUDIENCIA },
    },
  ],
]);

// El heredado no tenia kid, issuer ni audience. Solo se acepta con el
// algoritmo que realmente usaba y hasta la fecha de corte planificada:
// ultima emision heredada + 30 dias de validez + margen.
const HEREDADO = {
  esquema: 'heredado',
  algoritmo: 'HS256',
  clave: new TextEncoder().encode(process.env.AUTH_SECRETO_HEREDADO),
  opciones: {},
  aceptarHasta: Date.parse(process.env.AUTH_HEREDADO_ACEPTAR_HASTA || '2026-11-15T00:00:00Z'),
};

export class TokenInvalido extends Error {
  constructor(motivo) {
    super(motivo);
    this.motivo = motivo; // se convierte en etiqueta de metrica: 401 por motivo
  }
}

export const huellaDelToken = (token) =>
  createHash('sha256').update(token).digest('hex');

function resolverEntrada(cabecera) {
  if (cabecera.kid) return CLAVES_NUEVAS.get(cabecera.kid) || null;
  if (cabecera.alg !== HEREDADO.algoritmo) return null;
  if (Date.now() >= HEREDADO.aceptarHasta) return null;
  return HEREDADO;
}

export async function validarToken(token) {
  let cabecera;
  try {
    cabecera = decodeProtectedHeader(token);
  } catch {
    throw new TokenInvalido('formato');
  }

  const entrada = resolverEntrada(cabecera);
  if (!entrada) throw new TokenInvalido('clave_desconocida');

  try {
    const { payload } = await jwtVerify(token, entrada.clave, {
      algorithms: [entrada.algoritmo], // lista de un solo elemento
      clockTolerance: 30,
      ...entrada.opciones,
    });

    return {
      sujeto: payload.sub,
      esquema: entrada.esquema,
      expiraEn: payload.exp * 1000,
      // El heredado puede no tener jti: la huella del propio token lo sustituye.
      huella: payload.jti || huellaDelToken(token),
    };
  } catch (error) {
    throw new TokenInvalido(error.code || 'firma');
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Tres detalles de este código marcan la diferencia en producción. El primero es que la fecha de corte del heredado está en el propio validador, leída de configuración: el camino antiguo se cierra solo en la fecha planificada, sin depender de que alguien recuerde hacer un despliegue de eliminación, y la fecha puede posponerse sin cambiar código si la métrica muestra población residual. El segundo es que el motivo del rechazo se convierte en etiqueta de métrica, porque durante la migración la pregunta más importante es cuántos 401 son de token expirado, que es normal, y cuántos son de clave desconocida o firma inválida, que indican una instancia sin la clave nueva o un cliente enviando algo inesperado. El tercero es la tolerancia de reloj: los tokens de quince minutos hacen relevante la diferencia de reloj entre servidores de una forma que los tokens de treinta días nunca hicieron.',
        },
      ],
    },
    {
      title: 'El canje silencioso y la carrera entre pestañas abiertas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Esperar a que la población heredada expire sola funciona, pero desperdicia la oportunidad de convertirla. El canje silencioso aprovecha el siguiente contacto del cliente actualizado: cuando presenta un token heredado válido al endpoint de renovación, el servidor devuelve un par nuevo, y el usuario nunca se entera de que hubo migración. El punto delicado es que el token heredado tiene que dejar de ser canjeable después del canje, porque si no un token robado sigue generando pares nuevos indefinidamente, y es justo aquí donde la mayoría de las implementaciones desconecta a usuarios legítimos.',
        },
        {
          type: 'paragraph',
          value:
            'El motivo es la concurrencia del propio cliente. Un usuario con tres pestañas abiertas, o una aplicación que dispara cuatro peticiones en paralelo al volver del segundo plano, presenta el mismo token heredado varias veces en el mismo segundo. Si la primera petición consume el token y las otras tres reciben un rechazo por reutilización, el cliente interpreta ese rechazo como sesión inválida y manda al usuario a la pantalla de inicio de sesión. El mismo problema existe en la rotación del token de renovación del esquema nuevo, y la solución es la misma en los dos casos: una ventana de gracia en la que las peticiones concurrentes con el mismo token reciben exactamente el mismo par, en lugar de un par cada una o de un rechazo.',
        },
        {
          type: 'code',
          value: `// auth/canje-heredado.js
// Convierte un token heredado en un par nuevo, una sola vez, tolerando
// peticiones concurrentes del mismo cliente dentro de la ventana de gracia.
import { createClient } from 'redis';
import { TokenInvalido, validarToken } from './validador-doble.js';
import { emitirPar } from './emisor.js';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const VENTANA_DE_GRACIA_S = 120; // pestanas y peticiones paralelas del mismo cliente
const RESERVA_S = 10; // si el proceso muere a mitad, la reserva expira sola
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export async function canjearTokenHeredado(token, intento = 0) {
  const sesion = await validarToken(token);
  if (sesion.esquema !== 'heredado') throw new TokenInvalido('no_es_heredado');

  const clave = \`canje:\${sesion.huella}\`;
  const clavePar = \`\${clave}:par\`;
  const restanteS = Math.max(1, Math.ceil((sesion.expiraEn - Date.now()) / 1000));

  // 1) Quien consigue la reserva emite. NX garantiza un unico emisor.
  const reservado = await redis.set(clave, 'pendiente', { NX: true, EX: RESERVA_S });

  if (reservado) {
    const par = await emitirPar({ sujeto: sesion.sujeto, origen: 'canje_heredado' });
    // Par y marca de consumo escritos juntos: quien vea 'canjeado' encuentra el par.
    await redis
      .multi()
      .set(clavePar, JSON.stringify(par), { EX: VENTANA_DE_GRACIA_S })
      .set(clave, 'canjeado', { EX: restanteS })
      .exec();
    return par;
  }

  // 2) Otra peticion con el mismo token llego antes. Espera el resultado.
  for (let i = 0; i < 20; i += 1) {
    const estado = await redis.get(clave);

    if (estado === 'canjeado') {
      const par = await redis.get(clavePar);
      if (par) return JSON.parse(par); // dentro de la gracia: el MISMO par
      // Fuera de la gracia, reutilizar el token heredado indica una copia.
      throw new TokenInvalido('heredado_ya_canjeado');
    }

    if (estado === null) {
      // La reserva expiro sin concluir (el proceso murio): intenta asumirla.
      if (intento >= 2) break;
      return canjearTokenHeredado(token, intento + 1);
    }

    await esperar(100);
  }

  throw new TokenInvalido('canje_en_curso'); // el cliente debe repetir en breve
}`,
        },
        {
          type: 'paragraph',
          value:
            'La reserva corta de diez segundos y la marca de consumo larga son dos bloqueos con objetivos distintos. La reserva evita que dos instancias emitan pares diferentes para el mismo token al mismo tiempo, y expira rápido para que un fallo a mitad de la emisión no bloquee a ese usuario para siempre. La marca de consumo dura hasta que el token heredado expira y es lo que impide que un token copiado siga generando sesiones. Escribir el par y la marca en la misma transacción es lo que vuelve consistente la lectura: ninguna petición concurrente ve el estado canjeado sin poder encontrar el par durante la ventana de gracia.',
        },
        {
          type: 'paragraph',
          value:
            'El par queda guardado dos minutos en el almacenamiento compartido, y eso es una decisión de seguridad consciente, no un descuido. La alternativa sería rechazar las peticiones concurrentes, lo que desconecta a un usuario legítimo, o emitir un par para cada una, lo que multiplica sesiones y hace imposible detectar la reutilización. Dos minutos de retención en un almacenamiento que ya guarda sesiones, con tiempo de vida corto y acceso restringido, es un costo pequeño. Si la reutilización aparece después de la ventana, el comportamiento más seguro es revocar también la familia de tokens generada por el canje, porque no hay forma de saber cuál de las dos copias es la legítima.',
        },
      ],
    },
    {
      title: 'Las dependencias ocultas en el cliente que se rompen con el token nuevo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El contrato implícito de un token no es solo ser aceptado por el servidor. Clientes e intermediarios crean dependencias de formato, tamaño y contenido que nadie documentó, y la migración es el momento en que todas aparecen a la vez. Un token firmado con curva elíptica y con más claims suele ser más grande que el heredado, y un token opaco en lugar de un JWT deja de poder decodificarse, y cada uno de esos cambios rompe algo que dependía de la forma antigua.',
        },
        {
          type: 'table',
          columns: ['Dependencia oculta', 'Cómo se rompe', 'Síntoma que llega a soporte', 'Cómo detectarla antes'],
          rows: [
            [
              'La app decodifica el token para leer la expiración',
              'Un token opaco no se decodifica, o una expiración de 15 minutos dispara renovación en bucle',
              'La app pide inicio de sesión cada vez que abre, o consume batería y datos',
              'Tasa de renovación por sesión y por versión de la app',
            ],
            [
              'Límite de 4096 bytes por cookie en el navegador',
              'Una cookie más grande se descarta en silencio, sin error',
              'El inicio de sesión termina y el usuario aparece desconectado en la página siguiente',
              'Medir el tamaño del token emitido en el peor caso de claims',
            ],
            [
              'Límite de tamaño de cabeceras en proxy o balanceador',
              'Petición rechazada con 431 o 400 antes de llegar a la aplicación',
              'Error intermitente solo para usuarios con muchos roles',
              'Probar con el token del usuario con más permisos',
            ],
            [
              'Columna de tamaño fijo en el sistema del socio',
              'Token truncado al guardarse y rechazado al usarse',
              'La integración falla días después, en la primera renovación',
              'Comunicar el tamaño máximo en el contrato de integración',
            ],
            [
              'Expresión regular que valida el formato del token',
              'El gateway o el SDK rechaza el token antes de enviarlo',
              'Error en el cliente, sin ningún registro en el servidor',
              'Canario con versiones antiguas del SDK en preproducción',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La primera fila tiene una consecuencia que cambia el plan entero. Una aplicación que no sabe manejar el formato nuevo no puede recibir el formato nuevo, y eso significa que la emisión heredada tiene que seguir existiendo en el endpoint antiguo mientras esa versión de la aplicación siga en uso. La emisión pasa a decidirse por la capacidad del cliente, informada por una cabecera de versión o por el propio endpoint llamado, y la fase de drenaje solo empieza cuando la versión antigua cae por debajo de un umbral aceptable o cuando se publica una actualización obligatoria. Por eso la fecha de corte del heredado es una decisión de producto además de técnica.',
        },
        {
          type: 'paragraph',
          value:
            'Las integraciones de socios merecen un canal propio. Para ellas, el token no circula por sesión de usuario sino por credencial de servicio, y el canje silencioso no ocurre porque el socio nunca llama al endpoint de renovación. El camino es tratar el nuevo esquema como una versión del contrato de integración, con fecha anunciada, un periodo de convivencia medido en meses y una métrica por socio que muestre quién sigue usando el formato antiguo, para que la conversación ocurra antes del corte y no en el ticket abierto después de él.',
        },
      ],
    },
    {
      title: 'Cuándo es seguro apagar el camino heredado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El corte del heredado debe ser una decisión tomada por números y no por calendario, y esos números tienen que existir desde la fase 1. La métrica central es la población heredada activa: cuántos sujetos distintos presentaron un token heredado válido en las últimas veinticuatro horas, desglosado por versión de cliente y por socio. Esa curva debe caer de forma predecible después de que se detiene la emisión heredada, y su forma dice mucho: una caída rápida seguida de una meseta indica un grupo que no se convierte solo, como una versión antigua de la aplicación o una integración olvidada, y ese grupo necesita acción directa antes del corte.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'Qué responde', 'Valor sano durante la migración', 'Señal de alerta'],
          rows: [
            [
              '401 por motivo de rechazo',
              'Si el rechazo es expiración normal o un fallo de la migración',
              'Domina la expiración; clave desconocida cerca de cero',
              'Cualquier crecimiento de clave desconocida o firma',
            ],
            [
              'Inicios de sesión por minuto',
              'Si se está desconectando a usuarios en masa',
              'Dentro del rango histórico del mismo día de la semana',
              'Pico por encima del doble del rango, aunque sea breve',
            ],
            [
              'Población heredada activa por versión y socio',
              'Cuánto falta convertir y quién no se convierte solo',
              'Caída continua después de detener la emisión heredada',
              'Una meseta que no cambia durante más de una semana',
            ],
            [
              'Fallos de canje por motivo',
              'Si el canje silencioso está funcionando',
              'Reutilización fuera de la gracia rara y concentrada',
              'Canje en curso o reutilización repartida entre muchos usuarios',
            ],
            [
              'Renovaciones por sesión por hora',
              'Si algún cliente entró en un bucle de renovación',
              'Cerca de cuatro para un token de quince minutos',
              'Decenas por hora en una versión concreta de cliente',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El indicador de inicios de sesión por minuto es el que detecta el problema más rápido, porque reacciona en minutos mientras la población heredada reacciona en días. Una alerta sobre él, comparada con la misma hora de la semana anterior, tiene que estar activa antes de cualquier fase que cambie la emisión o la validación, y el criterio de reversión de la fase tiene que estar escrito antes de que empiece. Una migración de autenticación que solo descubre la desconexión masiva por el volumen de tickets de soporte ya perdió la primera hora del incidente.',
        },
        {
          type: 'ordered',
          items: [
            'Confirmar que la emisión heredada está apagada desde hace al menos la mayor validez heredada emitida, contada desde la última emisión real registrada y no desde la fecha del despliegue.',
            'Confirmar que la población heredada activa está por debajo del umbral acordado con producto, con la lista nominal de socios restantes ya contactados.',
            'Adelantar la fecha de corte en el validador de preproducción y ejecutar la batería de pruebas de extremo a extremo con las versiones de cliente todavía soportadas.',
            'Aplicar el corte en producción por configuración, sin despliegue de código, manteniendo durante algunos días la posibilidad de posponer la fecha si el indicador de inicios de sesión reacciona.',
            'Eliminar el secreto heredado de la configuración y revocarlo en el origen, porque un secreto que nadie usa y que sigue siendo válido es solo superficie de ataque.',
            'Eliminar el código del camino heredado en un despliegue separado, después de un ciclo completo sin ninguna validación heredada registrada.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿La migración cambia si el sistema actual usa una sesión opaca guardada en el servidor y no JWT?',
      answer:
        'La estructura de fases es la misma, pero el riesgo cambia de lugar. Con sesión opaca, el identificador no lleva información y toda validación es una consulta al almacenamiento de sesiones, lo que hace que el validador doble sea sencillo de despachar: un prefijo en el identificador, como sess_ para el formato antiguo, decide si la validación consulta el almacenamiento o verifica una firma. La diferencia importante es que la sesión opaca tiene revocación inmediata gratis, porque borrar la entrada del almacenamiento termina la sesión en la siguiente petición, y el token firmado de corta duración pierde esa propiedad. Si el producto depende de cerrar la sesión en el acto, como en un cambio de contraseña, la baja de un empleado o una sospecha de fraude, la migración tiene que traer consigo una lista de revocación por identificador de token, consultada en cada validación y mantenida solo durante el tiempo de vida del token de acceso, lo que es barato cuando ese tiempo es de quince minutos. Otro punto es que la sesión opaca suele guardar datos junto con la identidad, como carrito, preferencias y contexto de navegación, y la migración tiene que decidir adónde van esos datos, porque meterlos dentro del token infla su tamaño y choca con el límite de cookie descrito en la tabla de dependencias ocultas.',
    },
    {
      question: '¿No es más sencillo obligar a todo el mundo a iniciar sesión de nuevo una madrugada?',
      answer:
        'A veces lo es, y vale la pena hacer la cuenta antes de descartar la opción. Una base pequeña, un producto interno o un sistema en el que el inicio de sesión pasa por un proveedor de identidad corporativo con inicio de sesión único, donde el usuario se reautentica sin escribir contraseña, toleran bien un corte seco. El costo crece con tres factores: el número de usuarios activos, la proporción de clientes que no puedes actualizar, como aplicaciones móviles e integraciones, y el costo de cada inicio de sesión, que incluye un hash de contraseña deliberadamente caro, un segundo factor por SMS cobrado por mensaje y un flujo de restablecimiento de contraseña para quien no recuerda la suya. Si la decisión es el corte, no debe ser simultáneo para toda la base. Repartir el corte por cohortes, usando un hash estable del identificador del usuario para decidir a quién se desconecta en cada hora, convierte un pico de inicios de sesión imposible de absorber en una carga alta pero sostenible, y el servicio de autenticación debe escalarse antes, porque la misma lentitud que protege contra la fuerza bruta es la que tumba el servicio bajo un inicio de sesión legítimo masivo. Aun así, las integraciones de socios casi nunca aceptan un corte seco, y para ellas la convivencia sigue siendo obligatoria.',
    },
    {
      question: 'Después de la migración, ¿cómo rotar la clave de firma sin repetir todo este proceso?',
      answer:
        'Justamente para eso existe el identificador de clave en la cabecera, y es la mayor ganancia estructural de la migración. Con el validador eligiendo la clave por el identificador, la rotación se convierte en una versión reducida de las mismas fases: la clave pública nueva se publica en el endpoint de claves y pasa a ser aceptada por todos los validadores, después de un intervalo mayor que el tiempo de caché de ese endpoint la emisión empieza a firmar con la clave nueva, y la clave antigua sigue publicada hasta que expire el último token firmado con ella, lo que para un token de acceso de quince minutos es cuestión de horas y no de semanas. El token de renovación necesita atención aparte, porque vive mucho más: o es opaco y se guarda en el servidor, lo que lo desacopla de la clave de firma, o la clave antigua tiene que seguir aceptándose para renovación durante todo su tiempo de vida. El cuidado operativo es el mismo que en el corte del heredado, es decir, eliminar la clave antigua solo después de que la métrica de validaciones con su identificador llegue a cero, y nunca quitarla del endpoint de claves antes de dejar de firmar con ella.',
    },
  ],
  conclusion: {
    title: 'La migración de autenticación se mide en tokens vivos, no en despliegues',
    description:
      'Cambiar el esquema de token con un solo despliegue desconecta a todo el mundo porque ignora que la población de tokens ya emitidos vive en dispositivos, pestañas e integraciones fuera de tu control. Expandir la validación antes de cambiar la emisión, atar cada clave a un único algoritmo, convertir el token antiguo en el siguiente contacto con una ventana de gracia para peticiones concurrentes, mapear las dependencias ocultas en el cliente y cortar el heredado por métrica y no por calendario convierten el cambio en un proceso que el usuario nunca nota. Puedo planificar las fases de la migración a partir del inventario real de clientes e integraciones, implementar el validador doble y el canje silencioso, instrumentar los indicadores que detectan una desconexión masiva en minutos y conducir el corte del heredado con un criterio de reversión definido antes de cada etapa.',
    cta: 'Hablar sobre la migración de autenticación de mi producto',
  },
  related: [
    {
      label: 'Rotación de secretos sin indisponibilidad: cambiar la clave en producción',
      to: '/blog/rotacao-segredo-sem-indisponibilidade-trocar-chave-em-producao',
    },
    {
      label: 'Contrato de API sin versión: evolucionar el payload sin romper al cliente antiguo',
      to: '/blog/contrato-api-sem-versao-evoluir-payload-sem-quebrar-cliente-antigo',
    },
    {
      label: 'Arquitectura y Modernización de Backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
