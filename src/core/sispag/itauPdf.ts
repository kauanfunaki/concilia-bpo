import { groupTextLines, parseStatementPdfLines } from '../bankReconciliation/statementPdf'
import type { PdfLine, PdfTextItem } from '../bankReconciliation/statementPdf'
import { formatDateBR, formatMoney, parseMoney, roundCents } from '../bankReconciliation/money'
import { normalizeText } from '../bankReconciliation/text'
import { classifyMovement, splitCounterparty } from './classify'
import type { ItauMovement, ItauStatement } from '../../types/sispag'

/**
 * Leitura do "extrato mensal" do Itaú em PDF (Conta Corrente | Movimentação).
 *
 * Cada página repete o cabeçalho "data · descrição · entradas R$ · saídas R$ · saldo R$", e é
 * por ele que se sabe a coluna de cada valor: os valores vêm alinhados à direita e a posição muda
 * um pouco de uma página para outra. A data só aparece na primeira linha do dia e o saldo, na
 * última. Na página 1, a lateral traz a legenda das siglas ("P = poupança automática"), que fica
 * de fora pela posição.
 *
 * A leitura se confere de dois jeitos: a soma das entradas e das saídas tem que dar os totais do
 * quadro-resumo da página 1, e os movimentos de cada dia têm que levar um saldo impresso ao
 * seguinte. O "Saldo anterior" não serve de ponto de partida: soma a aplicação automática, e os
 * saldos do dia são só da conta corrente.
 */

interface Cell {
  x: number
  right: number
  text: string
}

interface Layout {
  dateX: number
  descriptionX: number
  moneyX: number
  creditRight: number
  debitRight: number
  balanceRight: number
}

interface Header {
  agency: string
  account: string
  month: number
  year: number
}

interface Totals {
  credit: number | null
  debit: number | null
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
// "extrato mensal ag 1234 cc 56789-0 mar 2025": pedaços colados ("56789-0mar") também valem
const HEADER = /\bag\.?\s*(\d{4})\s*cc\.?\s*([\d.]+-\d)\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*(\d{4})\b/
const MONEY_CELL = /^-?\d{1,3}(?:\.\d{3})*,\d{2}-?$/
const DATE_CELL = /^(\d{2})\/(\d{2})$/
// Saldos informados no meio do extrato que não são movimento
const BALANCE_LINE = /^(saldo anterior|saldo final|saldo em c\/?c|saldo aplic|saldo do dia|saldo total)/

function cellsOf(line: PdfLine): Cell[] {
  return line.spans
    .map((s) => ({ x: s.x, right: s.x + s.width, text: line.text.slice(s.start, s.end).trim() }))
    .filter((c) => c.text)
}

/** Linha de títulos das colunas: "data descrição entradas R$ saídas R$ saldo R$" */
function layoutOf(cells: Cell[]): Layout | null {
  const find = (pattern: RegExp) => cells.find((c) => pattern.test(normalizeText(c.text)))
  const date = find(/^data$/)
  const description = find(/^descricao$/)
  const credit = find(/^entradas\b/)
  const debit = find(/^saidas\b/)
  const balance = find(/^saldo\b/)
  if (!date || !description || !credit || !debit || !balance) return null
  if (!(date.x < description.x && description.x < credit.x && credit.x < debit.x && debit.x < balance.x)) return null
  return {
    dateX: date.x,
    descriptionX: description.x,
    // Valor de crédito grande começa antes do título da coluna
    moneyX: credit.x - (debit.x - credit.x) / 2,
    creditRight: credit.right,
    debitRight: debit.right,
    balanceRight: balance.right,
  }
}

function headerOf(lines: PdfLine[]): Header | null {
  for (const line of lines.slice(0, 60)) {
    const m = normalizeText(line.text).match(HEADER)
    if (m) return { agency: m[1], account: m[2], month: MONTHS.indexOf(m[3]) + 1, year: Number(m[4]) }
  }
  return null
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function parseItauPdf(items: PdfTextItem[], fileName: string): ItauStatement {
  const lines = groupTextLines(items)
  const header = headerOf(lines)
  if (!lines.some((l) => layoutOf(cellsOf(l)))) return genericFallback(lines, fileName, header)

  const movements: ItauMovement[] = []
  const warnings: string[] = []
  let layout: Layout | null = null
  let currentDate: string | null = null
  let openingBalance: number | null = null
  let closingBalance: number | null = null
  let signConflicts = 0
  let undated = 0
  // Quadro-resumo da página 1: "entradas (créditos) … total" e "saídas (débitos) … total"
  let summaryBlock: 'credit' | 'debit' | null = null
  const summary: Totals = { credit: null, debit: null }
  // "totalizador de aplicações automáticas", depois do saldo final: aplicações e resgates da
  // aplicação automática, que o quadro-resumo não soma
  const investment: Totals = { credit: null, debit: null }
  let ended = false

  // dd/mm vira data pelo mês do extrato: "31/12" num extrato de janeiro é do ano anterior
  const isoDate = (day: number, month: number): string => {
    const year = header ? (month > header.month ? header.year - 1 : header.year) : new Date().getFullYear()
    return `${year}-${pad(month)}-${pad(day)}`
  }

  for (const line of lines) {
    const cells = cellsOf(line)
    if (ended) {
      if (/na conta corrente/.test(normalizeText(line.text))) {
        // "na conta corrente (1)  7.481.912,43  3.500.733,98-": entrada e saída, nessa ordem
        const [entry, exit] = cells.filter((c) => MONEY_CELL.test(c.text)).map((c) => parseMoney(c.text))
        investment.credit = entry == null ? null : Math.abs(entry)
        investment.debit = exit == null ? null : Math.abs(exit)
        break
      }
      continue
    }
    const found = layoutOf(cells)
    if (found) {
      layout = found
      continue
    }
    // Antes do primeiro cabeçalho: endereço e quadro de resumo da página 1
    if (!layout) {
      const texts = cells.map((c) => normalizeText(c.text))
      if (texts.some((t) => /^entradas\b/.test(t))) summaryBlock = 'credit'
      else if (texts.some((t) => /^saidas\b/.test(t))) summaryBlock = 'debit'
      else if (summaryBlock && texts.includes('total')) {
        const value = cells.map((c) => parseMoney(c.text)).find((v) => v !== null)
        if (value != null && summary[summaryBlock] === null) summary[summaryBlock] = Math.abs(value)
        summaryBlock = null
      }
      continue
    }

    const kept = cells.filter((c) => c.right > layout!.dateX - 4)
    const dateCell = kept.find((c) => c.x < layout!.descriptionX - 4 && DATE_CELL.test(c.text))
    const money = kept.filter((c) => c.x >= layout!.moneyX && MONEY_CELL.test(c.text))
    const description = kept
      .filter((c) => c !== dateCell && !money.includes(c) && c.x >= layout!.descriptionX - 4)
      .map((c) => c.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (dateCell) {
      const [, d, m] = dateCell.text.match(DATE_CELL)!
      currentDate = isoDate(Number(d), Number(m))
    }

    let credit: number | null = null
    let debit: number | null = null
    let balance: number | null = null
    for (const cell of money) {
      const value = parseMoney(cell.text)
      if (value === null) continue
      const distance = (right: number) => Math.abs(cell.right - right)
      const column =
        distance(layout.balanceRight) < Math.min(distance(layout.creditRight), distance(layout.debitRight))
          ? 'balance'
          : distance(layout.debitRight) <= distance(layout.creditRight)
            ? 'debit'
            : 'credit'
      if (column === 'balance') balance = value
      else if (column === 'debit') {
        if (value > 0) signConflicts++
        debit = Math.abs(value)
      } else {
        if (value < 0) signConflicts++
        credit = Math.abs(value)
      }
    }

    const label = normalizeText(description)
    if (/^saldo final/.test(label)) {
      closingBalance = balance ?? closingBalance
      ended = true
      continue
    }
    if (/^saldo anterior/.test(label)) {
      openingBalance = balance
      continue
    }
    if (BALANCE_LINE.test(label) || (credit === null && debit === null)) continue
    if (!currentDate) {
      undated++
      continue
    }

    const amount = credit !== null ? credit : -(debit as number)
    const { kind, family } = classifyMovement(description, amount)
    const { counterparty, document } = splitCounterparty(description)
    movements.push({
      id: `P${line.page}-${movements.length + 1}`,
      order: movements.length,
      date: currentDate,
      description,
      counterparty,
      document,
      amount,
      balance,
      kind,
      family,
    })
  }

  if (movements.length === 0) warnings.push('Nenhum movimento reconhecido no PDF.')
  if (undated) warnings.push(`${undated} linha(s) com valor antes da primeira data ficaram de fora.`)
  if (signConflicts) warnings.push(`${signConflicts} valor(es) com sinal diferente da coluna: valeu a coluna (entradas ou saídas). Confira.`)
  warnings.push(...totalsCheck(movements, summary, investment), ...balanceCheck(movements, closingBalance))

  const period = header
    ? { start: `${header.year}-${pad(header.month)}-01`, end: `${header.year}-${pad(header.month)}-${pad(lastDay(header.year, header.month))}` }
    : null
  return {
    fileName,
    source: 'pdf',
    account: header ? `${header.agency} / ${header.account}` : '',
    company: '',
    period,
    openingBalance,
    closingBalance,
    movements,
    warnings,
  }
}

/** Entradas e saídas lidas × totais do quadro-resumo: pega linha perdida e sinal trocado */
function totalsCheck(movements: ItauMovement[], summary: Totals, investment: Totals): string[] {
  const warnings: string[] = []
  const credits = roundCents(movements.reduce((s, m) => s + Math.max(m.amount, 0), 0) - (investment.credit ?? 0))
  const debits = roundCents(movements.reduce((s, m) => s + Math.max(-m.amount, 0), 0) - (investment.debit ?? 0))
  if (summary.credit !== null && Math.abs(credits - summary.credit) >= 0.01) {
    warnings.push(`As entradas lidas (${formatMoney(credits)}) não batem com o total de entradas do PDF (${formatMoney(summary.credit)}).`)
  }
  if (summary.debit !== null && Math.abs(debits - summary.debit) >= 0.01) {
    warnings.push(`As saídas lidas (${formatMoney(debits)}) não batem com o total de saídas do PDF (${formatMoney(summary.debit)}).`)
  }
  return warnings
}

/** Do primeiro saldo impresso em diante, os movimentos de cada dia levam ao saldo do dia seguinte */
function balanceCheck(movements: ItauMovement[], closing: number | null): string[] {
  const warnings: string[] = []
  let running: number | null = null
  for (const m of movements) {
    if (running !== null) running = roundCents(running + m.amount)
    if (m.balance === null) continue
    if (running !== null && Math.abs(running - m.balance) >= 0.01) {
      warnings.push(
        `O saldo de ${formatDateBR(m.date)} no PDF (${formatMoney(m.balance)}) não bate com a soma lida (${formatMoney(running)}): ` +
          'alguma linha desse dia pode ter sido lida errado.'
      )
      if (warnings.length >= 3) break
    }
    running = m.balance
  }
  if (warnings.length === 0 && closing !== null && running !== null && Math.abs(running - closing) >= 0.01) {
    warnings.push(`A soma dos movimentos (${formatMoney(running)}) não fecha com o saldo final do PDF (${formatMoney(closing)}).`)
  }
  return warnings
}

/** PDF fora do layout do extrato mensal: leitura genérica do app, com aviso */
function genericFallback(lines: PdfLine[], fileName: string, header: Header | null): ItauStatement {
  const generic = parseStatementPdfLines(lines, fileName, header?.year)
  const movements: ItauMovement[] = generic.movements.map((m) => {
    const { kind, family } = classifyMovement(m.description, m.amount)
    const { counterparty, document } = splitCounterparty(m.description)
    return { id: m.id, order: m.order, date: m.date, description: m.description, counterparty, document, amount: m.amount, balance: m.balance, kind, family }
  })
  const dates = movements.map((m) => m.date).sort()
  return {
    fileName,
    source: 'pdf',
    account: header ? `${header.agency} / ${header.account}` : '',
    company: '',
    period: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null,
    openingBalance: generic.balances[0]?.balance ?? null,
    closingBalance: generic.balances[generic.balances.length - 1]?.balance ?? null,
    movements,
    warnings: ['O PDF não está no layout do "extrato mensal" do Itaú: a leitura foi genérica. Confira as linhas lidas.', ...generic.warnings],
  }
}
