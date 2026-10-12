# Propostas comerciais

Modelo e design system para gerar propostas comerciais em PDF (A4) com a identidade visual do joaovictorsouza.dev.

As propostas são páginas HTML que o Chrome imprime em PDF. Nada daqui entra no build do site.

## Como criar uma proposta

```bash
npm run proposta -- nova cliente-projeto
```

Isso copia `modelo/proposta.html` para `clientes/cliente-projeto.html`. Edite o conteúdo e gere o PDF:

```bash
npm run proposta -- cliente-projeto
```

O PDF sai ao lado do HTML, em `clientes/cliente-projeto.pdf`. O comando também aceita o caminho de um arquivo (por exemplo `propostas/modelo/proposta.html`, para visualizar o modelo).

Se o gerador avisar `conteúdo cortado na(s) página(s) N`, o conteúdo passou da área útil daquela página e foi cortado no PDF. Mova uma seção para outra `.page`.

Requisitos: `npm install` feito (as fontes vêm de `node_modules/@fontsource-variable`) e Chrome ou Edge instalado. Para usar outro navegador Chromium, defina `CHROME_PATH`.

## Estrutura

| Caminho | O que é |
| --- | --- |
| `proposta.css` | Design system: tokens, tipografia e componentes |
| `proposta.js` | Insere ícones, cabeçalho, rodapé e numeração; detecta página estourada |
| `modelo/proposta.html` | Modelo de 5 páginas com todos os blocos mais usados |
| `clientes/` | Propostas reais. Fica fora do git (ver abaixo) |
| `../scripts/gerar-proposta.mjs` | Comando `npm run proposta` |

**`clientes/` está no `.gitignore`.** O repositório é público e as propostas têm nome de cliente, escopo e valores. Só o modelo é versionado.

## Estrutura padrão de uma proposta

1. **Capa:** título, resumo, um card por opção com o preço, cliente, fornecedor, emissão e validade.
2. **Objetivo e escopo:** o ganho do cliente e o que será entregue.
3. **Como funciona e prazo:** fluxo de ponta a ponta e cronograma.
4. **Investimento e condições:** formas de pagamento, custos de terceiros, incluso e não incluso.
5. **Próximos passos e aceite:** opção escolhida, local, data e assinaturas.

Com mais de uma opção para o cliente escolher, acrescente uma página de comparativo logo após o objetivo (tabela `compare`) e repita as páginas 2 a 4 para cada opção. `clientes/rentzapp-integracao-whatsapp.html` é o exemplo completo desse formato, com 7 páginas.

## Design system

### Cores

Mesmos tokens do tema escuro do site (`src/styles/globals.css` e `tailwind.config.js`).

| Token | Valor | Uso |
| --- | --- | --- |
| `--bg` | `#0a0a0c` | Fundo da página |
| `--surface` | `#111114` | Fundo dos cards |
| `--elevated` | `#18181b` | Chips, ícones e numeração |
| `--border` | `#232328` | Borda dos cards |
| `--border-soft` | `#1b1b20` | Divisórias internas |
| `--fg` | `#fafafa` | Títulos e valores |
| `--fg-2` | `#d4d4d8` | Texto corrido |
| `--muted` | `#a1a1aa` | Texto de apoio |
| `--muted-2` | `#71717a` | Notas e rodapé |
| `--accent` / `--accent-2` | `#a855f7` / `#c084fc` | Roxo da marca |
| `--cyan` | `#22d3ee` | Segunda opção, itens do cliente |
| `--green` | `#4ade80` | Economia, itens positivos |
| `--gradient` | `#8b5cf6` → `#d946ef` → `#22d3ee` | Destaque: um trecho de título e uma borda de card por página |

### Tipografia

| Família | Uso | Classes |
| --- | --- | --- |
| Space Grotesk | Títulos, preços, nomes de plano | `h1` a `h4`, `.price`, `.amount` |
| Geist | Texto corrido | `body`, `.lead`, `.small` |
| Geist Mono | Rótulos em caixa alta | `.eyebrow`, `.chip`, `.days` |

Escala: capa `h1` 50px, seção `h2` 26px, `h3` 15px, `h4` 13px, `.lead` 13.5px, corpo 12.5px, `.small` 10.5px, `.eyebrow` 9.5px. Preços usam `.tnum` (algarismos tabulares).

### Página

- Cada `<div class="page">` é uma folha A4 (210 x 297 mm) com `overflow: hidden`. O conteúdo não quebra sozinho para a página seguinte.
- A capa é `<div class="page cover">`. As demais recebem cabeçalho, rodapé e `NN / NN` automaticamente.
- O texto do cabeçalho e do rodapé vem de `<body data-rodape="Proposta comercial | Cliente">`.
- Todo o conteúdo de uma página fica dentro de `<div class="content">`, separado em `<section>`.
- `.glow` é o brilho de fundo: um ou dois por página, cor em `--c`, opacidade entre .12 e .42.

### Componentes

| Classe | O que é |
| --- | --- |
| `.eyebrow` + `.num` | Rótulo da seção: `01 / Objetivo` |
| `.grad` | Trecho de título com o gradiente da marca |
| `.lead`, `.small`, `.note` | Parágrafo de abertura, nota de rodapé e aviso com barra roxa |
| `.card`, `.card-grad` | Card padrão e card com borda em gradiente (opção recomendada) |
| `.chip` (`.accent`, `.cyan`, `.green`) | Etiqueta em caixa alta |
| `.grid-2`, `.grid-3`, `.grid-4` | Grades de cards |
| `.options-cover` + `.opt` | Cards de opção da capa, com `.price` |
| `.parties` | Cliente, fornecedor e contato no pé da capa |
| `table.compare` | Tabela comparativa entre opções |
| `.flow` + `.node` (`.hl`) + `.arrow` | Fluxo em 3 etapas |
| `.scope` + `.node-icon` | Item de escopo com ícone |
| `ul.checks` (`.cyan`) | Lista com ícone de confirmação |
| `.plan` | Card de plano com nome, valor e recursos |
| `.steps` + `.step`, `.badge-n` | Passos numerados, em lista ou em cards |
| `.weeks` + `.timeline` + `.tl` | Cronograma por semana |
| `.pay` + `.amount` + `.rows` | Card de forma de pagamento |
| `.choice` + `.box` | Opção marcável no aceite |
| `.line-field`, `.sign` | Local e data, assinaturas |

### Ícones

Lucide, em traço de 2px. Uso: `<svg class="icon"><use href="#i-NOME"/></svg>`.

Disponíveis: `check`, `check-circle`, `arrow`, `car`, `layers`, `msg`, `settings`, `send`, `webhook`, `file`, `zap`, `activity`, `book`, `shield`, `x`.

Para adicionar outro, copie os `path` do ícone em lucide.dev para o objeto `ICONS` de `proposta.js`. Não use emoji como ícone.

## Regras de texto

- Nunca usar travessão nem meia-risca. Usar hífen, vírgula ou dois-pontos.
- Valores no formato `R$ 2.850,00`. Datas no formato `DD/MM/AAAA`.
- Seções numeradas em sequência (`01`, `02`...) ao longo do documento.
- Um destaque em gradiente por título e um `.card-grad` por página.
- Deixar explícito o que não está incluso e todo custo de terceiros.
- Validade padrão: 15 dias. Garantia padrão: 90 dias. Pagamento: PIX ou transferência.

## Antes de enviar

- [ ] `NOME DO CLIENTE` trocado no `<title>`, no `data-rodape`, na capa e no aceite
- [ ] Data de emissão e validade atualizadas
- [ ] Valores conferidos: parcelas somam o total e a economia à vista bate
- [ ] Gerador terminou sem aviso de conteúdo cortado
- [ ] PDF aberto e conferido página por página
