// Conteudo do artigo: dinheiro em float que nao fecha o caixa. Por que double precision e Number
// nao representam centavos, onde guardar valor monetario (numeric ou centavos inteiros), como
// arredondar uma vez so e no lugar certo, como ratear parcelas sem perder centavo e como migrar
// uma coluna float para numeric sem esconder a diferenca que ja existe.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    fl1: 'O mesmo valor em float e em numeric.',
    fl2: 'Soma de dez parcelas de 0,10 em float.',
    fl3: 'round em float arredonda metade para o par. Em numeric, metade para longe do zero.',
    js1: 'Em JavaScript, Number e double: o mesmo problema, agora no backend.',
    js2: 'parece arredondar para 1,01, mas devolve 1',
    js3: '5969 centavos, não 5970',
    schema1: 'Valor monetário em numeric com escala fixa: soma e multiplicação exatas.',
    schema2: 'O total do item é derivado, nunca digitado em outro lugar.',
    schema3: 'O cabeçalho guarda o total cobrado, que precisa bater com a soma dos itens.',
    money1: 'Valor monetário entra e sai como string decimal ("123.45") e vive como BigInt em centavos.',
    money2: 'Number nunca: um parseFloat no caminho reintroduz o erro de representação.',
    money3: 'a * b / d com arredondamento explícito, sem passar por float.',
    money4: "'half-up': metade para longe do zero, igual a round(numeric) no Postgres.",
    money5: "'half-even': metade para o par (arredondamento bancário).",
    money6: 'Rateio pelo maior resto: a soma das partes é sempre igual ao total.',
    money7: 'Para estorno, rateie o valor absoluto e inverta o sinal.',
    money8: 'Os centavos que sobraram vão para as partes com maior resto.',
    use1: '10% de desconto sobre 3 itens de R$ 0,35 (R$ 1,05): 0,105 vira 11 centavos.',
    use2: 'R$ 100,00 em 3 parcelas: soma 100,00, não 99,99.',
    use3: 'Formatação só na borda, a partir da string exata.',
    pg1: 'numeric (OID 1700) já chega como string: mantenha assim e converta com toCents.',
    pg2: 'NUNCA: pg.types.setTypeParser(1700, parseFloat)',
    pg3: 'bigint (OID 20) como BigInt, para colunas em centavos inteiros.',
    pg4: 'JSON.stringify não serializa BigInt: a API devolve string decimal.',
    mig1: 'Quantas linhas já carregam resíduo de float (valor que não é um centavo exato).',
    mig2: 'Diferença acumulada que a migração vai tornar visível.',
    mig3: 'Tabela pequena: conversão direta. Reescreve a tabela sob ACCESS EXCLUSIVE.',
    mig4: 'Itens cuja soma não bate com o total cobrado no cabeçalho.',
  },
  en: {
    fl1: 'The same value in float and in numeric.',
    fl2: 'Sum of ten installments of 0.10 in float.',
    fl3: 'round on float rounds half to even. On numeric, half away from zero.',
    js1: 'In JavaScript, Number is a double: same problem, now in the backend.',
    js2: 'looks like it rounds to 1.01, but returns 1',
    js3: '5969 cents, not 5970',
    schema1: 'Money in numeric with a fixed scale: exact sums and multiplications.',
    schema2: 'The item total is derived, never typed somewhere else.',
    schema3: 'The header stores the charged total, which must match the sum of the items.',
    money1: 'Money enters and leaves as a decimal string ("123.45") and lives as BigInt cents.',
    money2: 'Never Number: a single parseFloat on the way brings back the representation error.',
    money3: 'a * b / d with explicit rounding, never going through float.',
    money4: "'half-up': half away from zero, same as round(numeric) in Postgres.",
    money5: "'half-even': half to even (banker's rounding).",
    money6: 'Largest remainder allocation: the parts always add up to the total.',
    money7: 'For refunds, allocate the absolute value and flip the sign.',
    money8: 'The leftover cents go to the parts with the largest remainder.',
    use1: '10% discount on 3 items of 0.35 (1.05): 0.105 becomes 11 cents.',
    use2: '100.00 in 3 installments: adds up to 100.00, not 99.99.',
    use3: 'Formatting only at the edge, from the exact string.',
    pg1: 'numeric (OID 1700) already arrives as a string: keep it and convert with toCents.',
    pg2: 'NEVER: pg.types.setTypeParser(1700, parseFloat)',
    pg3: 'bigint (OID 20) as BigInt, for integer cents columns.',
    pg4: 'JSON.stringify does not serialize BigInt: the API returns a decimal string.',
    mig1: 'How many rows already carry float residue (a value that is not an exact cent).',
    mig2: 'Accumulated difference the migration is about to make visible.',
    mig3: 'Small table: direct conversion. Rewrites the table under ACCESS EXCLUSIVE.',
    mig4: 'Items whose sum does not match the total charged in the header.',
  },
  es: {
    fl1: 'El mismo valor en float y en numeric.',
    fl2: 'Suma de diez cuotas de 0,10 en float.',
    fl3: 'round en float redondea la mitad al par. En numeric, la mitad lejos del cero.',
    js1: 'En JavaScript, Number es un double: el mismo problema, ahora en el backend.',
    js2: 'parece redondear a 1,01, pero devuelve 1',
    js3: '5969 centavos, no 5970',
    schema1: 'Valor monetario en numeric con escala fija: sumas y multiplicaciones exactas.',
    schema2: 'El total del ítem es derivado, nunca se escribe en otro lugar.',
    schema3: 'La cabecera guarda el total cobrado, que debe coincidir con la suma de los ítems.',
    money1: 'El dinero entra y sale como string decimal ("123.45") y vive como BigInt en centavos.',
    money2: 'Nunca Number: un solo parseFloat en el camino devuelve el error de representación.',
    money3: 'a * b / d con redondeo explícito, sin pasar por float.',
    money4: "'half-up': la mitad lejos del cero, igual que round(numeric) en Postgres.",
    money5: "'half-even': la mitad al par (redondeo bancario).",
    money6: 'Prorrateo por mayor resto: la suma de las partes siempre es igual al total.',
    money7: 'Para reembolsos, prorratee el valor absoluto e invierta el signo.',
    money8: 'Los centavos sobrantes van a las partes con mayor resto.',
    use1: '10% de descuento sobre 3 ítems de 0,35 (1,05): 0,105 se convierte en 11 centavos.',
    use2: '100,00 en 3 cuotas: suma 100,00, no 99,99.',
    use3: 'Formato solo en el borde, a partir del string exacto.',
    pg1: 'numeric (OID 1700) ya llega como string: manténgalo así y conviértalo con toCents.',
    pg2: 'NUNCA: pg.types.setTypeParser(1700, parseFloat)',
    pg3: 'bigint (OID 20) como BigInt, para columnas en centavos enteros.',
    pg4: 'JSON.stringify no serializa BigInt: la API devuelve un string decimal.',
    mig1: 'Cuántas filas ya cargan residuo de float (un valor que no es un centavo exacto).',
    mig2: 'Diferencia acumulada que la migración va a hacer visible.',
    mig3: 'Tabla pequeña: conversión directa. Reescribe la tabla bajo ACCESS EXCLUSIVE.',
    mig4: 'Ítems cuya suma no coincide con el total cobrado en la cabecera.',
  },
};

const floatCode = (c) => `-- ${c.fl1}
SELECT 0.1::float8 + 0.2::float8     AS soma_float,      -- 0.30000000000000004
       0.1::numeric + 0.2::numeric   AS soma_numeric;    -- 0.3

-- ${c.fl2}
SELECT sum(v) FROM (SELECT 0.1::float8 AS v FROM generate_series(1, 10)) s;
-- 0.9999999999999999

-- ${c.fl3}
SELECT round(2.5::float8) AS round_float,     -- 2
       round(2.5::numeric) AS round_numeric;  -- 3

// ${c.js1}
0.1 + 0.2;                       // 0.30000000000000004
19.9 * 3;                        // 59.699999999999996
Math.floor(19.9 * 3 * 100);      // ${c.js3}
Math.round(1.005 * 100) / 100;   // ${c.js2}
(1.005).toFixed(2);              // '1.00'`;

const schemaCode = (c) => `-- ${c.schema1}
CREATE TABLE pedidos (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  moeda       char(3) NOT NULL DEFAULT 'BRL',
  -- ${c.schema3}
  total       numeric(14, 2) NOT NULL CHECK (total >= 0),
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pedido_itens (
  pedido_id      bigint NOT NULL REFERENCES pedidos (id),
  linha          smallint NOT NULL,
  quantidade     integer NOT NULL CHECK (quantidade > 0),
  preco_unitario numeric(12, 2) NOT NULL CHECK (preco_unitario >= 0),
  desconto       numeric(12, 2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  -- ${c.schema2}
  total          numeric(14, 2) GENERATED ALWAYS AS (quantidade * preco_unitario - desconto) STORED,
  PRIMARY KEY (pedido_id, linha),
  CHECK (desconto <= quantidade * preco_unitario)
);`;

const moneyCode = (c) => `// money.js
// ${c.money1}
// ${c.money2}
const DECIMAL_RE = /^(-)?(\\d+)(?:\\.(\\d{1,2}))?$/;

export function toCents(value) {
  if (typeof value !== 'string') {
    throw new TypeError('valor monetário deve chegar como string, nunca como number');
  }
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) throw new RangeError(\`valor monetário inválido: \${value}\`);
  const [, sign, units, fraction = ''] = match;
  const cents = BigInt(units) * 100n + BigInt(fraction.padEnd(2, '0'));
  return sign ? -cents : cents;
}

export function fromCents(cents) {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return \`\${negative ? '-' : ''}\${abs / 100n}.\${fraction}\`;
}

// ${c.money3}
// ${c.money4}
// ${c.money5}
export function mulDiv(a, b, d, mode = 'half-up') {
  if (d === 0n) throw new RangeError('divisão por zero');
  const n = a * b;
  const negative = (n < 0n) !== (d < 0n);
  const absN = n < 0n ? -n : n;
  const absD = d < 0n ? -d : d;
  let q = absN / absD;
  const twice = (absN % absD) * 2n;
  if (mode === 'half-up' && twice >= absD) q += 1n;
  if (mode === 'half-even' && (twice > absD || (twice === absD && q % 2n === 1n))) q += 1n;
  return negative ? -q : q;
}

// ${c.money6}
// ${c.money7}
export function allocate(totalCents, weights) {
  if (totalCents < 0n) throw new RangeError('rateie o valor absoluto');
  const totalWeight = weights.reduce((sum, w) => sum + w, 0n);
  if (totalWeight <= 0n || weights.some((w) => w < 0n)) {
    throw new RangeError('pesos precisam ser não negativos e somar mais que zero');
  }
  const shares = weights.map((w, index) => ({
    index,
    cents: (totalCents * w) / totalWeight,
    remainder: (totalCents * w) % totalWeight,
  }));
  let leftover = totalCents - shares.reduce((sum, s) => sum + s.cents, 0n);
  // ${c.money8}
  const byRemainder = [...shares].sort((a, b) =>
    b.remainder === a.remainder ? a.index - b.index : b.remainder > a.remainder ? 1 : -1,
  );
  for (const share of byRemainder) {
    if (leftover === 0n) break;
    share.cents += 1n;
    leftover -= 1n;
  }
  return shares.map((s) => s.cents);
}

// uso.js
import { allocate, fromCents, mulDiv, toCents } from './money.js';

// ${c.use1}
const subtotal = toCents('0.35') * 3n;                // 105n
const desconto = mulDiv(subtotal, 10n, 100n);         // 11n

// ${c.use2}
const parcelas = allocate(toCents('100.00'), [1n, 1n, 1n]);
parcelas.map(fromCents);                              // ['33.34', '33.33', '33.33']

// ${c.use3}
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
brl.format(fromCents(subtotal - desconto));           // 'R$ 0,94'`;

const pgCode = (c) => `// db.js
import pg from 'pg';

// ${c.pg1}
// ${c.pg2}
// ${c.pg3}
pg.types.setTypeParser(20, (value) => BigInt(value));

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function totalDoPedido(pedidoId) {
  const { rows } = await pool.query('SELECT total FROM pedidos WHERE id = $1', [pedidoId]);
  return rows[0].total; // '1234.56', string exata
}

// ${c.pg4}
export const serializar = (pedido) => ({ ...pedido, total: String(pedido.total) });`;

const migracaoCode = (c) => `-- ${c.mig1}
SELECT count(*) AS linhas,
       count(*) FILTER (WHERE valor <> round(valor::numeric, 2)::float8) AS com_residuo,
       -- ${c.mig2}
       sum(valor::numeric) - sum(round(valor::numeric, 2)) AS diferenca
  FROM lancamentos;

-- ${c.mig3}
ALTER TABLE lancamentos
  ALTER COLUMN valor TYPE numeric(14, 2) USING round(valor::numeric, 2);

-- ${c.mig4}
SELECT p.id, p.total, sum(i.total) AS soma_itens, p.total - sum(i.total) AS diferenca
  FROM pedidos p
  JOIN pedido_itens i ON i.pedido_id = p.id
 GROUP BY p.id, p.total
HAVING p.total <> sum(i.total)
 ORDER BY abs(p.total - sum(i.total)) DESC
 LIMIT 100;`;

const diagramaPt = `Dia 1  fechamento de outubro: 41.380 pedidos
       soma no banco (coluna double precision)   R$ 2.184.392,17
       repasse do gateway de pagamento           R$ 2.184.371,48
       diferença                                 R$ 20,69

Dia 1  primeira hipótese: pedidos estornados fora do sistema -> nenhum encontrado
Dia 2  segunda hipótese: taxa do gateway -> a taxa já vinha separada no extrato

Dia 3  a diferença aparece em 1 de cada 6 pedidos, sempre de 1 ou 2 centavos
       API em Node: total = itens.reduce((s, i) => s + i.preco * i.qtd * (1 - desc), 0)
       arredondamento: Math.round(total * 100) / 100, aplicado só no total
       gateway: arredonda o desconto item a item e soma depois
       parcelamento: 3 x Math.floor(total / 3 * 100) / 100 -> R$ 99,99 cobrado de R$ 100,00

Dia 4  contabilidade lança R$ 20,69 como "ajuste" e pede para isso não voltar em novembro`;

const diagramaEn = `Day 1  October close: 41,380 orders
       sum in the database (double precision column)   R$ 2,184,392.17
       payout from the payment gateway                 R$ 2,184,371.48
       difference                                      R$ 20.69

Day 1  first hypothesis: orders refunded outside the system -> none found
Day 2  second hypothesis: gateway fee -> the fee was already a separate line in the statement

Day 3  the difference shows up in 1 out of every 6 orders, always 1 or 2 cents
       Node API: total = items.reduce((s, i) => s + i.price * i.qty * (1 - disc), 0)
       rounding: Math.round(total * 100) / 100, applied only to the total
       gateway: rounds the discount item by item and sums afterwards
       installments: 3 x Math.floor(total / 3 * 100) / 100 -> 99.99 charged for 100.00

Day 4  accounting books R$ 20.69 as an "adjustment" and asks for it not to happen again in November`;

const diagramaEs = `Día 1  cierre de octubre: 41.380 pedidos
       suma en la base (columna double precision)   R$ 2.184.392,17
       liquidación del gateway de pago              R$ 2.184.371,48
       diferencia                                   R$ 20,69

Día 1  primera hipótesis: pedidos reembolsados fuera del sistema -> ninguno encontrado
Día 2  segunda hipótesis: comisión del gateway -> la comisión ya venía separada en el extracto

Día 3  la diferencia aparece en 1 de cada 6 pedidos, siempre de 1 o 2 centavos
       API en Node: total = items.reduce((s, i) => s + i.precio * i.cant * (1 - desc), 0)
       redondeo: Math.round(total * 100) / 100, aplicado solo al total
       gateway: redondea el descuento ítem por ítem y suma después
       cuotas: 3 x Math.floor(total / 3 * 100) / 100 -> 99,99 cobrado de 100,00

Día 4  contabilidad registra R$ 20,69 como "ajuste" y pide que no vuelva a pasar en noviembre`;

const pt = {
  intro:
    'O fechamento de outubro de um e-commerce não bateu por R$ 20,69. Era pouco dinheiro em R$ 2,18 milhões, mas a contabilidade não aceita "pouco": cada centavo sem explicação vira ajuste manual, e ajuste manual todo mês vira pergunta de auditoria. Depois de três dias procurando estornos e taxas, a causa apareceu em 1 de cada 6 pedidos: diferenças de 1 ou 2 centavos entre o que o sistema calculava e o que o gateway cobrava. A coluna de valor era double precision, a API somava com Number, o arredondamento acontecia só no total enquanto o gateway arredondava item a item, e o parcelamento cobrava R$ 99,99 de uma compra de R$ 100,00. Este artigo explica por que float não representa centavo, onde guardar valor monetário, como arredondar uma vez só e no lugar certo, como ratear parcelas sem perder centavo e como migrar uma coluna float para numeric sem esconder a diferença que já existe.',
  sections: [
    {
      title: 'O caixa que não fecha por R$ 20,69: um erro pequeno em cada pedido',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Diferença de fechamento costuma ser investigada como problema de processo: pedido estornado por fora, taxa lançada no lugar errado, venda duplicada. Por isso o time gastou dois dias nas hipóteses erradas. O que denunciou a causa real foi o formato da diferença: muitos pedidos com 1 ou 2 centavos, nenhum com valor grande. Diferença de processo aparece concentrada. Diferença de representação numérica aparece espalhada.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'Havia três defeitos somados. O primeiro era de tipo: double precision no banco e Number no Node, os dois em ponto flutuante binário, que não representam 0,10 de forma exata. O segundo era de lugar: o sistema arredondava o total do pedido e o gateway arredondava cada desconto de item, então os dois chegavam a valores diferentes mesmo com aritmética perfeita. O terceiro era de rateio: dividir R$ 100,00 em três e truncar cada parcela perde um centavo, e o cliente paga menos do que o pedido registra.',
        },
        {
          type: 'paragraph',
          value:
            'Só o primeiro defeito se resolve trocando o tipo da coluna. Os outros dois são decisões de regra de negócio que o código precisa tornar explícitas. É por isso que "trocar float por decimal" sozinho raramente fecha o caixa.',
        },
      ],
    },
    {
      title: 'Por que float não guarda 0,10: ponto flutuante binário e o erro que acumula',
      blocks: [
        {
          type: 'paragraph',
          value:
            'real e double precision no Postgres, float e double em Java, Number em JavaScript seguem o IEEE 754: o valor é guardado como uma fração binária. Assim como 1/3 não tem representação finita em decimal, 1/10 não tem em binário. O número guardado para 0,1 é o double mais próximo, um pouco acima de 0,1. Cada operação arredonda de novo para o double mais próximo, e o erro de cada etapa se soma ao das anteriores.',
        },
        {
          type: 'code',
          value: floatCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'O problema não é a exibição. Mostrar 0,30000000000000004 como R$ 0,30 parece resolver, mas o valor errado continua sendo usado na conta seguinte. O caso clássico é o de Math.floor(19.9 * 3 * 100): o produto em float fica um fio abaixo de 59,70, o floor joga para 5969 centavos, e o cliente é cobrado um centavo a menos. Math.round(1.005 * 100) devolve 100 pelo mesmo motivo: 1,005 em binário é um pouco menor que 1,005, e o arredondamento cai para baixo.',
        },
        {
          type: 'paragraph',
          value:
            'Existe ainda uma diferença sutil de comportamento. round em float no Postgres arredonda a metade para o par, então round(2.5::float8) devolve 2, enquanto round(2.5::numeric) devolve 3. Uma consulta que arredonda o mesmo campo em tipos diferentes, por exemplo numa view que faz cast, produz centavos diferentes para o mesmo pedido.',
        },
      ],
    },
    {
      title: 'Onde guardar dinheiro: numeric, centavos inteiros ou o tipo money',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existem duas escolhas corretas e uma armadilha. numeric(p, s) guarda o valor em base decimal, com escala fixa, e faz soma, subtração e multiplicação exatas. bigint em centavos guarda um inteiro, que é exato por definição, e deixa a interpretação da escala para a aplicação. O tipo money do Postgres parece feito para isso, mas formata e interpreta valores conforme o lc_monetary da sessão e mistura dado com apresentação.',
        },
        {
          type: 'table',
          columns: ['Tipo', 'Exato', 'Ponto forte', 'Armadilha', 'Quando usar'],
          rows: [
            ['real / double precision', 'Não', 'Rápido e compacto', 'Erro de representação que acumula em somas', 'Nunca para valor monetário'],
            ['money', 'Sim, com 2 casas fixas', 'Formatação pronta', 'Depende do lc_monetary; uma só moeda; divisão devolve float', 'Evitar em sistema novo'],
            ['numeric(14, 2)', 'Sim', 'Aritmética exata no SQL, legível em relatório', 'Driver devolve string; mais lento que inteiro em agregações enormes', 'Padrão para a maioria dos sistemas'],
            ['bigint em centavos', 'Sim', 'Rápido, simples de serializar, sem ambiguidade de escala', 'Escala implícita: a moeda precisa vir junto; relatório SQL divide por 100', 'Ledger de alto volume, integração com gateway que usa centavos'],
            ['numeric sem escala ou com 4+ casas', 'Sim', 'Guarda câmbio, tarifa por unidade, juros intermediários', 'Valor final precisa ser arredondado antes de cobrar', 'Taxas e preços unitários fracionados, nunca o valor cobrado'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Na prática, numeric(14, 2) cobre até R$ 999 bilhões com centavos e é a escolha mais segura para o modelo relacional, porque relatório, view e consulta ad hoc continuam legíveis. Centavos inteiros fazem sentido quando o volume de agregação é muito alto ou quando o gateway já fala em centavos, como a maioria das APIs de pagamento. O que não faz sentido é misturar: uma tabela em centavos e outra em reais força conversão em cada join, e cada conversão é um lugar novo para errar a escala.',
        },
        {
          type: 'code',
          value: schemaCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'Duas decisões desse esquema evitam a maior parte das divergências. O total do item é uma coluna gerada, então não existe um segundo cálculo do mesmo valor em outro lugar do código. E a moeda fica ao lado do valor: escala de duas casas não serve para iene, que não tem centavos, nem para dinar kuwaitiano, que tem três.',
        },
      ],
    },
    {
      title: 'Arredondar uma vez e no lugar certo: item, total e parcela',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com aritmética exata, arredondar em lugares diferentes produz resultados diferentes. Três itens de R$ 0,35 com 10% de desconto: se o desconto é calculado no total, R$ 1,05 vezes 10% dá R$ 0,105, que vira R$ 0,11. Se é calculado por item, cada R$ 0,035 vira R$ 0,04, e o desconto total é R$ 0,12. Nenhum dos dois está errado. Errado é o sistema fazer de um jeito e o gateway, a nota fiscal ou o ERP fazerem de outro.',
        },
        {
          type: 'list',
          items: [
            'Descubra a granularidade do documento de referência: a nota fiscal arredonda tributo por item, então o sistema também precisa arredondar por item e somar depois.',
            'Escolha o modo de arredondamento e escreva no código: metade para longe do zero é o que o Postgres faz em numeric e o que a maioria das regras fiscais espera; metade para o par reduz viés em somas grandes e aparece em regras bancárias.',
            'Arredonde uma vez, no fim de cada cálculo que gera valor cobrado. Valores intermediários, como preço por grama ou câmbio, ficam com mais casas e só viram centavo no último passo.',
            'Parcela e rateio não se dividem: se alocam. O total é fixo e as partes precisam somar exatamente o total.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O módulo abaixo resolve as três operações sem passar por float: converte string decimal para centavos em BigInt, multiplica e divide com o modo de arredondamento explícito e faz o rateio pelo método do maior resto. Ele usa só a biblioteca padrão e cabe no projeto sem dependência nova.',
        },
        {
          type: 'code',
          value: moneyCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'O rateio pelo maior resto é o que impede o R$ 99,99. Cada parte recebe o quociente inteiro, e os centavos que sobram são distribuídos, um a um, para as partes com maior resto, em ordem estável. Com pesos iguais, o centavo extra fica na primeira parcela; com pesos proporcionais, como o rateio de frete pelo valor de cada item, ele vai para quem perdeu mais no arredondamento. A propriedade que importa é testável: a soma das partes é sempre igual ao total.',
        },
      ],
    },
    {
      title: 'A borda da aplicação: driver, JSON e formatação sem parseFloat',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Trocar a coluna para numeric não adianta se o valor volta a ser float no caminho. O driver pg do Node devolve numeric como string justamente para não perder precisão, e a correção mais comum que se encontra em projetos é um setTypeParser com parseFloat, que desfaz toda a proteção. O mesmo acontece com um ORM configurado para mapear decimal em number, ou com um front que recebe "19.90" e faz Number(valor) antes de multiplicar pela quantidade.',
        },
        {
          type: 'code',
          value: pgCode(comments.pt),
        },
        {
          type: 'list',
          items: [
            'No banco: numeric com escala fixa ou bigint em centavos, nunca float.',
            'Na entrada da API: valor como string decimal ("19.90") ou inteiro em centavos (1990), com validação de formato. Number em JSON perde a garantia antes de chegar ao código.',
            'No domínio: BigInt em centavos ou uma biblioteca decimal; toda multiplicação por percentual passa por uma função com modo de arredondamento explícito.',
            'Na saída: string decimal, e Intl.NumberFormat só para exibição, recebendo a string exata.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Uma regra de revisão de código pega quase todos os casos: qualquer parseFloat, Number(), toFixed ou Math.round perto de uma variável chamada valor, preco, total ou desconto merece pergunta. toFixed, em particular, é formatação, não arredondamento: (1.005).toFixed(2) devolve "1.00".',
        },
      ],
    },
    {
      title: 'Migrar a coluna float para numeric sem esconder a diferença',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A migração tem duas partes: medir o estrago antes e trocar o tipo depois. Medir importa porque a conversão arredonda os resíduos e faz a diferença acumulada aparecer de uma vez nos relatórios. Se o financeiro não souber disso antes, o primeiro fechamento depois da migração parece um novo incidente.',
        },
        {
          type: 'code',
          value: migracaoCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'O ALTER COLUMN TYPE reescreve a tabela inteira com lock exclusivo, o que só é aceitável em tabela pequena ou numa janela de manutenção. Em tabela grande, o caminho seguro é adicionar uma coluna numeric nova, preencher em lotes, manter as duas sincronizadas por trigger enquanto o código passa a ler da nova e só então remover a antiga. A consulta de conciliação no fim do bloco deve virar um job diário: qualquer pedido cuja soma dos itens não bate com o total cobrado é um alerta, não um ajuste de fim de mês.',
        },
        {
          type: 'table',
          columns: ['Etapa', 'O que fazer', 'Como validar'],
          rows: [
            ['1. Medir', 'Contar linhas com resíduo e a diferença acumulada', 'Número compartilhado com o financeiro antes da troca'],
            ['2. Corrigir a borda', 'Remover parseFloat e Number do caminho do valor', 'Testes com 1.005, 19.9 x 3 e rateio de 100 em 3'],
            ['3. Trocar o tipo', 'ALTER direto em tabela pequena ou coluna nova com backfill em lotes', 'Contagem de linhas e soma por mês iguais antes e depois do arredondamento'],
            ['4. Alinhar a regra', 'Arredondar na mesma granularidade do gateway e da nota fiscal', 'Amostra de pedidos com valor idêntico nos dois sistemas'],
            ['5. Conciliar sempre', 'Job diário comparando itens, cabeçalho e repasse', 'Alerta com lista de pedidos divergentes, não um total'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso continuar com double precision se eu arredondar na hora de exibir?',
      answer:
        'Não. Arredondar na exibição esconde o erro, mas o valor sem arredondamento continua sendo usado em somas, descontos, parcelas e relatórios. O erro aparece justamente onde não há exibição: no total do mês, na conciliação com o gateway e em comparações de igualdade que falham por um resíduo na décima sexta casa.',
    },
    {
      question: 'numeric é lento demais para tabelas grandes?',
      answer:
        'Para a maioria dos sistemas, não faz diferença perceptível: o custo de um pedido está em I/O, índices e rede, não na soma de alguns numeric. Em agregações de centenas de milhões de linhas, numeric é mais lento que bigint, e aí guardar centavos inteiros é uma escolha legítima. O que nunca compensa é trocar exatidão por velocidade usando float.',
    },
    {
      question: 'Centavos inteiros ou numeric: qual escolher?',
      answer:
        'numeric(14, 2) é o padrão mais seguro quando o banco também serve relatórios e consultas manuais, porque o valor é legível como está. Centavos em bigint compensam em ledger de alto volume ou quando a integração principal já fala em centavos. Em qualquer dos dois, guarde a moeda junto, nunca misture as duas representações no mesmo banco e use mais casas só para valores intermediários, como câmbio e preço unitário fracionado.',
    },
  ],
  conclusion: {
    title: 'Dinheiro exige tipo exato, regra explícita e conciliação contínua',
    description:
      'O caixa que não fecha por centavos quase nunca tem uma causa só. O tipo float introduz erro de representação, o arredondamento em lugares diferentes cria divergência com gateway e nota fiscal, e a divisão de parcelas perde centavo. A correção combina numeric ou centavos inteiros no banco, uma borda que nunca converte valor para float, arredondamento escrito no código com modo e granularidade definidos, rateio pelo maior resto e uma conciliação diária que transforma diferença em alerta. Se o seu fechamento depende de ajuste manual todo mês, eu posso revisar o modelo de dados, o fluxo de cálculo e a integração com o gateway.',
    cta: 'Revisar cálculo e conciliação financeira',
  },
  related: [
    {
      label: 'Estoque negativo: condição de corrida entre duas compras do último item',
      to: '/blog/estoque-negativo-condicao-de-corrida-entre-duas-compras-do-ultimo-item',
    },
    {
      label: 'ALTER TABLE que para a produção: a fila de locks atrás de uma migração inocente',
      to: '/blog/alter-table-que-para-a-producao-a-fila-de-locks-atras-de-uma-migracao-inocente',
    },
    {
      label: 'Integração com ERP e backoffice',
      to: '/servicos/integracao-erp-e-backoffice',
    },
  ],
};

const en = {
  intro:
    'An e-commerce October close was off by R$ 20.69. It was not much money out of R$ 2.18 million, but accounting does not accept "not much": every unexplained cent becomes a manual adjustment, and a manual adjustment every month becomes an audit question. After three days looking for refunds and fees, the cause showed up in 1 out of every 6 orders: differences of 1 or 2 cents between what the system computed and what the gateway charged. The amount column was double precision, the API summed with Number, rounding happened only on the total while the gateway rounded item by item, and installments charged 99.99 for a 100.00 purchase. This article explains why float cannot represent a cent, where to store money, how to round once and in the right place, how to split installments without losing a cent, and how to migrate a float column to numeric without hiding the difference that already exists.',
  sections: [
    {
      title: 'The books that do not balance by R$ 20.69: a small error in every order',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A closing difference is usually investigated as a process problem: an order refunded outside the system, a fee booked in the wrong place, a duplicated sale. That is why the team spent two days on the wrong hypotheses. What gave away the real cause was the shape of the difference: many orders off by 1 or 2 cents, none with a large amount. Process differences show up concentrated. Numeric representation differences show up spread out.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'There were three defects stacked together. The first was about type: double precision in the database and Number in Node, both binary floating point, neither of which represents 0.10 exactly. The second was about place: the system rounded the order total and the gateway rounded each item discount, so both reached different values even with perfect arithmetic. The third was about splitting: dividing 100.00 by three and truncating each installment loses a cent, and the customer pays less than the order records.',
        },
        {
          type: 'paragraph',
          value:
            'Only the first defect is fixed by changing the column type. The other two are business rule decisions that the code has to make explicit. That is why "replace float with decimal" alone rarely balances the books.',
        },
      ],
    },
    {
      title: 'Why float cannot store 0.10: binary floating point and the error that accumulates',
      blocks: [
        {
          type: 'paragraph',
          value:
            'real and double precision in Postgres, float and double in Java, and Number in JavaScript follow IEEE 754: the value is stored as a binary fraction. Just as 1/3 has no finite decimal representation, 1/10 has no finite binary one. The number stored for 0.1 is the closest double, slightly above 0.1. Every operation rounds again to the closest double, and the error of each step adds to the previous ones.',
        },
        {
          type: 'code',
          value: floatCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'The problem is not the display. Showing 0.30000000000000004 as 0.30 looks like a fix, but the wrong value keeps being used in the next calculation. The classic case is Math.floor(19.9 * 3 * 100): the float product lands a hair below 59.70, floor drops it to 5969 cents, and the customer is charged one cent less. Math.round(1.005 * 100) returns 100 for the same reason: 1.005 in binary is slightly less than 1.005, and rounding goes down.',
        },
        {
          type: 'paragraph',
          value:
            'There is also a subtle behavioral difference. round on float in Postgres rounds half to even, so round(2.5::float8) returns 2, while round(2.5::numeric) returns 3. A query that rounds the same field with different types, for example in a view that casts, produces different cents for the same order.',
        },
      ],
    },
    {
      title: 'Where to store money: numeric, integer cents or the money type',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There are two correct choices and one trap. numeric(p, s) stores the value in decimal, with a fixed scale, and makes addition, subtraction and multiplication exact. bigint in cents stores an integer, which is exact by definition, and leaves the scale interpretation to the application. The Postgres money type looks designed for this, but it formats and parses values according to the session lc_monetary setting and mixes data with presentation.',
        },
        {
          type: 'table',
          columns: ['Type', 'Exact', 'Strength', 'Trap', 'When to use'],
          rows: [
            ['real / double precision', 'No', 'Fast and compact', 'Representation error that accumulates in sums', 'Never for money'],
            ['money', 'Yes, with 2 fixed decimals', 'Ready made formatting', 'Depends on lc_monetary; a single currency; division returns float', 'Avoid in new systems'],
            ['numeric(14, 2)', 'Yes', 'Exact arithmetic in SQL, readable in reports', 'Driver returns a string; slower than integers in huge aggregations', 'Default for most systems'],
            ['bigint in cents', 'Yes', 'Fast, easy to serialize, no scale ambiguity', 'Implicit scale: the currency must travel with it; SQL reports divide by 100', 'High volume ledgers, gateways that speak cents'],
            ['numeric without scale or with 4+ decimals', 'Yes', 'Stores exchange rates, unit rates, intermediate interest', 'The final value must be rounded before charging', 'Rates and fractional unit prices, never the charged amount'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'In practice, numeric(14, 2) covers up to 999 billion with cents and is the safest choice for the relational model, because reports, views and ad hoc queries stay readable. Integer cents make sense when the aggregation volume is very high or when the gateway already speaks in cents, as most payment APIs do. What does not make sense is mixing: one table in cents and another in units forces a conversion on every join, and every conversion is a new place to get the scale wrong.',
        },
        {
          type: 'code',
          value: schemaCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'Two decisions in this schema prevent most divergences. The item total is a generated column, so there is no second calculation of the same value somewhere else in the code. And the currency sits next to the amount: a two decimal scale does not work for the Japanese yen, which has no cents, or for the Kuwaiti dinar, which has three decimals.',
        },
      ],
    },
    {
      title: 'Round once and in the right place: item, total and installment',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even with exact arithmetic, rounding in different places produces different results. Three items of 0.35 with a 10% discount: if the discount is computed on the total, 1.05 times 10% is 0.105, which becomes 0.11. If it is computed per item, each 0.035 becomes 0.04, and the total discount is 0.12. Neither is wrong. What is wrong is the system doing it one way while the gateway, the invoice or the ERP do it another.',
        },
        {
          type: 'list',
          items: [
            'Find out the granularity of the reference document: if the invoice rounds tax per item, the system also has to round per item and sum afterwards.',
            'Pick the rounding mode and write it in the code: half away from zero is what Postgres does for numeric and what most tax rules expect; half to even reduces bias in large sums and shows up in banking rules.',
            'Round once, at the end of every calculation that produces a charged amount. Intermediate values, such as price per gram or exchange rates, keep more decimals and only become cents in the last step.',
            'Installments and splits are not divided: they are allocated. The total is fixed and the parts must add up to exactly the total.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The module below handles the three operations without going through float: it converts a decimal string to BigInt cents, multiplies and divides with an explicit rounding mode, and splits using the largest remainder method. It only uses the standard library and fits into the project without a new dependency.',
        },
        {
          type: 'code',
          value: moneyCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'Largest remainder allocation is what prevents the 99.99. Each part gets the integer quotient, and the leftover cents are handed out, one by one, to the parts with the largest remainder, in a stable order. With equal weights, the extra cent goes to the first installment; with proportional weights, such as splitting shipping by each item value, it goes to whoever lost the most in rounding. The property that matters is testable: the parts always add up to the total.',
        },
      ],
    },
    {
      title: 'The edge of the application: driver, JSON and formatting without parseFloat',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Switching the column to numeric does not help if the value becomes a float again on the way. The Node pg driver returns numeric as a string precisely to avoid losing precision, and the most common "fix" found in projects is a setTypeParser with parseFloat, which undoes all the protection. The same happens with an ORM configured to map decimal to number, or with a frontend that receives "19.90" and calls Number(value) before multiplying by the quantity.',
        },
        {
          type: 'code',
          value: pgCode(comments.en),
        },
        {
          type: 'list',
          items: [
            'In the database: numeric with a fixed scale or bigint in cents, never float.',
            'At the API input: the amount as a decimal string ("19.90") or integer cents (1990), with format validation. A JSON number loses the guarantee before it reaches the code.',
            'In the domain: BigInt cents or a decimal library; every multiplication by a percentage goes through a function with an explicit rounding mode.',
            'At the output: a decimal string, and Intl.NumberFormat only for display, receiving the exact string.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'One code review rule catches almost every case: any parseFloat, Number(), toFixed or Math.round near a variable called amount, price, total or discount deserves a question. toFixed, in particular, is formatting, not rounding: (1.005).toFixed(2) returns "1.00".',
        },
      ],
    },
    {
      title: 'Migrating the float column to numeric without hiding the difference',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The migration has two parts: measure the damage first and change the type afterwards. Measuring matters because the conversion rounds the residues and makes the accumulated difference show up all at once in reports. If finance does not know this in advance, the first close after the migration looks like a new incident.',
        },
        {
          type: 'code',
          value: migracaoCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'ALTER COLUMN TYPE rewrites the whole table under an exclusive lock, which is only acceptable for a small table or in a maintenance window. For a large table, the safe path is to add a new numeric column, backfill it in batches, keep both in sync with a trigger while the code switches to reading the new one, and only then drop the old one. The reconciliation query at the end of the block should become a daily job: any order whose item sum does not match the charged total is an alert, not an end of month adjustment.',
        },
        {
          type: 'table',
          columns: ['Step', 'What to do', 'How to validate'],
          rows: [
            ['1. Measure', 'Count rows with residue and the accumulated difference', 'Number shared with finance before the change'],
            ['2. Fix the edge', 'Remove parseFloat and Number from the amount path', 'Tests with 1.005, 19.9 x 3 and splitting 100 into 3'],
            ['3. Change the type', 'Direct ALTER on a small table, or a new column with batched backfill', 'Row count and monthly sum equal before and after rounding'],
            ['4. Align the rule', 'Round at the same granularity as the gateway and the invoice', 'Sample of orders with identical amounts in both systems'],
            ['5. Always reconcile', 'Daily job comparing items, header and payout', 'Alert with the list of diverging orders, not a total'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can I keep double precision if I round when displaying?',
      answer:
        'No. Rounding on display hides the error, but the unrounded value keeps being used in sums, discounts, installments and reports. The error shows up precisely where nothing is displayed: in the monthly total, in the reconciliation with the gateway and in equality comparisons that fail because of a residue in the sixteenth digit.',
    },
    {
      question: 'Is numeric too slow for large tables?',
      answer:
        'For most systems, the difference is not noticeable: the cost of an order lies in I/O, indexes and network, not in summing a few numerics. In aggregations over hundreds of millions of rows, numeric is slower than bigint, and storing integer cents becomes a legitimate choice. What never pays off is trading correctness for speed by using float.',
    },
    {
      question: 'Integer cents or numeric: which one should I choose?',
      answer:
        'numeric(14, 2) is the safest default when the database also serves reports and manual queries, because the value is readable as is. bigint cents pay off in high volume ledgers or when the main integration already speaks in cents. In both cases, store the currency alongside, never mix both representations in the same database, and use extra decimals only for intermediate values such as exchange rates and fractional unit prices.',
    },
  ],
  conclusion: {
    title: 'Money needs an exact type, an explicit rule and continuous reconciliation',
    description:
      'Books that do not balance by a few cents almost never have a single cause. The float type introduces representation error, rounding in different places creates divergence with the gateway and the invoice, and splitting installments loses cents. The fix combines numeric or integer cents in the database, an edge that never converts the amount to float, rounding written in the code with a defined mode and granularity, largest remainder allocation and a daily reconciliation that turns a difference into an alert. If your monthly close depends on a manual adjustment, I can review the data model, the calculation flow and the gateway integration.',
    cta: 'Review financial calculation and reconciliation',
  },
  related: [
    {
      label: 'Negative stock: the race condition between two purchases of the last item',
      to: '/blog/estoque-negativo-condicao-de-corrida-entre-duas-compras-do-ultimo-item',
    },
    {
      label: 'The ALTER TABLE that stops production: the lock queue behind an innocent migration',
      to: '/blog/alter-table-que-para-a-producao-a-fila-de-locks-atras-de-uma-migracao-inocente',
    },
    {
      label: 'ERP and back office integration',
      to: '/servicos/integracao-erp-e-backoffice',
    },
  ],
};

const es = {
  intro:
    'El cierre de octubre de un e-commerce no cuadró por R$ 20,69. Era poco dinero frente a R$ 2,18 millones, pero contabilidad no acepta "poco": cada centavo sin explicación se convierte en un ajuste manual, y un ajuste manual todos los meses se convierte en una pregunta de auditoría. Después de tres días buscando reembolsos y comisiones, la causa apareció en 1 de cada 6 pedidos: diferencias de 1 o 2 centavos entre lo que calculaba el sistema y lo que cobraba el gateway. La columna de valor era double precision, la API sumaba con Number, el redondeo se hacía solo sobre el total mientras el gateway redondeaba ítem por ítem, y las cuotas cobraban 99,99 de una compra de 100,00. Este artículo explica por qué float no representa un centavo, dónde guardar valores monetarios, cómo redondear una sola vez y en el lugar correcto, cómo prorratear cuotas sin perder centavos y cómo migrar una columna float a numeric sin esconder la diferencia que ya existe.',
  sections: [
    {
      title: 'La caja que no cuadra por R$ 20,69: un error pequeño en cada pedido',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una diferencia de cierre suele investigarse como un problema de proceso: un pedido reembolsado por fuera, una comisión registrada en el lugar equivocado, una venta duplicada. Por eso el equipo pasó dos días en las hipótesis equivocadas. Lo que delató la causa real fue la forma de la diferencia: muchos pedidos con 1 o 2 centavos, ninguno con un valor grande. Las diferencias de proceso aparecen concentradas. Las diferencias de representación numérica aparecen dispersas.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'Había tres defectos sumados. El primero era de tipo: double precision en la base y Number en Node, ambos en punto flotante binario, que no representan 0,10 de forma exacta. El segundo era de lugar: el sistema redondeaba el total del pedido y el gateway redondeaba cada descuento de ítem, así que los dos llegaban a valores distintos incluso con aritmética perfecta. El tercero era de prorrateo: dividir 100,00 entre tres y truncar cada cuota pierde un centavo, y el cliente paga menos de lo que registra el pedido.',
        },
        {
          type: 'paragraph',
          value:
            'Solo el primer defecto se resuelve cambiando el tipo de la columna. Los otros dos son decisiones de regla de negocio que el código debe hacer explícitas. Por eso "cambiar float por decimal" por sí solo rara vez cuadra la caja.',
        },
      ],
    },
    {
      title: 'Por qué float no guarda 0,10: punto flotante binario y el error que se acumula',
      blocks: [
        {
          type: 'paragraph',
          value:
            'real y double precision en Postgres, float y double en Java y Number en JavaScript siguen IEEE 754: el valor se guarda como una fracción binaria. Así como 1/3 no tiene representación finita en decimal, 1/10 no la tiene en binario. El número guardado para 0,1 es el double más cercano, un poco por encima de 0,1. Cada operación vuelve a redondear al double más cercano, y el error de cada paso se suma al de los anteriores.',
        },
        {
          type: 'code',
          value: floatCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'El problema no es la visualización. Mostrar 0,30000000000000004 como 0,30 parece resolverlo, pero el valor incorrecto sigue usándose en el cálculo siguiente. El caso clásico es Math.floor(19.9 * 3 * 100): el producto en float queda apenas por debajo de 59,70, el floor lo baja a 5969 centavos y al cliente se le cobra un centavo de menos. Math.round(1.005 * 100) devuelve 100 por el mismo motivo: 1,005 en binario es un poco menor que 1,005, y el redondeo cae hacia abajo.',
        },
        {
          type: 'paragraph',
          value:
            'Existe además una diferencia sutil de comportamiento. round en float en Postgres redondea la mitad al par, por lo que round(2.5::float8) devuelve 2, mientras que round(2.5::numeric) devuelve 3. Una consulta que redondea el mismo campo con tipos distintos, por ejemplo en una vista que hace cast, produce centavos distintos para el mismo pedido.',
        },
      ],
    },
    {
      title: 'Dónde guardar dinero: numeric, centavos enteros o el tipo money',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Hay dos opciones correctas y una trampa. numeric(p, s) guarda el valor en base decimal, con escala fija, y hace sumas, restas y multiplicaciones exactas. bigint en centavos guarda un entero, que es exacto por definición, y deja la interpretación de la escala a la aplicación. El tipo money de Postgres parece hecho para esto, pero formatea e interpreta valores según el lc_monetary de la sesión y mezcla dato con presentación.',
        },
        {
          type: 'table',
          columns: ['Tipo', 'Exacto', 'Punto fuerte', 'Trampa', 'Cuándo usar'],
          rows: [
            ['real / double precision', 'No', 'Rápido y compacto', 'Error de representación que se acumula en las sumas', 'Nunca para valores monetarios'],
            ['money', 'Sí, con 2 decimales fijos', 'Formato listo', 'Depende de lc_monetary; una sola moneda; la división devuelve float', 'Evitar en sistemas nuevos'],
            ['numeric(14, 2)', 'Sí', 'Aritmética exacta en SQL, legible en reportes', 'El driver devuelve string; más lento que un entero en agregaciones enormes', 'Estándar para la mayoría de los sistemas'],
            ['bigint en centavos', 'Sí', 'Rápido, fácil de serializar, sin ambigüedad de escala', 'Escala implícita: la moneda debe viajar con él; el reporte SQL divide por 100', 'Ledger de alto volumen, gateways que usan centavos'],
            ['numeric sin escala o con 4+ decimales', 'Sí', 'Guarda tipo de cambio, tarifa por unidad, intereses intermedios', 'El valor final debe redondearse antes de cobrar', 'Tasas y precios unitarios fraccionados, nunca el valor cobrado'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En la práctica, numeric(14, 2) cubre hasta 999 mil millones con centavos y es la opción más segura para el modelo relacional, porque reportes, vistas y consultas ad hoc siguen siendo legibles. Los centavos enteros tienen sentido cuando el volumen de agregación es muy alto o cuando el gateway ya trabaja en centavos, como la mayoría de las APIs de pago. Lo que no tiene sentido es mezclar: una tabla en centavos y otra en unidades obliga a convertir en cada join, y cada conversión es un lugar nuevo para equivocarse con la escala.',
        },
        {
          type: 'code',
          value: schemaCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'Dos decisiones de este esquema evitan la mayoría de las divergencias. El total del ítem es una columna generada, así que no existe un segundo cálculo del mismo valor en otro lugar del código. Y la moneda queda junto al valor: una escala de dos decimales no sirve para el yen japonés, que no tiene centavos, ni para el dinar kuwaití, que tiene tres decimales.',
        },
      ],
    },
    {
      title: 'Redondear una vez y en el lugar correcto: ítem, total y cuota',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Incluso con aritmética exacta, redondear en lugares distintos produce resultados distintos. Tres ítems de 0,35 con 10% de descuento: si el descuento se calcula sobre el total, 1,05 por 10% da 0,105, que se convierte en 0,11. Si se calcula por ítem, cada 0,035 se convierte en 0,04, y el descuento total es 0,12. Ninguno de los dos está mal. Lo que está mal es que el sistema lo haga de una forma y el gateway, la factura o el ERP lo hagan de otra.',
        },
        {
          type: 'list',
          items: [
            'Averigüe la granularidad del documento de referencia: si la factura redondea el impuesto por ítem, el sistema también debe redondear por ítem y sumar después.',
            'Elija el modo de redondeo y escríbalo en el código: la mitad lejos del cero es lo que hace Postgres con numeric y lo que espera la mayoría de las reglas fiscales; la mitad al par reduce el sesgo en sumas grandes y aparece en reglas bancarias.',
            'Redondee una sola vez, al final de cada cálculo que genera un valor cobrado. Los valores intermedios, como el precio por gramo o el tipo de cambio, mantienen más decimales y solo se convierten en centavos en el último paso.',
            'Las cuotas y los prorrateos no se dividen: se asignan. El total es fijo y las partes deben sumar exactamente el total.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El módulo siguiente resuelve las tres operaciones sin pasar por float: convierte un string decimal a centavos en BigInt, multiplica y divide con un modo de redondeo explícito y prorratea con el método del mayor resto. Usa solo la biblioteca estándar y entra en el proyecto sin una dependencia nueva.',
        },
        {
          type: 'code',
          value: moneyCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'El prorrateo por mayor resto es lo que evita el 99,99. Cada parte recibe el cociente entero, y los centavos sobrantes se reparten, uno por uno, entre las partes con mayor resto, en orden estable. Con pesos iguales, el centavo extra queda en la primera cuota; con pesos proporcionales, como el prorrateo del envío por el valor de cada ítem, va a quien más perdió en el redondeo. La propiedad que importa se puede probar: la suma de las partes siempre es igual al total.',
        },
      ],
    },
    {
      title: 'El borde de la aplicación: driver, JSON y formato sin parseFloat',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cambiar la columna a numeric no sirve si el valor vuelve a ser float en el camino. El driver pg de Node devuelve numeric como string justamente para no perder precisión, y la "corrección" más común que se encuentra en los proyectos es un setTypeParser con parseFloat, que deshace toda la protección. Lo mismo ocurre con un ORM configurado para mapear decimal a number, o con un frontend que recibe "19.90" y hace Number(valor) antes de multiplicar por la cantidad.',
        },
        {
          type: 'code',
          value: pgCode(comments.es),
        },
        {
          type: 'list',
          items: [
            'En la base: numeric con escala fija o bigint en centavos, nunca float.',
            'En la entrada de la API: el valor como string decimal ("19.90") o entero en centavos (1990), con validación de formato. Un number en JSON pierde la garantía antes de llegar al código.',
            'En el dominio: BigInt en centavos o una biblioteca decimal; toda multiplicación por un porcentaje pasa por una función con modo de redondeo explícito.',
            'En la salida: un string decimal, e Intl.NumberFormat solo para mostrar, recibiendo el string exacto.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Una regla de revisión de código atrapa casi todos los casos: cualquier parseFloat, Number(), toFixed o Math.round cerca de una variable llamada valor, precio, total o descuento merece una pregunta. toFixed, en particular, es formato, no redondeo: (1.005).toFixed(2) devuelve "1.00".',
        },
      ],
    },
    {
      title: 'Migrar la columna float a numeric sin esconder la diferencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La migración tiene dos partes: medir el daño antes y cambiar el tipo después. Medir importa porque la conversión redondea los residuos y hace que la diferencia acumulada aparezca de golpe en los reportes. Si finanzas no lo sabe de antemano, el primer cierre después de la migración parece un incidente nuevo.',
        },
        {
          type: 'code',
          value: migracaoCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'ALTER COLUMN TYPE reescribe toda la tabla con un lock exclusivo, lo que solo es aceptable en una tabla pequeña o en una ventana de mantenimiento. En una tabla grande, el camino seguro es agregar una columna numeric nueva, llenarla por lotes, mantener ambas sincronizadas con un trigger mientras el código pasa a leer la nueva y solo entonces eliminar la antigua. La consulta de conciliación al final del bloque debe convertirse en un job diario: cualquier pedido cuya suma de ítems no coincide con el total cobrado es una alerta, no un ajuste de fin de mes.',
        },
        {
          type: 'table',
          columns: ['Etapa', 'Qué hacer', 'Cómo validar'],
          rows: [
            ['1. Medir', 'Contar filas con residuo y la diferencia acumulada', 'Número compartido con finanzas antes del cambio'],
            ['2. Corregir el borde', 'Quitar parseFloat y Number del camino del valor', 'Pruebas con 1.005, 19.9 x 3 y prorrateo de 100 en 3'],
            ['3. Cambiar el tipo', 'ALTER directo en tabla pequeña o columna nueva con backfill por lotes', 'Conteo de filas y suma por mes iguales antes y después del redondeo'],
            ['4. Alinear la regla', 'Redondear con la misma granularidad que el gateway y la factura', 'Muestra de pedidos con valor idéntico en ambos sistemas'],
            ['5. Conciliar siempre', 'Job diario que compara ítems, cabecera y liquidación', 'Alerta con la lista de pedidos divergentes, no un total'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Puedo seguir con double precision si redondeo al mostrar?',
      answer:
        'No. Redondear al mostrar esconde el error, pero el valor sin redondear sigue usándose en sumas, descuentos, cuotas y reportes. El error aparece justamente donde no se muestra nada: en el total del mes, en la conciliación con el gateway y en comparaciones de igualdad que fallan por un residuo en el decimosexto dígito.',
    },
    {
      question: '¿numeric es demasiado lento para tablas grandes?',
      answer:
        'Para la mayoría de los sistemas, la diferencia no se nota: el costo de un pedido está en I/O, índices y red, no en sumar algunos numeric. En agregaciones de cientos de millones de filas, numeric es más lento que bigint, y guardar centavos enteros se vuelve una opción legítima. Lo que nunca compensa es cambiar exactitud por velocidad usando float.',
    },
    {
      question: 'Centavos enteros o numeric: ¿cuál elegir?',
      answer:
        'numeric(14, 2) es el estándar más seguro cuando la base también sirve reportes y consultas manuales, porque el valor es legible tal como está. Los centavos en bigint compensan en un ledger de alto volumen o cuando la integración principal ya trabaja en centavos. En ambos casos, guarde la moneda junto al valor, nunca mezcle las dos representaciones en la misma base y use más decimales solo para valores intermedios, como tipo de cambio y precio unitario fraccionado.',
    },
  ],
  conclusion: {
    title: 'El dinero exige tipo exacto, regla explícita y conciliación continua',
    description:
      'Una caja que no cuadra por centavos casi nunca tiene una sola causa. El tipo float introduce error de representación, el redondeo en lugares distintos crea divergencias con el gateway y la factura, y la división de cuotas pierde centavos. La corrección combina numeric o centavos enteros en la base, un borde que nunca convierte el valor a float, redondeo escrito en el código con modo y granularidad definidos, prorrateo por mayor resto y una conciliación diaria que convierte la diferencia en alerta. Si su cierre depende de un ajuste manual todos los meses, puedo revisar el modelo de datos, el flujo de cálculo y la integración con el gateway.',
    cta: 'Revisar cálculo y conciliación financiera',
  },
  related: [
    {
      label: 'Stock negativo: condición de carrera entre dos compras del último ítem',
      to: '/blog/estoque-negativo-condicao-de-corrida-entre-duas-compras-do-ultimo-item',
    },
    {
      label: 'El ALTER TABLE que detiene producción: la cola de locks detrás de una migración inocente',
      to: '/blog/alter-table-que-para-a-producao-a-fila-de-locks-atras-de-uma-migracao-inocente',
    },
    {
      label: 'Integración con ERP y backoffice',
      to: '/servicos/integracao-erp-e-backoffice',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
