# 0006 · Mapeamento de princípios ativos

- **Status:** Proposta (2026-11-14). Vira Aceita depois da aprovação do Edu.
- **Decisor:** Edu (com a farmacêutica nos pontos 4, 5 e 7)

## Contexto

A ANVISA nomeia o princípio ativo em português e num campo de texto livre ("atorvastatina cálcica,
ezetimiba"); o DDInter nomeia o medicamento em inglês ("Atorvastatin"). Sem uma ligação entre os
dois, nenhum medicamento brasileiro encontra suas interações. O pior erro possível aqui é
**silencioso**: ligar ao medicamento errado, ou não ligar e o app parecer dizer que está tudo bem
(o maior risco do projeto, ver o plano de fases).

O P6 deixou a camada canônica (`principio_ativo`, nomes, `mapeamento`, `medicamento_principio`)
vazia. O P7 a preenche, com revisão humana onde houver dúvida.

## Decisão

1. **Unidade de mapeamento: o componente.** O texto da ANVISA é separado em componentes (vírgula,
   ponto e vírgula e `+`; vírgula entre dígitos não separa; " e " **não** separa). A chave do
   componente é o texto sem acento, em minúsculas. Separar é do P7, e o texto original continua
   intacto em `medicamento.principio_ativo_original`.
2. **Três status, nesta precedência: decisão humana (`confirmado`) > automático > `pendente`.**
   Uma decisão sempre vence o automático. Pendente é o único status sem princípio ativo.
3. **Automático só com correspondência exata e única.** O nome em português (sem sal, ver 4) passa
   por regras de grafia (atorvastatina → atorvastatin, hidroclorotiazida → hydrochlorothiazide,
   ácido X-ico → X-ic acid, cloreto de sódio → sodium chloride, sulfato de X → X sulfate...), e só vira automático se alguma variante for **idêntica** ao nome de
   **um único** medicamento do DDInter. Duas correspondências viram "ambíguo" e pendente. As regras
   só **geram candidatas**; quem aceita é a comparação exata. A similaridade de texto (Dice sobre
   bigramas) é usada **só para sugerir** candidatos na fila, nunca para mapear.
4. **Sais: lista curta e segura.** Tiram-se só contra-íons orgânicos antes de "de" (cloridrato,
   besilato, maleato, fumarato, succinato, tartarato, valerato, propionato e afins), adjetivos de
   sal depois do nome (cálcica, sódico, potássica, magnésica) e hidratação (anidro, triidratado...).
   **Não** se tiram sulfato, fosfato, acetato, citrato, cloreto, óxido, hidróxido e carbonato: em
   "sulfato de magnésio" ou "cloreto de sódio" o sal é o medicamento, e tirá-lo trocaria a
   substância. Esses casos vão para a fila, com o sal removido apenas como sugestão. Cada sal
   tirado no automático é contado no relatório, para a farmacêutica conferir.
5. **Revisão obrigatória, mesmo parecendo casar:** componente com " e " ou "/" (pode ser mais de um),
   parênteses, concentração no texto, ou que só aparece como último componente de um texto cortado
   pela ANVISA (380 caracteres). Esses ficam pendentes até haver decisão.
6. **Texto cortado.** O último componente de um texto com o tamanho do corte **nunca é ligado**,
   nem se o nome casar, porque pode haver componentes depois do corte. O medicamento fica com
   `principio_truncado = 1` e conta como pendente.
7. **Decisões em arquivo versionado:** `data/mapeamento/decisoes.json`, com quem decidiu e quando.
   Três ações: `equivale` (aponta para um ou mais ids do DDInter), `sem-equivalente` (princípio ativo
   de verdade que o DDInter não tem; a ausência de interação passa a ser um fato da fonte) e
   `mesmo-que` (outra grafia de um componente já resolvido). Um id do DDInter inexistente **derruba a
   carga**; uma decisão para componente que sumiu dos dados só avisa. O arquivo entra na versão da
   base: mudar uma decisão muda a base, e cada versão é reproduzível a partir do repositório.
8. **Um princípio ativo por medicamento do DDInter.** Componentes que apontam para o mesmo
   medicamento do DDInter (com sal e sem sal, duas grafias, duas decisões) viram **um** princípio
   ativo; o nome em português é o decidido, ou o mais usado entre os medicamentos. Um
   `sem-equivalente` cujo nome coincide com o de um princípio ligado ao DDInter é unido a ele. Nome
   repetido entre princípios distintos vira aviso e é verificado a cada carga
   (`principiosComNomeRepetido`, deve ser 0).
9. **O medicamento sabe o que ficou sem mapear.** Três colunas novas em `medicamento` (migração
   0002): `componentes`, `componentes_pendentes` e `principio_truncado`. `componentes_pendentes > 0`
   significa que o motor (P10) só pode dizer "não verificado" para aqueles componentes, **nunca**
   "nenhuma ocorrência". Sem isso, o pendente seria invisível: ele não tem linha em
   `medicamento_principio`.
10. **Fila de revisão ordenada por impacto:** pelo número de medicamentos **ativos** que dependem do
    componente. O relatório diz quanto a cobertura sobe se os N primeiros forem resolvidos, para
    dimensionar o trabalho da farmacêutica. Saem ao lado da base: `mapeamento-fila.csv` (para
    planilha, `;` e BOM), `mapeamento-fila.json`, `mapeamento-automaticos.csv` (para conferir por
    amostragem) e `mapeamento-referencia.csv`.
11. **Conjunto de referência.** Cada nome de princípio ativo dos pares dela é procurado no mapeamento
    e classificado em confirmado, só automático, pendente ou não encontrado.
    `pnpm pipeline:base --exigir-referencia` falha enquanto algum não estiver **confirmado** (é o
    critério de conclusão da Fase 2).
12. **Sinônimos só sugerem.** Nomes diferentes para a mesma substância (paracetamol =
    acetaminophen, dipirona = metamizole, adrenalina = epinephrine...) ficam numa tabela curta que
    **só alimenta a sugestão**: o candidato aparece no topo da fila, marcado "sinônimo", e a
    farmacêutica confirma. Nunca mapeia sozinho: é um dicionário nosso, que ninguém revisou, no ponto
    mais crítico. Já a tradução regular de ânions e elementos (cloreto/chloride, sódio/sodium) entra
    nas regras de grafia, porque a comparação final continua exata.
13. **A fila volta como planilha.** `mapeamento-fila.csv` tem colunas em branco (`acao`,
    `ddinter_ids`, `como_chave`, `nome_pt`, `observacao`) e `pnpm pipeline:decisoes <csv> --revisor
"Nome"` as converte em decisões, tudo ou nada: com qualquer erro, nada é gravado. `c1`, `c2`
    ou `c3` em `ddinter_ids` significa "o candidato 1, 2 ou 3 da linha".
14. **Determinismo e versão.** A saída depende só da entrada, sem relógio e com ordem fixa. A versão
    da base passa a incluir as decisões e `VERSAO_REGRAS` (sobe quando uma regra automática muda;
    está em 2 desde a tradução de ânions).

## Alternativas consideradas

- **Dicionário português↔inglês externo (ou tradução por IA) para os nomes:** ampliaria o automático,
  mas introduz uma fonte que ninguém revisou, no ponto mais crítico. Rejeitado; um glossário
  aprovado pela farmacêutica entra como decisões `equivale`. A IA pode **sugerir** candidatos à
  fila numa fase posterior, nunca decidir.
- **Mapear por similaridade acima de um limiar:** erra de forma silenciosa em nomes parecidos
  (por exemplo, pares como "prednisona"/"prednisolona"). Rejeitado: só a correspondência exata é
  automática.
- **Tirar todos os sais:** cobre mais medicamentos, mas troca a substância em "sulfato de
  magnésio" e afins (ponto 4).
- **Guardar o pendente como linha em `medicamento_principio` com princípio nulo:** quebraria a chave
  primária e a regra "pendente nunca tem princípio". As colunas do ponto 9 dizem o mesmo sem isso.
- **Identificadores externos (ATC, DrugBank, PubChem) como ponte:** o DDInter tem DrugBank, mas a
  ANVISA não tem nenhum identificador; a ponte teria de vir de uma terceira fonte. Fica como
  melhoria, para gerar candidatos.

## Consequências

- A cobertura **não** será de 100% sem trabalho humano. O relatório mostra o número real e a fila diz
  onde mexer. Medicamentos com componente pendente aparecem como não verificados no app.
- O automático depende das regras de grafia, escritas para o português farmacêutico comum. Elas
  tendem a **perder** cobertura (mandam para a fila) em vez de ligar errado, porque a comparação
  final é exata. O risco que sobra é pequeno, mas real: um nome em inglês idêntico à grafia gerada
  pode ser, raramente, outra substância. Por isso a farmacêutica deve conferir uma amostra de
  `mapeamento-automaticos.csv`, e o relatório conta os sais tirados.
- A medida real de cobertura só sai da primeira carga com os dados reais; os números dos testes são
  sintéticos.
- Pontos que precisam da farmacêutica: 3 e 4 (o automático e a lista de sais), 5 (o que exige
  revisão) e 7 (as decisões).
- A ADR 0005 segue Proposta; os pontos dela (pior caso da gravidade, linhas repetidas por par, regra
  de medicamento ativo) continuam pendentes de confirmação e não mudam com esta.
