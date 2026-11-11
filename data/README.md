# data

Dados versionados no repositório.

- `reference-set/pairs.json`: conjunto de referência da farmacêutica. Formato em
  [`docs/conjunto-de-referencia.md`](../docs/conjunto-de-referencia.md).

Os arquivos brutos das fontes (ANVISA, DDInter) e a base gerada não são versionados por enquanto; a
decisão sobre incluir a base derivada foi adiada na [ADR 0004](../docs/adr/0004-finalidade-e-licencas.md).
O pipeline os escreve em `data/raw/` (downloads com manifesto) e `data/processed/` (registros,
rejeições e relatório de qualidade); as duas pastas ficam no `.gitignore`. Ver
[`pipeline/README.md`](../pipeline/README.md).
