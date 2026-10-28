import type ExcelJS from 'exceljs'
import { columnLetter } from '../proFrotas/sheet'
import { downloadBlob } from '../proFrotas/report'
import { formatPeriod } from '../bankReconciliation/money'
import { indexResult, itemMovements, itemPayments, statementLabel } from './view'
import type { ResultIndex } from './view'
import { DIVERGENT, RULE_LABEL, SITUATION_LABEL, SITUATIONS } from '../../types/sispag'
import type { ItauMovement, ResultItem, Situation, SispagPayment, SispagResult } from '../../types/sispag'

/**
 * Planilha da conferência: resumo com o fechamento dia a dia, o relatório SISPAG com a situação
 * de cada pagamento (é a conferência que hoje se faz à mão, marcando linha por linha), as linhas
 * do SISPAG no extrato e o que precisa de conferência.
 */

const FONT = 'Aptos'
const WHITE = 'FFFFFFFF'
const HEADER_FILL = 'FF1F3864'
const MONEY_FORMAT = '"R$"\\ #,##0.00;[Red]\\-"R$"\\ #,##0.00'

type Kind = 'text' | 'date' | 'money' | 'integer'

interface Column<T> {
  header: string
  width: number
  kind: Kind
  value: (row: T) => string | number | Date | null
  sum?: boolean
}

function isoToDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  // O ExcelJS converte pelo relógio UTC: meia-noite UTC vira a data pura, sem hora
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null
}

function applyFormat(cell: ExcelJS.Cell, kind: Kind): void {
  const center: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' }
  if (kind === 'date') {
    cell.numFmt = 'dd/mm/yyyy'
    cell.alignment = center
  } else if (kind === 'money') {
    cell.numFmt = MONEY_FORMAT
    cell.alignment = { horizontal: 'right', vertical: 'middle' }
  } else if (kind === 'integer') {
    cell.numFmt = '0'
    cell.alignment = center
  } else {
    cell.alignment = { horizontal: 'left', vertical: 'middle' }
  }
}

function styleHeader(cell: ExcelJS.Cell): void {
  cell.font = { name: FONT, size: 10, bold: true, color: { argb: WHITE } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
}

/** Aba com título, cabeçalho congelado, filtro e linha de totais (SUBTOTAL acompanha o filtro) */
function addTableSheet<T>(workbook: ExcelJS.Workbook, name: string, title: string, columns: Column<T>[], rows: T[], empty: string): void {
  const ws = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const last = columnLetter(columns.length - 1)
  columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width))

  ws.mergeCells(`A1:${last}1`)
  const titleCell = ws.getCell('A1')
  titleCell.value = title
  titleCell.font = { name: FONT, size: 14, bold: true, color: { argb: HEADER_FILL } }
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getRow(1).height = 24
  columns.forEach((c, i) => {
    const cell = ws.getCell(2, i + 1)
    cell.value = c.header
    styleHeader(cell)
  })
  ws.getRow(2).height = 30

  if (rows.length === 0) {
    ws.mergeCells(`A3:${last}3`)
    const cell = ws.getCell('A3')
    cell.value = empty
    cell.font = { name: FONT, size: 10, italic: true, color: { argb: 'FF7F7F7F' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    return
  }

  rows.forEach((row, i) => {
    columns.forEach((c, ci) => {
      const cell = ws.getCell(3 + i, ci + 1)
      cell.value = c.value(row)
      cell.font = { name: FONT, size: 10 }
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } }
      applyFormat(cell, c.kind)
    })
  })

  const lastData = 2 + rows.length
  const totalRow = lastData + 1
  ws.getCell(totalRow, 1).value = 'Total'
  columns.forEach((c, ci) => {
    if (!c.sum) return
    const letter = columnLetter(ci)
    const total = rows.reduce((s, r) => {
      const v = c.value(r)
      return s + (typeof v === 'number' ? v : 0)
    }, 0)
    ws.getCell(totalRow, ci + 1).value = { formula: `SUBTOTAL(109,${letter}3:${letter}${lastData})`, result: Math.round(total * 100) / 100 }
  })
  for (let ci = 1; ci <= columns.length; ci++) {
    const cell = ws.getCell(totalRow, ci)
    cell.font = { name: FONT, size: 10, bold: true }
    cell.border = { top: { style: 'thin' } }
    if (columns[ci - 1].sum) {
      cell.numFmt = MONEY_FORMAT
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
    }
  }
  ws.autoFilter = { from: 'A2', to: `${last}${lastData}` }
}

// ── Resumo ──────────────────────────────────────────────────────────────────

function addSummarySheet(workbook: ExcelJS.Workbook, result: SispagResult): void {
  const ws = workbook.addWorksheet('Resumo', { views: [{ showGridLines: false }] })
  ws.getColumn(1).width = 46
  for (let c = 2; c <= 6; c++) ws.getColumn(c).width = 19

  ws.mergeCells('A1:F1')
  const title = ws.getCell('A1')
  title.value = 'CONFERÊNCIA SISPAG × EXTRATO ITAÚ'
  title.font = { name: FONT, size: 14, bold: true, color: { argb: HEADER_FILL } }
  ws.getRow(1).height = 24

  const { report, statement, totals } = result
  let r = 3
  const info = (label: string, value: string) => {
    ws.getCell(r, 1).value = label
    ws.getCell(r, 1).font = { name: FONT, size: 10, bold: true }
    ws.mergeCells(r, 2, r, 6)
    ws.getCell(r, 2).value = value
    ws.getCell(r, 2).font = { name: FONT, size: 10 }
    r++
  }
  info('Empresa', [report.company, report.cnpj].filter(Boolean).join(' · '))
  info('Agência / conta', report.account || statement.account)
  info('Período conferido', formatPeriod(result.period))
  if (report.modality) info('Modalidade do relatório', report.modality)
  info('Extrato', statement.fileName)
  info('Relatório SISPAG', report.fileName)

  r++
  const line = (label: string, value: number, strong = false) => {
    ws.getCell(r, 1).value = label
    ws.getCell(r, 2).value = value
    ws.getCell(r, 2).numFmt = MONEY_FORMAT
    for (const c of [1, 2]) ws.getCell(r, c).font = { name: FONT, size: 10, bold: strong }
    r++
  }
  line('Débitos do SISPAG no extrato', totals.debits)
  line('(−) Pagamentos efetuados no relatório', totals.done)
  line('(−) Não efetuados, debitados e devolvidos', totals.returned)
  line('Diferença', totals.difference, true)
  r++
  line('Devoluções e estornos no extrato', totals.returns)
  if (totals.otherModality) line('Débitos de outra modalidade (fora do relatório)', totals.otherModality)
  line('Não efetuados, fora do extrato', totals.notDone)

  r++
  const header = (labels: string[]) => {
    labels.forEach((label, i) => {
      const cell = ws.getCell(r, i + 1)
      cell.value = label
      styleHeader(cell)
    })
    ws.getRow(r).height = 28
    r++
  }
  header(['Situação', 'Itens', 'Valor no extrato', 'Valor no SISPAG'])
  for (const situation of SITUATIONS) {
    const items = result.items.filter((i) => i.situation === situation)
    if (items.length === 0) continue
    ws.getCell(r, 1).value = SITUATION_LABEL[situation]
    ws.getCell(r, 2).value = items.length
    ws.getCell(r, 3).value = Math.round(items.reduce((s, i) => s + i.statementAmount, 0) * 100) / 100
    ws.getCell(r, 4).value = Math.round(items.reduce((s, i) => s + i.reportAmount, 0) * 100) / 100
    for (let c = 1; c <= 4; c++) {
      const cell = ws.getCell(r, c)
      cell.font = { name: FONT, size: 10, bold: DIVERGENT.includes(situation) }
      if (c >= 3) cell.numFmt = MONEY_FORMAT
      if (c === 2) cell.alignment = { horizontal: 'center' }
    }
    r++
  }

  r++
  header(['Dia', 'Débitos SISPAG (extrato)', 'Pagamentos (relatório)', 'Diferença', 'Devoluções e estornos', 'Outra modalidade'])
  for (const day of result.days) {
    const values: (Date | number | null)[] = [isoToDate(day.date), day.debits, day.debited, day.difference, day.returns, day.otherModality || null]
    values.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1)
      cell.value = v
      cell.font = { name: FONT, size: 10, bold: i === 3 && Math.abs(day.difference) >= 0.01 }
      cell.numFmt = i === 0 ? 'dd/mm/yyyy' : MONEY_FORMAT
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } }
      if (i === 0) cell.alignment = { horizontal: 'left' }
    })
    r++
  }
}

// ── Pagamentos, extrato e o que conferir ────────────────────────────────────

interface PaymentRow {
  payment: SispagPayment
  situation: Situation
  // Item que casou o débito (ou a devolução, para o não efetuado)
  item: ResultItem | null
  lines: ItauMovement[]
}

function paymentRows(result: SispagResult, index: ResultIndex): PaymentRow[] {
  const inPeriod = (p: SispagPayment) => p.date >= result.period.start && p.date <= result.period.end
  return result.report.payments
    .filter(inPeriod)
    .sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row)
    .map((payment) => {
      const situation = result.paymentSituation[payment.id] ?? 'notDone'
      const items = index.itemsOfPayment.get(payment.id) ?? []
      const item = items.find((i) => i.situation === situation) ?? items[0] ?? null
      return { payment, situation, item, lines: item ? itemMovements(item, index) : [] }
    })
}

function linesLabel(row: PaymentRow): string | null {
  if (row.lines.length === 0) return null
  const first = row.lines[0].description
  const shared = row.item ? row.item.paymentIds.length : 1
  if (row.lines.length > 1) return `${row.lines.length} linhas (${first}…)`
  return shared > 1 ? `${first} (lote de ${shared})` : first
}

const PAYMENT_COLUMNS: Column<PaymentRow>[] = [
  { header: 'Linha no Relatório', width: 10, kind: 'integer', value: (r) => r.payment.row },
  { header: 'Data do Pagamento', width: 13, kind: 'date', value: (r) => isoToDate(r.payment.date) },
  { header: 'Favorecido', width: 36, kind: 'text', value: (r) => r.payment.payee || null },
  { header: 'CPF/CNPJ', width: 20, kind: 'text', value: (r) => r.payment.document || null },
  { header: 'Tipo de Pagamento', width: 22, kind: 'text', value: (r) => r.payment.type || null },
  { header: 'Referência', width: 14, kind: 'text', value: (r) => r.payment.reference || null },
  { header: 'Valor', width: 15, kind: 'money', sum: true, value: (r) => r.payment.amount },
  { header: 'Status SISPAG', width: 14, kind: 'text', value: (r) => r.payment.status || null },
  { header: 'Conferência', width: 20, kind: 'text', value: (r) => SITUATION_LABEL[r.situation] },
  { header: 'Data no Extrato', width: 13, kind: 'date', value: (r) => isoToDate(r.lines[0]?.date) },
  { header: 'Lançamento no Extrato', width: 38, kind: 'text', value: linesLabel },
  { header: 'Valor no Extrato', width: 15, kind: 'money', value: (r) => (r.item && r.lines.length ? r.item.statementAmount : null) },
  { header: 'Regra', width: 14, kind: 'text', value: (r) => (r.item && r.item.rule !== 'none' ? RULE_LABEL[r.item.rule] : null) },
  { header: 'Observação', width: 50, kind: 'text', value: (r) => r.item?.note || null },
]

interface MovementRow {
  movement: ItauMovement
  item: ResultItem | null
  payments: SispagPayment[]
}

const KIND_LABEL: Record<ItauMovement['kind'], string> = {
  payment: 'Débito SISPAG',
  return: 'TED devolvida',
  reversal: 'Estorno SISPAG',
  other: 'Outro',
}

function payeesLabel(payments: SispagPayment[]): string | null {
  if (payments.length === 0) return null
  if (payments.length === 1) return payments[0].payee || payments[0].type
  const names = [...new Set(payments.map((p) => p.payee).filter(Boolean))]
  return `${payments.length} pagamentos: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`
}

const MOVEMENT_COLUMNS: Column<MovementRow>[] = [
  { header: 'Data', width: 12, kind: 'date', value: (r) => isoToDate(r.movement.date) },
  { header: 'Lançamento', width: 34, kind: 'text', value: (r) => r.movement.description },
  { header: 'Tipo', width: 15, kind: 'text', value: (r) => KIND_LABEL[r.movement.kind] },
  { header: 'Valor', width: 15, kind: 'money', sum: true, value: (r) => r.movement.amount },
  { header: 'Conferência', width: 20, kind: 'text', value: (r) => (r.item ? SITUATION_LABEL[r.item.situation] : null) },
  { header: 'Regra', width: 14, kind: 'text', value: (r) => (r.item && r.item.rule !== 'none' ? RULE_LABEL[r.item.rule] : null) },
  { header: 'Pagamentos', width: 11, kind: 'integer', value: (r) => r.payments.length || null },
  { header: 'Valor no SISPAG', width: 15, kind: 'money', value: (r) => (r.item && r.payments.length ? r.item.reportAmount : null) },
  { header: 'Favorecido(s)', width: 50, kind: 'text', value: (r) => payeesLabel(r.payments) },
  { header: 'Observação', width: 50, kind: 'text', value: (r) => r.item?.note || null },
]

interface CheckRow {
  item: ResultItem
  index: ResultIndex
}

const CHECK_COLUMNS: Column<CheckRow>[] = [
  { header: 'Situação', width: 22, kind: 'text', value: (r) => SITUATION_LABEL[r.item.situation] },
  { header: 'Data', width: 12, kind: 'date', value: (r) => isoToDate(r.item.date) },
  { header: 'Lançamento no Extrato', width: 34, kind: 'text', value: (r) => statementLabel(r.item, r.index) || null },
  { header: 'Valor no Extrato', width: 15, kind: 'money', sum: true, value: (r) => r.item.statementAmount },
  { header: 'Favorecido(s) no SISPAG', width: 40, kind: 'text', value: (r) => payeesLabel(itemPayments(r.item, r.index)) },
  { header: 'Valor no SISPAG', width: 15, kind: 'money', sum: true, value: (r) => r.item.reportAmount },
  { header: 'Observação', width: 60, kind: 'text', value: (r) => r.item.note || null },
  { header: 'Pista', width: 60, kind: 'text', value: (r) => r.item.hint || null },
]

export async function buildSispagWorkbook(result: SispagResult): Promise<ExcelJS.Workbook> {
  const { default: Excel } = await import('exceljs')
  const workbook = new Excel.Workbook()
  workbook.creator = 'Conciliador BPO'
  workbook.created = new Date()
  const index = indexResult(result)

  addSummarySheet(workbook, result)

  const toCheck: Situation[] = [...DIVERGENT, 'otherModality']
  const checkRows = result.items
    .filter((i) => toCheck.includes(i.situation))
    .sort((a, b) => toCheck.indexOf(a.situation) - toCheck.indexOf(b.situation) || a.date.localeCompare(b.date))
    .map((item) => ({ item, index }))
  addTableSheet(workbook, 'Para conferir', 'DIVERGÊNCIAS E LANÇAMENTOS FORA DO RELATÓRIO', CHECK_COLUMNS, checkRows, 'Nada para conferir: extrato e relatório fecham.')

  addTableSheet(workbook, 'Pagamentos SISPAG', 'RELATÓRIO SISPAG COM A CONFERÊNCIA DE CADA PAGAMENTO', PAYMENT_COLUMNS, paymentRows(result, index), 'Nenhum pagamento no período.')

  const movementRows: MovementRow[] = result.statement.movements
    .filter((m) => m.kind !== 'other' && m.date >= result.period.start && m.date <= result.period.end)
    .map((movement) => {
      const item = index.itemOfMovement.get(movement.id) ?? null
      return { movement, item, payments: item ? itemPayments(item, index) : [] }
    })
  addTableSheet(workbook, 'Extrato SISPAG', 'LINHAS DO SISPAG NO EXTRATO', MOVEMENT_COLUMNS, movementRows, 'Nenhuma linha do SISPAG no extrato.')

  return workbook
}

/** "Conferência SISPAG_03.2025.xlsx" ou "Conferência SISPAG_01.03.2025 a 15.03.2025.xlsx" */
export function sispagFileName(result: SispagResult): string {
  const { start, end } = result.period
  const short = (iso: string) => iso.split('-').reverse().join('.')
  const lastDay = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0)).getUTCDate()
  const wholeMonth = start.slice(0, 7) === end.slice(0, 7) && start.endsWith('-01') && Number(end.slice(8)) === lastDay
  const label = wholeMonth ? `${start.slice(5, 7)}.${start.slice(0, 4)}` : `${short(start)} a ${short(end)}`
  return `Conferência SISPAG_${label}.xlsx`
}

export async function downloadSispagReport(result: SispagResult): Promise<void> {
  const workbook = await buildSispagWorkbook(result)
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(buffer, sispagFileName(result), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}
