import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ErroTraducao } from './erro.js';
import { lerEntradaCompleta } from './entrada.js';
import { lerGlossario } from './glossario.js';
import { Memoria } from './memoria.js';
import { criarProtetor } from './protecao.js';
import {
  aplicarTraducoes,
  lerRespostaJson,
  MODELO_PADRAO,
  montarLote,
  PROVEDORES,
  type Provedor,
  pendentes,
  TAMANHO_LOTE_PADRAO,
  traduzirLoteViaApi,
  type ResultadoAplicacao,
} from './rascunho.js';
import { resumir, resumoEmMarkdown } from './resumo.js';
import {
  extrairUnidades,
  NOMES_PRIORIDADE,
  versaoDasUnidades,
  type UnidadeTexto,
} from './textos.js';
import { temErro, validarTraducao } from './validar.js';

const AJUDA = `Uso: pnpm pipeline:traducao <comando> [opções]

Comandos:
  glossario               confere data/traducao/glossario.json (não precisa dos dados; roda na CI)
  extrair                 lista os textos distintos em data/processed/traducao/<versão>/unidades.jsonl
  status                  situação por gravidade: sem tradução, não revisado, revisado, corrigido
  exportar                grava lotes em data/traducao/lotes/ para traduzir fora (por exemplo, no chat)
  importar <arquivo>      valida e grava traduções de um lote traduzido ([{id, pt}] ou {itens: [...]})
  rascunhar               traduz por uma API de modelo (Anthropic, Gemini, Groq...); retomável, mais grave primeiro
  validar                 confere toda a memória contra o glossário e os marcadores (sai com 1 se houver erro)
  comparar                grava data/traducao/comparacao.md com inglês e português lado a lado (--limite n, padrão 20)
  mostrar <id>            mostra um texto com nomes restaurados e o histórico

Opções:
  --raiz <pasta>          raiz do repositório (padrão: pasta atual)
  --lote <n>              textos por lote (padrão ${TAMANHO_LOTE_PADRAO})
  --limite <n>            máximo de textos nesta execução (exportar: padrão 1 lote; rascunhar: padrão todos)
  --provedor <nome>       rascunhar: anthropic (padrão), gemini, groq, cerebras, openrouter, github, mistral, openai
  --chave-env <NOME>      rascunhar: variável de ambiente com a chave (padrão por provedor)
  --pausa <ms>            rascunhar: espera entre lotes (planos gratuitos limitam pedidos por minuto)
  --url <endereço>        rascunhar: endereço base de outra API compatível com chat/completions
  --modelo <nome>         rascunhar: modelo da API (padrão ${MODELO_PADRAO}); importar: rótulo gravado (padrão "manual")
  --site/--manejo/--pares/--ddinter <versão>   versões das saídas processadas
`;

const hoje = (): string => new Date().toISOString().slice(0, 10);

interface Contexto {
  raiz: string;
  glossarioPath: string;
  memoria: Memoria;
}

function carregarUnidades(
  raiz: string,
  v: {
    site?: string | undefined;
    manejo?: string | undefined;
    pares?: string | undefined;
    ddinter?: string | undefined;
  },
) {
  const e = lerEntradaCompleta(raiz, {
    ...(v.site ? { site: v.site } : {}),
    ...(v.manejo ? { manejo: v.manejo } : {}),
    ...(v.pares ? { pares: v.pares } : {}),
    ...(v.ddinter ? { ddinter: v.ddinter } : {}),
  });
  return { unidades: extrairUnidades(e.textos), protetor: criarProtetor(e.nomes), entrada: e };
}

function mostrarResultado(r: ResultadoAplicacao): void {
  console.log(
    `gravados: ${r.gravados}; rejeitados: ${r.rejeitados.length}; sem tradução na resposta: ${r.faltando.length}; ids desconhecidos: ${r.desconhecidos.length}; com aviso: ${r.avisos.length}`,
  );
  for (const x of r.rejeitados.slice(0, 10)) {
    console.log(`  rejeitado ${x.id}: ${x.problemas.map((p) => p.detalhe).join('; ')}`);
  }
}

export async function executar(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      raiz: { type: 'string' },
      lote: { type: 'string' },
      limite: { type: 'string' },
      modelo: { type: 'string' },
      provedor: { type: 'string' },
      url: { type: 'string' },
      'chave-env': { type: 'string' },
      pausa: { type: 'string' },
      site: { type: 'string' },
      manejo: { type: 'string' },
      pares: { type: 'string' },
      ddinter: { type: 'string' },
      ajuda: { type: 'boolean', short: 'h' },
    },
  });
  const [comando, arg] = positionals;
  if (values.ajuda || comando === undefined) {
    console.log(AJUDA);
    return comando === undefined && !values.ajuda ? 2 : 0;
  }
  const raiz = resolve(values.raiz ?? process.env['INIT_CWD'] ?? process.cwd());
  const ctx: Contexto = {
    raiz,
    glossarioPath: join(raiz, 'data', 'traducao', 'glossario.json'),
    memoria: new Memoria(join(raiz, 'data', 'traducao', 'memoria.jsonl')),
  };
  const tamanhoLote = values.lote === undefined ? TAMANHO_LOTE_PADRAO : Number(values.lote);
  if (!Number.isInteger(tamanhoLote) || tamanhoLote < 1) {
    throw new ErroTraducao('--lote precisa ser um inteiro positivo');
  }
  const limite = values.limite === undefined ? undefined : Number(values.limite);
  if (limite !== undefined && (!Number.isInteger(limite) || limite < 1)) {
    throw new ErroTraducao('--limite precisa ser um inteiro positivo');
  }

  const g = lerGlossario(ctx.glossarioPath);
  if (comando === 'glossario') {
    const aprovados = g.termos.filter((t) => t.status === 'aprovado').length;
    console.log(
      `glossário v${g.versao} (${g.id}): ${g.termos.length} termos, ${aprovados} aprovados, ${g.termos.length - aprovados} propostos`,
    );
    return 0;
  }

  const { unidades, protetor, entrada } = carregarUnidades(raiz, values);

  switch (comando) {
    case 'extrair': {
      const v = versaoDasUnidades(unidades);
      const pasta = join(raiz, 'data', 'processed', 'traducao', v);
      mkdirSync(pasta, { recursive: true });
      writeFileSync(
        join(pasta, 'unidades.jsonl'),
        unidades.map((u) => JSON.stringify(u)).join('\n') + '\n',
      );
      console.log(`${unidades.length} textos distintos → ${pasta}/unidades.jsonl`);
      console.log(`fontes: ${JSON.stringify(entrada.versoes)}`);
      return 0;
    }
    case 'status': {
      console.log(resumoEmMarkdown(resumir(unidades, ctx.memoria)));
      return 0;
    }
    case 'exportar': {
      const fila = pendentes(unidades, ctx.memoria);
      const maximo = limite ?? tamanhoLote;
      const pasta = join(raiz, 'data', 'traducao', 'lotes');
      mkdirSync(pasta, { recursive: true });
      let n = existsSync(pasta)
        ? readdirSync(pasta).filter((f) => /^lote-\d+\.json$/.test(f)).length
        : 0;
      const escolhidos = fila.slice(0, maximo);
      for (let k = 0; k < escolhidos.length; k += tamanhoLote) {
        const lote = montarLote(escolhidos.slice(k, k + tamanhoLote), protetor, g);
        n++;
        const nome = `lote-${String(n).padStart(4, '0')}.json`;
        writeFileSync(join(pasta, nome), JSON.stringify(lote, null, 2) + '\n');
        console.log(`${nome}: ${lote.itens.length} textos`);
      }
      console.log(`pendentes: ${fila.length}; exportados: ${escolhidos.length}`);
      return 0;
    }
    case 'importar': {
      if (arg === undefined) throw new ErroTraducao('importar precisa do caminho do arquivo');
      // caminho relativo vale a partir de onde o comando foi digitado (a raiz), não da pasta do pacote
      const arquivo = resolve(raiz, arg);
      if (!existsSync(arquivo)) throw new ErroTraducao(`arquivo não encontrado: ${arquivo}`);
      const traducoes = lerRespostaJson(readFileSync(arquivo, 'utf8'));
      const porId = new Map(unidades.map((u) => [u.id, u]));
      const usadas = traducoes.flatMap((t) =>
        t.id !== undefined && porId.has(t.id) ? [porId.get(t.id) as UnidadeTexto] : [],
      );
      const lote = montarLote(usadas, protetor, g);
      // a posição `i` do arquivo não vale aqui: o vínculo é sempre pelo id
      const r = aplicarTraducoes(
        lote,
        traducoes.filter((t) => t.id !== undefined).map((t) => ({ id: t.id as string, pt: t.pt })),
        ctx.memoria,
        g,
        { modelo: values.modelo ?? 'manual', data: hoje() },
      );
      const semId = traducoes.length - traducoes.filter((t) => t.id !== undefined).length;
      if (semId > 0) console.log(`ignorados ${semId} item(ns) sem "id" (importar liga só por id)`);
      ctx.memoria.gravar();
      mostrarResultado(r);
      return r.rejeitados.length > 0 || r.desconhecidos.length > 0 ? 1 : 0;
    }
    case 'rascunhar': {
      const provedor = (values.provedor ?? 'anthropic') as Provedor;
      if (!PROVEDORES.includes(provedor)) {
        throw new ErroTraducao(`--provedor deve ser um de: ${PROVEDORES.join(', ')}`);
      }
      const nomeChave =
        values['chave-env'] ??
        (provedor === 'anthropic'
          ? 'ANTHROPIC_API_KEY'
          : provedor === 'gemini'
            ? 'GEMINI_API_KEY'
            : 'LLM_API_KEY');
      const chave = process.env[nomeChave];
      if (chave === undefined || chave === '') {
        throw new ErroTraducao(`defina ${nomeChave} (ou use exportar/importar)`);
      }
      const pausa = values.pausa === undefined ? 0 : Number(values.pausa);
      if (!Number.isFinite(pausa) || pausa < 0)
        throw new ErroTraducao('--pausa precisa ser um número de ms');
      const modelo = values.modelo ?? (provedor === 'anthropic' ? MODELO_PADRAO : undefined);
      const fila = pendentes(unidades, ctx.memoria).slice(0, limite ?? Infinity);
      let gravados = 0;
      let rejeitados = 0;
      for (let k = 0; k < fila.length; k += tamanhoLote) {
        if (k > 0 && pausa > 0) await new Promise((r) => setTimeout(r, pausa));
        const lote = montarLote(fila.slice(k, k + tamanhoLote), protetor, g);
        const resposta = await traduzirLoteViaApi(lote, {
          chave,
          provedor,
          ...(modelo !== undefined ? { modelo } : {}),
          ...(values.url !== undefined ? { url: values.url } : {}),
        });
        let r: ResultadoAplicacao;
        try {
          r = aplicarTraducoes(lote, lerRespostaJson(resposta), ctx.memoria, g, {
            modelo: `${provedor}:${modelo ?? ''}`,
            data: hoje(),
          });
        } catch (e) {
          if (!(e instanceof ErroTraducao)) throw e;
          // resposta que não é JSON: o lote volta a ser pendente e a execução continua
          console.log(`lote ${k / tamanhoLote + 1}: ${e.message}; lote descartado`);
          continue;
        }
        ctx.memoria.gravar(); // cada lote é gravado ao terminar: pode interromper e retomar
        gravados += r.gravados;
        rejeitados += r.rejeitados.length;
        console.log(
          `lote ${k / tamanhoLote + 1}: gravados ${r.gravados}, rejeitados ${r.rejeitados.length}`,
        );
      }
      console.log(
        `total: gravados ${gravados}, rejeitados ${rejeitados} (rejeitados voltam na próxima execução)`,
      );
      return 0;
    }
    case 'validar': {
      const porId = new Map(unidades.map((u) => [u.id, u]));
      let erros = 0;
      let avisos = 0;
      for (const e of ctx.memoria.todos()) {
        const u = porId.get(e.id);
        if (u === undefined) continue; // órfão: aparece no status
        const p = validarTraducao(protetor.proteger(u.en).texto, e.pt, g);
        if (temErro(p)) {
          erros++;
          console.log(`erro ${e.id}: ${p.map((x) => x.detalhe).join('; ')}`);
        } else if (p.length > 0) avisos++;
      }
      const sem = unidades.filter((u) => ctx.memoria.estado(u.id) === undefined).length;
      console.log(
        `textos: ${unidades.length}; sem tradução: ${sem}; com erro: ${erros}; com aviso: ${avisos}`,
      );
      return erros > 0 ? 1 : 0;
    }
    case 'comparar': {
      const caminhoNomes = join(raiz, 'data', 'traducao', 'nomes-pt.json');
      const nomesPt = existsSync(caminhoNomes)
        ? new Map(
            Object.entries(
              JSON.parse(readFileSync(caminhoNomes, 'utf8')) as Record<string, string>,
            ),
          )
        : undefined;
      const porId = new Map(unidades.map((u) => [u.id, u]));
      const eventos = [...ctx.memoria.todos()]
        .filter((e) => porId.has(e.id))
        .slice(-(limite ?? 20));
      const partes = ['# Comparação inglês × português', ''];
      for (const e of eventos) {
        const u = porId.get(e.id) as UnidadeTexto;
        const prot = protetor.proteger(u.en);
        partes.push(
          `## ${e.id} (${NOMES_PRIORIDADE[u.prioridade]}, ${e.status}, ${e.modelo ?? 'revisão'})`,
          '',
          `**EN:** ${u.en}`,
          '',
          `**PT:** ${protetor.restaurar(e.pt, prot.marcas, nomesPt)}`,
          '',
        );
      }
      const saidaMd = join(raiz, 'data', 'traducao', 'comparacao.md');
      writeFileSync(saidaMd, partes.join('\n'));
      console.log(`${eventos.length} textos → ${saidaMd}`);
      return 0;
    }
    case 'mostrar': {
      if (arg === undefined) throw new ErroTraducao('mostrar precisa do id do texto');
      const u = unidades.find((x) => x.id === arg);
      if (u === undefined) throw new ErroTraducao(`texto ${arg} não encontrado`);
      const caminhoNomes = join(raiz, 'data', 'traducao', 'nomes-pt.json');
      const nomesPt = existsSync(caminhoNomes)
        ? new Map(
            Object.entries(
              JSON.parse(readFileSync(caminhoNomes, 'utf8')) as Record<string, string>,
            ),
          )
        : undefined;
      const prot = protetor.proteger(u.en);
      console.log(`EN: ${u.en}`);
      for (const e of ctx.memoria.historico(u.id)) {
        console.log(
          `v${e.seq} [${e.status}, ${e.origem}, ${e.data}]: ${protetor.restaurar(e.pt, prot.marcas, nomesPt)}`,
        );
      }
      console.log(
        `usos: ${u.usos
          .map((x) => `${x.tipo}/${x.chave}/${x.nivel}`)
          .slice(0, 8)
          .join(', ')}`,
      );
      return 0;
    }
    default:
      console.error(`comando desconhecido: ${comando}\n`);
      console.log(AJUDA);
      return 2;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  executar(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      console.error(e instanceof ErroTraducao ? `erro: ${e.message}` : e);
      process.exit(1);
    },
  );
}
