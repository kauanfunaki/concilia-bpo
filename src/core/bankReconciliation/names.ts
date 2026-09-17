import { normalizeText } from './text'

/**
 * Comparação de nomes entre extrato e sistema.
 *
 * O mesmo favorecido chega escrito de formas diferentes ("ALFATECH" no banco,
 * "ALFA TECH / ALFATECNOLOGIA LTDA" no sistema; "VIAPASS S A" × "VIAPASS SA"), então a
 * comparação é por palavras significativas, com tolerância a abreviação e a uma letra
 * trocada. O nome nunca casa sozinho: serve para desempatar valores repetidos e para
 * agrupar lançamentos que somam um movimento.
 */

// Palavras que não identificam ninguém: forma jurídica, tipo de operação, conectivos
const STOPWORDS = new Set([
  'a', 'o', 'e', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'para', 'pra', 'p', 'por', 'com', 'sem',
  'ltda', 'ltd', 'sa', 's', 'me', 'epp', 'eireli', 'mei', 'cia', 'inc', 'sociedade', 'individual',
  'pix', 'ted', 'doc', 'tef', 'transf', 'transferencia', 'enviado', 'enviada', 'recebido', 'recebida',
  'pagamento', 'pagto', 'pgto', 'pag', 'boleto', 'titulo', 'liquidacao', 'liq', 'ref', 'nr', 'n', 'num',
  'numero', 'documento', 'deb', 'cred', 'debito', 'credito', 'chave', 'qr', 'cod', 'codigo', 'din',
  'dados', 'conta', 'contas', 'cc', 'ag', 'agencia', 'banco', 'bco', 'cnpj', 'cpf', 'valor', 'quantidade',
  'parcela', 'parcelas', 'fatura', 'receb', 'recebimento', 'entre', 'outros', 'despesas', 'despesa',
  'diversas', 'tarifa', 'tarifas', 'bancaria', 'bancarias', 'nf',
])

export function nameTokens(text: string): string[] {
  const tokens = normalizeText(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !STOPWORDS.has(t))
  return [...new Set(tokens)]
}

function levenshteinAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (a.length < b.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  // Abreviação: "transp" × "transportes", "logistic" × "logistica"
  if (short.length >= 4 && long.startsWith(short)) return true
  // Uma letra trocada: "sentinnela" × "sentinela"
  return short.length >= 5 && levenshteinAtMostOne(a, b)
}

/**
 * Semelhança entre dois nomes, de 0 a 1: fração das palavras do nome mais curto
 * que aparecem no outro. Nomes grudados ("alfatech" dentro de "alfatechalfatecnologia")
 * contam como quase iguais.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (ta.length === 0 || tb.length === 0) return 0

  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  const hits = small.filter((t) => large.some((u) => tokensMatch(t, u))).length
  let score = hits / small.length

  const joinedA = ta.join('')
  const joinedB = tb.join('')
  if (score < 0.9 && Math.min(joinedA.length, joinedB.length) >= 5 && (joinedA.includes(joinedB) || joinedB.includes(joinedA))) {
    score = 0.9
  }
  return score
}
