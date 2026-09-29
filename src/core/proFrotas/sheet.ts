import * as XLSX from 'xlsx'
import { parseDate, parseMoney } from '../bankReconciliation/money'
import { cellText, normalizeText } from '../bankReconciliation/text'
import type { SheetLine } from '../../types/proFrotas'

/**
 * Leitura da planilha "Relatório Detalhamento da Cobrança" da Pro Frotas.
 * As colunas são achadas pelo título: a posição já mudou entre versões do relatório
 * (o app antigo guardava letras fixas — F/AL/AQ numa versão, H/AO/AT na seguinte).
 */

export interface ProFrotasSheet {
  sheetName: string
  rows: unknown[][]
  // Linha do Excel (base 1) de rows[0]
  firstRow: number
}

type Field = 'note' | 'series' | 'stationCnpj' | 'stationName' | 'companyCnpj' | 'companyName' | 'fuelDate' | 'amount'

const HEADERS: Record<Field, string[]> = {
  note: ['numero da nota fiscal', 'numero nota fiscal', 'nota fiscal'],
  series: ['numero de serie', 'serie'],
  stationCnpj: ['cnpj do posto', 'cnpj posto'],
  stationName: ['nome do posto', 'posto'],
  companyCnpj: ['cnpj da empresa', 'cnpj empresa'],
  companyName: ['empresa', 'nome da empresa'],
  fuelDate: ['data abastecimento', 'data do abastecimento', 'data de abastecimento'],
  amount: ['valor no boleto', 'valor do boleto'],
}

const REQUIRED: Field[] = ['note', 'stationCnpj', 'companyCnpj', 'fuelDate', 'amount']

const REQUIRED_LABEL: Record<string, string> = {
  note: 'Número da Nota Fiscal',
  stationCnpj: 'CNPJ do Posto',
  companyCnpj: 'CNPJ da Empresa',
  fuelDate: 'Data Abastecimento',
  amount: 'Valor no Boleto',
}

// O título costuma estar na 1ª linha; a busca vai um pouco além por segurança
const HEADER_SEARCH_ROWS = 15

/** Todas as abas com as linhas em branco preservadas: o índice vira a linha do Excel */
export function readProFrotasWorkbook(data: ArrayBuffer | Uint8Array): ProFrotasSheet[] {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(data, { type: 'array', cellDates: false })
  } catch {
    throw new Error('Não foi possível ler a planilha. Verifique se o arquivo está corrompido.')
  }
  return (workbook.SheetNames ?? []).map((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const ref = sheet['!ref']
    return {
      sheetName,
      rows: ref ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true }) : [],
      firstRow: ref ? XLSX.utils.decode_range(ref).s.r + 1 : 1,
    }
  })
}

/** Só dígitos; CNPJ que o Excel guardou como número perde o zero à esquerda e volta a ter 14 */
export function cnpjDigits(value: unknown): string {
  const digits = cellText(value).replace(/\D/g, '')
  return digits.length >= 12 && digits.length < 14 ? digits.padStart(14, '0') : digits
}

function findColumns(rows: unknown[][]): { headerIndex: number; columns: Partial<Record<Field, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_ROWS); i++) {
    const cells = (rows[i] ?? []).map((c) => normalizeText(cellText(c)))
    const columns: Partial<Record<Field, number>> = {}
    for (const field of Object.keys(HEADERS) as Field[]) {
      const index = cells.findIndex((c) => HEADERS[field].includes(c))
      if (index >= 0) columns[field] = index
    }
    if (REQUIRED.every((f) => columns[f] !== undefined)) return { headerIndex: i, columns }
  }
  return null
}

/** Colunas obrigatórias que faltam na linha de título mais completa entre todas as abas */
function missingColumns(sheets: ProFrotasSheet[]): string[] {
  let best: string[] = REQUIRED.map((f) => REQUIRED_LABEL[f])
  for (const { rows } of sheets) {
    for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_ROWS); i++) {
      const cells = (rows[i] ?? []).map((c) => normalizeText(cellText(c)))
      const missing = REQUIRED.filter((f) => !cells.some((c) => HEADERS[f].includes(c))).map((f) => REQUIRED_LABEL[f])
      if (missing.length < best.length) best = missing
    }
  }
  return best
}

function readAmount(value: unknown): number | null {
  // Número vem cru (a Pro Frotas manda 3 casas às vezes); o arredondamento é na comparação
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return parseMoney(value)
}

/** Linhas de lançamento da planilha, na ordem em que aparecem */
export function parseProFrotasSheets(sheets: ProFrotasSheet[], fileName: string): SheetLine[] {
  for (const sheet of sheets) {
    const found = findColumns(sheet.rows)
    if (!found) continue
    const { headerIndex, columns } = found
    const at = (row: unknown[], field: Field) => (columns[field] === undefined ? null : row[columns[field]!])

    const lines: SheetLine[] = []
    for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? []
      if (row.every((c) => cellText(c) === '')) continue
      lines.push({
        source: { file: fileName, row: sheet.firstRow + i },
        noteText: cellText(at(row, 'note')),
        series: cellText(at(row, 'series')),
        stationCnpj: cnpjDigits(at(row, 'stationCnpj')),
        stationName: cellText(at(row, 'stationName')),
        companyCnpj: cnpjDigits(at(row, 'companyCnpj')),
        companyName: cellText(at(row, 'companyName')),
        fuelDate: parseDate(at(row, 'fuelDate')),
        amount: readAmount(at(row, 'amount')),
      })
    }
    return lines
  }

  const missing = missingColumns(sheets)
  throw new Error(
    `Não achei as colunas ${missing.join(', ')}. Confira se é o "Relatório Detalhamento da Cobrança" da Pro Frotas.`
  )
}
