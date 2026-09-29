import type ExcelJS from 'exceljs'
import { formatCnpj } from './cnpj'
import { columnLetter } from './sheet'
import type { Category, ResultNote, SheetSource, ValidationResult } from '../../types/proFrotas'

/**
 * Relatório da validação no formato do app antigo: uma aba por situação, com título,
 * tabela filtrável e linha de totais (SUBTOTAL, para acompanhar o filtro).
 * O antigo linkava o DANFE e a planilha no disco de quem gerou; aqui vão a chave de acesso
 * e as linhas de origem na planilha, que servem em qualquer máquina.
 */

const FONT = 'Aptos'
const WHITE = 'FFFFFFFF'
const HEADER_FILL = 'FF1F3864'
const MONEY_FORMAT = '"R$"\\ #,##0.00;[Red]\\-"R$"\\ #,##0.00'
const FIRST_DATA_ROW = 3
// Linhas de origem listadas por nota; o resto vira "(+N)"
const MAX_SOURCES = 5

type Kind = 'number' | 'text' | 'date' | 'money' | 'integer' | 'diff'

interface Column {
  header: string
  width: number
  kind: Kind
  value: (n: ResultNote, ctx: Context) => string | number | Date | null
  // Soma na linha de totais
  sum?: boolean
}

interface Context {
  multipleFiles: boolean
}

interface SheetSpec {
  category: Category
  name: string
  title: string
  columns: Column[]
}

/** "linhas 257, 260, 264 (+3)" — com o nome do arquivo quando houver mais de uma planilha */
export function formatSources(sources: SheetSource[], multipleFiles: boolean): string {
  const byFile = new Map<string, number[]>()
  for (const s of sources) byFile.set(s.file, [...(byFile.get(s.file) ?? []), s.row])
  return [...byFile.entries()]
    .map(([file, rows]) => {
      const shown = rows.slice(0, MAX_SOURCES).join(', ')
      const extra = rows.length > MAX_SOURCES ? ` (+${rows.length - MAX_SOURCES})` : ''
      const label = rows.length === 1 ? 'linha' : 'linhas'
      return `${multipleFiles ? `${file}: ` : ''}${label} ${shown}${extra}`
    })
    .join(' · ')
}

function isoToDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  // O ExcelJS converte pelo relógio UTC: meia-noite UTC vira a data pura, sem hora
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null
}

const number: Column = { header: 'Nº Nota', width: 12, kind: 'number', value: (n) => Number(n.sheet.number) }
const group: Column = { header: 'Grupo', width: 10, kind: 'text', value: (n) => (n.sheet.groupId ? 'Agrupada' : null) }
const groupNumber: Column = { header: 'Grupo', width: 9, kind: 'integer', value: (n) => n.groupNumber }
const issueDate = (header: string): Column => ({ header, width: 15, kind: 'date', value: (n) => isoToDate(n.xml?.issueDate) })
const fuelDate: Column = { header: 'Data Abastecimento', width: 17, kind: 'date', value: (n) => isoToDate(n.sheet.fuelDate) }
const days: Column = { header: 'Dias Postergados', width: 15, kind: 'integer', value: (n) => n.days }
const issuer: Column = { header: 'CNPJ Emitente', width: 21, kind: 'text', value: (n) => formatCnpj(n.sheet.stationCnpj) }
const station: Column = { header: 'Posto', width: 36, kind: 'text', value: (n) => n.xml?.issuerName || n.sheet.stationName || null }
// O destinatário é o do XML: a nota pode ter saído para outro CNPJ
const recipient: Column = { header: 'CNPJ Destinatário', width: 21, kind: 'text', value: (n) => formatCnpj(n.xml?.recipientCnpj || n.sheet.companyCnpj) }
const cancelDate: Column = { header: 'Data Cancelamento', width: 17, kind: 'date', value: (n) => isoToDate(n.cancelledAt) }
const xmlAmount = (header: string): Column => ({ header, width: 15, kind: 'money', sum: true, value: (n) => n.xmlAmount })
const sheetAmount = (header: string): Column => ({ header, width: 15, kind: 'money', sum: true, value: (n) => n.sheetAmount })
const difference: Column = { header: 'Diferença', width: 14, kind: 'diff', sum: true, value: () => null }
const sources: Column = { header: 'Linhas na Planilha', width: 30, kind: 'text', value: (n, ctx) => formatSources(n.sheet.sources, ctx.multipleFiles) }
const accessKey: Column = { header: 'Chave de Acesso', width: 48, kind: 'text', value: (n) => n.xml?.key || null }
const remark: Column = { header: 'Observação', width: 44, kind: 'text', value: (n) => n.note || null }

export const REPORT_SHEETS: SheetSpec[] = [
  {
    category: 'identical',
    name: 'NFe Idênticas',
    title: 'NOTAS IDÊNTICAS',
    columns: [number, issueDate('Data de Emissão'), fuelDate, days, issuer, station, recipient, sheetAmount('Valor Cobrado'), accessKey, remark],
  },
  {
    category: 'divergentGroup',
    name: 'NFe Divergentes Agrupadas',
    title: 'NOTAS DIVERGENTES AGRUPADAS',
    columns: [number, groupNumber, fuelDate, issuer, station, recipient, xmlAmount('Valor Receita'), sheetAmount('Valor Planilha'), difference, sources, accessKey, remark],
  },
  {
    category: 'divergent',
    name: 'NFe Divergentes',
    title: 'NOTAS DIVERGENTES SEM GRUPO',
    columns: [number, fuelDate, issuer, station, recipient, xmlAmount('Valor XML'), sheetAmount('Valor Planilha'), difference, sources, accessKey, remark],
  },
  {
    // Aba nova: o app antigo não lia o evento de cancelamento e dava essas notas como idênticas ou divergentes
    category: 'cancelled',
    name: 'NFe Canceladas',
    title: 'NOTAS CANCELADAS (NF-e COM CANCELAMENTO HOMOLOGADO)',
    columns: [number, issueDate('Data de Emissão'), cancelDate, fuelDate, issuer, station, recipient, xmlAmount('Valor XML'), sheetAmount('Valor Planilha'), sources, accessKey, remark],
  },
  {
    category: 'notFound',
    name: 'NFe Não Encontradas',
    title: 'NOTAS NÃO ENCONTRADAS',
    columns: [number, group, fuelDate, days, issuer, station, recipient, sheetAmount('Valor Nfe'), sources, remark],
  },
  {
    category: 'disregarded',
    name: 'NFe Desconsideradas',
    title: 'NOTAS DESCONSIDERADAS (+{dias} DIAS POSTERGADAS)',
    columns: [number, group, issueDate('Data Emissão'), fuelDate, days, issuer, station, recipient, sheetAmount('Valor Nfe'), sources, accessKey, remark],
  },
]

/** Ordem do antigo: pelo nº da nota; nas agrupadas, pelo grupo */
export function sortForReport(notes: ResultNote[], category: Category): ResultNote[] {
  return notes
    .filter((n) => n.category === category)
    .sort((a, b) => (a.groupNumber ?? 0) - (b.groupNumber ?? 0) || Number(a.sheet.number) - Number(b.sheet.number) || a.sheet.stationCnpj.localeCompare(b.sheet.stationCnpj))
}

export async function buildProFrotasWorkbook(result: ValidationResult): Promise<ExcelJS.Workbook> {
  const { default: Excel } = await import('exceljs')
  const workbook = new Excel.Workbook()
  workbook.creator = 'Conciliador BPO'
  workbook.created = new Date()
  const ctx: Context = { multipleFiles: new Set(result.notes.flatMap((n) => n.sheet.sources.map((s) => s.file))).size > 1 }

  for (const spec of REPORT_SHEETS) {
    addSheet(workbook, spec, sortForReport(result.notes, spec.category), result.settings.maxDays, ctx)
  }
  return workbook
}

function addSheet(workbook: ExcelJS.Workbook, spec: SheetSpec, notes: ResultNote[], maxDays: number, ctx: Context): void {
  const ws = workbook.addWorksheet(spec.name, {
    views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const cols = spec.columns
  const last = columnLetter(cols.length - 1)
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width))
  const letterOf = (header: string) => columnLetter(cols.findIndex((c) => c.header === header))

  // ── Título e cabeçalho ────────────────────────────────────────────────────
  ws.mergeCells(`A1:${last}1`)
  const title = ws.getCell('A1')
  title.value = spec.title.replace('{dias}', String(maxDays))
  title.font = { name: FONT, size: 14, bold: true, color: { argb: HEADER_FILL } }
  title.alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getRow(1).height = 24

  cols.forEach((c, i) => {
    const cell = ws.getCell(2, i + 1)
    cell.value = c.header
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: WHITE } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  ws.getRow(2).height = 30

  // ── Linhas ────────────────────────────────────────────────────────────────
  // Diferença = XML − planilha, em fórmula, como no antigo
  const diffIndex = cols.findIndex((c) => c.kind === 'diff')
  const xmlLetter = diffIndex >= 0 ? columnLetter(diffIndex - 2) : ''
  const sheetLetter = diffIndex >= 0 ? columnLetter(diffIndex - 1) : ''

  notes.forEach((note, i) => {
    const r = FIRST_DATA_ROW + i
    cols.forEach((c, ci) => {
      const cell = ws.getCell(r, ci + 1)
      if (c.kind === 'diff') {
        cell.value = { formula: `${xmlLetter}${r}-${sheetLetter}${r}`, result: note.difference ?? 0 }
      } else {
        cell.value = c.value(note, ctx)
      }
      cell.font = { name: FONT, size: 10 }
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } }
      applyFormat(cell, c.kind)
    })
  })

  if (notes.length === 0) {
    ws.mergeCells(`A${FIRST_DATA_ROW}:${last}${FIRST_DATA_ROW}`)
    const empty = ws.getCell(`A${FIRST_DATA_ROW}`)
    empty.value = 'Nenhuma nota nesta situação.'
    empty.font = { name: FONT, size: 10, italic: true, color: { argb: 'FF7F7F7F' } }
    empty.alignment = { horizontal: 'center', vertical: 'middle' }
    return
  }

  // ── Totais ────────────────────────────────────────────────────────────────
  const lastData = FIRST_DATA_ROW + notes.length - 1
  const totalRow = FIRST_DATA_ROW + notes.length
  const range = (letter: string) => `${letter}${FIRST_DATA_ROW}:${letter}${lastData}`
  ws.getCell(totalRow, 1).value = 'Qtd Nfe'
  ws.getCell(totalRow, 2).value = { formula: `SUBTOTAL(103,${range('A')})`, result: notes.length }
  const firstSum = cols.findIndex((c) => c.sum)
  if (firstSum > 0) ws.getCell(totalRow, firstSum).value = 'Total'
  cols.forEach((c, ci) => {
    if (!c.sum) return
    const letter = letterOf(c.header)
    const total = notes.reduce((s, n) => {
      const v = c.kind === 'diff' ? n.difference : c.value(n, ctx)
      return s + (typeof v === 'number' ? v : 0)
    }, 0)
    ws.getCell(totalRow, ci + 1).value = { formula: `SUBTOTAL(109,${range(letter)})`, result: Math.round(total * 100) / 100 }
  })
  for (let ci = 1; ci <= cols.length; ci++) {
    const cell = ws.getCell(totalRow, ci)
    cell.font = { name: FONT, size: 10, bold: true }
    cell.border = { top: { style: 'thin' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    if (cols[ci - 1].sum) cell.numFmt = MONEY_FORMAT
  }

  ws.autoFilter = { from: 'A2', to: `${last}${lastData}` }
}

function applyFormat(cell: ExcelJS.Cell, kind: Kind): void {
  const center: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' }
  switch (kind) {
    case 'number':
    case 'integer':
      cell.numFmt = '0'
      cell.alignment = center
      break
    case 'date':
      cell.numFmt = 'dd/mm/yyyy'
      cell.alignment = center
      break
    case 'money':
    case 'diff':
      cell.numFmt = MONEY_FORMAT
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
      break
    default:
      cell.alignment = { horizontal: 'left', vertical: 'middle' }
  }
}

/** "15.09.2026" */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export function reportFileName(periodEnd: string): string {
  return `Validação Pro Frotas_${shortDate(periodEnd)}.xlsx`
}

export function zipFileName(kind: 'conciliados' | 'conferencia' | 'pendentes', periodEnd: string): string {
  const label = { conciliados: 'XMLs conciliados', conferencia: 'XMLs para conferência', pendentes: 'Pendentes Pro Frotas' }[kind]
  return `${label}_${shortDate(periodEnd)}.zip`
}

export function downloadBlob(data: BlobPart | Uint8Array, fileName: string, type: string): void {
  // O fflate devolve Uint8Array<ArrayBufferLike>; nunca é SharedArrayBuffer, então vale como BlobPart
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadProFrotasReport(result: ValidationResult): Promise<void> {
  const workbook = await buildProFrotasWorkbook(result)
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(buffer, reportFileName(result.settings.periodEnd), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}
