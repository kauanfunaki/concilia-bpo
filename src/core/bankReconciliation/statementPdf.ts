import type { Statement, StatementBalancePoint, StatementMovement } from '../../types/bankReconciliation'
import { parseDate, parseMoney } from './money'
import { isBalanceLabel, ensureChronological } from './statementSheet'
import { normalizeText } from './text'

/**
 * Leitura de extrato em PDF — último recurso, quando o banco não oferece planilha.
 *
 * PDF não tem colunas: tem pedaços de texto soltos na página. A leitura reconstrói as
 * linhas pela altura, reconhece movimento por "data + valor" e usa três pistas para o
 * sinal: sinal escrito (-, D, parênteses), coluna Débito/Crédito do cabeçalho e o saldo
 * corrido. Pode errar, e por isso a tela obriga a conferência das linhas lidas.
 */

export interface PdfTextItem {
  page: number
  x: number
  y: number
  width: number
  height: number
  text: string
}

export interface PdfLine {
  page: number
  y: number
  height: number
  text: string
  // Trecho do texto ocupado por cada pedaço, com a posição horizontal dele na página
  spans: { start: number; end: number; x: number; width: number }[]
}

/** Agrupa os pedaços de texto em linhas: mesma página, mesma altura, da esquerda para a direita */
export function groupTextLines(items: PdfTextItem[]): PdfLine[] {
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b)
  const lines: PdfLine[] = []

  for (const page of pages) {
    // y cresce para cima no PDF: topo da página primeiro
    const sorted = items.filter((i) => i.page === page && i.text.trim()).sort((a, b) => b.y - a.y || a.x - b.x)
    let current: PdfTextItem[] = []
    let currentY = 0

    const flush = () => {
      if (current.length === 0) return
      current.sort((a, b) => a.x - b.x)
      let text = ''
      const spans: PdfLine['spans'] = []
      let previousEnd: number | null = null
      for (const item of current) {
        const piece = item.text.replace(/\s+/g, ' ')
        const gap = previousEnd === null ? 0 : item.x - previousEnd
        if (text && gap > Math.max(1, item.height * 0.15) && !text.endsWith(' ') && !piece.startsWith(' ')) text += ' '
        const start = text.length
        text += piece
        spans.push({ start, end: text.length, x: item.x, width: item.width })
        previousEnd = item.x + item.width
      }
      const height = Math.max(...current.map((i) => i.height || 0))
      lines.push({ page, y: currentY, height, text: text.trim(), spans })
      current = []
    }

    for (const item of sorted) {
      const tolerance = Math.max(2, (item.height || 8) * 0.45)
      if (current.length > 0 && Math.abs(item.y - currentY) <= tolerance) {
        current.push(item)
      } else {
        flush()
        current = [item]
        currentY = item.y
      }
    }
    flush()
  }
  return lines
}

// Valor monetário brasileiro com sinal opcional: "-1.234,56", "1.234,56 D", "(90,00)", "R$ 17,38-"
const MONEY_TOKEN =
  /(?<![\d.,])\(?[-\u2212\u2013+]?\s?(?:R\$\s?)?[-\u2212\u2013]?\s?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)\)?(?:\s?[DC](?![A-Za-zÀ-ÿ])|-(?!\d))?/g
const LEADING_DATES = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?:\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)?(?=\s|$)/
const NOISE = /\b(pagina|pag\.?\s*\d|folha \d|emitido em|gerado em|ouvidoria|sac\b|central de atendimento|www\.|https?:)/
const DEBIT_WORDS = /\b(enviad[oa]|pagamento|pagto|pgto|pag boleto|debito|deb|tarifa|saque|compra|aplicacao|iof|juros)\b/
const CREDIT_WORDS = /\b(recebid[oa]|credito|cred|deposito|estorno|resgate|devolucao|liquidacao)\b/

interface ColumnHints {
  debitX: number | null
  creditX: number | null
}

interface PdfMovement extends StatementMovement {
  explicitSign: boolean
  column: 'debit' | 'credit' | null
}

function columnHints(line: PdfLine): ColumnHints | null {
  const text = normalizeText(line.text)
  const debit = /\b(debitos?|saidas?)\b/.exec(text)
  const credit = /\b(creditos?|entradas?)\b/.exec(text)
  if (!debit || !credit) return null
  return { debitX: xAt(line, debit.index), creditX: xAt(line, credit.index) }
}

// Posição horizontal na página do caractere `index` do texto da linha
function xAt(line: PdfLine, index: number): number | null {
  // Espaço entre dois pedaços não pertence a nenhum: vale o pedaço seguinte
  const span = line.spans.find((s) => index >= s.start && index < s.end) ?? line.spans.find((s) => s.start >= index)
  if (!span) return null
  const fraction = (index - span.start) / Math.max(1, span.end - span.start)
  return span.x + span.width * fraction
}

function inferYear(lines: PdfLine[]): number | undefined {
  for (const line of lines) {
    const m = line.text.match(/\b\d{1,2}\/\d{1,2}\/(\d{4})\b/)
    if (m) return Number(m[1])
  }
  return undefined
}

type Classified =
  | { kind: 'break' }
  | { kind: 'text'; line: PdfLine; label: string }
  | { kind: 'movement'; line: PdfLine; movement: PdfMovement; before: string[]; after: string[] }

export function parseStatementPdfLines(lines: PdfLine[], fileName: string, fallbackYear?: number): Statement {
  const year = inferYear(lines) ?? fallbackYear
  const movements: PdfMovement[] = []
  const balances: StatementBalancePoint[] = []
  const classified: Classified[] = []
  let order = 0
  let currentDate: string | null = null
  let hints: ColumnHints | null = null

  // ── 1ª passada: o que é cada linha ──────────────────────────────────────────
  lines.forEach((line, lineIndex) => {
    const header = columnHints(line)
    if (header || isHeaderLine(line.text)) {
      if (header) hints = header
      classified.push({ kind: 'break' })
      return
    }
    if (NOISE.test(normalizeText(line.text))) {
      classified.push({ kind: 'break' })
      return
    }

    // Uma ou duas datas no começo (data de lançamento e data do movimento)
    let text = line.text
    let offset = 0
    let date: string | null = null
    const dates = text.match(LEADING_DATES)
    if (dates) {
      date = parseDate(dates[1], year)
      if (date) {
        offset = dates[0].length
        text = text.slice(offset)
        currentDate = date
      }
    }

    const tokens = [...text.matchAll(MONEY_TOKEN)]
    const label = text.replace(MONEY_TOKEN, ' ').replace(/\s+/g, ' ').trim()

    if (tokens.length === 0) {
      classified.push(date || !label ? { kind: 'break' } : { kind: 'text', line, label })
      return
    }

    if (isBalanceLabel(label)) {
      // "Saldo anterior" pode vir antes da primeira data: fica no começo da sequência
      const balance = parseMoney(tokens[tokens.length - 1][0])
      if (balance !== null) balances.push({ order: order++, date: date ?? currentDate ?? '', label, balance })
      classified.push({ kind: 'break' })
      return
    }
    if (!currentDate || /^total\b/.test(normalizeText(label))) {
      classified.push({ kind: 'break' })
      return
    }

    const amountToken = tokens.length >= 2 ? tokens[tokens.length - 2] : tokens[0]
    const balanceToken = tokens.length >= 2 ? tokens[tokens.length - 1] : null
    const amount = parseMoney(amountToken[0])
    if (amount === null || amount === 0) {
      classified.push({ kind: 'break' })
      return
    }

    let column: PdfMovement['column'] = null
    const activeHints = hints as ColumnHints | null
    if (activeHints?.debitX != null && activeHints.creditX != null) {
      const firstDigit = Math.max(0, amountToken[0].search(/\d/))
      const x = xAt(line, offset + (amountToken.index ?? 0) + firstDigit)
      if (x !== null) column = Math.abs(x - activeHints.debitX) <= Math.abs(x - activeHints.creditX) ? 'debit' : 'credit'
    }

    const movement: PdfMovement = {
      id: `P${line.page}-${lineIndex + 1}`,
      order: order++,
      date: date ?? currentDate,
      description: label,
      counterparty: '',
      document: '',
      amount,
      balance: balanceToken ? parseMoney(balanceToken[0]) : null,
      explicitSign: /[-\u2212\u2013(]|[DC]\s*$/.test(amountToken[0].trim()),
      column,
    }
    movements.push(movement)
    classified.push({ kind: 'movement', line, movement, before: [], after: [] })
  })

  // ── 2ª passada: texto solto é descrição que quebrou de linha ────────────────
  // Um bloco de linhas soltas entre dois movimentos é cortado no maior espaço vertical:
  // o que fica acima do corte continua o movimento de cima (célula alinhada no topo),
  // o que fica abaixo abre o movimento de baixo (célula centralizada na linha dos valores)
  let i = 0
  while (i < classified.length) {
    if (classified[i].kind !== 'text') {
      i++
      continue
    }
    let j = i
    while (j < classified.length && classified[j].kind === 'text') j++
    const block = classified.slice(i, j) as Extract<Classified, { kind: 'text' }>[]
    const above = classified[i - 1]?.kind === 'movement' ? (classified[i - 1] as Extract<Classified, { kind: 'movement' }>) : null
    const below = classified[j]?.kind === 'movement' ? (classified[j] as Extract<Classified, { kind: 'movement' }>) : null
    i = j
    if (!above && !below) continue

    const chain = [above?.line ?? null, ...block.map((b) => b.line), below?.line ?? null]
    const gaps = chain.slice(0, -1).map((line, k) => {
      const next = chain[k + 1]
      if (!line || !next || line.page !== next.page) return Infinity
      return Math.abs(line.y - next.y)
    })
    const limit = Math.max(...block.map((b) => b.line.height), 8) * 2.2

    // gaps[k] é o espaço antes de block[k]; gaps[block.length] é o espaço até o movimento de baixo
    let cut = !above ? 0 : !below ? block.length : 0
    if (above && below) {
      for (let k = 0; k <= block.length; k++) {
        if (gaps[k] >= gaps[cut]) cut = k
      }
    }
    for (let k = 0; k < cut && k < 3 && gaps[k] <= limit; k++) above?.after.push(block[k].label)
    for (let k = block.length - 1, taken = 0; k >= cut && taken < 3 && gaps[k + 1] <= limit; k--, taken++) {
      below?.before.unshift(block[k].label)
    }
  }
  for (const entry of classified) {
    if (entry.kind !== 'movement') continue
    entry.movement.description = [...entry.before, entry.movement.description, ...entry.after].join(' ').replace(/\s+/g, ' ').trim()
  }

  const warnings: string[] = []
  const unsure = applySigns(movements, balances)
  if (unsure > 0) {
    warnings.push(`${unsure} movimento(s) sem sinal claro no PDF: o sinal foi deduzido pela descrição. Confira.`)
  }

  const clean: StatementMovement[] = movements.map((m) => ({
    id: m.id,
    order: m.order,
    date: m.date,
    description: m.description,
    counterparty: m.counterparty,
    document: m.document,
    amount: m.amount,
    balance: m.balance,
  }))
  const ordered = ensureChronological(clean, balances)
  if (ordered.reversed) warnings.push('O extrato estava do mais recente para o mais antigo; a ordem foi invertida.')
  if (clean.length === 0) warnings.push('Nenhum movimento reconhecido no PDF. Se possível, use o extrato em Excel.')

  return { fileName, source: 'pdf', movements: ordered.movements, balances: ordered.balances, warnings }
}

// Linha de títulos de coluna: "Data  Histórico  Valor  Saldo"
function isHeaderLine(text: string): boolean {
  const words = normalizeText(text).split(/[^a-z]+/)
  const known = ['data', 'historico', 'descricao', 'lancamento', 'valor', 'saldo', 'documento', 'debito', 'credito', 'entradas', 'saidas']
  return words.filter((w) => known.includes(w)).length >= 3 && !/\d{1,2}\/\d{1,2}/.test(text)
}

/**
 * Define o sinal dos movimentos sem sinal escrito: coluna Débito/Crédito, depois saldo corrido,
 * depois palavras da descrição. Devolve quantos ficaram só com a descrição como pista.
 */
function applySigns(movements: PdfMovement[], balances: StatementBalancePoint[]): number {
  const sequence = [
    ...movements.map((m) => ({ order: m.order, movement: m as PdfMovement | null, balance: m.balance })),
    ...balances.map((b) => ({ order: b.order, movement: null, balance: b.balance as number | null })),
  ].sort((a, b) => a.order - b.order)

  let unsure = 0
  let previousBalance: number | null = null
  for (const step of sequence) {
    const m = step.movement
    if (m && !m.explicitSign) {
      const abs = Math.abs(m.amount)
      if (m.column) {
        m.amount = m.column === 'debit' ? -abs : abs
      } else if (previousBalance !== null && m.balance !== null && Math.abs(previousBalance - abs - m.balance) < 0.005) {
        m.amount = -abs
      } else if (previousBalance !== null && m.balance !== null && Math.abs(previousBalance + abs - m.balance) < 0.005) {
        m.amount = abs
      } else {
        const text = normalizeText(m.description)
        if (DEBIT_WORDS.test(text) && !CREDIT_WORDS.test(text)) m.amount = -abs
        else m.amount = abs
        unsure++
      }
    }
    if (step.balance !== null) previousBalance = step.balance
  }
  return unsure
}
