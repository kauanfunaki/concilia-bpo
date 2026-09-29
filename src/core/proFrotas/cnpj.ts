import { cellText } from '../bankReconciliation/text'

/**
 * CNPJ como chave de comparação. Desde julho/2026 a Receita emite CNPJ alfanumérico
 * (12 caracteres A-Z/0-9 + 2 dígitos verificadores): letras não podem ser descartadas.
 */

/** "44.555.666/0001-72" → "44555666000172"; CNPJ que o Excel guardou como número volta a ter 14 */
export function normalizeCnpj(value: unknown): string {
  const text = cellText(value).toUpperCase().replace(/[^0-9A-Z]/g, '')
  return /^\d{12,13}$/.test(text) ? text.padStart(14, '0') : text
}

export function formatCnpj(cnpj: string): string {
  return cnpj.length === 14
    ? `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
    : cnpj
}

// Dígito verificador: cada caractere vale o código ASCII − 48 (0-9 → 0-9, A → 17...)
function checkDigit(base: string): number {
  let weight = 2
  let sum = 0
  for (let i = base.length - 1; i >= 0; i--) {
    sum += (base.charCodeAt(i) - 48) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}

export function isValidCnpj(cnpj: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false
  const first = checkDigit(cnpj.slice(0, 12))
  const second = checkDigit(cnpj.slice(0, 12) + first)
  return cnpj.endsWith(`${first}${second}`)
}
