import type { AccountProfile, Period, Statement, SystemAccount } from '../../types/bankReconciliation'
import { toCents } from './money'
import { inPeriod } from './statementBalance'
import { normalizeText } from './text'

const DEFAULT_COLORS = {
  headerColor: 'FF0C1F3F',
  balanceColor: 'FF2F5EA8',
  highlightColor: 'FFB9CDE5',
  tabColor: 'FF95B3D7',
}

interface ProfilePreset {
  // Palavras que o nome da conta no sistema precisa ter
  tokens: string[]
  // Posição da aba no relatório geral
  position: number
  profile: AccountProfile
}

/**
 * Perfil da Inovati: abas, títulos e cores de Conciliação_15.09.xlsx.
 * Da mais específica para a mais genérica — "BTG INOVATI LOGISTICA" antes de qualquer "BTG".
 */
const INOVATI_PRESETS: ProfilePreset[] = [
  {
    tokens: ['BTG', 'INOVATI', 'LOGISTICA'],
    position: 5,
    profile: {
      sheetName: 'INOVATI LOG',
      company: 'INOVATI LOGÍSTICA',
      bankLabel: 'Btg - Inovati Logística',
      balanceLabel: 'Btg Inovati Log',
      headerColor: 'FF220B45',
      balanceColor: 'FF36116D',
      highlightColor: 'FFCCC1DA',
      tabColor: 'FFB3A2C7',
    },
  },
  {
    tokens: ['BTG', 'MATRIZ'],
    position: 1,
    profile: {
      sheetName: 'BTG - MATRIZ',
      company: 'INOVATI TRANSPORTES',
      bankLabel: 'Btg - Matriz',
      balanceLabel: 'Btg Matriz',
      ...DEFAULT_COLORS,
    },
  },
  {
    tokens: ['BTG', 'MT'],
    position: 3,
    profile: {
      sheetName: 'BTG - MT',
      company: 'INOVATI TRANSPORTES',
      bankLabel: 'Btg - Filial MT',
      balanceLabel: 'Btg MT',
      ...DEFAULT_COLORS,
    },
  },
  {
    tokens: ['QI', 'TECH'],
    position: 4,
    profile: {
      sheetName: 'QI TECH',
      company: 'INOVATI TRANSPORTES',
      bankLabel: 'Qi Tech',
      balanceLabel: 'QI Tech',
      headerColor: 'FF113B91',
      balanceColor: 'FF113B91',
      highlightColor: 'FFB7DEE8',
      tabColor: 'FF93CDDD',
    },
  },
  {
    tokens: ['CAIXA'],
    position: 2,
    profile: {
      sheetName: 'CAIXA',
      company: 'INOVATI TRANSPORTES',
      bankLabel: 'Caixa',
      balanceLabel: 'Caixa',
      headerColor: 'FF003A8F',
      balanceColor: 'FF003A8F',
      highlightColor: 'FFFCD5B5',
      tabColor: 'FFFAC090',
    },
  },
]

function keyTokens(key: string): string[] {
  return normalizeText(key).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
}

function findPreset(key: string): ProfilePreset | null {
  const tokens = keyTokens(key)
  return INOVATI_PRESETS.find((p) => p.tokens.every((t) => tokens.includes(t))) ?? null
}

/** O perfil da Inovati só vale para relatório da Inovati — outro cliente pode ter conta "CAIXA" */
export function isInovatiReport(accounts: Pick<SystemAccount, 'key'>[]): boolean {
  return accounts.some((a) => a.key.includes('INOVATI'))
}

/** Nome de aba válido no Excel: até 31 caracteres, sem []:*?/\ */
export function sheetNameFrom(name: string): string {
  const clean = name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return (clean || 'Conta').slice(0, 31).trim()
}

function titleCase(name: string): string {
  return name.toLowerCase().replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => space + letter.toUpperCase())
}

export function defaultProfile(account: Pick<SystemAccount, 'key' | 'name'>, inovati: boolean): AccountProfile {
  const preset = inovati ? findPreset(account.key) : null
  if (preset) return { ...preset.profile }
  return {
    sheetName: sheetNameFrom(account.name),
    company: '',
    bankLabel: titleCase(account.name),
    balanceLabel: titleCase(account.name),
    ...DEFAULT_COLORS,
  }
}

/** Ordem das abas no relatório geral: a do perfil do cliente, depois a do sistema */
export function sheetPosition(key: string, inovati: boolean, fallback: number): number {
  const preset = inovati ? findPreset(key) : null
  return preset ? preset.position : 100 + fallback
}

/** Contas do perfil que não vieram no relatório do sistema (conta parada no dia) */
export function presetAccountsMissing(accounts: SystemAccount[]): SystemAccount[] {
  if (!isInovatiReport(accounts)) return []
  return INOVATI_PRESETS.filter((p) => !accounts.some((a) => p.tokens.every((t) => keyTokens(a.key).includes(t)))).map(
    (p) => ({
      key: p.tokens.join(' '),
      code: '',
      name: `${p.profile.sheetName} (sem lançamentos no sistema)`,
      openingBalance: null,
      closingBalance: null,
      entries: [],
    })
  )
}

export interface AccountSuggestion {
  key: string | null
  reason: string
}

/**
 * Sugere a conta do sistema de um extrato: valores do período que batem com os lançamentos
 * da conta pesam mais; o nome do arquivo ("Extrato Caixa.xlsx") ajuda a desempatar.
 */
export function suggestAccount(statement: Statement, accounts: SystemAccount[], period: Period | null): AccountSuggestion {
  const movements = period ? statement.movements.filter((m) => inPeriod(m.date, period)) : statement.movements
  const fileTokens = new Set(keyTokens(statement.fileName.replace(/\.[a-z0-9]+$/i, '')))

  let best: { account: SystemAccount; score: number; hits: number; nameHits: number } | null = null
  let tie = false
  for (const account of accounts) {
    const remaining = new Map<number, number>()
    for (const e of account.entries) {
      if (period && !inPeriod(e.date, period)) continue
      const c = toCents(e.amount)
      remaining.set(c, (remaining.get(c) ?? 0) + 1)
    }
    let hits = 0
    for (const m of movements) {
      const c = toCents(m.amount)
      const left = remaining.get(c) ?? 0
      if (left > 0) {
        hits++
        remaining.set(c, left - 1)
      }
    }
    const nameHits = keyTokens(account.key).filter((t) => t.length >= 2 && fileTokens.has(t)).length
    const score = hits * 10 + nameHits * 5
    if (score === 0) continue
    if (!best || score > best.score) {
      best = { account, score, hits, nameHits }
      tie = false
    } else if (score === best.score) {
      tie = true
    }
  }

  if (!best || tie) return { key: null, reason: 'Não deu para identificar a conta — escolha na lista.' }
  const reasons: string[] = []
  if (best.hits) reasons.push(`${best.hits} valor(es) do extrato batem com a conta`)
  if (best.nameHits) reasons.push('nome do arquivo')
  return { key: best.account.key, reason: `Sugerida por: ${reasons.join(' e ')}` }
}
