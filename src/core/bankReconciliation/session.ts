import type {
  AccountProfile,
  AccountResult,
  Period,
  ResultRow,
  Situation,
  Statement,
  SystemAccount,
  SystemReport,
} from '../../types/bankReconciliation'
import { SITUATIONS } from '../../types/bankReconciliation'
import { defaultProfile, isInovatiReport, sheetPosition } from './accountProfiles'
import { reconcileAccount } from './matcher'
import { roundCents } from './money'
import { inPeriod, statementPeriodBalance, sumAmounts } from './statementBalance'

export interface LinkedStatement {
  statement: Statement
  accountKey: string | null
}

/** Junta extratos da mesma conta (ex.: um arquivo por dia) numa sequência só */
export function mergeStatements(statements: Statement[]): Pick<Statement, 'movements' | 'balances'> {
  if (statements.length === 1) return statements[0]
  const step = 1_000_000
  const ordered = [...statements].sort((a, b) => firstDate(a).localeCompare(firstDate(b)))
  return {
    movements: ordered.flatMap((s, i) => s.movements.map((m) => ({ ...m, id: `${i}:${m.id}`, order: i * step + m.order }))),
    balances: ordered.flatMap((s, i) => s.balances.map((b) => ({ ...b, order: i * step + b.order }))),
  }
}

function firstDate(statement: Statement): string {
  return statement.movements.reduce((min, m) => (min === '' || m.date < min ? m.date : min), '')
}

/** Concilia todas as contas que têm extrato vinculado, na ordem das abas do relatório */
export function buildAccountResults(
  system: SystemReport,
  extraAccounts: SystemAccount[],
  statements: LinkedStatement[],
  period: Period,
  savedProfiles: Record<string, Partial<AccountProfile>>
): AccountResult[] {
  const inovati = isInovatiReport(system.accounts)
  const accounts = [...system.accounts, ...extraAccounts]
  const built: { result: AccountResult; position: number }[] = []

  accounts.forEach((account, index) => {
    const linked = statements.filter((s) => s.accountKey === account.key).map((s) => s.statement)
    if (linked.length === 0) return

    const merged = mergeStatements(linked)
    // Linha incluída à mão e deixada com valor zero não é movimento
    const movements = merged.movements.filter((m) => inPeriod(m.date, period) && m.amount !== 0)
    const entries = account.entries.filter((e) => inPeriod(e.date, period))
    const bank = statementPeriodBalance(merged, period)

    // Saldo do sistema recalculado para o período escolhido (o relatório pode cobrir mais dias)
    let systemOpening: number | null = null
    let systemClosing: number | null = null
    if (account.openingBalance !== null) {
      const before = account.entries.filter((e) => e.date < period.start)
      systemOpening = roundCents(account.openingBalance + sumAmounts(before))
      systemClosing = roundCents(systemOpening + sumAmounts(entries))
    }

    built.push({
      position: sheetPosition(account.key, inovati, index),
      result: {
        accountKey: account.key,
        accountName: account.name,
        statementNames: linked.map((s) => s.fileName),
        profile: { ...defaultProfile(account, inovati), ...savedProfiles[account.key] },
        rows: reconcileAccount(entries, movements),
        balances: {
          systemOpening,
          systemClosing,
          bankOpening: bank.opening,
          bankClosing: bank.closing,
        },
        statementTotal: sumAmounts(movements),
      },
    })
  })

  return built.sort((a, b) => a.position - b.position).map((b) => b.result)
}

const RECONCILED: Situation[] = ['Lançamento conciliado', 'Valores iguais']

export interface AccountSummary {
  counts: Record<Situation, number>
  // Linhas que pedem olhar humano: tudo que não é "Lançamento conciliado"
  attention: number
  systemVariation: number | null
  bankVariation: number | null
  // Variação do banco − variação do sistema
  difference: number | null
  // Pendências do extrato − pendências do sistema: é o que precisa explicar a diferença
  explained: number
  closes: boolean | null
  // Saldo inicial do extrato + movimentos do período = saldo final do extrato
  statementCloses: boolean | null
}

export function summarizeAccount(result: AccountResult): AccountSummary {
  const counts = Object.fromEntries(SITUATIONS.map((s) => [s, 0])) as Record<Situation, number>
  let pendingStatement = 0
  let pendingSystem = 0
  for (const row of result.rows) {
    counts[row.situation]++
    if (RECONCILED.includes(row.situation)) continue
    if (row.source === 'statement') pendingStatement += row.amount
    else pendingSystem += row.amount
  }

  const { systemOpening, systemClosing, bankOpening, bankClosing } = result.balances
  const systemVariation = systemOpening !== null && systemClosing !== null ? roundCents(systemClosing - systemOpening) : null
  const bankVariation = bankOpening !== null && bankClosing !== null ? roundCents(bankClosing - bankOpening) : null
  const difference = systemVariation !== null && bankVariation !== null ? roundCents(bankVariation - systemVariation) : null
  const explained = roundCents(pendingStatement - pendingSystem)

  return {
    counts,
    attention: result.rows.length - counts['Lançamento conciliado'],
    systemVariation,
    bankVariation,
    difference,
    explained,
    closes: difference === null ? null : Math.abs(difference - explained) < 0.005,
    statementCloses:
      bankOpening === null || bankClosing === null ? null : Math.abs(bankOpening + result.statementTotal - bankClosing) < 0.005,
  }
}

export function updateRow(result: AccountResult, rowId: string, patch: Partial<Pick<ResultRow, 'situation' | 'document'>>): AccountResult {
  return {
    ...result,
    rows: result.rows.map((row) => (row.id === rowId ? { ...row, ...patch, edited: true } : row)),
  }
}
