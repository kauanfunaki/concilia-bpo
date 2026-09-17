import type { Period, SystemAccount, SystemReport } from '../../types/bankReconciliation'
import { parseDate, parseMoney, roundCents } from './money'
import { accountKey, cellText, normalizeText } from './text'

// Colunas do "Rel. Caixa Financeiro" exportado do Atua
const REQUIRED_COLUMNS = [
  'dt_lancamento',
  'ds_historico_lancamento',
  'nm_caixa_financeiro',
  'vl_credito',
  'vl_debito',
  'vl_saldo',
]

const HEADER_SCAN_ROWS = 15

/**
 * Lê o relatório de caixa do Atua (linhas cruas da planilha, cabeçalho incluso).
 *
 * O relatório vem agrupado por conta: cada grupo abre com a linha "Saldo Anterior"
 * (saldo inicial em vl_saldo) e segue com os lançamentos, cada um com o saldo corrido.
 * Crédito entra positivo e débito negativo, independente do sinal gravado no arquivo.
 */
export function parseAtuaReport(rows: unknown[][], fileName: string): SystemReport {
  const headerIndex = findHeaderRow(rows)
  if (headerIndex < 0) {
    const firstRow = (rows[0] ?? []).map((c) => normalizeText(cellText(c)))
    const missing = REQUIRED_COLUMNS.filter((col) => !firstRow.includes(col))
    throw new Error(
      `Não reconheci o relatório do sistema: faltam as colunas ${missing.join(', ')}. ` +
        'Use o "Rel. Caixa Financeiro" exportado do Atua.'
    )
  }

  const header = rows[headerIndex].map((c) => normalizeText(cellText(c)))
  const col = (name: string) => header.indexOf(name)
  const idx = {
    id: col('cd_lancamento'),
    date: col('dt_lancamento'),
    document: col('nr_documento'),
    history: col('ds_historico_lancamento'),
    complement: col('ds_complemento'),
    code: col('cd_caixa_financeiro'),
    account: col('nm_caixa_financeiro'),
    credit: col('vl_credito'),
    debit: col('vl_debito'),
    balance: col('vl_saldo'),
  }
  const at = (row: unknown[], i: number) => (i >= 0 ? row[i] : null)

  const accounts = new Map<string, SystemAccount>()
  const dates: string[] = []
  const undated: { account: SystemAccount; position: number }[] = []

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const name = cellText(at(row, idx.account))
    if (!name) continue

    const key = accountKey(name)
    let account = accounts.get(key)
    if (!account) {
      account = {
        key,
        code: cellText(at(row, idx.code)),
        name,
        openingBalance: null,
        closingBalance: null,
        entries: [],
      }
      accounts.set(key, account)
    }

    const history = cellText(at(row, idx.history))
    const date = parseDate(at(row, idx.date))
    if (date) dates.push(date)
    const balance = parseMoney(at(row, idx.balance))

    if (normalizeText(history) === 'saldo anterior') {
      if (account.openingBalance === null) account.openingBalance = balance
      if (account.entries.length === 0) account.closingBalance = balance
      continue
    }

    const credit = Math.abs(parseMoney(at(row, idx.credit)) ?? 0)
    const debit = Math.abs(parseMoney(at(row, idx.debit)) ?? 0)
    const amount = roundCents(credit - debit)
    if (amount === 0 && !history) continue

    if (!date) undated.push({ account, position: account.entries.length })
    account.entries.push({
      id: cellText(at(row, idx.id)) || `linha-${r + 1}`,
      date: date ?? '',
      document: cellText(at(row, idx.document)),
      history,
      complement: cellText(at(row, idx.complement)),
      amount,
    })
    if (balance !== null) account.closingBalance = balance
  }

  const period: Period | null = dates.length
    ? { start: dates.reduce((a, b) => (a < b ? a : b)), end: dates.reduce((a, b) => (a > b ? a : b)) }
    : null

  // Lançamento sem data fica no início do período, para não sumir do filtro
  for (const { account, position } of undated) {
    account.entries[position].date = period?.start ?? ''
  }

  for (const account of accounts.values()) {
    if (account.closingBalance === null && account.openingBalance !== null) {
      const total = account.entries.reduce((sum, e) => sum + e.amount, 0)
      account.closingBalance = roundCents(account.openingBalance + total)
    }
  }

  if (accounts.size === 0) {
    throw new Error('O relatório do sistema não tem nenhuma conta com lançamentos.')
  }

  return { fileName, accounts: [...accounts.values()], period }
}

function findHeaderRow(rows: unknown[][]): number {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS)
  for (let r = 0; r < limit; r++) {
    const cells = (rows[r] ?? []).map((c) => normalizeText(cellText(c)))
    if (REQUIRED_COLUMNS.every((col) => cells.includes(col))) return r
  }
  return -1
}
