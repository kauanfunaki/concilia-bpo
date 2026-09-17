/** Remove acentos: "Situação" → "Situacao" */
export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Texto de comparação: sem acento, minúsculo, espaços simples */
export function normalizeText(text: string): string {
  return stripAccents(text).toLowerCase().replace(/[\s\u00a0]+/g, ' ').trim()
}

/** Chave de conta: "Caixa  Econômica" → "CAIXA ECONOMICA" */
export function accountKey(name: string): string {
  return normalizeText(name).toUpperCase()
}

/** Conteúdo de célula como texto limpo ("" para vazio) */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}
