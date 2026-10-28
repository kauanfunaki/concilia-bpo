import { normalizeText } from '../bankReconciliation/text'
import { formatDateBR, parseMoney, toCents } from '../bankReconciliation/money'
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

/**
 * Os dois itens de um pagamento: o débito, a linha (ou o lote) do extrato de onde o dinheiro
 * saiu, e a devolução ou o estorno, quando ele voltou. O pagamento devolvido está nos dois:
 * a TED que voltou no "Dev TED" também saiu no lote do dia. Sem débito no extrato, `debit` é o
 * item só do relatório (não efetuado, só no SISPAG).
 */
export function paymentItems(paymentId: string, index: ResultIndex): { debit: ResultItem | null; refund: ResultItem | null } {
  const items = index.itemsOfPayment.get(paymentId) ?? []
  return {
    debit: items.find((i) => i.rule !== 'return') ?? null,
    refund: items.find((i) => i.rule === 'return') ?? null,
  }
}

/** Na devolução, a coluna mostra o débito do pagamento; no débito, a devolução */
export function counterpartHeader(item: ResultItem): string {
  return item.rule === 'return' ? 'Débito' : 'Devolução'
}

/** Data e lançamento do outro lado: "Dev TED 311980 MOT05" ou "2 linhas · Sispag Fornecedores TED" */
export function counterpart(payment: SispagPayment, item: ResultItem, index: ResultIndex): { date: string; label: string } | null {
  const { debit, refund } = paymentItems(payment.id, index)
  const other = item.rule === 'return' ? debit : refund
  if (!other || other.movementIds.length === 0) return null
  return { date: other.date, label: statementLabel(other, index) }
}

// Tabulação e quebra de linha desmontam a colagem; "=", "+", "-" e "@" no início o Excel lê como fórmula
function pasteCell(text: string): string {
  return text.replace(/[\t\r\n]+/g, ' ').trim().replace(/^[=+\-@]+/, '')
}

/**
 * Pagamentos do item para colar no Excel: separados por tabulação, com cabeçalho, data
 * dd/mm/aaaa e valor com vírgula decimal, sem separador de milhar.
 */
export function paymentsForExcel(payments: SispagPayment[], item: ResultItem, index: ResultIndex): string {
  // Como na tela: a coluna do débito ou da devolução só vai quando algum pagamento tem
  const counterparts = payments.map((p) => {
    const c = counterpart(p, item, index)
    return c ? `${formatDateBR(c.date)} · ${c.label}` : ''
  })
  const extra = counterparts.some(Boolean)
  const header = ['Linha no Relatório', 'Data do Pagamento', 'Favorecido', 'CPF/CNPJ', 'Tipo de Pagamento', 'Status SISPAG', ...(extra ? [counterpartHeader(item)] : []), 'Valor']
  const rows = payments.map((p, i) => [
    String(p.row),
    formatDateBR(p.date),
    p.payee,
    p.document,
    p.type,
    p.status,
    ...(extra ? [counterparts[i]] : []),
    p.amount.toFixed(2).replace('.', ','),
  ])
  return [header, ...rows].map((cells) => cells.map(pasteCell).join('\t')).join('\r\n')
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
