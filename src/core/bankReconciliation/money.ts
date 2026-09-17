/**
 * Leitura de valores e datas como chegam dos bancos e do sistema do cliente:
 * texto pt-BR ("-\u00a017,38", "1.234,56 D", "(90,00)"), número, serial do Excel.
 */

/** Arredonda para centavos: -40355.84999999998 → -40355.85 */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

/** Valor em centavos inteiros — é a chave de comparação entre extrato e sistema */
export function toCents(value: number): number {
  return Math.round(value * 100)
}

/**
 * Converte um valor monetário em número com 2 casas.
 * Retorna null quando não há valor legível.
 */
export function parseMoney(input: unknown): number | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? roundCents(input) : null
  if (typeof input !== 'string') return null

  let s = input.replace(/[\s\u00a0\u2007\u202f]/g, '').replace(/R\$/gi, '')
  if (!s) return null

  let negative = false
  if (/^\(.+\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (/^[-\u2212\u2013]/.test(s)) {
    negative = true
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }
  if (/[-\u2212\u2013]$/.test(s)) {
    negative = true
    s = s.slice(0, -1)
  }
  // Sufixo de natureza: D = débito, C = crédito
  const nature = s.match(/[DC]$/i)
  if (nature) {
    negative = nature[0].toUpperCase() === 'D'
    s = s.slice(0, -1)
  }

  if (!/^\d[\d.,]*$/.test(s)) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let normalized: string
  if (lastComma >= 0 && lastDot >= 0) {
    // O separador que aparece por último é o decimal
    normalized = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma >= 0) {
    normalized = (s.match(/,/g) ?? []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if (lastDot >= 0) {
    // "1.234" é milhar (extrato brasileiro); "12.50" é decimal
    const decimals = s.length - lastDot - 1
    normalized = (s.match(/\./g) ?? []).length > 1 || decimals === 3 ? s.replace(/\./g, '') : s
  } else {
    normalized = s
  }

  const n = Number(normalized)
  if (!Number.isFinite(n)) return null
  return roundCents(negative ? -n : n)
}

const MONTHS: Record<string, number> = {
  jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7,
  ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12,
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function fullYear(text: string): number {
  const n = Number(text)
  return text.length <= 2 ? 2000 + n : n
}

/**
 * Converte uma data em "yyyy-mm-dd".
 * Aceita dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd, "15/set/2026", serial do Excel e Date.
 * "15/09" sem ano só é aceito quando `fallbackYear` é informado.
 */
export function parseDate(input: unknown, fallbackYear?: number): string | null {
  if (input === null || input === undefined) return null

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null
    return isoDate(input.getFullYear(), input.getMonth() + 1, input.getDate())
  }

  if (typeof input === 'number') {
    // Serial do Excel entre 1954 e 2119; fora disso é número comum, não data
    if (!Number.isFinite(input) || input < 20000 || input > 80000) return null
    const d = new Date(Math.round((Math.floor(input) - 25569) * 86400000))
    return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }

  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!s) return null

  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/])/)
  if (m) return isoDate(fullYear(m[3]), Number(m[2]), Number(m[1]))

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]))

  m = s.match(/^(\d{1,2})[/.\s-]+([A-Za-zÇç]{3})[A-Za-zÇç]*\.?(?:[/.\s-]+(\d{4}|\d{2}))?$/)
  if (m) {
    const month = MONTHS[m[2].toLowerCase()]
    const year = m[3] ? fullYear(m[3]) : fallbackYear
    if (month && year) return isoDate(year, month, Number(m[1]))
    return null
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (m && fallbackYear) return isoDate(fallbackYear, Number(m[2]), Number(m[1]))

  return null
}

/** "2026-09-15" → "15/09/2026" */
export function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

/** "15/09/2026" ou "14/09/2026 a 15/09/2026" */
export function formatPeriod(period: { start: string; end: string }): string {
  return period.start === period.end
    ? formatDateBR(period.start)
    : `${formatDateBR(period.start)} a ${formatDateBR(period.end)}`
}

/** -1507.68 → "-R$ 1.507,68" */
export function formatMoney(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
