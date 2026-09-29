import * as XLSX from 'xlsx'
import { formatDateBR, formatMoney, parseDate, parseMoney } from '../bankReconciliation/money'
import { cellText, normalizeText } from '../bankReconciliation/text'
import { formatCnpj, normalizeCnpj } from './cnpj'
import type { SheetLine } from '../../types/proFrotas'

/**
 * Leitura da planilha "Relatório Detalhamento da Cobrança" da Pro Frotas.
 * As colunas vêm pré-selecionadas pelo título e a pessoa pode trocar qualquer uma, como na
 * tela de configuração do app antigo — só que lá eram letras fixas, e a posição já mudou entre
 * versões do relatório (F/AL/AQ numa, H/AO/AT noutra).
 */

export interface ProFrotasSheet {
  sheetName: string
  rows: unknown[][]
  // Linha do Excel (base 1) de rows[0]
  firstRow: number
  // Coluna do Excel (base 0) de rows[i][0]
  firstCol: number
}

export type Field =
  | 'note'
  | 'amount'
  | 'stationCnpj'
  | 'companyCnpj'
  | 'fuelDate'
  | 'postponed'
  | 'series'
  | 'stationName'
  | 'companyName'

export interface FieldSpec {
  field: Field
  label: string
  required: boolean
  aliases: string[]
}

export const FIELDS: FieldSpec[] = [
  { field: 'note', label: 'Número da Nota Fiscal', required: true, aliases: ['numero da nota fiscal', 'numero nota fiscal', 'nota fiscal'] },
  { field: 'amount', label: 'Valor no Boleto', required: true, aliases: ['valor no boleto', 'valor do boleto'] },
  { field: 'stationCnpj', label: 'CNPJ do Posto', required: true, aliases: ['cnpj do posto', 'cnpj posto'] },
  { field: 'companyCnpj', label: 'CNPJ da Empresa', required: true, aliases: ['cnpj da empresa', 'cnpj empresa'] },
  { field: 'fuelDate', label: 'Data do Abastecimento', required: true, aliases: ['data abastecimento', 'data do abastecimento', 'data de abastecimento'] },
  { field: 'postponed', label: 'Postergado', required: false, aliases: ['postergado', 'postergada', 'postergados', 'postergadas'] },
  { field: 'series', label: 'Série', required: false, aliases: ['numero de serie', 'serie'] },
  { field: 'stationName', label: 'Nome do Posto', required: false, aliases: ['nome do posto', 'posto'] },
  { field: 'companyName', label: 'Empresa', required: false, aliases: ['empresa', 'nome da empresa'] },
]

/** Coluna de cada campo (índice em rows[i]); null = não usar */
export type ColumnMapping = Record<Field, number | null>

/** Títulos escolhidos numa importação anterior; '' = a pessoa escolheu não usar o campo */
export type PreferredTitles = Partial<Record<Field, string>>

export interface SheetLayout {
  sheetIndex: number
  headerIndex: number
  mapping: ColumnMapping
}

export interface SheetColumn {
  index: number
  letter: string
  title: string
}

// O título costuma estar na 1ª linha; a busca vai um pouco além por segurança
const HEADER_SEARCH_ROWS = 15
const SAMPLE_ROWS = 300

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
    const range = ref ? XLSX.utils.decode_range(ref) : null
    return {
      sheetName,
      rows: ref ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true }) : [],
      firstRow: range ? range.s.r + 1 : 1,
      firstCol: range ? range.s.c : 0,
    }
  })
}

export function columnLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function emptyMapping(): ColumnMapping {
  return Object.fromEntries(FIELDS.map((f) => [f.field, null])) as ColumnMapping
}

function mapRow(row: unknown[], preferred: PreferredTitles): { mapping: ColumnMapping; score: number } {
  const cells = row.map((c) => normalizeText(cellText(c)))
  const mapping = emptyMapping()
  let score = 0
  for (const spec of FIELDS) {
    const wanted = preferred[spec.field]
    let index = -1
    if (wanted === '') continue
    if (wanted) index = cells.indexOf(normalizeText(wanted))
    if (index < 0) index = cells.findIndex((c) => spec.aliases.includes(c))
    if (index < 0) continue
    mapping[spec.field] = index
    score += spec.required ? 2 : 1
  }
  return { mapping, score }
}

/** Aba, linha de título e colunas pré-selecionadas: a linha que mais reconhece campos pelo título */
export function detectLayout(sheets: ProFrotasSheet[], preferred: PreferredTitles = {}): SheetLayout {
  let best: SheetLayout & { score: number } = { sheetIndex: 0, headerIndex: 0, mapping: emptyMapping(), score: 0 }
  sheets.forEach((sheet, sheetIndex) => {
    for (let i = 0; i < Math.min(sheet.rows.length, HEADER_SEARCH_ROWS); i++) {
      const { mapping, score } = mapRow(sheet.rows[i] ?? [], preferred)
      if (score > best.score) best = { sheetIndex, headerIndex: i, mapping, score }
    }
  })
  if (best.score === 0) {
    // Nenhum título conhecido: a 1ª linha preenchida vira o título, e a pessoa escolhe as colunas
    const sheetIndex = Math.max(0, sheets.findIndex((s) => s.rows.some((r) => r?.some((c) => cellText(c) !== ''))))
    const rows = sheets[sheetIndex]?.rows ?? []
    const headerIndex = Math.max(0, rows.findIndex((r) => r?.some((c) => cellText(c) !== '')))
    return { sheetIndex, headerIndex, mapping: emptyMapping() }
  }
  return { sheetIndex: best.sheetIndex, headerIndex: best.headerIndex, mapping: best.mapping }
}

/** Layout de outra aba ou linha de título, mantendo o que der da escolha atual pelos títulos */
export function layoutForSheet(sheets: ProFrotasSheet[], sheetIndex: number, preferred: PreferredTitles): SheetLayout {
  const only = detectLayout([sheets[sheetIndex]], preferred)
  return { ...only, sheetIndex }
}

export function sheetColumns(sheet: ProFrotasSheet, headerIndex: number): SheetColumn[] {
  const header = sheet.rows[headerIndex] ?? []
  const width = Math.max(0, ...sheet.rows.slice(headerIndex, headerIndex + SAMPLE_ROWS).map((r) => r?.length ?? 0))
  return Array.from({ length: width }, (_, index) => ({
    index,
    letter: columnLetter(sheet.firstCol + index),
    title: cellText(header[index]),
  }))
}

/** Títulos das colunas escolhidas, para pré-selecionar da próxima vez */
export function mappingTitles(sheet: ProFrotasSheet, headerIndex: number, mapping: ColumnMapping): PreferredTitles {
  const header = sheet.rows[headerIndex] ?? []
  return Object.fromEntries(
    FIELDS.map(({ field }) => [field, mapping[field] === null ? '' : cellText(header[mapping[field]!])])
  ) as PreferredTitles
}

export function missingRequired(mapping: ColumnMapping): FieldSpec[] {
  return FIELDS.filter((f) => f.required && mapping[f.field] === null)
}

function readAmount(value: unknown): number | null {
  // Número vem cru (a Pro Frotas manda 3 casas às vezes); o arredondamento é na comparação
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return parseMoney(value)
}

/** "Sim" na coluna Postergado */
export function isYes(value: unknown): boolean {
  return ['sim', 's', 'yes', 'y', 'x', 'true', 'verdadeiro'].includes(normalizeText(cellText(value)))
}

/** Exemplo do que a coluna traz, já lido como o campo — para a pessoa conferir a escolha */
export function columnSample(sheet: ProFrotasSheet, headerIndex: number, column: number, field: Field): string {
  // Postergado conta a planilha inteira: as linhas "Sim" costumam vir juntas no fim
  const values = sheet.rows
    .slice(headerIndex + 1, field === 'postponed' ? undefined : headerIndex + 1 + SAMPLE_ROWS)
    .map((r) => r?.[column])
    .filter((v) => cellText(v) !== '')
  if (field === 'postponed') {
    const yes = values.filter(isYes).length
    return values.length ? `Sim em ${yes.toLocaleString('pt-BR')} de ${values.length.toLocaleString('pt-BR')} linhas` : 'coluna vazia'
  }
  const value = values.find((v) => cellText(v) !== '-')
  if (value === undefined) return 'coluna vazia'
  switch (field) {
    case 'fuelDate': {
      const iso = parseDate(value)
      return iso ? formatDateBR(iso) : `${cellText(value)} (não é data)`
    }
    case 'amount': {
      const amount = readAmount(value)
      return amount === null ? `${cellText(value)} (não é valor)` : formatMoney(amount)
    }
    case 'stationCnpj':
    case 'companyCnpj':
      return formatCnpj(normalizeCnpj(value))
    default:
      return cellText(value)
  }
}

/** Linhas de lançamento da planilha, na ordem em que aparecem */
export function parseSheetLines(sheet: ProFrotasSheet, headerIndex: number, mapping: ColumnMapping, fileName: string): SheetLine[] {
  const missing = missingRequired(mapping)
  if (missing.length) throw new Error(`Escolha a coluna de ${missing.map((f) => f.label).join(', ')}.`)
  const at = (row: unknown[], field: Field) => (mapping[field] === null ? null : row[mapping[field]!])

  const lines: SheetLine[] = []
  for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] ?? []
    if (row.every((c) => cellText(c) === '')) continue
    lines.push({
      source: { file: fileName, row: sheet.firstRow + i },
      noteText: cellText(at(row, 'note')),
      series: cellText(at(row, 'series')),
      stationCnpj: normalizeCnpj(at(row, 'stationCnpj')),
      stationName: cellText(at(row, 'stationName')),
      companyCnpj: normalizeCnpj(at(row, 'companyCnpj')),
      companyName: cellText(at(row, 'companyName')),
      fuelDate: parseDate(at(row, 'fuelDate')),
      amount: readAmount(at(row, 'amount')),
      postponed: isYes(at(row, 'postponed')),
    })
  }
  return lines
}

/** Leitura direta, com as colunas reconhecidas pelo título */
export function parseProFrotasSheets(sheets: ProFrotasSheet[], fileName: string, preferred: PreferredTitles = {}): SheetLine[] {
  const layout = detectLayout(sheets, preferred)
  const missing = missingRequired(layout.mapping)
  if (missing.length) {
    throw new Error(
      `Não achei as colunas ${missing.map((f) => f.label).join(', ')}. Confira se é o "Relatório Detalhamento da Cobrança" da Pro Frotas.`
    )
  }
  return parseSheetLines(sheets[layout.sheetIndex], layout.headerIndex, layout.mapping, fileName)
}
