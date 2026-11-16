import { chaveDe } from './normalizar.js';

/**
 * Contra-íons orgânicos que, antes de "de", indicam só o sal ou éster de um princípio ativo
 * ("cloridrato de metformina" é metformina). Lista curta de propósito: "sulfato de magnésio",
 * "cloreto de sódio" e "acetato de cálcio" SÃO o medicamento, e tirar o prefixo os trocaria por
 * outra substância. Esses casos vão para a revisão, com o sal removido só como sugestão.
 */
export const SAIS_SEGUROS = [
  'cloridrato',
  'dicloridrato',
  'bromidrato',
  'besilato',
  'mesilato',
  'maleato',
  'fumarato',
  'hemifumarato',
  'succinato',
  'tartarato',
  'hemitartarato',
  'valerato',
  'propionato',
  'dipropionato',
] as const;

/** Prefixos que só valem como sugestão na fila de revisão, nunca no mapeamento automático. */
export const SAIS_AMBIGUOS = [
  'sulfato',
  'fosfato',
  'acetato',
  'citrato',
  'nitrato',
  'lactato',
  'gluconato',
  'carbonato',
  'benzoato',
  'estearato',
  'palmitato',
] as const;

/** Adjetivos de sal depois do nome ("atorvastatina cálcica", "diclofenaco sódico"). */
const ADJETIVOS = [
  'calcica',
  'calcico',
  'sodica',
  'sodico',
  'potassica',
  'potassico',
  'magnesica',
  'magnesico',
];

/** Hidratação, que não muda o princípio ativo. */
const HIDRATACAO = [
  'anidro',
  'anidra',
  'hidratado',
  'hidratada',
  'monoidratado',
  'monoidratada',
  'diidratado',
  'diidratada',
  'di-hidratado',
  'di-hidratada',
  'triidratado',
  'triidratada',
  'tri-hidratado',
  'tri-hidratada',
  'hemi-hidratado',
  'hemi-hidratada',
  'hemiidratado',
  'hemiidratada',
  'sesqui-hidratado',
  'sesqui-hidratada',
  'sesquiidratado',
  'sesquiidratada',
  'penta-hidratado',
  'penta-hidratada',
  'pentaidratado',
  'pentaidratada',
  'hexa-hidratado',
  'hexa-hidratada',
  'hexaidratado',
  'hexaidratada',
];

/**
 * "diclofenaco de sódio" é diclofenaco. Só vale quando o que sobra NÃO parece um ânion
 * ("cloreto de sódio", "bicarbonato de sódio" e "valproato de sódio" não perdem o "de sódio":
 * o primeiro é o medicamento e os outros vão para a revisão, com a grafia como sugestão).
 */
const CONTRA_IONS_DE = ['de sodio', 'de potassio'];
const PARECE_ANION = /(ato|eto|ito|ido)$/;

export interface SemSal {
  /** Chave sem os sais e hidratos tirados. */
  chave: string;
  /** Quantos caracteres saíram do início e do fim da chave (para aplicar ao texto original). */
  cortaInicio: number;
  cortaFim: number;
  /** O que foi tirado, em palavras ("cloridrato de", "cálcica"). */
  regras: string[];
}

function tirar(chave: string, prefixos: readonly string[]): SemSal {
  let atual = chave;
  let inicio = 0;
  let fim = 0;
  const regras: string[] = [];
  // hidratação e adjetivo, do fim para o começo
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const sufixo of [...HIDRATACAO, ...ADJETIVOS, ...CONTRA_IONS_DE]) {
      if (atual.endsWith(` ${sufixo}`) && atual.length > sufixo.length + 1) {
        if (CONTRA_IONS_DE.includes(sufixo)) {
          const resto = atual.slice(0, -(sufixo.length + 1)).split(' ');
          if (resto.length !== 1 || PARECE_ANION.test(resto[0] as string)) continue;
        }
        atual = atual.slice(0, -(sufixo.length + 1));
        fim += sufixo.length + 1;
        regras.push(`sufixo "${sufixo}"`);
        mudou = true;
        break;
      }
    }
  }
  for (const prefixo of prefixos) {
    const marca = `${prefixo} de `;
    if (atual.startsWith(marca) && atual.length > marca.length) {
      atual = atual.slice(marca.length);
      inicio += marca.length;
      regras.push(`prefixo "${prefixo} de"`);
      break;
    }
  }
  return { chave: atual, cortaInicio: inicio, cortaFim: fim, regras };
}

/** Tira só o que é seguro tirar. É o que o mapeamento automático usa. */
export const removerSal = (chave: string): SemSal => tirar(chave, SAIS_SEGUROS);

/** Tira também os prefixos ambíguos. Só serve para sugerir candidatos à revisão. */
export const removerSalComoSugestao = (chave: string): SemSal =>
  tirar(chave, [...SAIS_SEGUROS, ...SAIS_AMBIGUOS]);

/**
 * Aplica ao texto original (com acento) o mesmo corte feito na chave. As duas têm o mesmo
 * comprimento (tirar acento troca um caractere por um); se não tiverem, devolve a chave.
 */
export function nomeSemSal(texto: string, s: SemSal): string {
  const minusculo = texto.toLowerCase().replace(/\s+/g, ' ').trim();
  if (chaveDe(minusculo).length !== minusculo.length) return s.chave;
  return minusculo.slice(s.cortaInicio, minusculo.length - s.cortaFim);
}
