import type { ProFrotasSheet } from '../proFrotas/sheet'
import { parseDate, parseMoney, roundCents, formatMoney } from '../bankReconciliation/money'
import { cellText, normalizeText } from '../bankReconciliation/text'
import { paymentFamily } from './classify'
import type { Period } from '../../types/bankReconciliation'
import type { SispagPayment, SispagReport } from '../../types/sispag'

/**
 * Lê a "Consulta de pagamentos" do SISPAG exportada do Itaú Empresas (.xls ou .xlsx).
 *
 * O arquivo abre com um bloco "Dados da conta" (agência/conta, empresa, CNPJ, período e
 * modalidade) e segue com a tabela: favorecido, CPF/CNPJ, tipo de pagamento, referência,
 * data, valor e status. A última linha é o "Total:". Outras abas (conferência feita à mão,
 * por exemplo) ficam de fora: vale a aba com mais pagamentos.
 */

type Field = 'payee' | 'document' | 'type' | 'reference' | 'date' | 'amount' | 'status'

// Títulos das colunas, sem acento e em minúsculas
const FIELD_TITLES: [Field, RegExp][] = [
  ['payee', /favorecido|beneficiario/],
  ['document', /cpf|cnpj/],
  ['type', /tipo/],
  ['reference', /referencia/],
  ['date', /data/],
  ['amount', /valor/],
  ['status', /status|situacao/],
]
const REQUIRED: Field[] = ['payee', 'date', 'amount', 'status']
const FIELD_NAME: Record<Field, string> = {
  payee: 'favorecido / beneficiário',
  document: 'CPF/CNPJ',
  type: 'tipo de pagamento',
  reference: 'referência da empresa',
  date: 'data do pagamento',
  amount: 'valor (R$)',
  status: 'status',
}

const HEADER_SEARCH_ROWS = 40

type Columns = Partial<Record<Field, number>>

function headerColumns(row: unknown[]): Columns {
  const columns: Columns = {}
  row.forEach((cell, index) => {
    const title = normalizeText(cellText(cell))
    if (!title) return
    const match = FIELD_TITLES.find(([field, pattern]) => columns[field] === undefined && pattern.test(title))
    if (match) columns[match[0]] = index
  })
  return columns
}

function findHeader(sheet: ProFrotasSheet): { index: number; columns: Columns } | null {
  const limit = Math.min(sheet.rows.length, HEADER_SEARCH_ROWS)
  for (let r = 0; r < limit; r++) {
    const columns = headerColumns(sheet.rows[r] ?? [])
    if (REQUIRED.every((f) => columns[f] !== undefined)) return { index: r, columns }
  }
  return null
}

/** Rótulo "Período:" seguido do valor na próxima célula preenchida da mesma linha */
function readAccountData(rows: unknown[][]): Pick<SispagReport, 'company' | 'cnpj' | 'account' | 'modality' | 'period'> {
  const data = { company: '', cnpj: '', account: '', modality: '', period: null as Period | null }
  for (const row of rows) {
    const cells = (row ?? []).map(cellText)
    cells.forEach((cell, i) => {
      const label = normalizeText(cell).replace(/\s*:$/, '').replace(/\s*\/\s*/g, '/')
      const value = cells.slice(i + 1).find(Boolean) ?? ''
      if (!value) return
      if (label === 'agencia/conta') data.account = value
      else if (label === 'nome da empresa') data.company = value
      else if (label === 'cnpj') data.cnpj = value
      else if (label === 'modalidade') data.modality = value
      else if (label === 'periodo') {
        const dates = (value.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) ?? []).map((d) => parseDate(d)).filter((d): d is string => d !== null)
        if (dates.length >= 2) data.period = { start: dates[0], end: dates[dates.length - 1] }
      }
    })
  }
  return data
}

function isDone(status: string): boolean {
  const s = normalizeText(status)
  return !/\bnao\b|cancel|rejeit|recus|devolv|estorn|pendente|agendad/.test(s) && /^(efetuad|pago|liquidad|realizad)/.test(s)
}

function parseSheet(sheet: ProFrotasSheet, fileName: string): SispagReport | null {
  const header = findHeader(sheet)
  if (!header) return null
  const { index, columns } = header
  const at = (row: unknown[], field: Field) => (columns[field] === undefined ? null : row[columns[field]!])

  const payments: SispagPayment[] = []
  let fileTotal: number | null = null
  let skipped = 0
  for (let r = index + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? []
    const payee = cellText(at(row, 'payee'))
    if (/^total\b/.test(normalizeText(cellText(row[0]) || payee))) {
      fileTotal = parseMoney(at(row, 'amount'))
      continue
    }
    const date = parseDate(at(row, 'date'))
    const amount = parseMoney(at(row, 'amount'))
    // Linha em branco ou soma solta no fim da planilha
    if (!date && !payee) continue
    if (!date || amount === null) {
      skipped++
      continue
    }
    const row1 = sheet.firstRow + r
    const type = cellText(at(row, 'type'))
    const status = cellText(at(row, 'status'))
    payments.push({
      id: `L${row1}`,
      row: row1,
      payee,
      document: cellText(at(row, 'document')),
      type,
      reference: cellText(at(row, 'reference')).replace(/^-$/, ''),
      date,
      amount: Math.abs(amount),
      status,
      done: isDone(status),
      family: paymentFamily(type),
    })
  }

  const data = readAccountData(sheet.rows.slice(0, index))
  const warnings: string[] = []
  if (skipped > 0) warnings.push(`${skipped} linha(s) sem data ou valor legível ficaram de fora.`)
  if (fileTotal !== null) {
    const sum = roundCents(payments.reduce((s, p) => s + p.amount, 0))
    if (Math.abs(sum - fileTotal) >= 0.01) {
      warnings.push(`O "Total:" do arquivo (${formatMoney(fileTotal)}) não bate com a soma das linhas lidas (${formatMoney(sum)}).`)
    }
  }
  if (columns.type === undefined) warnings.push('Sem a coluna "tipo de pagamento": os lotes do extrato ficam mais difíceis de separar.')

  let period = data.period
  if (!period && payments.length) {
    const dates = payments.map((p) => p.date).sort()
    period = { start: dates[0], end: dates[dates.length - 1] }
  }
  return { fileName, ...data, period, payments, fileTotal, warnings }
}

export function parseSispagReport(sheets: ProFrotasSheet[], fileName: string): SispagReport {
  const reports = sheets.map((s) => parseSheet(s, fileName)).filter((r): r is SispagReport => r !== null)
  if (reports.length === 0) {
    throw new Error(
      `Não reconheci o relatório SISPAG: procurei as colunas ${REQUIRED.map((f) => `"${FIELD_NAME[f]}"`).join(', ')}. ` +
        'Use a "Consulta de pagamentos" do SISPAG exportada em Excel.'
    )
  }
  const best = reports.reduce((a, b) => (b.payments.length > a.payments.length ? b : a))
  if (best.payments.length === 0) throw new Error('O relatório SISPAG não tem nenhum pagamento.')
  return best
}
