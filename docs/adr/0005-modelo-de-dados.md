# 0005 · Modelo de dados e carga

- **Status:** Proposta (2026-11-14). Vira Aceita depois da aprovação do Edu.
- **Decisor:** Edu

## Contexto

O P6 leva as saídas processadas da ANVISA e do DDInter (P4 e P5) para um arquivo SQLite versionado,
o mesmo que o app embarca (ADR 0003). O esquema completo está em
[`docs/modelo-de-dados.md`](../modelo-de-dados.md); aqui ficam as decisões que mudam o resultado
clínico ou são difíceis de desfazer.

## Decisão

1. **Três camadas.** Proveniência (`fonte_versao`, `meta`); dados das fontes como vieram, já
   validados (`medicamento`, `ddinter_*`); e a camada canônica (`principio_ativo`, nomes,
   `mapeamento`, `medicamento_principio`), que **existe desde a primeira migração mas fica vazia**
   até o P7. Nada da camada das fontes é traduzido nem reescrito: o inglês do DDInter fica em
   colunas `*_en`.
2. **Gravidade padronizada.** Cinco valores gravados: `contraindicada`, `grave`, `moderada`, `leve`
   e `indeterminada`. "Nenhuma ocorrência" **não é valor de linha**: é o resultado de uma consulta
   sem registro. Conversão do DDInter: Major → grave, Moderate → moderada, Minor → leve, Unknown →
   indeterminada. O DDInter não tem "contraindicada", então nenhuma conversão a produz. A
   classificação original de cada fonte é gravada ao lado.
3. **Pior caso.** Quando o par está no site e nos 8 CSVs com níveis diferentes (14 casos nos dados
   de 2026-11-13), vale o mais grave; os dois níveis originais ficam gravados. O mesmo vale para
   pares do site em que o nível do par difere do nível do texto (118 casos): a gravidade é a do par.
4. **Pares: união das fontes, todas as linhas mantidas.** Uma linha por par do site
   (`id_par_site` + `id_texto`) e uma por par que só os CSVs têm (sem texto, `Unknown`). Os 7.330
   pares de medicamentos que têm mais de um id de par no site **ficam com todas as linhas**: não
   sabemos por que o site os repete, e escolher uma seria apagar informação. Quem decide como
   mostrar é o motor (P10).
5. **Manejo e referências pertencem ao texto**, não ao par (conferido em 50 de 50 amostras), e ficam
   em `ddinter_texto`. A tradução (P8) entra numa tabela própria, com status, sem alterar o original.
6. **Medicamento da ANVISA: um por número de registro.** O arquivo repete o mesmo número com situação
   `Ativo` e `Inativo`; a carga junta as linhas, `ativo` vale 1 se alguma linha for ativa, e os campos
   vêm da linha ativa (ou da primeira). O relatório de carga mostra quais campos diferiam entre as
   linhas juntadas. A regra "ativo se alguma linha for ativa" era uma proposta da documentação da
   fonte e **ainda precisa da confirmação da farmacêutica**. Registros sem número (baixo risco) ficam
   um por linha.
7. **Alternativas** só existem para o par que cada texto leu (as dos demais pares não foram
   coletadas) e guardam apenas identificadores.
8. **Busca por nome com FTS5**, sem acento e sem diferença de maiúsculas, em tabelas de conteúdo
   externo reconstruídas no fim da carga (a base é entregue só para leitura, sem gatilhos).
9. **Migrações SQL versionadas**, geradas pelo Drizzle a partir do esquema (a da busca é escrita à
   mão, porque o Drizzle não descreve tabelas virtuais). Um executor próprio, de poucas linhas, as
   aplica e guarda o checksum de cada uma; uma migração já aplicada que mude derruba a execução. O
   mesmo SQL serve ao app (P13) com o driver do Expo.
10. **Determinismo.** A mesma entrada gera o mesmo arquivo, byte a byte (sem relógio, linhas em ordem
    fixa, `VACUUM` no fim). A versão da base depende só das versões das fontes. A carga para se uma
    conta não fechar: cada item lido vira uma linha gravada ou um descarte com motivo.

## Alternativas consideradas

- **Uma tabela só para todos os tipos de interação:** as colunas são muito diferentes (alimento e
  doença não têm par nem texto compartilhado); ficaria cheia de nulos e de regras escondidas.
- **Referências em tabela própria:** 77 mil referências que ninguém consulta separadamente; uma
  lista JSON por texto basta. Reabrir se o app precisar buscar por referência.
- **Escolher uma linha por par de medicamentos já na carga:** simplifica o motor, mas decide sem
  critério conhecido (ponto 4).
- **Drizzle também na carga em massa:** o Drizzle define o esquema e gera as migrações; a carga usa
  comandos preparados do próprio SQLite, que são mais simples e rápidos para 250 mil linhas. O
  motor e o app podem usar o Drizzle nas consultas.

## Consequências

- A camada canônica vazia significa que, até o P7, nada liga um medicamento brasileiro a um
  medicamento do DDInter. O relatório de carga e o plano deixam isso explícito.
- O tamanho do arquivo com os dados reais ainda não foi medido: com textos sintéticos do tamanho
  esperado, a carga leva cerca de 6 s e gera cerca de 40 MB. O número que vale sai da primeira carga
  real e alimenta o teste de decisão da ADR 0003.
- Ninguém deve interpretar `indeterminada` como "leve": o app mostra "Não determinada".
- Os pontos 3, 4 e 6 são decisões clínicas ou de dados que a farmacêutica deveria ver antes do P10.
