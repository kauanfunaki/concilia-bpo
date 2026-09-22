// ── Conciliação bancária: relatório do sistema do cliente × extrato do banco ──
// Datas circulam como texto ISO "yyyy-mm-dd" para não depender de fuso horário.

// Situação de cada linha — é a coluna "Situação" da planilha final
export type Situation =
  | 'Lançamento conciliado'
  | 'Lançamento não encontrado'
  | 'Aguardando composição'
  | 'Recebimento Frota'
  | 'Valores iguais'

// Ordem usada na lista suspensa da aba Config (a do modelo + "Valores iguais")
export const SITUATIONS: Situation[] = [
  'Lançamento conciliado',
  'Lançamento não encontrado',
  'Aguardando composição',
  'Recebimento Frota',
  'Valores iguais',
]

export interface Period {
  start: string
  end: string
}

// ── Sistema do cliente (Atua) ───────────────────────────────────────────────

// Lançamento do relatório do sistema. Valor com sinal: crédito +, débito −
export interface SystemEntry {
  id: string
  date: string
  document: string
  history: string
  complement: string
  amount: number
}

export interface SystemAccount {
  // Nome normalizado — é o que liga a conta entre arquivos e preferências salvas
  key: string
  code: string
  name: string
  openingBalance: number | null
  closingBalance: number | null
  entries: SystemEntry[]
}

export interface SystemReport {
  fileName: string
  accounts: SystemAccount[]
  period: Period | null
}

// ── Extrato bancário ────────────────────────────────────────────────────────

export type StatementSource = 'excel' | 'pdf'

export interface StatementMovement {
  id: string
  // Posição cronológica dentro do extrato (movimentos e linhas de saldo dividem a sequência)
  order: number
  date: string
  description: string
  counterparty: string
  document: string
  amount: number
  // Saldo após o movimento, quando o banco informa
  balance: number | null
  // Tipo da transação, quando o banco tem coluna própria ("Depósito de PIX", "Tarifa")
  kind?: string
  // Registro redundante (aplicação/resgate da conta remunerada): fica fora da conciliação
  ignored?: boolean
}

// Linha de saldo informada pelo banco ("SALDO DIA", "SALDO ANTERIOR"…)
export interface StatementBalancePoint {
  order: number
  date: string
  label: string
  balance: number
}

export type StatementField =
  | 'date'
  | 'description'
  | 'counterparty'
  | 'document'
  | 'amount'
  | 'credit'
  | 'debit'
  | 'direction'
  | 'kind'
  | 'balance'

// Campo do extrato → índice da coluna na planilha
export type ColumnMapping = Partial<Record<StatementField, number>>

export interface Statement {
  fileName: string
  source: StatementSource
  movements: StatementMovement[]
  balances: StatementBalancePoint[]
  warnings: string[]
}

// ── Resultado ───────────────────────────────────────────────────────────────

// Como a linha foi casada
// value: valor único nos dois lados · same-value: valor repetido, par escolhido pelo nome
// sum: soma de vários lançamentos · none: sem par
export type MatchCriterion = 'value' | 'same-value' | 'sum' | 'none'

export interface ResultRow {
  id: string
  source: 'statement' | 'system'
  date: string
  // Coluna "Lançamento" da planilha
  description: string
  // Histórico completo do banco, só para a tela
  bankHistory: string
  amount: number
  situation: Situation
  document: string
  criterion: MatchCriterion
  // Explicação curta do casamento, só para a tela
  note: string
  // Possível par por nome com valor diferente — não casa, só avisa
  suggestion: string
  movementIds: string[]
  entryIds: string[]
  edited: boolean
}

export interface AccountBalances {
  systemOpening: number | null
  systemClosing: number | null
  bankOpening: number | null
  bankClosing: number | null
}

// Logos embutidas na planilha exportada: a da empresa à esquerda do título, a do banco à direita
export type LogoId = 'inovati' | 'btg' | 'caixa' | 'qitech'

// Aparência e rótulos da aba na planilha exportada (cores em ARGB)
export interface AccountProfile {
  sheetName: string
  company: string
  bankLabel: string
  balanceLabel: string
  headerColor: string
  balanceColor: string
  highlightColor: string
  tabColor: string
  logo: LogoId | null
  bankLogo: LogoId | null
}

export interface AccountResult {
  accountKey: string
  accountName: string
  statementNames: string[]
  profile: AccountProfile
  rows: ResultRow[]
  balances: AccountBalances
  // Soma dos movimentos do extrato no período — confere saldo inicial + movimentos = final
  statementTotal: number
  // Registros redundantes do período, fora da conciliação mas dentro do saldo do banco
  ignoredCount: number
  ignoredTotal: number
}
