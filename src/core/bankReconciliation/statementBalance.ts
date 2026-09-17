import type { Period, Statement, StatementMovement } from '../../types/bankReconciliation'
import { roundCents } from './money'

export interface StatementPeriodBalance {
  opening: number | null
  closing: number | null
}

export function inPeriod(date: string, period: Period): boolean {
  return date >= period.start && date <= period.end
}

/**
 * Saldo inicial e final do extrato no período.
 *
 * Inicial: a linha de saldo do banco logo antes do primeiro movimento do período
 * ("SALDO DIA" do dia anterior, "SALDO ANTERIOR"); sem ela, o saldo corrido do
 * primeiro movimento menos o valor dele.
 * Final: a linha de saldo logo depois do último movimento do período; sem ela,
 * o saldo corrido do último movimento; sem saldo corrido, inicial + movimentos.
 */
export function statementPeriodBalance(
  statement: Pick<Statement, 'movements' | 'balances'>,
  period: Period
): StatementPeriodBalance {
  const movements = [...statement.movements].sort((a, b) => a.order - b.order)
  const points = [...statement.balances].sort((a, b) => a.order - b.order)
  const periodMovements = movements.filter((m) => inPeriod(m.date, period))

  if (periodMovements.length === 0) {
    // Conta parada no período: vale o último saldo conhecido até o fim dele
    const known = [
      ...movements.filter((m) => m.balance !== null && m.date <= period.end).map((m) => ({ order: m.order, balance: m.balance as number })),
      ...points.filter((p) => p.date <= period.end).map((p) => ({ order: p.order, balance: p.balance })),
    ].sort((a, b) => a.order - b.order)
    const last = known.length ? known[known.length - 1].balance : null
    return { opening: last, closing: last }
  }

  const first = periodMovements[0]
  const lastMovement = periodMovements[periodMovements.length - 1]

  const previous = lastBefore(movements, first.order)
  const pointBefore = [...points]
    .reverse()
    .find((p) => p.order < first.order && (!previous || p.order > previous.order) && p.date <= period.start)

  let opening: number | null = null
  if (pointBefore) opening = pointBefore.balance
  else if (first.balance !== null) opening = roundCents(first.balance - first.amount)
  else if (previous) opening = previous.balance

  const next = movements.find((m) => m.order > lastMovement.order)
  const pointAfter = [...points]
    .reverse()
    .find((p) => p.order > lastMovement.order && (!next || p.order < next.order) && p.date <= period.end)

  let closing: number | null = pointAfter?.balance ?? lastMovement.balance
  if (closing === null && opening !== null) {
    closing = roundCents(opening + sumAmounts(periodMovements))
  }

  return { opening, closing }
}

function lastBefore(movements: StatementMovement[], order: number): StatementMovement | undefined {
  let found: StatementMovement | undefined
  for (const m of movements) {
    if (m.order < order) found = m
  }
  return found
}

export function sumAmounts(items: { amount: number }[]): number {
  return roundCents(items.reduce((sum, i) => sum + i.amount, 0))
}
