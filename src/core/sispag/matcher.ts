import { formatDateBR, roundCents, toCents } from '../bankReconciliation/money'
import { nameSimilarity } from '../bankReconciliation/names'
import { documentsMatch } from './classify'
import type { Period } from '../../types/bankReconciliation'
import type {
  DaySummary,
  ItauMovement,
  ItauStatement,
  MatchRule,
  PaymentFamily,
  ResultItem,
  Situation,
  SispagPayment,
  SispagReport,
  SispagResult,
} from '../../types/sispag'

// Devolução de TED chega no mesmo dia ou poucos dias depois do débito
const RETURN_WINDOW_DAYS = 10
// Mesmo valor em outra data: pagamento agendado para fim de semana ou feriado, débito atrasado
const SHIFT_WINDOW_DAYS = 5
// Busca por soma: acima disso a combinação vira loteria
const MAX_SUM_POOL = 60
const MAX_SUM_ITEMS = 15
const MAX_SUM_STEPS = 200_000

// Fechamento por total: lotes específicos antes do genérico
const BLOCK_ORDER: PaymentFamily[] = ['ted', 'ownTransfer', 'tax', 'salary', 'supplier']

interface Line {
  m: ItauMovement
  cents: number
  family: PaymentFamily
}

interface Pay {
  p: SispagPayment
  cents: number
  // Dia em que o débito deve aparecer: a data do pagamento ou o próximo dia com movimento no
  // extrato (pagamento agendado para sábado sai na segunda)
  eff: string
}

type Accept = (line: Line, pay: Pay) => boolean

const strict: Accept = (l, x) => x.p.family === l.family
// Extratos que listam cada TED como "Sispag Fornecedores" (jan/2025): o lote genérico aceita TED
const relaxed: Accept = (l, x) => l.family === 'supplier' && x.p.family !== 'tax' && x.p.family !== 'salary'

function blockAccepts(lineFamily: PaymentFamily, payFamily: PaymentFamily): boolean {
  return lineFamily === payFamily || (lineFamily === 'supplier' && (payFamily === 'ted' || payFamily === 'ownTransfer'))
}

function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

function sumCents<T extends { cents: number }>(items: T[]): number {
  return items.reduce((s, i) => s + i.cents, 0)
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

function datesPeriod(dates: string[]): Period | null {
  if (dates.length === 0) return null
  const sorted = [...dates].sort()
  return { start: sorted[0], end: sorted[sorted.length - 1] }
}

/** Período em comum entre extrato e relatório; null quando não há nenhum dia em comum */
export function commonPeriod(statement: ItauStatement, report: SispagReport): Period | null {
  const a = statement.period ?? datesPeriod(statement.movements.map((m) => m.date))
  const b = report.period ?? datesPeriod(report.payments.map((p) => p.date))
  if (!a || !b) return a ?? b
  const start = a.start > b.start ? a.start : b.start
  const end = a.end < b.end ? a.end : b.end
  return start <= end ? { start, end } : null
}

/** Quanto o favorecido do extrato (quando o banco informa) parece o do pagamento */
function counterpartyScore(m: ItauMovement, p: SispagPayment): number {
  if (m.document && p.document && documentsMatch(m.document, p.document)) return 2
  return m.counterparty ? nameSimilarity(m.counterparty, p.payee) : 0
}

/** Maior nota; no empate, o primeiro da lista */
function best<T>(items: T[], score: (item: T) => number): T | null {
  let chosen: T | null = null
  let chosenScore = -Infinity
  for (const item of items) {
    const s = score(item)
    if (s > chosenScore) {
      chosen = item
      chosenScore = s
    }
  }
  return chosen
}

/**
 * Pagamentos cuja soma dá exatamente `goal` (centavos), com 2 ou mais itens. Valores repetidos
 * contam uma vez por nível: trocar um pagamento de R$ 120 por outro de R$ 120 não é outra
 * combinação. Busca interrompida pelo limite também vale como ambígua.
 */
export function findSubset<T extends { cents: number }>(pool: T[], goal: number): { items: T[]; ambiguous: boolean } | null {
  const items = [...pool].filter((i) => i.cents > 0).sort((a, b) => b.cents - a.cents)
  const suffix: number[] = new Array(items.length + 1).fill(0)
  for (let i = items.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + items[i].cents

  const results: number[][] = []
  const picked: number[] = []
  let steps = 0
  const search = (start: number, remaining: number): void => {
    if (results.length >= 2 || ++steps > MAX_SUM_STEPS) return
    if (remaining === 0) {
      if (picked.length >= 2) results.push([...picked])
      return
    }
    if (picked.length >= MAX_SUM_ITEMS) return
    let previous = -1
    for (let i = start; i < items.length; i++) {
      if (suffix[i] < remaining) return
      const c = items[i].cents
      if (c > remaining || c === previous) continue
      previous = c
      picked.push(i)
      search(i + 1, remaining - c)
      picked.pop()
      if (results.length >= 2) return
    }
  }
  search(0, goal)
  if (results.length === 0) return null
  return { items: results[0].map((i) => items[i]), ambiguous: results.length > 1 || steps > MAX_SUM_STEPS }
}

function typesOf(pays: Pay[]): string {
  const types = [...new Set(pays.map((x) => x.p.type || 'sem tipo'))]
  return types.length <= 2 ? types.join(', ') : `${types.slice(0, 2).join(', ')} e outros`
}

// Ordem de "pior" situação: é a que vale quando um pagamento aparece em mais de um item
const PAYMENT_PRIORITY: Situation[] = ['notDone', 'matched', 'returned', 'otherModality', 'returnUnmatched', 'statementOnly', 'reportOnly', 'returnedDone']

/**
 * Confere o extrato do Itaú com o relatório SISPAG, dia a dia, no período em comum.
 *
 * 1. Devoluções ("Dev TED") e estornos ("Est Sispag") × pagamentos não efetuados de mesmo valor:
 *    o débito saiu e voltou. Esses pagamentos entram junto com os efetuados no confronto dos débitos.
 * 2. No dia: linha do extrato = pagamento de mesmo valor e mesmo CPF/CNPJ, quando o extrato traz o
 *    documento; depois, de mesmo valor e mesmo lote (TED, tributos…).
 * 3. Linha que é a soma de um lote: todos os pagamentos de um tipo no dia, ou uma combinação deles.
 * 4. Extrato que lista cada TED como "Sispag Fornecedores": repete 2 e 3 aceitando TED nesse lote.
 * 5. Várias linhas de um lote × os pagamentos dele, pelo total; depois, o que sobrou do dia.
 * 6. Mesmo valor em outra data (até 5 dias). O resto é divergência.
 */
export function reconcileSispag(statement: ItauStatement, report: SispagReport): SispagResult {
  const period = commonPeriod(statement, report)
  if (!period) throw new Error('O extrato e o relatório SISPAG não têm nenhum dia em comum.')
  const inPeriod = (date: string) => date >= period.start && date <= period.end

  const movements = statement.movements.filter((m) => inPeriod(m.date))
  const payments = report.payments.filter((p) => inPeriod(p.date))
  const dates = [...new Set(movements.map((m) => m.date))].sort()
  const lastDate = dates[dates.length - 1] ?? period.end
  const effective = (date: string) => dates.find((d) => d >= date) ?? date
  const reportHasSalary = payments.some((p) => p.family === 'salary')

  const pays: Pay[] = payments.map((p) => ({ p, cents: toCents(p.amount), eff: effective(p.date) }))
  const lines: Line[] = movements
    .filter((m) => m.kind === 'payment')
    .map((m) => ({ m, cents: Math.abs(toCents(m.amount)), family: m.family ?? 'supplier' }))
  const credits = movements
    .filter((m) => m.kind === 'return' || m.kind === 'reversal')
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)

  const items: ResultItem[] = []
  const push = (item: Omit<ResultItem, 'id'>) => items.push({ id: `i${items.length + 1}`, ...item })

  // ── 1. Devoluções e estornos ──────────────────────────────────────────────
  const returned = new Set<string>()
  const returnedDone = new Set<string>()
  const notDone = pays.filter((x) => !x.p.done)
  const done = pays.filter((x) => x.p.done)
  for (const r of credits) {
    const cents = toCents(r.amount)
    const ted = r.kind === 'return'
    const fits = (x: Pay) => x.cents === cents && x.eff <= r.date && daysBetween(x.eff, r.date) <= RETURN_WINDOW_DAYS
    // TED devolvida procura TED; depois, o favorecido; depois, o pagamento mais recente
    const rank = (x: Pay) =>
      (!ted || x.p.family === 'ted' || x.p.family === 'ownTransfer' ? 100 : 0) + counterpartyScore(r, x.p) * 10 - daysBetween(x.eff, r.date) / 100
    const label = ted ? 'TED devolvida' : 'Estorno do SISPAG'

    const pending = best(notDone.filter((x) => !returned.has(x.p.id) && fits(x)), rank)
    if (pending) {
      returned.add(pending.p.id)
      push({
        situation: 'returned',
        rule: 'return',
        date: r.date,
        movementIds: [r.id],
        paymentIds: [pending.p.id],
        statementAmount: r.amount,
        reportAmount: pending.p.amount,
        note: `${label}; no SISPAG consta "${pending.p.status || 'não efetuado'}"`,
        hint: '',
      })
      continue
    }
    const paid = best(done.filter((x) => !returnedDone.has(x.p.id) && fits(x)), rank)
    if (paid) {
      returnedDone.add(paid.p.id)
      push({
        situation: 'returnedDone',
        rule: 'return',
        date: r.date,
        movementIds: [r.id],
        paymentIds: [paid.p.id],
        statementAmount: r.amount,
        reportAmount: paid.p.amount,
        note: `${label} em ${formatDateBR(r.date)}, mas no SISPAG consta como efetuado: o favorecido pode não ter recebido`,
        hint: '',
      })
      continue
    }
    push({
      situation: 'returnUnmatched',
      rule: 'none',
      date: r.date,
      movementIds: [r.id],
      paymentIds: [],
      statementAmount: r.amount,
      reportAmount: 0,
      note: `${label} sem pagamento de mesmo valor no relatório até ${RETURN_WINDOW_DAYS} dias antes: pode ser de pagamento de outro período`,
      hint: '',
    })
  }

  // O que saiu da conta segundo o relatório: efetuados e não efetuados que foram devolvidos
  const debited = pays.filter((x) => x.p.done || returned.has(x.p.id))
  const freeLines = new Set(lines.map((l) => l.m.id))
  const freePays = new Set(debited.map((x) => x.p.id))

  const link = (ls: Line[], ps: Pay[], rule: MatchRule, note: string) => {
    ls.forEach((l) => freeLines.delete(l.m.id))
    ps.forEach((x) => freePays.delete(x.p.id))
    push({
      situation: 'matched',
      rule,
      date: ls[0].m.date,
      movementIds: ls.map((l) => l.m.id),
      paymentIds: ps.map((x) => x.p.id),
      statementAmount: sumCents(ls) / 100,
      reportAmount: sumCents(ps) / 100,
      note,
      hint: '',
    })
  }

  // Extrato com o CPF/CNPJ de cada pagamento (Lançamentos detalhado, OFX): mesmo valor e mesmo
  // documento casam antes de tudo, para não trocar favorecidos que receberam o mesmo valor no dia
  const byDocument = (ls: Line[], ps: Pay[]) => {
    const byCents = groupBy(ps.filter((x) => x.p.document), (x) => x.cents)
    for (const l of ls) {
      if (!l.m.document) continue
      const x = (byCents.get(l.cents) ?? []).find(
        (c) => freePays.has(c.p.id) && (strict(l, c) || relaxed(l, c)) && documentsMatch(l.m.document, c.p.document)
      )
      if (x) link([l], [x], 'value', '')
    }
  }

  const byValue = (ls: Line[], ps: Pay[], accept: Accept) => {
    const byCents = groupBy(ps, (x) => x.cents)
    // "Sispag Tributos" e "Sispag Fornecedores TED" escolhem antes do lote genérico
    const ordered = [...ls].sort((a, b) => Number(a.family === 'supplier') - Number(b.family === 'supplier'))
    for (const l of ordered) {
      const candidates = (byCents.get(l.cents) ?? []).filter((x) => freePays.has(x.p.id) && accept(l, x))
      const x = best(candidates, (c) => counterpartyScore(l.m, c.p))
      if (x) link([l], [x], 'value', '')
    }
  }

  const byBatch = (ls: Line[], freeOf: () => Pay[], accept: Accept) => {
    for (const l of [...ls].sort((a, b) => a.cents - b.cents)) {
      if (!freeLines.has(l.m.id)) continue
      const pool = freeOf().filter((x) => accept(l, x) && x.cents > 0 && x.cents < l.cents)
      if (pool.length < 2) continue
      const byType = [...groupBy(pool, (x) => x.p.type).values()]
      const byFamily = [...groupBy(pool, (x) => x.p.family).values()]

      const whole = [...byType, ...byFamily].find((g) => g.length >= 2 && sumCents(g) === l.cents)
      if (whole) {
        link([l], whole, 'batch', `Lote de ${whole.length} pagamentos (${typesOf(whole)})`)
        continue
      }
      // Lote que saiu em mais de uma linha: a combinação procura primeiro dentro do tipo
      const pools = [...byType.filter((g) => g.length >= 2 && sumCents(g) > l.cents), pool]
      for (const g of pools) {
        if (g.length > MAX_SUM_POOL) continue
        const found = findSubset(g, l.cents)
        if (!found) continue
        link(
          [l],
          found.items,
          found.ambiguous ? 'sumAmbiguous' : 'sum',
          `Soma de ${found.items.length} pagamentos (${typesOf(found.items)})` +
            (found.ambiguous ? ' — outra combinação dá o mesmo valor; a composição pode ser outra' : '')
        )
        break
      }
    }
  }

  // ── 2 a 5: dia a dia ──────────────────────────────────────────────────────
  const linesByDay = groupBy(lines, (l) => l.m.date)
  const paysByDay = groupBy(debited, (x) => x.eff)
  const days = [...new Set([...linesByDay.keys(), ...paysByDay.keys()])].sort()
  for (const day of days) {
    const dayLines = linesByDay.get(day) ?? []
    const dayPays = paysByDay.get(day) ?? []
    const freeL = () => dayLines.filter((l) => freeLines.has(l.m.id))
    const freeP = () => dayPays.filter((x) => freePays.has(x.p.id))
    const supplierLines = () => freeL().filter((l) => l.family === 'supplier')

    byDocument(freeL(), freeP())
    byValue(freeL(), freeP(), strict)
    byBatch(freeL(), freeP, strict)
    byValue(supplierLines(), freeP(), relaxed)
    byBatch(supplierLines(), freeP, relaxed)

    for (const family of BLOCK_ORDER) {
      const bl = freeL().filter((l) => l.family === family)
      const bp = freeP().filter((x) => blockAccepts(family, x.p.family))
      if (bl.length && bp.length && sumCents(bl) === sumCents(bp)) {
        link(bl, bp, 'block', `${bl.length} linha(s) do extrato = ${bp.length} pagamento(s) (${typesOf(bp)}), pelo total do lote`)
      }
    }

    const restL = freeL().filter((l) => l.family !== 'salary' || reportHasSalary)
    const restP = freeP()
    if (restL.length && restP.length && sumCents(restL) === sumCents(restP)) {
      link(restL, restP, 'day', `O que sobrou do dia fecha pelo total: ${restL.length} linha(s) × ${restP.length} pagamento(s)`)
    }
  }

  // ── 6. Mesmo valor em outra data ──────────────────────────────────────────
  for (const l of lines) {
    if (!freeLines.has(l.m.id)) continue
    const candidates = debited.filter(
      (x) =>
        freePays.has(x.p.id) &&
        x.cents === l.cents &&
        Math.abs(daysBetween(x.eff, l.m.date)) <= SHIFT_WINDOW_DAYS &&
        (strict(l, x) || relaxed(l, x))
    )
    const x = best(candidates, (c) => counterpartyScore(l.m, c.p) - Math.abs(daysBetween(c.eff, l.m.date)))
    if (x) link([l], [x], 'shifted', `Pagamento de ${formatDateBR(x.p.date)}, debitado em ${formatDateBR(l.m.date)}`)
  }

  // ── Sobras ────────────────────────────────────────────────────────────────
  const matchedMovements = new Set(items.flatMap((i) => i.movementIds))
  const pendingByCents = groupBy(
    notDone.filter((x) => !returned.has(x.p.id)),
    (x) => x.cents
  )

  for (const l of lines) {
    if (!freeLines.has(l.m.id)) continue
    const base = {
      rule: 'none' as const,
      date: l.m.date,
      movementIds: [l.m.id],
      paymentIds: [],
      statementAmount: l.cents / 100,
      reportAmount: 0,
    }
    if (l.family === 'salary' && !reportHasSalary) {
      push({
        ...base,
        situation: 'otherModality',
        note: `Débito de salários: o relatório${report.modality ? ` é da modalidade "${report.modality}" e` : ''} não traz salários`,
        hint: '',
      })
      continue
    }
    const pending = (pendingByCents.get(l.cents) ?? []).find((x) => Math.abs(daysBetween(x.eff, l.m.date)) <= 2)
    push({
      ...base,
      situation: 'statementOnly',
      note: 'Débito do SISPAG sem pagamento efetuado no relatório',
      hint: pending
        ? `Há pagamento não efetuado de mesmo valor: ${pending.p.payee} (${formatDateBR(pending.p.date)}). Se a devolução saiu depois do fim do extrato, o débito é dele.`
        : '',
    })
  }

  for (const x of debited) {
    if (!freePays.has(x.p.id)) continue
    const twin = movements.find(
      (m) => m.amount < 0 && !matchedMovements.has(m.id) && Math.abs(toCents(m.amount)) === x.cents && Math.abs(daysBetween(x.eff, m.date)) <= SHIFT_WINDOW_DAYS
    )
    const late = x.eff > lastDate ? ' O pagamento é do fim do período: o débito pode ter saído no extrato seguinte.' : ''
    push({
      situation: 'reportOnly',
      rule: 'none',
      date: x.p.date,
      movementIds: [],
      paymentIds: [x.p.id],
      statementAmount: 0,
      reportAmount: x.p.amount,
      note: (x.p.done ? 'Efetuado no SISPAG, sem débito no extrato.' : 'Devolvido, mas o débito não aparece no extrato.') + late,
      hint: twin ? `Há lançamento de mesmo valor no extrato em ${formatDateBR(twin.date)}: "${twin.description}"` : '',
    })
  }

  for (const x of notDone) {
    if (returned.has(x.p.id)) continue
    push({
      situation: 'notDone',
      rule: 'none',
      date: x.p.date,
      movementIds: [],
      paymentIds: [x.p.id],
      statementAmount: 0,
      reportAmount: x.p.amount,
      note: x.p.status ? `Status no SISPAG: ${x.p.status}` : '',
      hint: '',
    })
  }

  // ── Situação de cada pagamento, resumo por dia e totais ───────────────────
  const paymentSituation: Record<string, Situation> = {}
  for (const item of items) {
    for (const id of item.paymentIds) {
      const current = paymentSituation[id]
      if (!current || PAYMENT_PRIORITY.indexOf(item.situation) > PAYMENT_PRIORITY.indexOf(current)) paymentSituation[id] = item.situation
    }
  }

  const otherModalityIds = new Set(items.filter((i) => i.situation === 'otherModality').flatMap((i) => i.movementIds))
  const summary = new Map<string, DaySummary>()
  const day = (date: string) => {
    let d = summary.get(date)
    if (!d) {
      d = { date, debits: 0, returns: 0, otherModality: 0, debited: 0, difference: 0 }
      summary.set(date, d)
    }
    return d
  }
  for (const l of lines) {
    if (otherModalityIds.has(l.m.id)) day(l.m.date).otherModality += l.cents
    else day(l.m.date).debits += l.cents
  }
  for (const r of credits) day(r.date).returns += toCents(r.amount)
  for (const x of debited) day(x.eff).debited += x.cents
  const daySummaries = [...summary.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      debits: d.debits / 100,
      returns: d.returns / 100,
      otherModality: d.otherModality / 100,
      debited: d.debited / 100,
      // "|| 0" tira o −0, que a tela mostraria como "-R$ 0,00"
      difference: (d.debits - d.debited) / 100 || 0,
    }))

  const total = (list: Pay[]) => roundCents(sumCents(list) / 100)
  const totals = {
    debits: roundCents(daySummaries.reduce((s, d) => s + d.debits, 0)),
    returns: roundCents(daySummaries.reduce((s, d) => s + d.returns, 0)),
    otherModality: roundCents(daySummaries.reduce((s, d) => s + d.otherModality, 0)),
    done: total(done),
    returned: total(notDone.filter((x) => returned.has(x.p.id))),
    notDone: total(notDone.filter((x) => !returned.has(x.p.id))),
    difference: 0,
  }
  totals.difference = roundCents(totals.debits - totals.done - totals.returned) || 0

  const relevant = (m: ItauMovement) => m.kind !== 'other'
  return {
    period,
    statement,
    report,
    items,
    days: daySummaries,
    totals,
    paymentSituation,
    outside: {
      payments: report.payments.length - payments.length,
      movements: statement.movements.filter(relevant).length - movements.filter(relevant).length,
    },
  }
}
