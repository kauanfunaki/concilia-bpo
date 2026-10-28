import { formatDateBR, formatMoney, parseDate, parseMoney, roundCents } from '../bankReconciliation/money'
import { groupTextLines } from '../bankReconciliation/statementPdf'
import type { PdfTextItem } from '../bankReconciliation/statementPdf'
import { cellText, normalizeText } from '../bankReconciliation/text'
import type { ProFrotasSheet } from '../proFrotas/sheet'
import { classifyMovement } from './classify'
import type { Period } from '../../types/bankReconciliation'
import type { ItauMovement, ItauStatement } from '../../types/sispag'

/**
 * "Lançamentos do período" do Itaú Empresas, exportados em PDF ou Excel: data, lançamento, razão
 * social, CPF/CNPJ, valor (com sinal) e saldo. O SISPAG vem consolidado, uma linha "SISPAG
 * FORNECEDORES" por lote, ou detalhado, uma linha "PAGAMENTOS A FORNECEDORES" por pagamento com o
 * favorecido e o CPF/CNPJ; a conferência casa os dois como casa o extrato mensal e o OFX.
 *
 * Os saldos vêm em linhas próprias: "SALDO ANTERIOR", "SALDO TOTAL DISPONÍVEL DIA" (conta mais
 * aplicação automática) e, só no Excel, "SALDO MOVIMENTAÇÃO CONTA" e "SALDO APLIC. AUT.". A leitura
 * se confere pelo saldo total de cada dia: o anterior mais os lançamentos do dia, fora as
 * aplicações e resgates automáticos, que só passam dinheiro entre a conta e a aplicação (o PDF nem
 * os mostra).
 */

interface Row {
  // Onde achar a linha no arquivo: "L12" (linha do Excel) ou "P3-5" (página do PDF)
  ref: string
  date: string | null
  description: string
  name: string
  document: string
  value: number | null
  balance: number | null
}

interface Meta {
  company: string
  account: string
  period: Period | null
}

// "APL APLIC AUT MAIS" e "RES APLIC AUT MAIS": dinheiro entre a conta e a aplicação automática
const AUTO_INVESTMENT = /^(apl|res)\.? aplic\.? aut/
const DATE_CELL = /^\d{2}\/\d{2}\/\d{4}$/
const MONEY_CELL = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/
const HEADER_SEARCH_ROWS = 40
const MAX_BALANCE_WARNINGS = 3

/** "0012287-0" vira "12287-0", como no relatório SISPAG ("7285 / 12287-0") */
function accountLabel(agency: string, account: string): string {
  const number = account.replace(/^0+(?=\d)/, '')
  return agency && number ? `${agency} / ${number}` : number
}

function periodOf(text: string): Period | null {
  const dates = (text.match(/\d{2}\/\d{2}\/\d{4}/g) ?? []).map((d) => parseDate(d)).filter((d): d is string => d !== null)
  return dates.length >= 2 ? { start: dates[0], end: dates[dates.length - 1] } : null
}

function toStatement(rows: Row[], meta: Meta, fileName: string, source: ItauStatement['source']): ItauStatement {
  const movements: ItauMovement[] = []
  const warnings: string[] = []
  let openingBalance: number | null = null
  let closingBalance: number | null = null
  // Saldo total: o anterior mais os lançamentos lidos, conferido a cada "SALDO TOTAL DISPONÍVEL DIA"
  let running: number | null = null
  let undated = 0

  for (const row of rows) {
    const label = normalizeText(row.description)
    if (row.value === null || row.value === 0) {
      if (row.balance === null) continue
      if (/^saldo anterior/.test(label)) {
        openingBalance = row.balance
        running = row.balance
      } else if (/^saldo total/.test(label)) {
        if (running !== null && Math.abs(running - row.balance) >= 0.01 && warnings.length < MAX_BALANCE_WARNINGS) {
          warnings.push(
            `O saldo de ${row.date ? formatDateBR(row.date) : 'um dia'} no extrato (${formatMoney(row.balance)}) não bate com a soma lida ` +
              `(${formatMoney(running)}): alguma linha desse dia pode ter sido lida errado.`
          )
        }
        closingBalance = row.balance
        running = row.balance
      }
      continue
    }
    if (!row.date) {
      undated++
      continue
    }
    if (running !== null && !AUTO_INVESTMENT.test(label)) running = roundCents(running + row.value)
    const { kind, family } = classifyMovement(row.description, row.value)
    movements.push({
      id: row.ref,
      order: movements.length,
      date: row.date,
      description: [row.description, row.name].filter(Boolean).join(' '),
      counterparty: row.name,
      document: row.document,
      amount: row.value,
      balance: null,
      kind,
      family,
    })
  }

  if (movements.length === 0) warnings.push('Nenhum lançamento reconhecido no extrato.')
  if (undated) warnings.push(`${undated} linha(s) com valor e sem data ficaram de fora.`)

  const dates = movements.map((m) => m.date).sort()
  return {
    fileName,
    source,
    account: meta.account,
    company: meta.company,
    period: meta.period ?? (dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null),
    openingBalance,
    closingBalance,
    movements,
    warnings,
  }
}

// ── Excel ────────────────────────────────────────────────────────────────────

type Field = 'date' | 'description' | 'name' | 'document' | 'value' | 'balance'

// Títulos das colunas, sem acento e em minúsculas
const FIELD_TITLES: [Field, RegExp][] = [
  ['date', /^data$/],
  ['description', /^(lancamentos?|historico|descricao)$/],
  ['name', /^razao social$/],
  ['document', /^(cpf\/cnpj|cnpj\/cpf)$/],
  ['value', /^valor\b/],
  ['balance', /^saldo\b/],
]

type Columns = Partial<Record<Field, number>>

function sheetHeader(sheet: ProFrotasSheet): { index: number; columns: Columns } | null {
  const limit = Math.min(sheet.rows.length, HEADER_SEARCH_ROWS)
  for (let r = 0; r < limit; r++) {
    const columns: Columns = {}
    ;(sheet.rows[r] ?? []).forEach((cell, index) => {
      const title = normalizeText(cellText(cell))
      const match = FIELD_TITLES.find(([field, pattern]) => columns[field] === undefined && pattern.test(title))
      if (match) columns[match[0]] = index
    })
    if (columns.date !== undefined && columns.description !== undefined && columns.value !== undefined) return { index: r, columns }
  }
  return null
}

/** Rótulo ("Agência:") seguido do valor na próxima célula preenchida da mesma linha */
function sheetMeta(rows: unknown[][]): Meta {
  const meta: Meta = { company: '', account: '', period: null }
  let agency = ''
  let account = ''
  for (const row of rows) {
    const cells = (row ?? []).map(cellText)
    cells.forEach((cell, i) => {
      const label = normalizeText(cell).replace(/\s*:$/, '')
      const value = cells.slice(i + 1).find(Boolean) ?? ''
      if (!value) return
      if (label === 'nome') meta.company = value
      else if (label === 'agencia') agency = value
      else if (label === 'conta') account = value
      else if (label === 'periodo') meta.period = periodOf(value)
    })
  }
  meta.account = accountLabel(agency, account)
  return meta
}

function isSispagReport(sheets: ProFrotasSheet[]): boolean {
  return sheets.some((s) =>
    s.rows.slice(0, HEADER_SEARCH_ROWS).some((row) => {
      const titles = (row ?? []).map((c) => normalizeText(cellText(c)))
      return titles.some((t) => /favorecido|beneficiario/.test(t)) && titles.includes('status')
    })
  )
}

export function parseLancamentosSheet(sheets: ProFrotasSheet[], fileName: string): ItauStatement {
  let best: { rows: Row[]; meta: Meta } | null = null
  for (const sheet of sheets) {
    const header = sheetHeader(sheet)
    if (!header) continue
    const { index, columns } = header
    const rows: Row[] = []
    for (let r = index + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? []
      const at = (field: Field) => (columns[field] === undefined ? null : row[columns[field]!])
      const description = cellText(at('description'))
      const value = parseMoney(at('value'))
      const balance = parseMoney(at('balance'))
      if (!description && value === null && balance === null) continue
      rows.push({
        ref: `L${sheet.firstRow + r}`,
        date: parseDate(at('date')),
        description,
        name: cellText(at('name')),
        document: cellText(at('document')),
        value,
        balance,
      })
    }
    if (!best || rows.length > best.rows.length) best = { rows, meta: sheetMeta(sheet.rows.slice(0, index)) }
  }
  if (!best) {
    if (isSispagReport(sheets)) {
      throw new Error('Esta planilha é o relatório SISPAG ("Consulta de pagamentos"): ele vai no passo 2. Aqui vai o extrato do Itaú.')
    }
    throw new Error(
      'Não reconheci o extrato: procurei as colunas "Data", "Lançamento" e "Valor (R$)". ' +
        'Use os "Lançamentos" do Itaú Empresas exportados em Excel.'
    )
  }
  return toStatement(best.rows, best.meta, fileName, 'excel')
}

// ── PDF ──────────────────────────────────────────────────────────────────────

interface PdfColumns {
  page: number
  // Altura do cabeçalho das colunas: o que está acima dele, na página dele, não é lançamento
  top: number
  description: number
  name: number | null
  document: number | null
  // Valores alinhados à direita: é a borda direita que diz a coluna
  valueRight: number
  balanceRight: number | null
}

/** Linha de títulos: "Data · Lançamentos · Razão Social · CNPJ/CPF · Valor (R$) · Saldo (R$)" */
function pdfColumns(items: PdfTextItem[]): PdfColumns | null {
  for (const date of items) {
    if (normalizeText(date.text) !== 'data') continue
    const line = items.filter((i) => i.page === date.page && Math.abs(i.y - date.y) <= 2)
    const find = (pattern: RegExp) => line.find((i) => pattern.test(normalizeText(i.text)))
    const description = find(/^lancamentos?$/)
    const value = find(/^valor\b/)
    if (!description || !value || !(date.x < description.x && description.x < value.x)) continue
    const name = find(/^razao social$/)
    const document = find(/^(cnpj\/cpf|cpf\/cnpj)$/)
    const balance = find(/^saldo\b/)
    return {
      page: date.page,
      top: date.y,
      description: description.x,
      name: name?.x ?? null,
      document: document?.x ?? null,
      valueRight: value.x + value.width,
      balanceRight: balance ? balance.x + balance.width : null,
    }
  }
  return null
}

/** Acima das colunas: "EMPRESA CNPJ … Agência 1234 Conta 0056789-0" e "Lançamentos do período: … até …" */
function pdfMeta(items: PdfTextItem[], columns: PdfColumns): Meta {
  const lines = groupTextLines(items.filter((i) => i.page === columns.page && i.y > columns.top + 2))
  const text = normalizeText(lines.map((l) => l.text).join(' '))
  const account = text.match(/agencia:?\s*(\d{4})\s*conta:?\s*([\d.]+-\d)/)
  return {
    // Pedaços colados ("EMPRESACNPJ") também valem
    company: lines[0] ? lines[0].text.split(/cnpj/i)[0].trim() : '',
    account: account ? accountLabel(account[1], account[2]) : '',
    period: periodOf(text.match(/periodo:?\s*(\d{2}\/\d{2}\/\d{4}\s*ate\s*\d{2}\/\d{2}\/\d{4})/)?.[1] ?? ''),
  }
}

/** Pedaços de uma célula, de cima para baixo: "SISPAG FORNECEDORES PIX QR-" + "CODE" */
function joinPieces(pieces: PdfTextItem[]): string {
  return [...pieces]
    .sort((a, b) => a.page - b.page || (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x))
    .reduce((text, item) => {
      const piece = item.text.replace(/\s+/g, ' ').trim()
      if (!piece) return text
      return !text ? piece : text.endsWith('-') ? text + piece : `${text} ${piece}`
    }, '')
}

function pdfRow(date: PdfTextItem, pieces: PdfTextItem[], c: PdfColumns, ref: string): Row {
  const aligned = (right: number | null, item: PdfTextItem) => right !== null && Math.abs(item.x + item.width - right) <= 12
  const money = pieces.filter((i) => MONEY_CELL.test(i.text.trim()))
  const valueCell = money.find((i) => aligned(c.valueRight, i))
  const balanceCell = money.find((i) => i !== valueCell && aligned(c.balanceRight, i))
  const text = pieces.filter((i) => i !== valueCell && i !== balanceCell)
  const inColumn = (from: number | null, to: (number | null)[]) => {
    const end = to.find((x): x is number => x !== null) ?? Infinity
    return from === null ? [] : text.filter((i) => i.x >= from - 4 && i.x < end - 4)
  }
  return {
    ref,
    date: parseDate(date.text.trim()),
    description: joinPieces(inColumn(c.description, [c.name, c.document])),
    name: joinPieces(inColumn(c.name, [c.document])),
    document: joinPieces(inColumn(c.document, [])),
    value: valueCell ? parseMoney(valueCell.text) : null,
    balance: balanceCell ? parseMoney(balanceCell.text) : null,
  }
}

/**
 * Cada linha começa pela data, na primeira coluna. Histórico e razão social longos quebram em duas
 * ou três linhas centradas na altura da data: cada pedaço vai para a data mais próxima. Linha que
 * a página corta ao meio continua na seguinte: o que sobra no pé da página é o começo da primeira
 * linha da próxima, e o que vem antes da primeira data é o fim da última linha da anterior.
 */
function pdfRows(items: PdfTextItem[], c: PdfColumns): Row[] {
  const body = items.filter((i) => i.text.trim() && (i.page > c.page || (i.page === c.page && i.y < c.top - 2)))
  const groups: { date: PdfTextItem; pieces: PdfTextItem[] }[] = []
  let carried: PdfTextItem[] = []
  for (const page of [...new Set(body.map((i) => i.page))].sort((a, b) => a - b)) {
    const onPage = body.filter((i) => i.page === page)
    const dates = onPage.filter((i) => i.x < c.description - 4 && DATE_CELL.test(i.text.trim())).sort((a, b) => b.y - a.y)
    const first = groups.length
    const previous = groups[first - 1]
    groups.push(...dates.map((date, i) => ({ date, pieces: i === 0 ? carried : [] })))
    const pageGroups = groups.slice(first)
    carried = []
    for (const item of onPage) {
      // Rodapé ("aviso:", "atualizado em…") começa na margem, antes da coluna de lançamento
      if (item.x < c.description - 4) continue
      if (pageGroups.length === 0) {
        carried.push(item)
        continue
      }
      const near = pageGroups.reduce((a, b) => (Math.abs(b.date.y - item.y) < Math.abs(a.date.y - item.y) ? b : a))
      if (Math.abs(near.date.y - item.y) <= (near.date.height || 9) * 1.6) near.pieces.push(item)
      else if (item.y < pageGroups[pageGroups.length - 1].date.y) carried.push(item)
      else if (item.y > pageGroups[0].date.y && previous) previous.pieces.push(item)
    }
  }
  return groups.map((g, i) => pdfRow(g.date, g.pieces, c, `P${g.date.page}-${i + 1}`))
}

/** null quando o PDF não está neste layout */
export function parseLancamentosPdf(items: PdfTextItem[], fileName: string): ItauStatement | null {
  const columns = pdfColumns(items)
  if (!columns) return null
  return toStatement(pdfRows(items, columns), pdfMeta(items, columns), fileName, 'pdf')
}
