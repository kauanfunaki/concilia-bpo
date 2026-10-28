import type { Period } from './bankReconciliation'

// ── Conferência SISPAG: extrato do Itaú × relatório de pagamentos do SISPAG ──
// Datas circulam como texto ISO "yyyy-mm-dd", como no resto do app.

/**
 * Família do pagamento. É o que separa as linhas no extrato: o Itaú lança TED, transferência
 * para o mesmo titular, tributos e salários em linhas próprias, às vezes somadas por lote.
 */
export type PaymentFamily = 'supplier' | 'ted' | 'ownTransfer' | 'tax' | 'salary'

export const FAMILY_LABEL: Record<PaymentFamily, string> = {
  supplier: 'Fornecedores',
  ted: 'TED',
  ownTransfer: 'TED mesmo titular',
  tax: 'Tributos',
  salary: 'Salários',
}

// ── Relatório do SISPAG ("Consulta de pagamentos") ─────────────────────────

export interface SispagPayment {
  id: string
  // Linha no Excel, para achar o pagamento no arquivo
  row: number
  payee: string
  document: string
  type: string
  reference: string
  date: string
  // Sempre positivo
  amount: number
  status: string
  // "Efetuado". Os outros status não deveriam sair da conta, a não ser por débito devolvido
  done: boolean
  family: PaymentFamily
}

export interface SispagReport {
  fileName: string
  company: string
  cnpj: string
  account: string
  modality: string
  period: Period | null
  payments: SispagPayment[]
  // Linha "Total:" do rodapé, quando existe: confere a leitura
  fileTotal: number | null
  warnings: string[]
}

// ── Extrato do Itaú ─────────────────────────────────────────────────────────

// O papel da linha do extrato na conferência
export type MovementKind =
  | 'payment' // débito do SISPAG
  | 'return' // TED devolvida
  | 'reversal' // estorno do SISPAG
  | 'other' // fora da conferência: tarifa, PIX recebido, aplicação…

export interface ItauMovement {
  id: string
  order: number
  date: string
  description: string
  // Favorecido e CPF/CNPJ, quando o banco informa ("PAGAMENTOS A FORNECEDORES <nome> <doc>")
  counterparty: string
  document: string
  // Crédito +, débito −
  amount: number
  balance: number | null
  kind: MovementKind
  // Só nos débitos do SISPAG: o lote que o histórico indica
  family: PaymentFamily | null
}

export interface ItauStatement {
  fileName: string
  source: 'pdf' | 'ofx' | 'excel'
  account: string
  company: string
  period: Period | null
  openingBalance: number | null
  closingBalance: number | null
  movements: ItauMovement[]
  warnings: string[]
}

// ── Resultado ───────────────────────────────────────────────────────────────

export type Situation =
  | 'matched' // débito(s) do extrato = pagamento(s) efetuado(s)
  | 'returned' // não efetuado no SISPAG: debitado e devolvido, a conta zerou
  | 'returnedDone' // efetuado no SISPAG, mas o dinheiro voltou para a conta
  | 'statementOnly' // débito do SISPAG no extrato sem pagamento no relatório
  | 'reportOnly' // efetuado no relatório sem débito no extrato
  | 'returnUnmatched' // devolução ou estorno sem pagamento no relatório
  | 'otherModality' // débito de modalidade que o relatório não traz (salários)
  | 'notDone' // não efetuado e fora do extrato: só informação

// Ordem da tela: o que pede atenção primeiro
export const SITUATIONS: Situation[] = [
  'returnedDone',
  'statementOnly',
  'reportOnly',
  'returnUnmatched',
  'otherModality',
  'matched',
  'returned',
  'notDone',
]

export const SITUATION_LABEL: Record<Situation, string> = {
  matched: 'Conciliado',
  returned: 'Devolvido',
  returnedDone: 'Efetuado e devolvido',
  statementOnly: 'Só no extrato',
  reportOnly: 'Só no SISPAG',
  returnUnmatched: 'Devolução sem pagamento',
  otherModality: 'Outra modalidade',
  notDone: 'Não efetuado',
}

// O que precisa de conferência manual
export const DIVERGENT: Situation[] = ['returnedDone', 'statementOnly', 'reportOnly', 'returnUnmatched']

// Como as linhas foram casadas
export type MatchRule =
  | 'value' // 1 linha = 1 pagamento, mesmo valor e dia
  | 'batch' // 1 linha = o lote inteiro de um tipo de pagamento no dia
  | 'sum' // 1 linha = combinação de pagamentos do dia
  | 'sumAmbiguous' // idem, mas outra combinação dá a mesma soma
  | 'block' // várias linhas = vários pagamentos do mesmo lote, pelo total
  | 'day' // o que sobrou do dia fecha pelo total
  | 'shifted' // mesmo valor em outra data
  | 'return' // devolução ou estorno × pagamento
  | 'none'

export const RULE_LABEL: Record<MatchRule, string> = {
  value: 'Valor',
  batch: 'Lote',
  sum: 'Soma',
  sumAmbiguous: 'Soma (conferir)',
  block: 'Total do lote',
  day: 'Total do dia',
  shifted: 'Outra data',
  return: 'Devolução',
  none: '—',
}

export interface ResultItem {
  id: string
  situation: Situation
  rule: MatchRule
  // Data do extrato; sem linha no extrato, a do pagamento
  date: string
  movementIds: string[]
  paymentIds: string[]
  // Valores absolutos: soma das linhas do extrato e soma dos pagamentos
  statementAmount: number
  reportAmount: number
  note: string
  // Pista para a divergência: valor igual do outro lado que não casou
  hint: string
}

export interface DaySummary {
  date: string
  // Débitos do SISPAG no extrato, fora outra modalidade
  debits: number
  // Devoluções e estornos
  returns: number
  // Débitos de modalidade que o relatório não traz
  otherModality: number
  // Pagamentos do relatório que saíram da conta neste dia: efetuados e devolvidos
  debited: number
  // debits − debited: zero quando o dia fecha
  difference: number
}

export interface SispagTotals {
  debits: number
  returns: number
  otherModality: number
  done: number
  // Não efetuados que foram debitados e devolvidos
  returned: number
  notDone: number
  difference: number
}

export interface SispagResult {
  period: Period
  statement: ItauStatement
  report: SispagReport
  items: ResultItem[]
  days: DaySummary[]
  totals: SispagTotals
  // Situação final de cada pagamento do período (id → situação)
  paymentSituation: Record<string, Situation>
  // Fora do período em comum entre os dois arquivos
  outside: { payments: number; movements: number }
}
