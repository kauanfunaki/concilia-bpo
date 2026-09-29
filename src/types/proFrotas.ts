/**
 * Validação Pro Frotas: planilha "Detalhamento da Cobrança" da Pro Frotas × XMLs de NF-e
 * baixados do portal DF-e da Receita do PR. Recriação do app desktop "Validador Pro Frotas".
 */

/** Linha da planilha onde a nota apareceu: arquivo + linha do Excel (base 1) */
export interface SheetSource {
  file: string
  row: number
}

/** Linha da planilha como veio, antes de separar notas agrupadas e somar repetidas */
export interface SheetLine {
  source: SheetSource
  noteText: string
  series: string
  stationCnpj: string
  stationName: string
  companyCnpj: string
  companyName: string
  fuelDate: string | null
  amount: number | null
  // Coluna Postergado = Sim: o lançamento veio de outro período e não entra no cálculo
  postponed: boolean
}

/** Nota da planilha já tratada: uma por (nº da nota, CNPJ do posto) */
export interface SheetNote {
  id: string
  number: string
  series: string
  stationCnpj: string
  stationName: string
  companyCnpj: string
  fuelDate: string | null
  amount: number
  // Linha da planilha com várias notas ("NFe100, NFe101"): a 1ª leva o valor, as outras zero
  groupId: string | null
  sources: SheetSource[]
}

export interface XmlItem {
  description: string
  quantity: number | null
  unit: string
  unitPrice: number | null
  total: number | null
}

export interface XmlNote {
  key: string
  number: string
  series: string
  // tpNF: 0 = entrada, 1 = saída (a venda do posto para a empresa)
  type: number
  issueDate: string | null
  issuerCnpj: string
  issuerName: string
  recipientCnpj: string
  recipientName: string
  amount: number
  fileName: string
  items: XmlItem[]
}

export type Category = 'identical' | 'divergentGroup' | 'divergent' | 'notFound' | 'disregarded'

export const CATEGORIES: Category[] = ['identical', 'divergentGroup', 'divergent', 'notFound', 'disregarded']

export const CATEGORY_LABEL: Record<Category, string> = {
  identical: 'Idênticas',
  divergentGroup: 'Divergentes agrupadas',
  divergent: 'Divergentes',
  notFound: 'Não encontradas',
  disregarded: 'Desconsideradas',
}

export interface ResultNote {
  id: string
  category: Category
  sheet: SheetNote
  xml: XmlNote | null
  // Valor da planilha como vai para o relatório (em nota agrupada: o total na 1ª, zero nas outras)
  sheetAmount: number
  xmlAmount: number | null
  difference: number | null
  // Emissão − abastecimento na nota com XML; data final do período − abastecimento na não encontrada
  days: number | null
  // Número sequencial do grupo no relatório (só nas agrupadas)
  groupNumber: number | null
  note: string
}

export interface CnpjConversion {
  // CNPJ da Empresa como está na planilha → CNPJ destinatário das notas
  from: string
  to: string
}

export interface ValidationSettings {
  companyCnpj: string
  periodEnd: string
  maxDays: number
  tolerance: number
  // Só para registro: as linhas da planilha já chegam convertidas ao motor
  cnpjConversions?: CnpjConversion[]
}

export interface ValidationStats {
  sheetLines: number
  sheetOtherCompany: number
  sheetPostponed: number
  sheetWithoutNote: number
  // Sem CNPJ da empresa, sem CNPJ do posto ou sem valor
  sheetIncomplete: number
  sheetNotes: number
  xmlNotes: number
  xmlDuplicates: number
  xmlInbound: number
  xmlOtherRecipient: number
}

export interface ValidationResult {
  settings: ValidationSettings
  companyName: string
  notes: ResultNote[]
  // XMLs sem par na planilha, dentro do prazo: seguem para o próximo período
  pending: XmlNote[]
  // XMLs sem par que já passaram do prazo: saem de vez
  expired: XmlNote[]
  stats: ValidationStats
}
