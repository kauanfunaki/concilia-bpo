import type {
  MatchCriterion,
  ResultRow,
  Situation,
  StatementMovement,
  SystemEntry,
} from '../../types/bankReconciliation'
import {
  entryDescription,
  entryDocument,
  entryNameText,
  movementDescription,
  movementNameText,
} from './entryText'
import { formatMoney, toCents } from './money'
import { nameSimilarity } from './names'

// Nome parecido o bastante para desempatar ou agrupar
const NAME_THRESHOLD = 0.5
// Nome parecido o bastante para sugerir um par de valor diferente (sem casar)
const SUGGESTION_THRESHOLD = 0.6
// Limites da busca por soma — acima disso a combinação vira loteria
const MAX_SUM_CANDIDATES = 20
const MAX_SUM_ITEMS = 8
const MAX_SUM_STEPS = 200_000

interface Link {
  movements: StatementMovement[]
  entries: SystemEntry[]
  situation: Situation
  criterion: MatchCriterion
  note: string
}

/**
 * Concilia uma conta: lançamentos do sistema × movimentos do extrato, já filtrados pelo período.
 *
 * 1. Valor único nos dois lados → "Lançamento conciliado". O valor é a chave: raramente repete.
 * 2. Valor repetido → pareia pelo nome mais parecido e marca "Valores iguais", para conferência
 *    manual — mesmo quando o nome parece resolver.
 * 3. Sobras: vários lançamentos com nome parecido que somam exatamente um movimento (ou o
 *    inverso) → "Lançamento conciliado"; se mais de uma combinação dá a mesma soma, "Valores iguais".
 * 4. Movimento do extrato sem par → "Aguardando composição".
 *    Lançamento do sistema sem par → "Lançamento não encontrado".
 *
 * As linhas saem na ordem do extrato; os lançamentos só do sistema vêm no fim.
 */
export function reconcileAccount(entries: SystemEntry[], movements: StatementMovement[]): ResultRow[] {
  const similarityCache = new Map<string, number>()
  const similarity = (m: StatementMovement, e: SystemEntry) => {
    const key = `${m.id}|${e.id}`
    let score = similarityCache.get(key)
    if (score === undefined) {
      score = nameSimilarity(movementNameText(m), entryNameText(e))
      similarityCache.set(key, score)
    }
    return score
  }

  const freeMovements = new Map(movements.map((m) => [m.id, m]))
  const freeEntries = new Map(entries.map((e) => [e.id, e]))
  const links: Link[] = []

  const link = (ms: StatementMovement[], es: SystemEntry[], situation: Situation, criterion: MatchCriterion, note: string) => {
    ms.forEach((m) => freeMovements.delete(m.id))
    es.forEach((e) => freeEntries.delete(e.id))
    links.push({ movements: ms, entries: es, situation, criterion, note })
  }

  // ── 1 e 2: mesmo valor ────────────────────────────────────────────────────
  const entriesByValue = groupBy(entries, (e) => toCents(e.amount))
  for (const [cents, ms] of groupBy(movements, (m) => toCents(m.amount))) {
    const es = entriesByValue.get(cents)
    if (!es) continue
    if (ms.length === 1 && es.length === 1) {
      link(ms, es, 'Lançamento conciliado', 'value', 'Valor único no extrato e no sistema')
      continue
    }
    const note =
      `Valor repetido (${ms.length} no extrato, ${es.length} no sistema) — ` +
      'par escolhido pelo nome, conferir'
    for (const [m, e] of bestPairs(ms, es, similarity)) {
      link([m], [e], 'Valores iguais', 'same-value', note)
    }
  }

  // ── 3: soma — vários do sistema formam um movimento do extrato ────────────
  for (const m of byAbsoluteDesc([...freeMovements.values()])) {
    const pool = [...freeEntries.values()].filter(
      (e) => sameSign(e.amount, m.amount) && Math.abs(e.amount) < Math.abs(m.amount) && similarity(m, e) >= NAME_THRESHOLD
    )
    const sums = findSums(pool, m.amount, (e) => similarity(m, e))
    if (sums.length === 0) continue
    const ambiguous = sums.length > 1
    link(
      [m],
      sums[0],
      ambiguous ? 'Valores iguais' : 'Lançamento conciliado',
      'sum',
      `Soma de ${sums[0].length} lançamentos do sistema` + (ambiguous ? ' — há outra combinação com a mesma soma, conferir' : '')
    )
  }

  // ── 3: soma — vários movimentos do extrato formam um lançamento do sistema ─
  for (const e of byAbsoluteDesc([...freeEntries.values()])) {
    const pool = [...freeMovements.values()].filter(
      (m) => sameSign(m.amount, e.amount) && Math.abs(m.amount) < Math.abs(e.amount) && similarity(m, e) >= NAME_THRESHOLD
    )
    const sums = findSums(pool, e.amount, (m) => similarity(m, e))
    if (sums.length === 0) continue
    const ambiguous = sums.length > 1
    link(
      sums[0],
      [e],
      ambiguous ? 'Valores iguais' : 'Lançamento conciliado',
      'sum',
      `Parte de ${sums[0].length} movimentos que somam ${formatMoney(e.amount)}` + (ambiguous ? ' — há outra combinação, conferir' : '')
    )
  }

  // ── 4: linhas do relatório ────────────────────────────────────────────────
  const linkByMovement = new Map<string, Link>()
  for (const l of links) l.movements.forEach((m) => linkByMovement.set(m.id, l))

  const leftoverEntries = entries.filter((e) => freeEntries.has(e.id))
  const leftoverMovements = movements.filter((m) => freeMovements.has(m.id))

  const rows: ResultRow[] = movements.map((m): ResultRow => {
    const l = linkByMovement.get(m.id)
    const base = {
      id: `extrato:${m.id}`,
      source: 'statement' as const,
      date: m.date,
      description: movementDescription(m),
      bankHistory: [m.description, m.counterparty].filter(Boolean).join(' · '),
      amount: m.amount,
      movementIds: [m.id],
      edited: false,
    }
    if (!l) {
      const best = bestSuggestion(leftoverEntries, (e) => similarity(m, e))
      return {
        ...base,
        situation: 'Aguardando composição',
        document: '',
        criterion: 'none',
        note: 'Movimento do extrato sem lançamento no sistema',
        suggestion: best ? `Nome parecido no sistema: ${entryDocument(best)} (${formatMoney(best.amount)})` : '',
        entryIds: [],
      }
    }
    return {
      ...base,
      situation: l.situation,
      document: l.entries.map(entryDocument).join(', '),
      criterion: l.criterion,
      note: l.note,
      suggestion: '',
      entryIds: l.entries.map((e) => e.id),
    }
  })

  for (const e of leftoverEntries) {
    const best = bestSuggestion(leftoverMovements, (m) => similarity(m, e))
    rows.push({
      id: `sistema:${e.id}`,
      source: 'system',
      date: e.date,
      description: entryDescription(e),
      bankHistory: '',
      amount: e.amount,
      situation: 'Lançamento não encontrado',
      document: entryDocument(e),
      criterion: 'none',
      note: 'Lançamento do sistema sem movimento no extrato',
      suggestion: best ? `Nome parecido no extrato: ${movementDescription(best)} (${formatMoney(best.amount)})` : '',
      movementIds: [],
      entryIds: [e.id],
      edited: false,
    })
  }

  return rows
}

function groupBy<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

function sameSign(a: number, b: number): boolean {
  return (a > 0 && b > 0) || (a < 0 && b < 0)
}

function byAbsoluteDesc<T extends { amount: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

/** Pareia dois grupos de mesmo valor, maior semelhança de nome primeiro; empate fica com a ordem original */
function bestPairs(
  movements: StatementMovement[],
  entries: SystemEntry[],
  similarity: (m: StatementMovement, e: SystemEntry) => number
): [StatementMovement, SystemEntry][] {
  const candidates: { m: StatementMovement; e: SystemEntry; score: number; mi: number; ei: number }[] = []
  movements.forEach((m, mi) =>
    entries.forEach((e, ei) => {
      const sameDay = m.date === e.date ? 0.01 : 0
      candidates.push({ m, e, score: similarity(m, e) + sameDay, mi, ei })
    })
  )
  candidates.sort((a, b) => b.score - a.score || a.mi - b.mi || a.ei - b.ei)

  const usedM = new Set<string>()
  const usedE = new Set<string>()
  const pairs: [StatementMovement, SystemEntry][] = []
  for (const c of candidates) {
    if (usedM.has(c.m.id) || usedE.has(c.e.id)) continue
    usedM.add(c.m.id)
    usedE.add(c.e.id)
    pairs.push([c.m, c.e])
  }
  return pairs
}

/**
 * Combinações de 2 ou mais itens do mesmo sinal que somam exatamente `target`.
 * Devolve no máximo duas — basta saber se a combinação é única.
 */
export function findSums<T extends { amount: number }>(pool: T[], target: number, rank: (item: T) => number): T[][] {
  if (pool.length < 2) return []
  const candidates = [...pool].sort((a, b) => rank(b) - rank(a)).slice(0, MAX_SUM_CANDIDATES)
  const items = candidates
    .map((item) => ({ item, cents: Math.abs(toCents(item.amount)) }))
    .sort((a, b) => b.cents - a.cents)

  const goal = Math.abs(toCents(target))
  const suffix: number[] = new Array(items.length + 1).fill(0)
  for (let i = items.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + items[i].cents

  const results: T[][] = []
  const picked: number[] = []
  let steps = 0

  const search = (start: number, remaining: number) => {
    if (results.length >= 2 || steps++ > MAX_SUM_STEPS) return
    if (remaining === 0) {
      if (picked.length >= 2) results.push(picked.map((i) => items[i].item))
      return
    }
    if (picked.length >= MAX_SUM_ITEMS) return
    for (let i = start; i < items.length; i++) {
      if (suffix[i] < remaining) return
      if (items[i].cents > remaining) continue
      picked.push(i)
      search(i + 1, remaining - items[i].cents)
      picked.pop()
      if (results.length >= 2) return
    }
  }
  search(0, goal)
  return results
}

function bestSuggestion<T>(items: T[], score: (item: T) => number): T | null {
  let best: T | null = null
  let bestScore = SUGGESTION_THRESHOLD
  for (const item of items) {
    const s = score(item)
    if (s >= bestScore) {
      best = item
      bestScore = s + 1e-9
    }
  }
  return best
}
