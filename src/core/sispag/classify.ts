import { normalizeText } from '../bankReconciliation/text'
import type { MovementKind, PaymentFamily } from '../../types/sispag'

/**
 * Família pelo "tipo de pagamento" do relatório SISPAG ("TED outro titular", "DARF código de
 * barras", "PIX Transferências"…). Tipo desconhecido vale como fornecedor, que é o lote genérico.
 */
export function paymentFamily(type: string): PaymentFamily {
  const t = normalizeText(type)
  if (/\bted\b/.test(t) && /mesmo titular/.test(t)) return 'ownTransfer'
  if (/\b(ted|doc)\b/.test(t)) return 'ted'
  if (/salari|folha/.test(t)) return 'salary'
  if (/darf|\bdas\b|\bgps\b|fgts|tribut|iptu|\biss\b|ipva|\bgare\b|dpvat|impost|\binss\b|icms/.test(t)) return 'tax'
  return 'supplier'
}

export interface MovementClass {
  kind: MovementKind
  family: PaymentFamily | null
}

// Débitos do SISPAG, do histórico mais específico para o mais genérico. Os PDFs de 2025 trazem
// "Sispag Fornecedores", "Sispag Fornecedores TED", "Sispag Transf Titul TED", "Sispag Tributos"
// e "Sispag Salários"; o OFX de 2026 traz "PAGAMENTOS A FORNECEDORES <favorecido> <CPF/CNPJ>"
const DEBITS: [RegExp, PaymentFamily][] = [
  [/^sispag transf(erencia)? (titul|mesmo)/, 'ownTransfer'],
  [/^sispag .*\bted\b/, 'ted'],
  [/^(sispag (tributos|impostos)|pagamentos? de tributos)/, 'tax'],
  [/^(sispag (sal|folha)|pagamentos? de salarios)/, 'salary'],
  [/^(sispag\b|pagamentos? a fornecedores|pagto fornec)/, 'supplier'],
]

// Créditos que desfazem um débito do SISPAG: "Dev TED 078952 MOT02", "Est Sispag Fornecedores"
const RETURN = /^(dev(ol(ucao)?)?\.? ?ted|ted devolvid)/
const REVERSAL = /^(est(orno)?\.? (sispag|pagamentos? a fornecedores|pagto fornec))/

/** O papel da linha do extrato na conferência, pelo histórico e pelo sinal */
export function classifyMovement(description: string, amount: number): MovementClass {
  const text = normalizeText(description)
  if (amount > 0) {
    if (RETURN.test(text)) return { kind: 'return', family: null }
    if (REVERSAL.test(text)) return { kind: 'reversal', family: null }
    return { kind: 'other', family: null }
  }
  if (amount < 0) {
    for (const [pattern, family] of DEBITS) {
      if (pattern.test(text)) return { kind: 'payment', family }
    }
  }
  return { kind: 'other', family: null }
}

const DOCUMENT_AT_END = /\s+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11}|\d{14})$/
const PAYMENT_PREFIX = /^(pagamentos? a fornecedores|sispag (tributos|fornecedores|salarios|salários))\s+/i

/**
 * Favorecido e CPF/CNPJ do histórico: "PAGAMENTOS A FORNECEDORES ACME LTDA 12.345.678/0001-90".
 * Sem documento no fim não há nome confiável: "Sispag Fornecedores TED" é só o lote.
 */
export function splitCounterparty(description: string): { counterparty: string; document: string } {
  const clean = description.replace(/\s+/g, ' ').trim()
  const doc = clean.match(DOCUMENT_AT_END)
  if (!doc) return { counterparty: '', document: '' }
  const counterparty = clean.slice(0, doc.index).replace(PAYMENT_PREFIX, '').trim()
  return { counterparty, document: doc[1] }
}

/**
 * CPF/CNPJ iguais pelos dígitos. O PIX mascara o CPF ("***.456.789-**"): aí valem os dígitos
 * visíveis, nas mesmas posições.
 */
export function documentsMatch(a: string, b: string): boolean {
  const da = a.replace(/[^\d*]/g, '')
  const db = b.replace(/[^\d*]/g, '')
  if (da.replace(/\*/g, '').length < 6 || db.replace(/\*/g, '').length < 6 || da.length !== db.length) return false
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== '*' && db[i] !== '*' && da[i] !== db[i]) return false
  }
  return true
}

/** Agência e conta só com dígitos, para comparar "1234 / 56789-0" com "1234567890" */
export function accountDigits(account: string): string {
  return account.replace(/\D/g, '')
}
