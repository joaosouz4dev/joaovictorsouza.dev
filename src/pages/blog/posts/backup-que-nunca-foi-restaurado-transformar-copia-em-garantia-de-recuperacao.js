// Conteudo do artigo: backup que nunca foi restaurado e como transformar copia
// em garantia de recuperacao.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O painel de backup mostrava setecentos e vinte execuções consecutivas com sucesso quando o disco do banco principal falhou numa terça-feira à tarde. A restauração começou às quinze e dez com a expectativa de quarenta minutos, e terminou às três e vinte da manhã seguinte, com quatro horas de pedidos perdidos, porque o dump mais recente não continha o schema das três tabelas criadas no mês anterior, a chave de criptografia do arquivo estava guardada no gerenciador de segredos que dependia do mesmo banco, e ninguém no plantão tinha permissão de escrita no bucket de destino. Este artigo mostra por que um backup que nunca foi restaurado é uma hipótese e não uma garantia, por que a taxa de sucesso do job mede a coisa errada, quais são as quatro propriedades que separam cópia de recuperação e em que ordem elas falham, como o objetivo de tempo e o de ponto de recuperação deixam de ser números de slide e viram restrições de arquitetura, como montar o ensaio de restauração que roda sozinho toda semana, e qual é a dependência circular que transforma um incidente recuperável numa parada de doze horas.',
  sections: [
    {
      title: 'Backup é uma hipótese até que alguém restaure',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O que o job de backup prova quando termina com sucesso é bem menos do que o time costuma assumir. Ele prova que um processo leu dados de uma origem e escreveu bytes num destino sem retornar código de erro. Não prova que os bytes escritos são legíveis, que representam um estado consistente do sistema, que o conteúdo cobre tudo o que precisa ser restaurado, que existe alguém com permissão para lê-los de volta, nem que o tempo de leitura cabe no prazo que o negócio aceita. Cada uma dessas cinco afirmações é independente das outras, e o job de backup verifica exatamente zero delas.',
        },
        {
          type: 'paragraph',
          value:
            'A diferença entre a cópia e a garantia é a mesma que existe entre um teste que compila e um teste que passa. A métrica que quase todo painel exibe é a taxa de sucesso do job, e ela é enganosa justamente porque fica em cem por cento durante todo o período em que o backup está silenciosamente inútil. Um dump que perdeu uma tabela porque o usuário de leitura não recebeu permissão na tabela nova termina com sucesso. Um arquivo truncado por disco cheio no destino termina com sucesso se a escrita retorna antes do flush. Um backup criptografado com uma chave que já foi rotacionada termina com sucesso todos os dias, e continua terminando com sucesso até o dia em que alguém precisa abri-lo.',
        },
        {
          type: 'paragraph',
          value:
            'A reformulação que resolve isso é tratar a restauração como o teste e o backup como o código. Ninguém aceitaria um sistema em que a suíte de testes nunca roda e a equipe afirma que o código funciona porque compilou setecentas e vinte vezes seguidas. O backup está exatamente nessa posição na maioria das organizações, e o motivo é que restaurar parece caro enquanto nada quebrou. O custo real é assimétrico da mesma forma que no caso dos testes: o ensaio semanal custa algumas horas de máquina, e a descoberta de que o backup não presta durante um incidente custa o tempo de indisponibilidade multiplicado por todo o negócio que depende do sistema.',
        },
        {
          type: 'diagram',
          value: `O QUE CADA COISA REALMENTE PROVA

  job de backup verde      -> "um processo escreveu bytes em algum lugar"
                              nao prova legibilidade
                              nao prova completude
                              nao prova acesso
                              nao prova prazo

  checksum do arquivo      -> "os bytes nao corromperam depois da escrita"
                              nao prova que o conteudo esta certo

  restauracao em ambiente  -> "estes bytes viram um banco que sobe"
  descartavel                 nao prova que a aplicacao funciona

  restauracao + consulta   -> "este banco responde o que a aplicacao pergunta"
  de verificacao              ESTA e a garantia

  ^ so a ultima linha e uma garantia. as tres primeiras sao indicios.`,
        },
      ],
    },
    {
      title: 'As quatro propriedades e a ordem em que elas falham',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma recuperação depende de quatro propriedades independentes, e vale enumerá-las separadamente porque cada uma falha por um motivo próprio, é detectada por um teste próprio e é responsabilidade de uma pessoa diferente na prática. Legibilidade é a capacidade de ler os bytes de volta e obter o que foi escrito. Completude é a cobertura: se tudo o que precisa existir depois da restauração está dentro do conjunto de cópias. Consistência é a propriedade de que os dados representam um instante válido do sistema, e não um retrato borrado de várias tabelas capturadas em momentos diferentes. Acessibilidade é a capacidade de a pessoa certa chegar aos bytes no momento do incidente, com credencial, permissão e rede.',
        },
        {
          type: 'table',
          columns: ['Propriedade', 'Falha típica', 'Como é detectada', 'Quando costuma ser descoberta'],
          rows: [
            [
              'Legibilidade',
              'Arquivo truncado, compressão corrompida, chave de criptografia rotacionada',
              'Restauração completa em ambiente descartável',
              'Durante o incidente, ao abrir o arquivo',
            ],
            [
              'Completude',
              'Tabela nova sem permissão de leitura, banco novo fora da lista, bucket de anexos não copiado',
              'Comparar inventário de objetos da origem com o do restaurado',
              'Depois da restauração, quando a aplicação acusa erro',
            ],
            [
              'Consistência',
              'Dump sem transação única, réplica capturada no meio de uma escrita distribuída',
              'Consulta de integridade referencial no ambiente restaurado',
              'Dias depois, como dado órfão em relatório',
            ],
            [
              'Acessibilidade',
              'Credencial no cofre que depende do sistema caído, permissão só do time que está de férias',
              'Ensaio conduzido por alguém do plantão, sem ajuda',
              'Durante o incidente, no pior momento possível',
            ],
            [
              'Prazo',
              'Restaurar dois terabytes por um link que entrega cem megabits',
              'Cronometrar o ensaio de ponta a ponta',
              'Durante o incidente, quando o relógio já corre',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A coluna mais útil dessa tabela é a última, e ela explica por que a discussão sobre backup tende a ser improdutiva. Quatro das cinco linhas só são descobertas durante o incidente, que é o único momento em que não existe tempo para resolvê-las. O ensaio de restauração não é uma prática de maturidade opcional: é o único mecanismo que move essas descobertas de dentro do incidente para fora dele. Vale notar também que a ordem de falha na prática é quase sempre a inversa da ordem de atenção que os times dão. Quase todo mundo se preocupa com legibilidade, que é a que menos falha, e quase ninguém testa acessibilidade, que é a que mais transforma um incidente de quarenta minutos numa parada de meio dia.',
        },
        {
          type: 'paragraph',
          value:
            'A consistência merece um parágrafo próprio porque é a mais mal compreendida das quatro. Um backup lógico que roda tabela por tabela sem uma transação única captura cada tabela num instante diferente, e o resultado é um estado que nunca existiu: um pedido que referencia um item de pagamento que ainda não havia sido criado quando aquela tabela foi lida. Em Postgres, a opção de dump em transação única resolve isso dentro de um banco, mas não entre bancos: se o sistema guarda pedidos num banco e pagamentos em outro, nenhuma ferramenta de dump garante um instante comum entre os dois, e a consistência passa a depender de um ponto de recuperação coordenado por tempo, com a tolerância explicitamente aceita pelo negócio.',
        },
      ],
    },
    {
      title: 'Os dois números que viram restrição de arquitetura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Os dois objetivos que organizam qualquer plano de recuperação são o tempo máximo aceitável até o sistema voltar, e a quantidade máxima aceitável de dados perdidos medida em tempo. O primeiro responde quanto tempo o negócio sobrevive parado, o segundo responde quanto trabalho pode desaparecer. São números de negócio, não de infraestrutura, e o erro mais comum é deixá-los na apresentação sem verificar se a arquitetura atual consegue entregá-los. Um objetivo de quinze minutos de perda máxima com um backup diário é uma contradição declarada: a arquitetura já garante, por construção, até vinte e quatro horas de perda.',
        },
        {
          type: 'paragraph',
          value:
            'O que torna esses números concretos é derivar deles a restrição técnica correspondente, e é aí que a conversa deixa de ser retórica. A quantidade aceitável de perda define a frequência mínima da cópia e, quando é menor que algumas horas, obriga o envio contínuo do log de transações em vez de dumps periódicos. O tempo aceitável até a volta define a forma da restauração, não o tamanho do backup: restaurar dois terabytes de dump lógico não cabe em quatro horas por mais banda que exista, porque o gargalo é a reconstrução de índices, enquanto uma réplica já promovida cabe em minutos porque não há nada a reconstruir.',
        },
        {
          type: 'table',
          columns: ['Perda aceitável', 'Retorno aceitável', 'Arquitetura que entrega', 'Custo relativo'],
          rows: [
            [
              '24 horas',
              '8 horas',
              'Dump diário em armazenamento de objetos, restauração manual',
              'Baixo',
            ],
            [
              '1 hora',
              '4 horas',
              'Snapshot diário mais envio contínuo de log de transações',
              'Médio',
            ],
            [
              '5 minutos',
              '1 hora',
              'Snapshot mais log contínuo com réplica quente já restaurada',
              'Alto',
            ],
            [
              'Perto de zero',
              'Minutos',
              'Réplica sincronizada com promoção automatizada e ensaio de failover',
              'Muito alto',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Uma armadilha específica aparece na última linha e merece ser dita com todas as letras, porque ela já custou dados a muita gente: réplica não é backup. A replicação propaga fielmente qualquer escrita, inclusive a errada, e um comando de exclusão sem cláusula de filtro chega à réplica em milissegundos. A réplica resolve o tempo de retorno diante de falha de hardware e não resolve nada diante de erro humano, defeito de aplicação ou ataque. Os dois mecanismos são complementares e respondem a perguntas diferentes: a réplica protege contra a máquina que morreu, o backup protege contra a escrita que não deveria ter acontecido, e um plano que confunde os dois descobre a diferença no dia em que alguém roda um UPDATE sem WHERE.',
        },
      ],
    },
    {
      title: 'O ensaio de restauração que roda sozinho',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O ensaio precisa ser automatizado por um motivo que não é preguiça: um procedimento manual só é executado enquanto alguém se lembra dele, e a memória organizacional dura menos que a rotatividade do time. O ensaio automatizado roda toda semana sem que ninguém decida rodar, e a primeira semana em que ele falha é a semana em que o backup parou de funcionar, e não o dia do incidente. O desenho mínimo tem quatro etapas: provisionar um ambiente descartável, restaurar a cópia mais recente dentro dele, rodar consultas de verificação contra o resultado, e destruir o ambiente registrando o tempo total.',
        },
        {
          type: 'paragraph',
          value:
            'A etapa que diferencia um ensaio útil de um teatro de conformidade é a terceira. Restaurar e verificar apenas que o banco sobe prova pouco, porque um banco vazio também sobe. As consultas de verificação precisam checar completude, comparando a contagem de tabelas e de objetos com a origem, checar integridade referencial, procurando registros órfãos que denunciam captura inconsistente, e checar atualidade, confirmando que o registro mais recente do backup está dentro da janela de perda aceitável. Esse último item é o que detecta o caso mais silencioso de todos, que é o backup que roda com sucesso mas sobre uma réplica que parou de receber dados há três semanas.',
        },
        {
          type: 'code',
          value: `#!/usr/bin/env bash
# scripts/ensaio-restauracao.sh
# Ensaio semanal de restauracao. Roda em agendador, sem intervencao humana.
# Falhar aqui e o objetivo: e mais barato do que falhar durante o incidente.

set -euo pipefail

BUCKET="\${BACKUP_BUCKET:?bucket de backup nao definido}"
RPO_HORAS="\${RPO_HORAS:-24}"
INSTANCIA="ensaio-restauracao-$(date +%Y%m%d%H%M%S)"
INICIO=$(date +%s)

# Ambiente descartavel e sempre destruido, inclusive quando o ensaio falha.
# Sem esta linha, um ensaio que falha deixa lixo caro rodando ate alguem ver.
limpar() {
  docker rm -f "\$INSTANCIA" >/dev/null 2>&1 || true
  rm -f "\$ARQUIVO" 2>/dev/null || true
}
trap limpar EXIT

# 1. Buscar a copia mais recente pelo armazenamento, e nao por um nome
#    previsivel: nome previsivel esconde o caso em que o job parou de gerar
#    arquivo novo e o ensaio segue restaurando o mesmo backup antigo.
ARQUIVO=$(mktemp /tmp/backup-XXXXXX.dump)
CHAVE=$(aws s3api list-objects-v2 --bucket "\$BUCKET" --prefix "postgres/" \\
  --query 'sort_by(Contents, &LastModified)[-1].Key' --output text)

if [ "\$CHAVE" = "None" ] || [ -z "\$CHAVE" ]; then
  echo "FALHA: nenhum backup encontrado em \$BUCKET" >&2
  exit 1
fi

# Idade do arquivo: um backup legivel porem velho falha o objetivo de perda
# aceitavel do mesmo jeito que um backup corrompido. Esta checagem pega o
# job que morreu silenciosamente ha semanas com o painel ainda verde.
MODIFICADO=$(aws s3api head-object --bucket "\$BUCKET" --key "\$CHAVE" \\
  --query 'LastModified' --output text)
IDADE_HORAS=$(( ( \$(date +%s) - \$(date -d "\$MODIFICADO" +%s) ) / 3600 ))

if [ "\$IDADE_HORAS" -gt "\$RPO_HORAS" ]; then
  echo "FALHA: backup mais recente tem \${IDADE_HORAS}h, limite e \${RPO_HORAS}h" >&2
  exit 1
fi

aws s3 cp "s3://\$BUCKET/\$CHAVE" "\$ARQUIVO" --quiet

# 2. Restaurar num banco efemero, isolado do ambiente real.
docker run -d --name "\$INSTANCIA" -e POSTGRES_PASSWORD=ensaio \\
  -p 55432:5432 postgres:16 >/dev/null

until docker exec "\$INSTANCIA" pg_isready -q; do sleep 1; done

# --exit-on-error e essencial: sem ele, pg_restore ignora erros de objeto
# individual e termina com codigo zero, e o ensaio aprova um backup parcial.
PGPASSWORD=ensaio pg_restore --host=localhost --port=55432 --username=postgres \\
  --dbname=postgres --no-owner --exit-on-error "\$ARQUIVO"

# 3. Verificacao de conteudo. Um banco vazio tambem sobe: o que prova a
#    restauracao sao as consultas abaixo, nao o processo ter iniciado.
PGPASSWORD=ensaio psql --host=localhost --port=55432 --username=postgres \\
  --dbname=postgres --variable=ON_ERROR_STOP=1 --quiet <<'SQL'
DO $$
DECLARE
  total_tabelas int;
  pedidos_orfaos int;
  registro_mais_novo timestamptz;
BEGIN
  -- Completude: contagem conferida contra o inventario esperado da origem.
  SELECT count(*) INTO total_tabelas
    FROM information_schema.tables WHERE table_schema = 'public';
  IF total_tabelas < 42 THEN
    RAISE EXCEPTION 'Completude: % tabelas restauradas, esperado ao menos 42',
      total_tabelas;
  END IF;

  -- Consistencia: orfao denuncia captura sem transacao unica, em que cada
  -- tabela foi lida num instante diferente.
  SELECT count(*) INTO pedidos_orfaos
    FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
    WHERE c.id IS NULL;
  IF pedidos_orfaos > 0 THEN
    RAISE EXCEPTION 'Consistencia: % pedidos sem cliente', pedidos_orfaos;
  END IF;

  -- Atualidade: pega a origem que parou de receber dados com o job verde.
  SELECT max(created_at) INTO registro_mais_novo FROM orders;
  IF registro_mais_novo < now() - interval '36 hours' THEN
    RAISE EXCEPTION 'Atualidade: registro mais novo e de %', registro_mais_novo;
  END IF;
END $$;
SQL

# 4. O tempo do ensaio e a estimativa honesta do tempo de retorno. Publicar
#    como metrica permite alertar quando a restauracao passa a nao caber no
#    prazo, o que acontece de forma gradual conforme a base cresce.
DURACAO=$(( \$(date +%s) - INICIO ))
echo "ensaio_restauracao_segundos \$DURACAO"
echo "OK: restauracao verificada em \${DURACAO}s a partir de \$CHAVE"`,
        },
        {
          type: 'paragraph',
          value:
            'Duas escolhas no script merecem destaque porque são exatamente onde os ensaios caseiros costumam falhar em silêncio. A primeira é a opção que faz o restaurador parar no primeiro erro: sem ela, a ferramenta reporta problemas por objeto individual e ainda assim termina com código zero, de forma que um backup em que metade dos objetos não restaurou é aprovado pelo ensaio. A segunda é buscar a cópia mais recente consultando o armazenamento em vez de montar um nome previsível a partir da data, porque o nome previsível esconde justamente o caso em que o job parou de gerar arquivos novos: o ensaio continua restaurando com sucesso o mesmo arquivo de três semanas atrás e continua reportando verde.',
        },
      ],
    },
    {
      title: 'A dependência circular que ninguém desenha',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A falha mais cara em recuperação raramente está no backup. Está na cadeia de coisas que precisam funcionar para que alguém consiga usá-lo, e essa cadeia costuma passar pelo próprio sistema que caiu. A credencial de acesso ao armazenamento está num gerenciador de segredos que autentica contra o serviço de identidade que usa o banco que está fora do ar. A documentação do procedimento está num wiki hospedado no mesmo cluster. O alerta que avisaria o plantão passa por um serviço que depende da fila que parou. Cada um desses elos é razoável isoladamente e o conjunto forma um ciclo que só se revela quando o ciclo precisa ser percorrido.',
        },
        {
          type: 'paragraph',
          value:
            'O teste que revela esse ciclo é diferente do ensaio automatizado e não pode ser substituído por ele, porque o ensaio roda com as credenciais de serviço já configuradas no agendador, que é justamente o que não existirá durante o incidente. O que revela a dependência circular é o ensaio conduzido por uma pessoa do plantão, partindo apenas do que ela teria em mãos às três da manhã: um notebook, um segundo fator e o documento de procedimento. Toda vez que essa pessoa precisa perguntar algo a alguém, a pergunta é uma dependência não documentada, e o objetivo do exercício é produzir exatamente essa lista.',
        },
        {
          type: 'ordered',
          items: [
            'Desenhar a cadeia completa de recuperação, do alerta inicial até a aplicação servindo tráfego, listando cada sistema que precisa estar de pé em cada passo.',
            'Marcar na cadeia todo elemento que depende, direta ou indiretamente, do sistema que está sendo recuperado, incluindo identidade, segredos, rede, observabilidade e documentação.',
            'Para cada dependência circular encontrada, criar um caminho alternativo que não passe pelo sistema caído, como credencial de emergência guardada fora de linha e procedimento exportado em arquivo estático.',
            'Conduzir o ensaio com uma pessoa do plantão que não desenhou o sistema, sem ajuda dos autores, registrando cada pergunta que ela precisa fazer.',
            'Transformar cada pergunta registrada em correção do procedimento ou em automação, e repetir o exercício com outra pessoa no trimestre seguinte.',
            'Guardar a credencial de emergência com validade limitada e auditoria de uso, para que o caminho alternativo não vire uma porta permanente sem controle.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Há uma variante dessa dependência que é específica de backup e que merece atenção própria: a chave de criptografia. Cifrar as cópias é correto e frequentemente obrigatório, e cria um ponto de falha novo, porque o backup passa a valer exatamente o que a chave vale. Se a chave vive apenas no gerenciador de segredos que depende do ambiente afetado, a cópia está criptografada contra o próprio dono. Se a chave é rotacionada sem manter as anteriores acessíveis, os backups antigos viram ruído no dia da rotação, de forma silenciosa, e o ensaio semanal só detecta isso se restaurar também uma cópia antiga de tempos em tempos, e não apenas a mais recente.',
        },
      ],
    },
    {
      title: 'Os alertas que substituem a fé no painel verde',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Trocar a taxa de sucesso do job por indicadores que refletem recuperação de verdade é a mudança de instrumentação que sustenta todo o resto. São quatro sinais, e a característica comum entre eles é que nenhum pode ser satisfeito por um processo que apenas escreveu bytes em algum lugar. A idade da cópia verificada mais recente responde qual é a perda real de dados neste instante, e é diferente da idade do último backup, porque uma cópia não verificada não conta. A duração do ensaio de ponta a ponta é a estimativa honesta do tempo de retorno, e ela cresce com a base até o dia em que deixa de caber no prazo, o que precisa ser detectado antes do incidente e não durante.',
        },
        {
          type: 'paragraph',
          value:
            'Os outros dois sinais cobrem o que costuma passar despercebido. A diferença de inventário entre origem e restaurado detecta a tabela nova que ficou de fora por falta de permissão, que é a causa mais comum de restauração incompleta em sistemas que evoluem rápido. O tempo desde o último ensaio conduzido por um humano do plantão detecta a erosão do procedimento, que acontece por rotatividade e por mudança de infraestrutura mesmo quando tudo o mais continua automatizado e verde.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'O que revela', 'Limite sugerido', 'Ação quando dispara'],
          rows: [
            [
              'Idade da cópia verificada',
              'Perda real de dados agora, e não a prometida',
              'Maior que o objetivo de perda aceitável',
              'Tratar como incidente de severidade alta, mesmo sem impacto visível',
            ],
            [
              'Duração do ensaio',
              'Tempo de retorno real diante do crescimento da base',
              'Acima de setenta por cento do prazo aceitável',
              'Revisar a forma da restauração antes que o prazo estoure',
            ],
            [
              'Diferença de inventário',
              'Objeto novo fora da cobertura do backup',
              'Qualquer diferença diferente de zero',
              'Corrigir a permissão ou a lista de objetos no mesmo dia',
            ],
            [
              'Tempo desde o ensaio humano',
              'Erosão do procedimento e do conhecimento do plantão',
              'Mais de um trimestre',
              'Agendar o exercício com alguém que não o conduziu antes',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Vale fechar com a inversão que organiza a prioridade de investimento nesse tema. O backup não é o produto, a recuperação é. Todo o esforço gasto em aumentar a frequência de cópias tem retorno decrescente e é fácil de justificar em reunião, enquanto o esforço gasto em provar a recuperação tem retorno alto e é difícil de vender porque não produz nada visível enquanto nada quebra. A pergunta que separa uma organização preparada de uma organização confiante não é com que frequência o backup roda, é qual foi a data da última restauração bem-sucedida conduzida por alguém que estaria de plantão, e quanto tempo ela levou.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Com que frequência o ensaio de restauração precisa rodar para valer alguma coisa?',
      answer:
        'A frequência correta é derivada de duas coisas e nenhuma delas é o calendário em si: o ritmo de mudança do sistema e o custo de descobrir tarde. Se o schema muda toda semana, porque o time entrega continuamente, o ensaio automatizado precisa rodar toda semana, já que a janela entre uma mudança que quebra a cobertura e a próxima verificação é exatamente o período em que o backup está inútil sem que ninguém saiba. Em sistemas estáveis, com schema mudando poucas vezes ao ano, o ensaio mensal cobre bem. O ponto importante é separar dois tipos de ensaio com frequências diferentes. O automatizado, que restaura e roda consultas de verificação, deve ser o mais frequente possível, porque o custo marginal dele é tempo de máquina e ele pega regressão de cobertura e corrupção. O ensaio humano, conduzido por alguém do plantão sem ajuda, é caro e precisa acontecer no mínimo trimestralmente, porque o que ele verifica é o procedimento e o conhecimento da equipe, e ambos se degradam com rotatividade e com mudança de infraestrutura, não com o passar dos dias. Uma regra prática que funciona bem: o ensaio automatizado roda na mesma cadência em que o sistema muda, e o humano roda sempre que a equipe de plantão muda de composição ou quando a infraestrutura de recuperação é alterada, com um piso trimestral mesmo que nada disso aconteça.',
    },
    {
      question: 'Como testar restauração quando a base tem vários terabytes e restaurar tudo é caro demais?',
      answer:
        'A resposta tem duas camadas e a primeira é reconhecer que existe uma tensão real, que não se resolve fingindo que restaurar cinco terabytes toda semana é viável. A camada barata e frequente é a restauração parcial verificada: restaurar um subconjunto determinístico que inclua as tabelas críticas e uma amostra aleatória das demais, o que pega corrupção, regressão de cobertura e erro de permissão pelo custo de uma fração do volume. É importante que a amostra tenha um componente aleatório rotativo, porque uma amostra fixa deixa de cobrir justamente as tabelas que nunca entraram nela. A camada cara e rara é a restauração completa cronometrada, que precisa acontecer pelo menos uma vez por trimestre, porque é a única que mede o tempo de retorno de verdade e a única que valida a restauração de índices e de objetos grandes, que é onde o tempo realmente se concentra em bases desse tamanho. Há também uma otimização de arquitetura que muda o problema em vez de administrá-lo: manter uma réplica restaurada de forma contínua a partir do backup, aplicando o log de transações à medida que ele chega. Esse arranjo torna a verificação permanente em vez de periódica, já que a réplica só continua acompanhando se as cópias forem legíveis e completas, e de quebra reduz o tempo de retorno, porque a restauração já está feita quando o incidente acontece. O custo é manter uma cópia quente adicional, o que costuma ser menor do que parece quando comparado ao custo do tempo parado que ele elimina.',
    },
    {
      question: 'Backup em nuvem com replicação entre regiões já não resolve isso tudo por padrão?',
      answer:
        'Resolve durabilidade de armazenamento, que é uma propriedade importante e é a menos provável de falhar entre todas as que uma recuperação exige. Os provedores oferecem garantias altíssimas de que o objeto gravado continuará existindo e com os mesmos bytes, e replicação entre regiões protege contra a perda de uma região inteira. Nenhuma dessas garantias fala sobre completude, sobre consistência ou sobre acessibilidade, que são exatamente as três propriedades que mais falham na prática. Um backup incompleto é replicado entre três regiões com a mesma diligência que um completo, e continua incompleto nas três. Um dump capturado sem transação única permanece inconsistente depois de qualquer quantidade de replicação. E a acessibilidade frequentemente piora com recursos gerenciados, porque a política de acesso ao armazenamento costuma depender do mesmo provedor de identidade que serve a aplicação, o que cria a dependência circular clássica. Há ainda dois riscos específicos de nuvem que merecem atenção explícita: a regra de ciclo de vida do bucket, que apaga silenciosamente objetos antigos conforme uma política que alguém configurou uma vez e ninguém revisou, e o fato de que um comprometimento de credencial com permissão ampla apaga origem e cópia com a mesma facilidade. É por isso que a cópia com bloqueio de objeto, imutável por um período determinado e em uma conta separada com credenciais distintas, é a prática que transforma durabilidade em garantia real, porque ela protege contra a categoria de falha que a replicação não cobre, que é a exclusão autorizada e errada.',
    },
  ],
  conclusion: {
    title: 'A cópia só vira garantia no dia em que alguém a restaura',
    description:
      'Um painel com setecentas e vinte execuções verdes descreve um processo que escreveu bytes, e não um sistema capaz de voltar. O que separa uma coisa da outra são quatro propriedades que falham por motivos independentes, dois objetivos de negócio traduzidos em restrição de arquitetura, um ensaio automatizado que verifica conteúdo em vez de apenas subir o banco, e um exercício humano que expõe a dependência circular entre a recuperação e o sistema que caiu. Posso desenhar o plano de recuperação do seu sistema a partir dos objetivos reais de perda e de retorno, montar o ensaio automatizado com consultas de verificação de completude, consistência e atualidade, mapear e quebrar as dependências circulares da cadeia de recuperação e configurar os indicadores que avisam quando a restauração deixou de caber no prazo.',
    cta: 'Falar sobre o plano de recuperação do meu sistema',
  },
  related: [
    {
      label: 'Migração de banco sem janela: expandir, migrar, contrair',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Rollback de base de conhecimento sem derrubar o atendimento',
      to: '/blog/rollback-base-conhecimento-voltar-indice-sem-derrubar-atendimento',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The backup dashboard showed seven hundred and twenty consecutive successful runs when the primary database disk failed on a Tuesday afternoon. The restore started at ten past three with an expectation of forty minutes, and finished at twenty past three the following morning, with four hours of orders lost, because the most recent dump did not contain the schema of the three tables created the month before, the encryption key for the archive was stored in the secret manager that depended on the same database, and nobody on call had write permission on the destination bucket. This article shows why a backup that has never been restored is a hypothesis rather than a guarantee, why job success rate measures the wrong thing, which four properties separate a copy from a recovery and in what order they fail, how recovery time and recovery point objectives stop being slide numbers and become architectural constraints, how to build the restore drill that runs by itself every week, and which circular dependency turns a recoverable incident into a twelve hour outage.',
  sections: [
    {
      title: 'A backup is a hypothesis until somebody restores it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'What a backup job proves when it finishes successfully is far less than teams usually assume. It proves that a process read data from a source and wrote bytes to a destination without returning an error code. It does not prove that the written bytes are readable, that they represent a consistent state of the system, that the content covers everything that needs restoring, that somebody has permission to read them back, or that the read time fits within the deadline the business accepts. Each of those five statements is independent of the others, and the backup job verifies exactly zero of them.',
        },
        {
          type: 'paragraph',
          value:
            'The difference between a copy and a guarantee is the same as the difference between a test that compiles and a test that passes. The metric nearly every dashboard displays is job success rate, and it is misleading precisely because it sits at one hundred percent throughout the entire period in which the backup is quietly useless. A dump that lost a table because the read user was never granted permission on the new table finishes successfully. An archive truncated by a full disk at the destination finishes successfully if the write returns before the flush. A backup encrypted with a key that has already been rotated finishes successfully every day, and keeps finishing successfully until the day somebody needs to open it.',
        },
        {
          type: 'paragraph',
          value:
            'The reframing that fixes this is treating the restore as the test and the backup as the code. Nobody would accept a system where the test suite never runs and the team claims the code works because it compiled seven hundred and twenty times in a row. Backups sit in exactly that position in most organizations, and the reason is that restoring feels expensive while nothing is broken. The real cost is asymmetric in the same way it is with tests: the weekly drill costs a few hours of machine time, and discovering that the backup is worthless during an incident costs downtime multiplied by every part of the business that depends on the system.',
        },
        {
          type: 'diagram',
          value: `WHAT EACH THING ACTUALLY PROVES

  green backup job         -> "a process wrote bytes somewhere"
                              does not prove readability
                              does not prove completeness
                              does not prove access
                              does not prove deadline

  archive checksum         -> "the bytes did not rot after the write"
                              does not prove the content is right

  restore into a           -> "these bytes become a database that starts"
  disposable environment      does not prove the application works

  restore + verification   -> "this database answers what the app asks"
  queries                     THIS is the guarantee

  ^ only the last line is a guarantee. the first three are hints.`,
        },
      ],
    },
    {
      title: 'The four properties and the order in which they fail',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A recovery depends on four independent properties, and it is worth enumerating them separately because each fails for its own reason, is detected by its own test, and in practice belongs to a different person. Readability is the ability to read the bytes back and get what was written. Completeness is coverage: whether everything that must exist after the restore is inside the set of copies. Consistency is the property that the data represents a valid instant of the system, rather than a blurred picture of several tables captured at different moments. Accessibility is the ability of the right person to reach the bytes at incident time, with credentials, permissions and network.',
        },
        {
          type: 'table',
          columns: ['Property', 'Typical failure', 'How it is detected', 'When it is usually discovered'],
          rows: [
            [
              'Readability',
              'Truncated archive, corrupted compression, rotated encryption key',
              'Full restore into a disposable environment',
              'During the incident, when opening the archive',
            ],
            [
              'Completeness',
              'New table without read permission, new database off the list, attachment bucket never copied',
              'Compare the object inventory of source and restore',
              'After the restore, when the application throws errors',
            ],
            [
              'Consistency',
              'Dump without a single transaction, replica captured mid distributed write',
              'Referential integrity query in the restored environment',
              'Days later, as orphan rows in a report',
            ],
            [
              'Accessibility',
              'Credential in the vault that depends on the downed system, permission held only by the team on vacation',
              'Drill conducted by somebody on call, with no help',
              'During the incident, at the worst possible moment',
            ],
            [
              'Deadline',
              'Restoring two terabytes over a link that delivers one hundred megabits',
              'Timing the drill end to end',
              'During the incident, when the clock is already running',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The most useful column in that table is the last one, and it explains why backup discussions tend to be unproductive. Four of the five rows are only discovered during the incident, which is the one moment with no time to solve them. The restore drill is not an optional maturity practice: it is the only mechanism that moves those discoveries from inside the incident to outside it. It is also worth noting that the order of failure in practice is almost the inverse of the order of attention teams give. Almost everybody worries about readability, which fails least, and almost nobody tests accessibility, which does the most to turn a forty minute incident into a half day outage.',
        },
        {
          type: 'paragraph',
          value:
            'Consistency deserves its own paragraph because it is the most misunderstood of the four. A logical backup that runs table by table without a single transaction captures each table at a different instant, and the result is a state that never existed: an order referencing a payment item that had not yet been created when that table was read. In Postgres, the single transaction dump option solves this within one database, but not across databases: if the system keeps orders in one database and payments in another, no dump tool guarantees a common instant between them, and consistency comes to depend on a recovery point coordinated by time, with the tolerance explicitly accepted by the business.',
        },
      ],
    },
    {
      title: 'The two numbers that become architectural constraints',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The two objectives that organize any recovery plan are the maximum acceptable time until the system is back, and the maximum acceptable amount of lost data measured in time. The first answers how long the business survives while down, the second answers how much work may disappear. They are business numbers, not infrastructure numbers, and the most common mistake is leaving them in the deck without checking whether the current architecture can deliver them. A fifteen minute maximum loss objective with a daily backup is a declared contradiction: the architecture already guarantees, by construction, up to twenty four hours of loss.',
        },
        {
          type: 'paragraph',
          value:
            'What makes those numbers concrete is deriving the corresponding technical constraint from them, and that is where the conversation stops being rhetorical. The acceptable amount of loss defines the minimum copy frequency and, when it is shorter than a few hours, forces continuous shipping of the transaction log instead of periodic dumps. The acceptable time to return defines the shape of the restore, not the size of the backup: restoring two terabytes of logical dump does not fit in four hours no matter how much bandwidth exists, because the bottleneck is index rebuilding, while an already promoted replica fits in minutes because there is nothing to rebuild.',
        },
        {
          type: 'table',
          columns: ['Acceptable loss', 'Acceptable return', 'Architecture that delivers it', 'Relative cost'],
          rows: [
            [
              '24 hours',
              '8 hours',
              'Daily dump in object storage, manual restore',
              'Low',
            ],
            [
              '1 hour',
              '4 hours',
              'Daily snapshot plus continuous transaction log shipping',
              'Medium',
            ],
            [
              '5 minutes',
              '1 hour',
              'Snapshot plus continuous log with a warm replica already restored',
              'High',
            ],
            [
              'Near zero',
              'Minutes',
              'Synchronous replica with automated promotion and failover drills',
              'Very high',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A specific trap shows up in the last row and deserves to be said plainly, because it has already cost many people their data: a replica is not a backup. Replication faithfully propagates any write, including the wrong one, and a delete statement without a filter clause reaches the replica in milliseconds. A replica solves return time in the face of hardware failure and solves nothing in the face of human error, application defects or attacks. The two mechanisms are complementary and answer different questions: the replica protects against the machine that died, the backup protects against the write that should never have happened, and a plan that conflates them discovers the difference the day somebody runs an UPDATE with no WHERE.',
        },
      ],
    },
    {
      title: 'The restore drill that runs by itself',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The drill has to be automated for a reason that is not laziness: a manual procedure only runs while somebody remembers it, and organizational memory lasts less than team turnover. The automated drill runs every week without anybody deciding to run it, and the first week it fails is the week the backup stopped working, rather than the day of the incident. The minimum design has four steps: provision a disposable environment, restore the most recent copy into it, run verification queries against the result, and destroy the environment while recording total time.',
        },
        {
          type: 'paragraph',
          value:
            'The step that separates a useful drill from compliance theater is the third one. Restoring and merely verifying that the database starts proves little, because an empty database also starts. The verification queries have to check completeness, comparing table and object counts against the source, check referential integrity, looking for orphan rows that betray an inconsistent capture, and check freshness, confirming that the most recent record in the backup falls within the acceptable loss window. That last item is what detects the quietest case of all, which is the backup that runs successfully but against a replica that stopped receiving data three weeks ago.',
        },
        {
          type: 'code',
          value: `#!/usr/bin/env bash
# scripts/restore-drill.sh
# Weekly restore drill. Runs on a scheduler, with no human intervention.
# Failing here is the point: it is cheaper than failing during the incident.

set -euo pipefail

BUCKET="\${BACKUP_BUCKET:?backup bucket not defined}"
RPO_HOURS="\${RPO_HOURS:-24}"
INSTANCE="restore-drill-$(date +%Y%m%d%H%M%S)"
START=$(date +%s)

# The disposable environment is always destroyed, including when the drill
# fails. Without this line, a failing drill leaves expensive garbage running
# until somebody notices.
cleanup() {
  docker rm -f "\$INSTANCE" >/dev/null 2>&1 || true
  rm -f "\$ARCHIVE" 2>/dev/null || true
}
trap cleanup EXIT

# 1. Fetch the most recent copy from storage rather than from a predictable
#    name: a predictable name hides the case where the job stopped producing
#    new archives and the drill keeps restoring the same old backup.
ARCHIVE=$(mktemp /tmp/backup-XXXXXX.dump)
KEY=$(aws s3api list-objects-v2 --bucket "\$BUCKET" --prefix "postgres/" \\
  --query 'sort_by(Contents, &LastModified)[-1].Key' --output text)

if [ "\$KEY" = "None" ] || [ -z "\$KEY" ]; then
  echo "FAIL: no backup found in \$BUCKET" >&2
  exit 1
fi

# Archive age: a readable but stale backup misses the acceptable loss
# objective just as much as a corrupted one. This check catches the job that
# died silently weeks ago with the dashboard still green.
MODIFIED=$(aws s3api head-object --bucket "\$BUCKET" --key "\$KEY" \\
  --query 'LastModified' --output text)
AGE_HOURS=$(( ( \$(date +%s) - \$(date -d "\$MODIFIED" +%s) ) / 3600 ))

if [ "\$AGE_HOURS" -gt "\$RPO_HOURS" ]; then
  echo "FAIL: most recent backup is \${AGE_HOURS}h old, limit is \${RPO_HOURS}h" >&2
  exit 1
fi

aws s3 cp "s3://\$BUCKET/\$KEY" "\$ARCHIVE" --quiet

# 2. Restore into an ephemeral database, isolated from the real environment.
docker run -d --name "\$INSTANCE" -e POSTGRES_PASSWORD=drill \\
  -p 55432:5432 postgres:16 >/dev/null

until docker exec "\$INSTANCE" pg_isready -q; do sleep 1; done

# --exit-on-error is essential: without it, pg_restore ignores per object
# errors and exits with code zero, and the drill approves a partial backup.
PGPASSWORD=drill pg_restore --host=localhost --port=55432 --username=postgres \\
  --dbname=postgres --no-owner --exit-on-error "\$ARCHIVE"

# 3. Content verification. An empty database also starts: what proves the
#    restore are the queries below, not the process having come up.
PGPASSWORD=drill psql --host=localhost --port=55432 --username=postgres \\
  --dbname=postgres --variable=ON_ERROR_STOP=1 --quiet <<'SQL'
DO $$
DECLARE
  total_tables int;
  orphan_orders int;
  newest_record timestamptz;
BEGIN
  -- Completeness: count checked against the expected inventory of the source.
  SELECT count(*) INTO total_tables
    FROM information_schema.tables WHERE table_schema = 'public';
  IF total_tables < 42 THEN
    RAISE EXCEPTION 'Completeness: % tables restored, expected at least 42',
      total_tables;
  END IF;

  -- Consistency: orphans betray a capture without a single transaction, where
  -- each table was read at a different instant.
  SELECT count(*) INTO orphan_orders
    FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
    WHERE c.id IS NULL;
  IF orphan_orders > 0 THEN
    RAISE EXCEPTION 'Consistency: % orders with no customer', orphan_orders;
  END IF;

  -- Freshness: catches the source that stopped receiving data with a green job.
  SELECT max(created_at) INTO newest_record FROM orders;
  IF newest_record < now() - interval '36 hours' THEN
    RAISE EXCEPTION 'Freshness: newest record is from %', newest_record;
  END IF;
END $$;
SQL

# 4. Drill duration is the honest estimate of return time. Publishing it as a
#    metric allows alerting when the restore stops fitting the deadline, which
#    happens gradually as the database grows.
DURATION=$(( \$(date +%s) - START ))
echo "restore_drill_seconds \$DURATION"
echo "OK: restore verified in \${DURATION}s from \$KEY"`,
        },
        {
          type: 'paragraph',
          value:
            'Two choices in the script deserve emphasis because they are exactly where homegrown drills tend to fail silently. The first is the option that makes the restorer stop at the first error: without it, the tool reports per object problems and still exits with code zero, so a backup where half the objects failed to restore is approved by the drill. The second is fetching the most recent copy by querying storage instead of composing a predictable name from the date, because the predictable name hides precisely the case where the job stopped producing new archives: the drill keeps successfully restoring the same three week old file and keeps reporting green.',
        },
      ],
    },
    {
      title: 'The circular dependency nobody draws',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most expensive failure in recovery is rarely in the backup. It is in the chain of things that must work for somebody to be able to use it, and that chain usually runs through the very system that went down. The storage access credential lives in a secret manager that authenticates against the identity service that uses the database that is offline. The procedure documentation lives in a wiki hosted on the same cluster. The alert that would page the on call engineer goes through a service that depends on the queue that stopped. Each of those links is reasonable in isolation and together they form a cycle that only reveals itself when the cycle has to be walked.',
        },
        {
          type: 'paragraph',
          value:
            'The test that reveals that cycle is different from the automated drill and cannot be replaced by it, because the drill runs with service credentials already configured in the scheduler, which is precisely what will not exist during the incident. What reveals the circular dependency is the drill conducted by somebody on call, starting only from what they would have at three in the morning: a laptop, a second factor and the procedure document. Every time that person needs to ask somebody something, the question is an undocumented dependency, and the point of the exercise is to produce exactly that list.',
        },
        {
          type: 'ordered',
          items: [
            'Draw the complete recovery chain, from the initial alert to the application serving traffic, listing every system that must be up at each step.',
            'Mark on the chain every element that depends, directly or indirectly, on the system being recovered, including identity, secrets, network, observability and documentation.',
            'For each circular dependency found, create an alternative path that does not run through the downed system, such as an emergency credential kept offline and the procedure exported as a static file.',
            'Conduct the drill with somebody on call who did not design the system, with no help from the authors, recording every question they need to ask.',
            'Turn each recorded question into a procedure fix or into automation, and repeat the exercise with a different person the following quarter.',
            'Store the emergency credential with a limited validity and usage auditing, so that the alternative path does not become a permanent uncontrolled door.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'There is a variant of this dependency that is specific to backups and deserves its own attention: the encryption key. Encrypting copies is correct and often mandatory, and it creates a new point of failure, because the backup becomes worth exactly what the key is worth. If the key lives only in the secret manager that depends on the affected environment, the copy is encrypted against its own owner. If the key is rotated without keeping previous ones accessible, old backups turn into noise on rotation day, silently, and the weekly drill only detects that if it also restores an older copy from time to time, rather than only the most recent one.',
        },
      ],
    },
    {
      title: 'The alerts that replace faith in a green dashboard',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Replacing job success rate with indicators that reflect actual recovery is the instrumentation change that holds up everything else. There are four signals, and what they have in common is that none can be satisfied by a process that merely wrote bytes somewhere. The age of the most recent verified copy answers what the real data loss is at this instant, and it differs from the age of the last backup, because an unverified copy does not count. The end to end drill duration is the honest estimate of return time, and it grows with the database until the day it no longer fits the deadline, which has to be detected before the incident rather than during it.',
        },
        {
          type: 'paragraph',
          value:
            'The other two signals cover what usually goes unnoticed. The inventory difference between source and restore detects the new table left out for lack of permission, which is the most common cause of incomplete restores in fast moving systems. Time since the last drill conducted by a human on call detects procedure erosion, which happens through turnover and infrastructure change even when everything else stays automated and green.',
        },
        {
          type: 'table',
          columns: ['Indicator', 'What it reveals', 'Suggested threshold', 'Action when it fires'],
          rows: [
            [
              'Age of the verified copy',
              'Real data loss right now, rather than the promised one',
              'Greater than the acceptable loss objective',
              'Treat as a high severity incident, even with no visible impact',
            ],
            [
              'Drill duration',
              'Real return time as the database grows',
              'Above seventy percent of the acceptable deadline',
              'Revisit the shape of the restore before the deadline is blown',
            ],
            [
              'Inventory difference',
              'New object outside backup coverage',
              'Any difference other than zero',
              'Fix the permission or the object list the same day',
            ],
            [
              'Time since the human drill',
              'Erosion of the procedure and of on call knowledge',
              'More than one quarter',
              'Schedule the exercise with somebody who has not run it before',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'It is worth closing with the inversion that organizes investment priority on this topic. The backup is not the product, the recovery is. Every bit of effort spent increasing copy frequency has diminishing returns and is easy to justify in a meeting, while effort spent proving recovery has high returns and is hard to sell because it produces nothing visible while nothing is broken. The question that separates a prepared organization from a confident one is not how often the backup runs, it is what the date was of the last successful restore conducted by somebody who would have been on call, and how long it took.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'How often does the restore drill need to run to be worth anything?',
      answer:
        'The right frequency is derived from two things and neither is the calendar itself: the rate of change of the system and the cost of finding out late. If the schema changes every week, because the team ships continuously, the automated drill has to run every week, since the window between a change that breaks coverage and the next verification is exactly the period in which the backup is useless without anybody knowing. In stable systems, with a schema changing a few times a year, a monthly drill covers it well. The important point is to separate two kinds of drill with different frequencies. The automated one, which restores and runs verification queries, should be as frequent as possible, because its marginal cost is machine time and it catches coverage regressions and corruption. The human drill, conducted by somebody on call with no help, is expensive and needs to happen at least quarterly, because what it verifies is the procedure and the team knowledge, and both degrade with turnover and infrastructure change rather than with the passage of days. A practical rule that works well: the automated drill runs at the same cadence at which the system changes, and the human one runs whenever the on call rotation changes composition or whenever the recovery infrastructure is altered, with a quarterly floor even if none of that happens.',
    },
    {
      question: 'How do you test restores when the database is several terabytes and restoring everything is too expensive?',
      answer:
        'The answer has two layers and the first is acknowledging a real tension, which is not resolved by pretending that restoring five terabytes every week is viable. The cheap and frequent layer is the verified partial restore: restoring a deterministic subset that includes the critical tables plus a random sample of the rest, which catches corruption, coverage regression and permission errors at a fraction of the volume. It matters that the sample has a rotating random component, because a fixed sample stops covering precisely the tables that never entered it. The expensive and rare layer is the timed full restore, which has to happen at least once a quarter, because it is the only one that truly measures return time and the only one that validates index and large object restoration, which is where the time actually concentrates in databases that size. There is also an architectural optimization that changes the problem instead of managing it: keeping a replica continuously restored from the backup, applying the transaction log as it arrives. That arrangement makes verification permanent rather than periodic, since the replica only keeps up if the copies are readable and complete, and as a bonus it reduces return time, because the restore is already done when the incident happens. The cost is maintaining an additional warm copy, which is usually smaller than it seems when compared to the cost of the downtime it eliminates.',
    },
    {
      question: 'Does cloud backup with cross region replication not already solve all of this by default?',
      answer:
        'It solves storage durability, which is an important property and the least likely to fail among all the ones a recovery requires. Providers offer extremely high guarantees that a written object will keep existing with the same bytes, and cross region replication protects against losing an entire region. None of those guarantees speaks to completeness, consistency or accessibility, which are exactly the three properties that fail most in practice. An incomplete backup is replicated across three regions with the same diligence as a complete one, and stays incomplete in all three. A dump captured without a single transaction remains inconsistent after any amount of replication. And accessibility frequently gets worse with managed services, because the storage access policy usually depends on the same identity provider that serves the application, which creates the classic circular dependency. There are also two cloud specific risks that deserve explicit attention: the bucket lifecycle rule, which silently deletes old objects according to a policy somebody configured once and nobody reviewed, and the fact that a credential compromise with broad permissions deletes source and copy with equal ease. That is why a copy with object lock, immutable for a defined period and in a separate account with distinct credentials, is the practice that turns durability into a real guarantee, because it protects against the failure category replication does not cover, which is the authorized and wrong deletion.',
    },
  ],
  conclusion: {
    title: 'A copy only becomes a guarantee the day somebody restores it',
    description:
      'A dashboard with seven hundred and twenty green runs describes a process that wrote bytes, not a system able to come back. What separates one from the other are four properties that fail for independent reasons, two business objectives translated into architectural constraints, an automated drill that verifies content instead of merely starting the database, and a human exercise that exposes the circular dependency between the recovery and the system that went down. I can design your recovery plan from real loss and return objectives, build the automated drill with verification queries for completeness, consistency and freshness, map and break the circular dependencies in the recovery chain, and configure the indicators that warn when the restore has stopped fitting the deadline.',
    cta: 'Talk about the recovery plan for my system',
  },
  related: [
    {
      label: 'Database migration without a maintenance window: expand, migrate, contract',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Knowledge base rollback without taking support down',
      to: '/blog/rollback-base-conhecimento-voltar-indice-sem-derrubar-atendimento',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'El panel de backup mostraba setecientas veinte ejecuciones consecutivas con éxito cuando el disco de la base principal falló un martes por la tarde. La restauración comenzó a las quince y diez con una expectativa de cuarenta minutos, y terminó a las tres y veinte de la mañana siguiente, con cuatro horas de pedidos perdidos, porque el dump más reciente no contenía el esquema de las tres tablas creadas el mes anterior, la clave de cifrado del archivo estaba guardada en el gestor de secretos que dependía de la misma base, y nadie de guardia tenía permiso de escritura en el bucket de destino. Este artículo muestra por qué un backup que nunca fue restaurado es una hipótesis y no una garantía, por qué la tasa de éxito del job mide lo equivocado, cuáles son las cuatro propiedades que separan una copia de una recuperación y en qué orden fallan, cómo el objetivo de tiempo y el de punto de recuperación dejan de ser números de presentación y se vuelven restricciones de arquitectura, cómo montar el ensayo de restauración que se ejecuta solo cada semana, y cuál es la dependencia circular que convierte un incidente recuperable en una parada de doce horas.',
  sections: [
    {
      title: 'Un backup es una hipótesis hasta que alguien lo restaura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Lo que prueba un job de backup cuando termina con éxito es bastante menos de lo que el equipo suele suponer. Prueba que un proceso leyó datos de un origen y escribió bytes en un destino sin devolver código de error. No prueba que los bytes escritos sean legibles, que representen un estado consistente del sistema, que el contenido cubra todo lo que hace falta restaurar, que exista alguien con permiso para leerlos de vuelta, ni que el tiempo de lectura quepa en el plazo que el negocio acepta. Cada una de esas cinco afirmaciones es independiente de las demás, y el job de backup verifica exactamente cero de ellas.',
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre la copia y la garantía es la misma que existe entre un test que compila y un test que pasa. La métrica que casi todos los paneles muestran es la tasa de éxito del job, y resulta engañosa justamente porque se mantiene en el cien por ciento durante todo el periodo en que el backup está silenciosamente inservible. Un dump que perdió una tabla porque el usuario de lectura nunca recibió permiso sobre la tabla nueva termina con éxito. Un archivo truncado por disco lleno en el destino termina con éxito si la escritura retorna antes del flush. Un backup cifrado con una clave que ya fue rotada termina con éxito todos los días, y sigue terminando con éxito hasta el día en que alguien necesita abrirlo.',
        },
        {
          type: 'paragraph',
          value:
            'La reformulación que resuelve esto es tratar la restauración como el test y el backup como el código. Nadie aceptaría un sistema en el que la suite de pruebas nunca se ejecuta y el equipo afirma que el código funciona porque compiló setecientas veinte veces seguidas. El backup está exactamente en esa posición en la mayoría de las organizaciones, y el motivo es que restaurar parece caro mientras nada se ha roto. El costo real es asimétrico igual que en el caso de las pruebas: el ensayo semanal cuesta unas horas de máquina, y descubrir que el backup no sirve durante un incidente cuesta el tiempo de indisponibilidad multiplicado por todo el negocio que depende del sistema.',
        },
        {
          type: 'diagram',
          value: `QUE PRUEBA REALMENTE CADA COSA

  job de backup en verde   -> "un proceso escribio bytes en algun lugar"
                              no prueba legibilidad
                              no prueba completitud
                              no prueba acceso
                              no prueba plazo

  checksum del archivo     -> "los bytes no se corrompieron tras la escritura"
                              no prueba que el contenido sea correcto

  restauracion en entorno  -> "estos bytes se vuelven una base que arranca"
  desechable                  no prueba que la aplicacion funcione

  restauracion + consultas -> "esta base responde lo que la aplicacion pregunta"
  de verificacion             ESTA es la garantia

  ^ solo la ultima linea es una garantia. las tres primeras son indicios.`,
        },
      ],
    },
    {
      title: 'Las cuatro propiedades y el orden en que fallan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una recuperación depende de cuatro propiedades independientes, y conviene enumerarlas por separado porque cada una falla por un motivo propio, se detecta con una prueba propia y en la práctica es responsabilidad de una persona distinta. La legibilidad es la capacidad de leer los bytes de vuelta y obtener lo que fue escrito. La completitud es la cobertura: si todo lo que debe existir después de la restauración está dentro del conjunto de copias. La consistencia es la propiedad de que los datos representen un instante válido del sistema, y no un retrato borroso de varias tablas capturadas en momentos diferentes. La accesibilidad es la capacidad de que la persona correcta llegue a los bytes en el momento del incidente, con credencial, permiso y red.',
        },
        {
          type: 'table',
          columns: ['Propiedad', 'Fallo típico', 'Cómo se detecta', 'Cuándo suele descubrirse'],
          rows: [
            [
              'Legibilidad',
              'Archivo truncado, compresión corrompida, clave de cifrado rotada',
              'Restauración completa en entorno desechable',
              'Durante el incidente, al abrir el archivo',
            ],
            [
              'Completitud',
              'Tabla nueva sin permiso de lectura, base nueva fuera de la lista, bucket de adjuntos no copiado',
              'Comparar el inventario de objetos del origen con el del restaurado',
              'Después de la restauración, cuando la aplicación falla',
            ],
            [
              'Consistencia',
              'Dump sin transacción única, réplica capturada en medio de una escritura distribuida',
              'Consulta de integridad referencial en el entorno restaurado',
              'Días después, como dato huérfano en un informe',
            ],
            [
              'Accesibilidad',
              'Credencial en el cofre que depende del sistema caído, permiso solo del equipo que está de vacaciones',
              'Ensayo conducido por alguien de guardia, sin ayuda',
              'Durante el incidente, en el peor momento posible',
            ],
            [
              'Plazo',
              'Restaurar dos terabytes por un enlace que entrega cien megabits',
              'Cronometrar el ensayo de punta a punta',
              'Durante el incidente, cuando el reloj ya corre',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La columna más útil de esa tabla es la última, y explica por qué la discusión sobre backup tiende a ser improductiva. Cuatro de las cinco filas solo se descubren durante el incidente, que es el único momento en que no hay tiempo para resolverlas. El ensayo de restauración no es una práctica de madurez opcional: es el único mecanismo que traslada esos descubrimientos desde dentro del incidente hacia fuera de él. Vale notar también que el orden de fallo en la práctica es casi el inverso del orden de atención que los equipos dedican. Casi todo el mundo se preocupa por la legibilidad, que es la que menos falla, y casi nadie prueba la accesibilidad, que es la que más convierte un incidente de cuarenta minutos en una parada de medio día.',
        },
        {
          type: 'paragraph',
          value:
            'La consistencia merece un párrafo propio porque es la más mal comprendida de las cuatro. Un backup lógico que recorre tabla por tabla sin una transacción única captura cada tabla en un instante distinto, y el resultado es un estado que nunca existió: un pedido que referencia un ítem de pago que todavía no había sido creado cuando esa tabla fue leída. En Postgres, la opción de dump en transacción única resuelve esto dentro de una base, pero no entre bases: si el sistema guarda pedidos en una base y pagos en otra, ninguna herramienta de dump garantiza un instante común entre ambas, y la consistencia pasa a depender de un punto de recuperación coordinado por tiempo, con la tolerancia aceptada explícitamente por el negocio.',
        },
      ],
    },
    {
      title: 'Los dos números que se vuelven restricción de arquitectura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los dos objetivos que organizan cualquier plan de recuperación son el tiempo máximo aceptable hasta que el sistema vuelva, y la cantidad máxima aceptable de datos perdidos medida en tiempo. El primero responde cuánto tiempo sobrevive el negocio parado, el segundo responde cuánto trabajo puede desaparecer. Son números de negocio, no de infraestructura, y el error más común es dejarlos en la presentación sin verificar si la arquitectura actual consigue entregarlos. Un objetivo de quince minutos de pérdida máxima con un backup diario es una contradicción declarada: la arquitectura ya garantiza, por construcción, hasta veinticuatro horas de pérdida.',
        },
        {
          type: 'paragraph',
          value:
            'Lo que vuelve concretos esos números es derivar de ellos la restricción técnica correspondiente, y ahí es donde la conversación deja de ser retórica. La cantidad aceptable de pérdida define la frecuencia mínima de la copia y, cuando es menor que unas pocas horas, obliga al envío continuo del log de transacciones en lugar de dumps periódicos. El tiempo aceptable hasta el retorno define la forma de la restauración, no el tamaño del backup: restaurar dos terabytes de dump lógico no cabe en cuatro horas por más ancho de banda que exista, porque el cuello de botella es la reconstrucción de índices, mientras que una réplica ya promovida cabe en minutos porque no hay nada que reconstruir.',
        },
        {
          type: 'table',
          columns: ['Pérdida aceptable', 'Retorno aceptable', 'Arquitectura que lo entrega', 'Costo relativo'],
          rows: [
            [
              '24 horas',
              '8 horas',
              'Dump diario en almacenamiento de objetos, restauración manual',
              'Bajo',
            ],
            [
              '1 hora',
              '4 horas',
              'Snapshot diario más envío continuo del log de transacciones',
              'Medio',
            ],
            [
              '5 minutos',
              '1 hora',
              'Snapshot más log continuo con réplica caliente ya restaurada',
              'Alto',
            ],
            [
              'Cerca de cero',
              'Minutos',
              'Réplica sincronizada con promoción automatizada y ensayo de failover',
              'Muy alto',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Una trampa específica aparece en la última fila y merece decirse con todas las letras, porque ya le costó datos a mucha gente: una réplica no es un backup. La replicación propaga fielmente cualquier escritura, incluida la equivocada, y un comando de borrado sin cláusula de filtro llega a la réplica en milisegundos. La réplica resuelve el tiempo de retorno frente a un fallo de hardware y no resuelve nada frente a un error humano, un defecto de aplicación o un ataque. Los dos mecanismos son complementarios y responden preguntas distintas: la réplica protege contra la máquina que murió, el backup protege contra la escritura que no debería haber ocurrido, y un plan que confunde ambos descubre la diferencia el día en que alguien ejecuta un UPDATE sin WHERE.',
        },
      ],
    },
    {
      title: 'El ensayo de restauración que se ejecuta solo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El ensayo necesita estar automatizado por un motivo que no es pereza: un procedimiento manual solo se ejecuta mientras alguien lo recuerda, y la memoria organizacional dura menos que la rotación del equipo. El ensayo automatizado se ejecuta cada semana sin que nadie decida ejecutarlo, y la primera semana en que falla es la semana en que el backup dejó de funcionar, y no el día del incidente. El diseño mínimo tiene cuatro etapas: aprovisionar un entorno desechable, restaurar la copia más reciente dentro de él, ejecutar consultas de verificación contra el resultado, y destruir el entorno registrando el tiempo total.',
        },
        {
          type: 'paragraph',
          value:
            'La etapa que diferencia un ensayo útil de un teatro de cumplimiento es la tercera. Restaurar y verificar únicamente que la base arranca prueba poco, porque una base vacía también arranca. Las consultas de verificación deben comprobar la completitud, comparando el conteo de tablas y de objetos con el origen, comprobar la integridad referencial, buscando registros huérfanos que delatan una captura inconsistente, y comprobar la actualidad, confirmando que el registro más reciente del backup está dentro de la ventana de pérdida aceptable. Ese último punto es el que detecta el caso más silencioso de todos, que es el backup que se ejecuta con éxito pero sobre una réplica que dejó de recibir datos hace tres semanas.',
        },
        {
          type: 'code',
          value: `#!/usr/bin/env bash
# scripts/ensayo-restauracion.sh
# Ensayo semanal de restauracion. Se ejecuta en un planificador, sin humanos.
# Fallar aqui es el objetivo: es mas barato que fallar durante el incidente.

set -euo pipefail

BUCKET="\${BACKUP_BUCKET:?bucket de backup no definido}"
RPO_HORAS="\${RPO_HORAS:-24}"
INSTANCIA="ensayo-restauracion-$(date +%Y%m%d%H%M%S)"
INICIO=$(date +%s)

# El entorno desechable siempre se destruye, incluso cuando el ensayo falla.
# Sin esta linea, un ensayo fallido deja basura cara ejecutandose hasta que
# alguien lo note.
limpiar() {
  docker rm -f "\$INSTANCIA" >/dev/null 2>&1 || true
  rm -f "\$ARCHIVO" 2>/dev/null || true
}
trap limpiar EXIT

# 1. Buscar la copia mas reciente en el almacenamiento y no por un nombre
#    predecible: el nombre predecible oculta el caso en que el job dejo de
#    generar archivos nuevos y el ensayo sigue restaurando el mismo backup viejo.
ARCHIVO=$(mktemp /tmp/backup-XXXXXX.dump)
CLAVE=$(aws s3api list-objects-v2 --bucket "\$BUCKET" --prefix "postgres/" \\
  --query 'sort_by(Contents, &LastModified)[-1].Key' --output text)

if [ "\$CLAVE" = "None" ] || [ -z "\$CLAVE" ]; then
  echo "FALLO: ningun backup encontrado en \$BUCKET" >&2
  exit 1
fi

# Edad del archivo: un backup legible pero viejo incumple el objetivo de
# perdida aceptable igual que uno corrompido. Esta comprobacion atrapa al job
# que murio en silencio hace semanas con el panel todavia en verde.
MODIFICADO=$(aws s3api head-object --bucket "\$BUCKET" --key "\$CLAVE" \\
  --query 'LastModified' --output text)
EDAD_HORAS=$(( ( \$(date +%s) - \$(date -d "\$MODIFICADO" +%s) ) / 3600 ))

if [ "\$EDAD_HORAS" -gt "\$RPO_HORAS" ]; then
  echo "FALLO: el backup mas reciente tiene \${EDAD_HORAS}h, el limite es \${RPO_HORAS}h" >&2
  exit 1
fi

aws s3 cp "s3://\$BUCKET/\$CLAVE" "\$ARCHIVO" --quiet

# 2. Restaurar en una base efimera, aislada del entorno real.
docker run -d --name "\$INSTANCIA" -e POSTGRES_PASSWORD=ensayo \\
  -p 55432:5432 postgres:16 >/dev/null

until docker exec "\$INSTANCIA" pg_isready -q; do sleep 1; done

# --exit-on-error es esencial: sin el, pg_restore ignora errores de objetos
# individuales y termina con codigo cero, y el ensayo aprueba un backup parcial.
PGPASSWORD=ensayo pg_restore --host=localhost --port=55432 --username=postgres \\
  --dbname=postgres --no-owner --exit-on-error "\$ARCHIVO"

# 3. Verificacion de contenido. Una base vacia tambien arranca: lo que prueba
#    la restauracion son las consultas de abajo, no que el proceso haya subido.
PGPASSWORD=ensayo psql --host=localhost --port=55432 --username=postgres \\
  --dbname=postgres --variable=ON_ERROR_STOP=1 --quiet <<'SQL'
DO $$
DECLARE
  total_tablas int;
  pedidos_huerfanos int;
  registro_mas_nuevo timestamptz;
BEGIN
  -- Completitud: conteo contrastado con el inventario esperado del origen.
  SELECT count(*) INTO total_tablas
    FROM information_schema.tables WHERE table_schema = 'public';
  IF total_tablas < 42 THEN
    RAISE EXCEPTION 'Completitud: % tablas restauradas, se esperaban al menos 42',
      total_tablas;
  END IF;

  -- Consistencia: un huerfano delata una captura sin transaccion unica, donde
  -- cada tabla fue leida en un instante distinto.
  SELECT count(*) INTO pedidos_huerfanos
    FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
    WHERE c.id IS NULL;
  IF pedidos_huerfanos > 0 THEN
    RAISE EXCEPTION 'Consistencia: % pedidos sin cliente', pedidos_huerfanos;
  END IF;

  -- Actualidad: atrapa al origen que dejo de recibir datos con el job en verde.
  SELECT max(created_at) INTO registro_mas_nuevo FROM orders;
  IF registro_mas_nuevo < now() - interval '36 hours' THEN
    RAISE EXCEPTION 'Actualidad: el registro mas nuevo es de %', registro_mas_nuevo;
  END IF;
END $$;
SQL

# 4. La duracion del ensayo es la estimacion honesta del tiempo de retorno.
#    Publicarla como metrica permite alertar cuando la restauracion deja de
#    caber en el plazo, lo que ocurre de forma gradual a medida que la base crece.
DURACION=$(( \$(date +%s) - INICIO ))
echo "ensayo_restauracion_segundos \$DURACION"
echo "OK: restauracion verificada en \${DURACION}s a partir de \$CLAVE"`,
        },
        {
          type: 'paragraph',
          value:
            'Dos decisiones del script merecen destacarse porque son exactamente donde los ensayos caseros suelen fallar en silencio. La primera es la opción que hace que el restaurador se detenga ante el primer error: sin ella, la herramienta reporta problemas por objeto individual y aun así termina con código cero, de modo que un backup en el que la mitad de los objetos no se restauró queda aprobado por el ensayo. La segunda es buscar la copia más reciente consultando el almacenamiento en lugar de componer un nombre predecible a partir de la fecha, porque el nombre predecible oculta justamente el caso en que el job dejó de generar archivos nuevos: el ensayo sigue restaurando con éxito el mismo archivo de hace tres semanas y sigue reportando verde.',
        },
      ],
    },
    {
      title: 'La dependencia circular que nadie dibuja',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El fallo más caro en una recuperación rara vez está en el backup. Está en la cadena de cosas que deben funcionar para que alguien consiga usarlo, y esa cadena suele pasar por el propio sistema que se cayó. La credencial de acceso al almacenamiento está en un gestor de secretos que se autentica contra el servicio de identidad que usa la base que está fuera de servicio. La documentación del procedimiento está en un wiki alojado en el mismo clúster. La alerta que avisaría a la guardia pasa por un servicio que depende de la cola que se detuvo. Cada uno de esos eslabones es razonable por separado y el conjunto forma un ciclo que solo se revela cuando hay que recorrerlo.',
        },
        {
          type: 'paragraph',
          value:
            'La prueba que revela ese ciclo es distinta del ensayo automatizado y no puede ser sustituida por él, porque el ensayo se ejecuta con las credenciales de servicio ya configuradas en el planificador, que es justamente lo que no existirá durante el incidente. Lo que revela la dependencia circular es el ensayo conducido por una persona de guardia, partiendo solo de lo que tendría a mano a las tres de la madrugada: un portátil, un segundo factor y el documento del procedimiento. Cada vez que esa persona necesita preguntarle algo a alguien, la pregunta es una dependencia no documentada, y el objetivo del ejercicio es producir exactamente esa lista.',
        },
        {
          type: 'ordered',
          items: [
            'Dibujar la cadena completa de recuperación, desde la alerta inicial hasta la aplicación sirviendo tráfico, listando cada sistema que debe estar en pie en cada paso.',
            'Marcar en la cadena todo elemento que dependa, directa o indirectamente, del sistema que se está recuperando, incluidos identidad, secretos, red, observabilidad y documentación.',
            'Para cada dependencia circular encontrada, crear un camino alternativo que no pase por el sistema caído, como una credencial de emergencia guardada fuera de línea y el procedimiento exportado en un archivo estático.',
            'Conducir el ensayo con una persona de guardia que no diseñó el sistema, sin ayuda de los autores, registrando cada pregunta que necesita hacer.',
            'Convertir cada pregunta registrada en una corrección del procedimiento o en automatización, y repetir el ejercicio con otra persona el trimestre siguiente.',
            'Guardar la credencial de emergencia con validez limitada y auditoría de uso, para que el camino alternativo no se convierta en una puerta permanente sin control.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Hay una variante de esa dependencia que es específica del backup y merece atención propia: la clave de cifrado. Cifrar las copias es correcto y a menudo obligatorio, y crea un punto de fallo nuevo, porque el backup pasa a valer exactamente lo que vale la clave. Si la clave vive solo en el gestor de secretos que depende del entorno afectado, la copia está cifrada contra su propio dueño. Si la clave se rota sin mantener accesibles las anteriores, los backups antiguos se vuelven ruido el día de la rotación, de forma silenciosa, y el ensayo semanal solo lo detecta si también restaura una copia antigua de vez en cuando, y no únicamente la más reciente.',
        },
      ],
    },
    {
      title: 'Las alertas que sustituyen la fe en el panel verde',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cambiar la tasa de éxito del job por indicadores que reflejen recuperación de verdad es el cambio de instrumentación que sostiene todo lo demás. Son cuatro señales, y la característica común entre ellas es que ninguna puede ser satisfecha por un proceso que apenas escribió bytes en algún lugar. La edad de la copia verificada más reciente responde cuál es la pérdida real de datos en este instante, y es distinta de la edad del último backup, porque una copia no verificada no cuenta. La duración del ensayo de punta a punta es la estimación honesta del tiempo de retorno, y crece con la base hasta el día en que deja de caber en el plazo, lo que debe detectarse antes del incidente y no durante él.',
        },
        {
          type: 'paragraph',
          value:
            'Las otras dos señales cubren lo que suele pasar desapercibido. La diferencia de inventario entre origen y restaurado detecta la tabla nueva que quedó fuera por falta de permiso, que es la causa más común de restauración incompleta en sistemas que evolucionan rápido. El tiempo desde el último ensayo conducido por un humano de guardia detecta la erosión del procedimiento, que ocurre por rotación de personal y por cambios de infraestructura incluso cuando todo lo demás sigue automatizado y en verde.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'Qué revela', 'Límite sugerido', 'Acción cuando se dispara'],
          rows: [
            [
              'Edad de la copia verificada',
              'Pérdida real de datos ahora, y no la prometida',
              'Mayor que el objetivo de pérdida aceptable',
              'Tratar como incidente de severidad alta, aun sin impacto visible',
            ],
            [
              'Duración del ensayo',
              'Tiempo de retorno real frente al crecimiento de la base',
              'Por encima del setenta por ciento del plazo aceptable',
              'Revisar la forma de la restauración antes de que el plazo se rompa',
            ],
            [
              'Diferencia de inventario',
              'Objeto nuevo fuera de la cobertura del backup',
              'Cualquier diferencia distinta de cero',
              'Corregir el permiso o la lista de objetos el mismo día',
            ],
            [
              'Tiempo desde el ensayo humano',
              'Erosión del procedimiento y del conocimiento de la guardia',
              'Más de un trimestre',
              'Agendar el ejercicio con alguien que no lo condujo antes',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Conviene cerrar con la inversión que organiza la prioridad de inversión en este tema. El backup no es el producto, la recuperación sí. Todo el esfuerzo gastado en aumentar la frecuencia de copias tiene retorno decreciente y es fácil de justificar en una reunión, mientras que el esfuerzo gastado en probar la recuperación tiene retorno alto y es difícil de vender porque no produce nada visible mientras nada se rompe. La pregunta que separa a una organización preparada de una organización confiada no es con qué frecuencia se ejecuta el backup, es cuál fue la fecha de la última restauración exitosa conducida por alguien que habría estado de guardia, y cuánto tiempo tardó.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Con qué frecuencia necesita ejecutarse el ensayo de restauración para que valga de algo?',
      answer:
        'La frecuencia correcta se deriva de dos cosas y ninguna de ellas es el calendario en sí: el ritmo de cambio del sistema y el costo de descubrirlo tarde. Si el esquema cambia cada semana, porque el equipo entrega de forma continua, el ensayo automatizado necesita ejecutarse cada semana, ya que la ventana entre un cambio que rompe la cobertura y la siguiente verificación es exactamente el periodo en que el backup está inservible sin que nadie lo sepa. En sistemas estables, con un esquema que cambia pocas veces al año, el ensayo mensual cubre bien. El punto importante es separar dos tipos de ensayo con frecuencias distintas. El automatizado, que restaura y ejecuta consultas de verificación, debe ser lo más frecuente posible, porque su costo marginal es tiempo de máquina y atrapa regresiones de cobertura y corrupción. El ensayo humano, conducido por alguien de guardia sin ayuda, es caro y necesita ocurrir como mínimo trimestralmente, porque lo que verifica es el procedimiento y el conocimiento del equipo, y ambos se degradan con la rotación de personal y con cambios de infraestructura, no con el paso de los días. Una regla práctica que funciona bien: el ensayo automatizado se ejecuta a la misma cadencia con que cambia el sistema, y el humano se ejecuta siempre que la guardia cambie de composición o cuando se altere la infraestructura de recuperación, con un piso trimestral aunque nada de eso ocurra.',
    },
    {
      question: '¿Cómo probar la restauración cuando la base tiene varios terabytes y restaurar todo es demasiado caro?',
      answer:
        'La respuesta tiene dos capas y la primera es reconocer que existe una tensión real, que no se resuelve fingiendo que restaurar cinco terabytes cada semana es viable. La capa barata y frecuente es la restauración parcial verificada: restaurar un subconjunto determinista que incluya las tablas críticas y una muestra aleatoria de las demás, lo que atrapa corrupción, regresión de cobertura y errores de permiso por el costo de una fracción del volumen. Es importante que la muestra tenga un componente aleatorio rotativo, porque una muestra fija deja de cubrir justamente las tablas que nunca entraron en ella. La capa cara y poco frecuente es la restauración completa cronometrada, que debe ocurrir al menos una vez por trimestre, porque es la única que mide el tiempo de retorno de verdad y la única que valida la restauración de índices y de objetos grandes, que es donde el tiempo realmente se concentra en bases de ese tamaño. También existe una optimización de arquitectura que cambia el problema en lugar de administrarlo: mantener una réplica restaurada de forma continua a partir del backup, aplicando el log de transacciones a medida que llega. Ese arreglo vuelve la verificación permanente en lugar de periódica, ya que la réplica solo sigue al día si las copias son legibles y completas, y de paso reduce el tiempo de retorno, porque la restauración ya está hecha cuando ocurre el incidente. El costo es mantener una copia caliente adicional, que suele ser menor de lo que parece comparado con el costo del tiempo parado que elimina.',
    },
    {
      question: '¿El backup en la nube con replicación entre regiones no resuelve ya todo esto por defecto?',
      answer:
        'Resuelve la durabilidad del almacenamiento, que es una propiedad importante y la menos propensa a fallar entre todas las que exige una recuperación. Los proveedores ofrecen garantías altísimas de que el objeto escrito seguirá existiendo con los mismos bytes, y la replicación entre regiones protege contra la pérdida de una región entera. Ninguna de esas garantías habla de completitud, de consistencia ni de accesibilidad, que son exactamente las tres propiedades que más fallan en la práctica. Un backup incompleto se replica entre tres regiones con la misma diligencia que uno completo, y sigue incompleto en las tres. Un dump capturado sin transacción única permanece inconsistente después de cualquier cantidad de replicación. Y la accesibilidad frecuentemente empeora con servicios gestionados, porque la política de acceso al almacenamiento suele depender del mismo proveedor de identidad que sirve a la aplicación, lo que crea la dependencia circular clásica. Existen además dos riesgos específicos de la nube que merecen atención explícita: la regla de ciclo de vida del bucket, que borra silenciosamente objetos antiguos según una política que alguien configuró una vez y nadie revisó, y el hecho de que un compromiso de credencial con permisos amplios borra origen y copia con la misma facilidad. Por eso la copia con bloqueo de objeto, inmutable durante un periodo determinado y en una cuenta separada con credenciales distintas, es la práctica que convierte la durabilidad en una garantía real, porque protege contra la categoría de fallo que la replicación no cubre, que es el borrado autorizado y equivocado.',
    },
  ],
  conclusion: {
    title: 'La copia solo se vuelve garantía el día en que alguien la restaura',
    description:
      'Un panel con setecientas veinte ejecuciones en verde describe un proceso que escribió bytes, y no un sistema capaz de volver. Lo que separa una cosa de la otra son cuatro propiedades que fallan por motivos independientes, dos objetivos de negocio traducidos en restricciones de arquitectura, un ensayo automatizado que verifica contenido en lugar de apenas arrancar la base, y un ejercicio humano que expone la dependencia circular entre la recuperación y el sistema que se cayó. Puedo diseñar el plan de recuperación de tu sistema a partir de los objetivos reales de pérdida y de retorno, montar el ensayo automatizado con consultas de verificación de completitud, consistencia y actualidad, mapear y romper las dependencias circulares de la cadena de recuperación y configurar los indicadores que avisan cuando la restauración dejó de caber en el plazo.',
    cta: 'Hablar sobre el plan de recuperación de mi sistema',
  },
  related: [
    {
      label: 'Migración de base sin ventana: expandir, migrar, contraer',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Rollback de base de conocimiento sin tumbar la atención',
      to: '/blog/rollback-base-conhecimento-voltar-indice-sem-derrubar-atendimento',
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
