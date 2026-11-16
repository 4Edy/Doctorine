#!/usr/bin/env python3
"""Gera data/mapeamento/classes-dcb.json a partir da planilha "Lista DCB consolidada" (ANVISA).

Uso: python3 -I data/mapeamento/gerar-classes-dcb.py <planilha.xlsx> [saida.json]
Requer openpyxl. Guarda só os nomes cuja classificação na DCB é EXA (excipiente), HOM
(homeopático), PM (planta medicinal) ou RAD (radiofármaco), e que NÃO aparecem também como
IFA, INF ou BIO. É a única forma de um nome entrar no mapeamento "automático por classe".
"""
import json, re, sys, unicodedata
from collections import defaultdict
import openpyxl

NAO_FARMACOLOGICAS = {'EXA', 'HOM', 'PM', 'RAD'}
USADAS_COMO_FARMACO = {'IFA', 'INF', 'BIO'}


def chave(texto: str) -> str:
    s = unicodedata.normalize('NFD', texto)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', s.lower()).strip()


def main(entrada: str, saida: str) -> None:
    wb = openpyxl.load_workbook(entrada, read_only=True, data_only=True)
    classes: dict[str, set[str]] = defaultdict(set)
    historico = ''
    for linha in list(wb.worksheets[0].iter_rows(values_only=True))[2:]:
        if not linha[1] or not linha[3]:
            continue
        classes[chave(str(linha[1]))].add(str(linha[3]).strip().upper())
    itens = []
    for nome in sorted(classes):
        c = classes[nome]
        if c & USADAS_COMO_FARMACO or not c <= NAO_FARMACOLOGICAS:
            continue
        itens.append({'chave': nome, 'classe': sorted(c)[0]})
    with open(saida, 'w', encoding='utf-8') as f:
        json.dump(
            {
                'versao': 1,
                'fonte': 'DCB consolidada (ANVISA), out/2026',
                'classes': itens,
            },
            f,
            ensure_ascii=False,
            indent=0,
            separators=(',', ':'),
        )
        f.write('\n')
    print(f'{len(itens)} nomes gravados em {saida}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'data/mapeamento/classes-dcb.json')
