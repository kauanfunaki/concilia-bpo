import { normalizeText } from './text'

/**
 * Registros que o banco lança aos pares quando aplica e resgata a conta remunerada:
 * o dinheiro não sai da empresa, só muda de bolso dentro do banco. Não têm lançamento
 * correspondente no sistema do cliente e ficam fora da conciliação.
 */
export const REDUNDANT_RECORDS = [
  'Aplicação Conta Remunerada',
  'Débito na Conta Corrente',
  'Resgate Conta Remunerada',
  'Crédito na Conta Corrente',
]

function clean(text: string): string {
  return normalizeText(text).replace(/[^a-z0-9]+/g, ' ').trim()
}

const CLEAN_RECORDS = REDUNDANT_RECORDS.map(clean)

/** O texto é um dos registros redundantes (ou começa por um deles, seguido de complemento) */
export function isRedundantText(text: string): boolean {
  const t = clean(text)
  return t !== '' && CLEAN_RECORDS.some((r) => t === r || t.startsWith(`${r} `))
}
