import type {
  ColumnMapping,
  Statement,
  StatementBalancePoint,
  StatementField,
  StatementMovement,
} from '../../types/bankReconciliation'
import { parseDate, parseMoney, roundCents } from './money'
import { cellText, normalizeText } from './text'

export interface SheetRows {
  sheetName: string
  rows: unknown[][]
}

export interface SheetLayout {
  sheetName: string
  // -1 = planilha sem cabeçalho (dados desde a primeira linha)
  headerRow: number
  mapping: ColumnMapping
}

export const FIELD_LABELS: Record<StatementField, string> = {
  date: 'Data',
  description: 'Histórico / descrição',
  counterparty: 'Nome / razão social',
  document: 'Documento',
  amount: 'Valor (com sinal)',
  credit: 'Crédito',
  debit: 'Débito',
  direction: 'Natureza (D/C)',
  balance: 'Saldo',
}

// Nomes de cabeçalho reconhecidos por campo, do mais forte para o mais fraco.
// O texto do cabeçalho chega normalizado: sem acento, minúsculo.
const HEADER_PATTERNS: Record<StatementField, [RegExp, number][]> = {
  date: [
    [/^data( de)? lancamento$/, 6],
    [/^data$/, 5],
    [/^(data|dt)( d[ao])? (contabil|transacao|operacao)$/, 4],
    [/^data( d[ao])? mov(imento|imentacao)?$/, 3],
    [/^(data|dt)\b/, 2],
  ],
  description: [
    [/^(historico|descricao|lancamento|lancamentos|transacao|movimentacao|detalhes?|operacao|memo)$/, 5],
    [/^(historico|descricao)\b/, 4],
    [/\b(historico|descricao)\b/, 3],
  ],
  counterparty: [
    [/^(nome ?\/ ?razao social|razao social|favorecido|beneficiario|pagador|contraparte|remetente|destinatario|origem ?\/ ?destino)$/, 5],
    [/\b(razao social|favorecido|beneficiario|pagador|contraparte)\b/, 4],
    [/^nome\b/, 3],
  ],
  document: [
    [/^(documento|doc|n\.? ?doc\.?|nr\.? ?documento|n[o°º]?\.? ?(do )?documento|numero( do)? documento)$/, 5],
    [/\bdocumento\b/, 3],
  ],
  amount: [
    [/^valor( (do )?lancamento| da transacao| ?\(?r\$\)?)?$/, 6],
    [/^(montante|quantia)$/, 4],
    [/^valor\b/, 3],
  ],
  credit: [[/^(creditos?|entradas?|valor( do)? credito)( ?\(?r\$\)?)?$/, 5]],
  debit: [[/^(debitos?|saidas?|valor( do)? debito)( ?\(?r\$\)?)?$/, 5]],
  direction: [[/^(d ?\/ ?c|c ?\/ ?d|natureza|deb ?\/ ?cred|cred ?\/ ?deb|tipo|sinal)$/, 4]],
  balance: [
    [/^saldo( ?\(?r\$\)?| do dia| apos( o)? lancamento| final| atual)?$/, 5],
    [/^saldo\b/, 3],
  ],
}

const HEADER_SCAN_ROWS = 40

function headerScore(text: string): { field: StatementField; weight: number }[] {
  const h = normalizeText(text).replace(/:$/, '')
  if (!h) return []
  const found: { field: StatementField; weight: number }[] = []
  for (const field of Object.keys(HEADER_PATTERNS) as StatementField[]) {
    for (const [pattern, weight] of HEADER_PATTERNS[field]) {
      if (pattern.test(h)) {
        found.push({ field, weight })
        break
      }
    }
  }
  return found
}

/** Atribui colunas a campos: cada campo uma coluna, o mais forte primeiro */
function mapHeaderRow(cells: unknown[]): ColumnMapping {
  const candidates: { field: StatementField; col: number; weight: number }[] = []
  cells.forEach((cell, col) => {
    for (const { field, weight } of headerScore(cellText(cell))) candidates.push({ field, col, weight })
  })
  candidates.sort((a, b) => b.weight - a.weight || a.col - b.col)

  const mapping: ColumnMapping = {}
  const usedCols = new Set<number>()
  for (const c of candidates) {
    if (mapping[c.field] !== undefined || usedCols.has(c.col)) continue
    mapping[c.field] = c.col
    usedCols.add(c.col)
  }
  return mapping
}

export function isMappingUsable(mapping: ColumnMapping): boolean {
  const hasValue = mapping.amount !== undefined || mapping.credit !== undefined || mapping.debit !== undefined
  return mapping.date !== undefined && hasValue
}

/** Procura a linha de cabeçalho do extrato nas primeiras linhas da aba */
export function detectLayout(sheet: SheetRows): SheetLayout | null {
  let best: SheetLayout | null = null
  let bestCount = 0
  const limit = Math.min(sheet.rows.length, HEADER_SCAN_ROWS)
  for (let r = 0; r < limit; r++) {
    const mapping = mapHeaderRow(sheet.rows[r] ?? [])
    if (!isMappingUsable(mapping)) continue
    const count = Object.keys(mapping).length
    if (count > bestCount) {
      best = { sheetName: sheet.sheetName, headerRow: r, mapping }
      bestCount = count
    }
  }
  return best
}

export function isBalanceLabel(label: string): boolean {
  return /^s ?a ?l ?d ?o\b/.test(normalizeText(label))
}

/** Lê os movimentos de uma aba com o layout (cabeçalho + colunas) informado */
export function parseStatementRows(
  rows: unknown[][],
  layout: Pick<SheetLayout, 'headerRow' | 'mapping'>,
  fallbackYear?: number
): Pick<Statement, 'movements' | 'balances' | 'warnings'> {
  const { mapping } = layout
  const at = (row: unknown[], field: StatementField) => {
    const i = mapping[field]
    return i === undefined ? null : row[i]
  }

  const movements: StatementMovement[] = []
  const balances: StatementBalancePoint[] = []
  let order = 0
  let ignored = 0
  let lastDate = ''

  for (let r = layout.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const description = cellText(at(row, 'description'))
    const counterparty = cellText(at(row, 'counterparty'))
    const balance = parseMoney(at(row, 'balance'))
    const date = parseDate(at(row, 'date'), fallbackYear)

    if (!date) {
      // "SALDO ANTERIOR" sem data no topo, "SALDO FINAL" sem data no rodapé
      const undatedBalance = isBalanceLabel(description || counterparty) ? balance ?? parseMoney(at(row, 'amount')) : null
      if (undatedBalance !== null) {
        balances.push({ order: order++, date: lastDate, label: description || counterparty, balance: undatedBalance })
      } else if (row.some((c) => cellText(c) !== '')) {
        ignored++
      }
      continue
    }
    lastDate = date

    let amount: number | null
    if (mapping.amount !== undefined) {
      amount = parseMoney(at(row, 'amount'))
      const nature = normalizeText(cellText(at(row, 'direction')))
      if (amount !== null && nature) {
        if (/^(d|-)/.test(nature)) amount = -Math.abs(amount)
        else if (/^(c|\+)/.test(nature)) amount = Math.abs(amount)
      }
    } else {
      const credit = parseMoney(at(row, 'credit'))
      const debit = parseMoney(at(row, 'debit'))
      amount = credit === null && debit === null ? null : roundCents(Math.abs(credit ?? 0) - Math.abs(debit ?? 0))
    }

    const label = description || counterparty
    if (isBalanceLabel(label)) {
      const value = balance ?? amount
      if (value !== null) balances.push({ order: order++, date, label, balance: value })
      continue
    }
    if (amount === null || amount === 0) {
      ignored++
      continue
    }

    movements.push({
      id: `L${r + 1}`,
      order: order++,
      date,
      description,
      counterparty,
      document: cellText(at(row, 'document')),
      amount,
      balance,
    })
  }

  const ordered = ensureChronological(movements, balances)
  const warnings: string[] = []
  if (ordered.reversed) warnings.push('O extrato estava do mais recente para o mais antigo; a ordem foi invertida.')
  if (ignored > 0) warnings.push(`${ignored} linha(s) sem data ou sem valor foram ignoradas.`)
  return { movements: ordered.movements, balances: ordered.balances, warnings }
}

/**
 * Alguns bancos listam do mais recente para o mais antigo. O saldo corrido só faz
 * sentido em ordem cronológica, então a sequência é invertida quando for o caso.
 */
export function ensureChronological(
  movements: StatementMovement[],
  balances: StatementBalancePoint[]
): { movements: StatementMovement[]; balances: StatementBalancePoint[]; reversed: boolean } {
  const all = [...movements, ...balances].sort((a, b) => a.order - b.order)
  if (all.length < 2) return { movements, balances, reversed: false }

  const first = all[0].date
  const last = all[all.length - 1].date
  let reverse = first > last
  if (first === last) {
    reverse = runningBalanceHits([...movements].reverse()) > runningBalanceHits(movements)
  }
  if (!reverse) return { movements, balances, reversed: false }

  const total = all.length
  return {
    movements: movements.map((m) => ({ ...m, order: total - 1 - m.order })).sort((a, b) => a.order - b.order),
    balances: balances.map((b) => ({ ...b, order: total - 1 - b.order })).sort((a, b) => a.order - b.order),
    reversed: true,
  }
}

function runningBalanceHits(movements: StatementMovement[]): number {
  let hits = 0
  for (let i = 1; i < movements.length; i++) {
    const prev = movements[i - 1].balance
    const cur = movements[i].balance
    if (prev !== null && cur !== null && Math.abs(prev + movements[i].amount - cur) < 0.005) hits++
  }
  return hits
}

/**
 * Lê um extrato em planilha: escolhe a aba e o cabeçalho reconhecidos com mais movimentos.
 * Sem cabeçalho reconhecido, devolve o extrato vazio com aviso — a tela pede o mapeamento.
 */
export function parseStatementWorkbook(
  sheets: SheetRows[],
  fileName: string,
  fallbackYear?: number
): { statement: Statement; layout: SheetLayout | null } {
  let best: { statement: Statement; layout: SheetLayout } | null = null
  for (const sheet of sheets) {
    const layout = detectLayout(sheet)
    if (!layout) continue
    const parsed = parseStatementRows(sheet.rows, layout, fallbackYear)
    if (!best || parsed.movements.length > best.statement.movements.length) {
      best = { statement: { fileName, source: 'excel', ...parsed }, layout }
    }
  }
  if (best) return best
  return {
    statement: {
      fileName,
      source: 'excel',
      movements: [],
      balances: [],
      warnings: ['Não reconheci as colunas do extrato. Indique abaixo qual coluna é a data, o histórico e o valor.'],
    },
    layout: null,
  }
}
