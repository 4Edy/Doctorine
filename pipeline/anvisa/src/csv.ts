/**
 * Leitor de CSV mínimo para os arquivos da ANVISA: separador ";", campos entre aspas (com ""
 * como aspas literais e quebras de linha dentro das aspas) e campos numéricos sem aspas.
 *
 * Não lança exceção: um registro malformado vem com `erro`, para o chamador rejeitá-lo com o
 * número da linha e seguir adiante.
 */
export interface RegistroCsv {
  /** Linha física (base 1) em que o registro começa. */
  linha: number;
  campos: string[];
  erro?: string;
}

export function lerCsv(texto: string, separador = ';'): RegistroCsv[] {
  const saida: RegistroCsv[] = [];
  let campos: string[] = [];
  let campo = '';
  let emAspas = false;
  let aspasFechadas = false;
  let linhaAtual = 1;
  let linhaInicio = 1;
  let erro: string | undefined;

  const fecharCampo = (): void => {
    campos.push(campo);
    campo = '';
    aspasFechadas = false;
  };
  const fecharRegistro = (): void => {
    fecharCampo();
    const vazio = campos.length === 1 && campos[0] === '' && erro === undefined;
    if (!vazio) {
      saida.push(
        erro === undefined ? { linha: linhaInicio, campos } : { linha: linhaInicio, campos, erro },
      );
    }
    campos = [];
    erro = undefined;
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i] as string;
    if (emAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          emAspas = false;
          aspasFechadas = true;
        }
      } else {
        if (c === '\n') linhaAtual++;
        campo += c;
      }
    } else if (c === separador) {
      fecharCampo();
    } else if (c === '\n' || (c === '\r' && texto[i + 1] === '\n')) {
      if (c === '\r') i++;
      fecharRegistro();
      linhaAtual++;
      linhaInicio = linhaAtual;
    } else if (c === '"' && campo === '' && !aspasFechadas) {
      emAspas = true;
    } else {
      if (aspasFechadas) erro ??= 'caractere inesperado depois das aspas de fechamento';
      campo += c;
    }
  }

  if (emAspas) erro = 'aspas não fechadas (arquivo cortado?)';
  if (campo !== '' || campos.length > 0 || emAspas) fecharRegistro();
  return saida;
}
