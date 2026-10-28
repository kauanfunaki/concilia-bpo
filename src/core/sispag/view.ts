import { normalizeText } from '../bankReconciliation/text'
import { parseMoney, toCents } from '../bankReconciliation/money'
import type { ItauMovement, ResultItem, SispagPayment, SispagResult } from '../../types/sispag'

/** Atalhos do resultado para a tela e a planilha: de id para linha, pagamento e item */
export interface ResultIndex {
  movement: Map<string, ItauMovement>
  payment: Map<string, SispagPayment>
  itemOfMovement: Map<string, ResultItem>
  itemsOfPayment: Map<string, ResultItem[]>
}

export function indexResult(result: SispagResult): ResultIndex {
  const index: ResultIndex = {
    movement: new Map(result.statement.movements.map((m) => [m.id, m])),
    payment: new Map(result.report.payments.map((p) => [p.id, p])),
    itemOfMovement: new Map(),
    itemsOfPayment: new Map(),
  }
  for (const item of result.items) {
    for (const id of item.movementIds) index.itemOfMovement.set(id, item)
    for (const id of item.paymentIds) index.itemsOfPayment.set(id, [...(index.itemsOfPayment.get(id) ?? []), item])
  }
  return index
}

export function itemMovements(item: ResultItem, index: ResultIndex): ItauMovement[] {
  return item.movementIds.map((id) => index.movement.get(id)).filter((m): m is ItauMovement => m !== undefined)
}

export function itemPayments(item: ResultItem, index: ResultIndex): SispagPayment[] {
  return item.paymentIds.map((id) => index.payment.get(id)).filter((p): p is SispagPayment => p !== undefined)
}

function distinct(values: string[], max: number): string {
  const unique = [...new Set(values.filter(Boolean))]
  return unique.slice(0, max).join(', ') + (unique.length > max ? '…' : '')
}

/** "Sispag Fornecedores TED" ou "3 linhas · Sispag Fornecedores TED" */
export function statementLabel(item: ResultItem, index: ResultIndex): string {
  const ms = itemMovements(item, index)
  if (ms.length <= 1) return ms[0]?.description ?? ''
  return `${ms.length} linhas · ${distinct(ms.map((m) => m.description), 2)}`
}

/** "ACME LTDA" ou "712 pagamentos · TED outro titular" */
export function reportLabel(item: ResultItem, index: ResultIndex): string {
  const ps = itemPayments(item, index)
  if (ps.length <= 1) return ps[0] ? ps[0].payee || ps[0].type : ''
  return `${ps.length} pagamentos · ${distinct(ps.map((p) => p.type), 2)}`
}

/**
 * Busca da tela: favorecido, CPF/CNPJ, referência, histórico do extrato ou valor
 * ("1.302,20", "1302,2").
 */
export function itemMatches(item: ResultItem, index: ResultIndex, query: string): boolean {
  const q = normalizeText(query)
  if (!q) return true
  const value = /^[\d.,]+$/.test(q) && /,\d{1,2}$|^\d+$/.test(q) ? parseMoney(q) : null
  if (value !== null) {
    const target = toCents(value)
    if (toCents(item.statementAmount) === target || toCents(item.reportAmount) === target) return true
    // Item com várias linhas (lotes do mesmo dia somados): vale o valor de cada linha
    if (itemMovements(item, index).some((m) => Math.abs(toCents(m.amount)) === target)) return true
    if (itemPayments(item, index).some((p) => toCents(p.amount) === target)) return true
  }
  const digits = q.replace(/\D/g, '')
  return (
    itemPayments(item, index).some(
      (p) =>
        normalizeText(p.payee).includes(q) ||
        (digits.length >= 4 && (p.document.replace(/\D/g, '').includes(digits) || p.reference.includes(digits)))
    ) || itemMovements(item, index).some((m) => normalizeText(m.description).includes(q))
  )
}
