import type ExcelJS from 'exceljs'
import type { AccountResult, Period, Situation } from '../../types/bankReconciliation'
import { SITUATIONS } from '../../types/bankReconciliation'
import { sheetNameFrom } from './accountProfiles'
import { roundCents } from './money'

/**
 * Relatório de conciliação no layout de Conciliação_15.09.xlsx:
 * uma aba por banco (faixa de título, tabela Data/Lançamento/Valor/Situação/Documento e
 * bloco SALDO), mais a aba Config oculta com a lista da coluna Situação.
 */

const FONT = 'Aptos'
const WHITE = 'FFFFFFFF'
const MONEY_FORMAT = '"R$"\\ #,##0.00;[Red]\\-"R$"\\ #,##0.00'
const FIRST_DATA_ROW = 5
// A lista suspensa de Situação vai além da última linha, para linhas incluídas à mão
const EXTRA_VALIDATION_ROWS = 100

// Destaque das linhas por situação — em formatação condicional, para acompanhar a troca
// de situação feita no próprio Excel. "Valores iguais" em âmbar, para conferência manual.
const SITUATION_FILL: Partial<Record<Situation, string | 'highlight'>> = {
  'Aguardando composição': 'highlight',
  'Recebimento Frota': 'highlight',
  'Lançamento não encontrado': 'FFF8CBAD',
  'Valores iguais': 'FFFFE699',
}

type Border = Partial<ExcelJS.Borders>

function solid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function isoToDate(iso: string): Date | null {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  // O ExcelJS converte pelo relógio UTC: meia-noite UTC vira a data pura, sem hora
  return new Date(Date.UTC(y, m - 1, d))
}

function uniqueSheetName(name: string, used: Set<string>): string {
  let candidate = name
  let n = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`
    candidate = name.slice(0, 31 - suffix.length) + suffix
  }
  used.add(candidate.toLowerCase())
  return candidate
}

export async function buildBankWorkbook(accounts: AccountResult[]): Promise<ExcelJS.Workbook> {
  const { default: Excel } = await import('exceljs')
  const workbook = new Excel.Workbook()
  workbook.creator = 'Conciliador BPO'
  workbook.created = new Date()

  addConfigSheet(workbook, accounts)
  const used = new Set<string>(['config'])
  for (const account of accounts) {
    addAccountSheet(workbook, account, uniqueSheetName(sheetNameFrom(account.profile.sheetName), used))
  }
  return workbook
}

function addConfigSheet(workbook: ExcelJS.Workbook, accounts: AccountResult[]): void {
  const ws = workbook.addWorksheet('Config', { state: 'hidden' })
  ws.getCell('B4').value = 'Situação'
  ws.getCell('B4').font = { name: FONT, bold: true }
  SITUATIONS.forEach((s, i) => (ws.getCell(`B${5 + i}`).value = s))
  ws.getCell('G4').value = 'Banco'
  ws.getCell('G4').font = { name: FONT, bold: true }
  accounts.forEach((a, i) => (ws.getCell(`G${5 + i}`).value = a.profile.bankLabel))
  ws.getColumn('B').width = 28
  ws.getColumn('G').width = 24
}

function addAccountSheet(workbook: ExcelJS.Workbook, account: AccountResult, sheetName: string): void {
  const { profile, rows, balances } = account
  const ws = workbook.addWorksheet(sheetName, {
    properties: { tabColor: { argb: profile.tabColor } },
    views: [{ showGridLines: false, zoomScale: 85, zoomScaleNormal: 85 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  const widths: Record<string, number> = { A: 3.71, B: 14.71, C: 72.71, D: 18.71, E: 45.71, F: 29.71, G: 9.14, H: 9, I: 10.71, J: 20.71 }
  for (const [col, width] of Object.entries(widths)) ws.getColumn(col).width = width
  ws.getRow(1).height = 15.75
  ws.getRow(2).height = 60.75
  ws.getRow(3).height = 24.95
  ws.getRow(4).height = 19.5

  // ── Faixa de título (B2:F3) ───────────────────────────────────────────────
  for (const addr of ['B2', 'C2', 'D2', 'E2', 'F2', 'B3', 'C3', 'D3', 'E3', 'F3']) {
    ws.getCell(addr).fill = solid(profile.headerColor)
  }
  ws.mergeCells('C2:E3')
  const title = ws.getCell('C2')
  title.value = `${profile.company ? `${profile.company}\n` : ''}Relatório de Conciliação`
  title.font = { name: FONT, size: 22, bold: true, color: { argb: WHITE } }
  title.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  const bank = ws.getCell('F3')
  bank.value = profile.bankLabel
  bank.font = { name: FONT, size: 14, color: { argb: WHITE } }
  bank.alignment = { horizontal: 'right', vertical: 'middle' }
  setBorder(ws, 'B2', { top: medium(), left: medium() })
  for (const addr of ['C2', 'D2', 'E2']) setBorder(ws, addr, { top: medium() })
  setBorder(ws, 'F2', { top: medium(), right: medium() })
  setBorder(ws, 'B3', { left: medium() })
  setBorder(ws, 'F3', { right: medium() })

  // ── Cabeçalho da tabela (linha 4) ─────────────────────────────────────────
  const headers: [string, string, ExcelJS.Alignment['horizontal']][] = [
    ['B4', 'Data', 'center'],
    ['C4', 'Lançamento', 'center'],
    ['D4', 'Valor', 'center'],
    ['E4', 'Situação', 'right'],
    ['F4', 'Documento', 'right'],
  ]
  for (const [addr, label, horizontal] of headers) {
    const cell = ws.getCell(addr)
    cell.value = label
    cell.font = { name: FONT, size: 14, bold: true, color: { argb: WHITE } }
    cell.fill = solid(profile.headerColor)
    cell.alignment = { horizontal, vertical: 'middle' }
    cell.border = { bottom: medium(), ...(addr === 'B4' ? { left: medium() } : {}), ...(addr === 'F4' ? { right: medium() } : {}) }
  }

  // ── Linhas ────────────────────────────────────────────────────────────────
  rows.forEach((row, i) => {
    const r = FIRST_DATA_ROW + i
    const date = ws.getCell(`B${r}`)
    date.value = isoToDate(row.date)
    date.numFmt = 'dd/mm/yyyy'
    date.alignment = { horizontal: 'center', vertical: 'middle' }

    ws.getCell(`C${r}`).value = row.description
    ws.getCell(`C${r}`).alignment = { horizontal: 'left', vertical: 'middle' }

    const value = ws.getCell(`D${r}`)
    value.value = roundCents(row.amount)
    value.numFmt = MONEY_FORMAT
    value.alignment = { horizontal: 'right', vertical: 'middle' }

    ws.getCell(`E${r}`).value = row.situation
    ws.getCell(`E${r}`).alignment = { horizontal: 'right', vertical: 'middle' }
    ws.getCell(`F${r}`).value = row.document || null
    ws.getCell(`F${r}`).alignment = { horizontal: 'right', vertical: 'middle' }

    for (const col of ['B', 'C', 'D', 'E', 'F']) {
      ws.getCell(`${col}${r}`).font = { name: FONT, size: 11 }
    }
    ws.getRow(r).height = 15.75
  })

  const lastRow = Math.max(FIRST_DATA_ROW, FIRST_DATA_ROW + rows.length - 1)
  ws.autoFilter = { from: 'B4', to: `F${lastRow}` }

  // Uma validação para a faixa inteira: célula a célula, o ExcelJS gera faixas sobrepostas
  // e o Excel abre o arquivo pedindo reparo
  const validations = (ws as unknown as { dataValidations: { add(address: string, v: ExcelJS.DataValidation): void } })
    .dataValidations
  validations.add(`E${FIRST_DATA_ROW}:E${lastRow + EXTRA_VALIDATION_ROWS}`, {
    type: 'list',
    allowBlank: true,
    formulae: [`Config!$B$5:$B$${4 + SITUATIONS.length}`],
    showErrorMessage: true,
    errorTitle: 'Situação',
    error: 'Escolha uma situação da lista.',
  })

  const rules: ExcelJS.ConditionalFormattingRule[] = []
  let priority = 1
  for (const situation of SITUATIONS) {
    const fill = SITUATION_FILL[situation]
    if (!fill) continue
    rules.push({
      type: 'expression',
      priority: priority++,
      formulae: [`$E${FIRST_DATA_ROW}="${situation}"`],
      style: {
        fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: fill === 'highlight' ? profile.highlightColor : fill } },
        font: { bold: true },
      },
    })
  }
  ws.addConditionalFormatting({ ref: `B${FIRST_DATA_ROW}:F${lastRow + EXTRA_VALIDATION_ROWS}`, rules })

  // ── Bloco SALDO (I:J) ─────────────────────────────────────────────────────
  ws.mergeCells('I2:J2')
  const saldo = ws.getCell('I2')
  saldo.value = 'SALDO'
  saldo.font = { name: FONT, size: 14, bold: true, color: { argb: WHITE } }
  saldo.fill = solid(profile.balanceColor)
  saldo.alignment = { horizontal: 'center', vertical: 'middle' }
  saldo.border = { top: medium(), left: medium(), bottom: medium(), right: medium() }
  setBorder(ws, 'J2', { top: medium(), bottom: medium(), right: medium() })

  balanceBlock(ws, 4, 'Atua', profile.balanceColor, balances.systemOpening, balances.systemClosing)
  balanceBlock(ws, 8, profile.balanceLabel, profile.balanceColor, balances.bankOpening, balances.bankClosing)

  // Conferência: a diferença entre as variações é o que as pendências precisam explicar
  ws.mergeCells('I12:J12')
  const check = ws.getCell('I12')
  check.value = 'Conferência'
  check.font = { name: FONT, size: 12, bold: true, color: { argb: WHITE } }
  check.fill = solid(profile.balanceColor)
  check.alignment = { horizontal: 'center', vertical: 'middle' }
  check.border = { top: thin(), left: thin(), right: thin() }
  setBorder(ws, 'J12', { top: thin(), right: thin() })

  const variation = (closing: number | null, opening: number | null) =>
    closing !== null && opening !== null ? roundCents(closing - opening) : null
  const systemVariation = variation(balances.systemClosing, balances.systemOpening)
  const bankVariation = variation(balances.bankClosing, balances.bankOpening)
  const difference = systemVariation !== null && bankVariation !== null ? roundCents(bankVariation - systemVariation) : null

  const checkRows: [number, string, string, number | null][] = [
    [13, 'Var. Atua', 'J6-J5', systemVariation],
    [14, 'Var. Banco', 'J10-J9', bankVariation],
    [15, 'Diferença', 'J14-J13', difference],
  ]
  for (const [r, label, formula, result] of checkRows) {
    const labelCell = ws.getCell(`I${r}`)
    labelCell.value = label
    labelCell.font = { name: FONT, size: 12, bold: true }
    labelCell.border = { left: thin(), ...(r === 15 ? { bottom: thin() } : {}) }
    const valueCell = ws.getCell(`J${r}`)
    valueCell.value = result === null ? null : { formula, result }
    valueCell.numFmt = MONEY_FORMAT
    valueCell.font = { name: FONT, size: 12 }
    valueCell.border = { right: thin(), ...(r === 15 ? { bottom: thin() } : {}) }
  }
}

function balanceBlock(
  ws: ExcelJS.Worksheet,
  top: number,
  label: string,
  color: string,
  opening: number | null,
  closing: number | null
): void {
  ws.mergeCells(`I${top}:J${top}`)
  const head = ws.getCell(`I${top}`)
  head.value = label
  head.font = { name: FONT, size: 12, bold: true, color: { argb: WHITE } }
  head.fill = solid(color)
  head.alignment = { horizontal: 'center', vertical: 'middle' }
  head.border = { top: thin(), left: thin(), right: thin() }
  setBorder(ws, `J${top}`, { top: thin(), right: thin() })

  const lines: [number, string, number | null][] = [
    [top + 1, 'Inicial', opening],
    [top + 2, 'Final', closing],
  ]
  for (const [r, text, value] of lines) {
    const last = r === top + 2
    const labelCell = ws.getCell(`I${r}`)
    labelCell.value = text
    labelCell.font = { name: FONT, size: 12, bold: true }
    labelCell.alignment = { vertical: 'middle' }
    labelCell.border = { left: thin(), ...(last ? { bottom: thin() } : {}) }
    const valueCell = ws.getCell(`J${r}`)
    valueCell.value = value
    valueCell.numFmt = MONEY_FORMAT
    valueCell.font = { name: FONT, size: 12 }
    valueCell.alignment = { vertical: 'middle' }
    valueCell.border = { right: thin(), ...(last ? { bottom: thin() } : {}) }
  }
}

function medium(): Partial<ExcelJS.Border> {
  return { style: 'medium' }
}

function thin(): Partial<ExcelJS.Border> {
  return { style: 'thin' }
}

function setBorder(ws: ExcelJS.Worksheet, addr: string, border: Border): void {
  ws.getCell(addr).border = { ...ws.getCell(addr).border, ...border }
}

/** Conciliação_15.09.xlsx · Conciliação_CAIXA_15.09.xlsx · Conciliação_14.09_a_15.09.xlsx */
export function exportFileName(period: Period, sheetName?: string): string {
  const short = (iso: string) => {
    const [, m, d] = iso.split('-')
    return `${d}.${m}`
  }
  const dates = period.start === period.end ? short(period.start) : `${short(period.start)}_a_${short(period.end)}`
  const bank = sheetName ? `_${sheetName.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()}` : ''
  return `Conciliação${bank}_${dates}.xlsx`
}

export async function downloadBankWorkbook(accounts: AccountResult[], fileName: string): Promise<void> {
  const workbook = await buildBankWorkbook(accounts)
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
