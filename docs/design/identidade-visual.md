# Identidade visual "Botanical Clinical" (P3)

Resultado da revisão do protótipo exportado do Lovable (2026-11-12). Os tokens aprovados estão em
[`packages/design-tokens`](../../packages/design-tokens) e são a fonte única para o app (P13).
O protótipo em si **não entra no repositório**: é referência visual, e o app será refeito em Expo.

## Marca

- **Logo em uso:** "D" serifado em ameixa com folha verde e nós moleculares. Lê bem em 24 a 48 px
  e carrega as duas ideias do produto (botânica e farmacologia). Recomendado como marca principal.
- **Alternativa não usada:** hexágono molecular com broto. É mais genérico ("app de química") e
  perde nitidez em tamanho pequeno. Guardar só como variante para ilustração.
- Os dois arquivos são PNG de 1024 px com fundo transparente. Para o app, falta exportar em SVG
  (ou PNGs nos tamanhos de ícone adaptativo do Android) antes do P13.
- **Tipografia:** Cormorant Garamond só para a marca e títulos de tela de abertura; Manrope para
  toda a interface. No app, as fontes precisam ser **empacotadas** (o protótipo as carrega do
  Google Fonts, o que não funciona offline, contra o ADR 0003).

## Telas revisadas

Abertura, onboarding, Início, Nova análise (medicamentos). As telas Resultado, Detalhe, Histórico,
Relatório e Fontes foram revisadas pelo código, não em captura de tela.

### O que está bom e deve ser mantido

- Gravidade comunicada por **ícone + texto + cor**, nunca só cor; "nenhuma ocorrência" com borda
  tracejada e o aviso fixo "Isso não significa que a combinação seja segura".
- Selo "Exemplo ilustrativo" em todo dado de demonstração; selo de tradução revisada ou não.
- Alvos de toque de 48 dp, `prefers-reduced-motion`, rótulos de campo para leitor de tela.
- Contraste de texto acima de AA em todos os pares de marca, gravidade e estado de dado.

### Ajustes feitos nos tokens

| Achado no protótipo                                                                        | Ajuste                                                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Borda de campos e botões secundários usava `roseGray` (1,5:1), abaixo de 3:1 (WCAG 1.4.11) | Novo token `borderStrong` (#8C8190, 3,6:1). `roseGray` só decorativo.      |
| Comentário dizia 5,3:1 para a cor de ação com texto branco                                 | Corrigido para 5,2:1 (medido); teste automático garante ≥ 4,5:1.           |
| Cor de ação como texto sobre `blush` dá 4,4:1 (reprova AA)                                 | Regra: texto na cor de ação só sobre ivory ou branco. Em teste.            |
| Sombras em string CSS e fontes em pilha CSS, não funcionam no React Native                 | `shadows.*.native` e `typography.fontFamilyNative` (uma família por peso). |
| Contraste e ordem de gravidade só checados por inspeção                                    | 12 testes em `packages/design-tokens` rodam na CI.                         |

### Pendências para o P13 (corrigir ao refazer as telas no Expo)

1. Rótulos de 12 px (resumo por gravidade) e 13 px (selos de estado). Mínimo de 14 px
   (`typography.size.caption`).
2. Barra inferior com botão central "Analisar" sobrepõe o fim do conteúdo na Início (a lista
   "Consultados recentemente" fica parcialmente atrás). Reservar espaço inferior.
3. Indicador de etapas da Nova análise quebra "1." e "Medicamentos" em duas linhas.
4. O bloco `.dark` do protótipo é resto do template (azul-ardósia), fora da marca. Não portar;
   modo escuro fica fora da v1.
5. Saudação "Dra. Farmacêutica" é texto fixo de demonstração.

## Decisão pendente do Edu

**Escala de gravidade.** Em 2026-11-10 a escala aprovada tinha quatro níveis: contraindicada, grave,
moderada, leve. O protótipo **junta "contraindicada" e "grave"** num único rótulo ("Grave ou
contraindicada") e acrescenta "não determinada" e "nenhuma ocorrência". Os dois extras fazem
sentido (a base pode não classificar um par; ausência de dado não é segurança). A fusão é que
diverge: contraindicada ("não usar junto") é uma conduta diferente de grave ("usar com monitoramento").
Os tokens ficaram como no protótipo (5 níveis, `grave` único) **até a decisão**; separar custa
só uma entrada nova em `severity`.
