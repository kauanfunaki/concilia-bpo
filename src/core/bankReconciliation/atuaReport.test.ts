import { describe, it, expect } from 'vitest'
import { parseAtuaReport } from './atuaReport'

const HEADER = [
  'cd_lancamento', 'dt_lancamento', 'nr_documento', 'ds_historico_lancamento', 'vl_credito', 'vl_debito',
  'cd_caixa_financeiro', 'nm_caixa_financeiro', 'vl_saldo', 'ds_complemento',
]

function row(id: number, date: string, doc: string | null, history: string, credit: number | null, debit: number | null, code: number, account: string, balance: number) {
  return [id, date, doc, history, credit, debit, code, account, balance, null]
}

const ROWS: unknown[][] = [
  HEADER,
  row(2, '15/09/2026', null, 'Saldo Anterior', null, null, 5, 'BANCO ALFA', -1000),
  row(101, '15/09/2026', 'NF-10/2', 'SERVICOS : : REF. PGTO TITULO NR. NF-10/2 - FORNECEDOR X', null, -250.5, 5, 'BANCO ALFA', -1250.5),
  row(102, '15/09/2026', null, ': TRANSF ENTRE CONTAS - BETA', 300, null, 5, 'BANCO ALFA', -950.5),
  row(2, '15/09/2026', null, 'Saldo Anterior', null, null, 7, 'BANCO BETA', 80),
  row(103, '15/09/2026', null, ': TRANSF ENTRE CONTAS - ALFA', null, -300, 7, 'BANCO BETA', -220),
]

describe('parseAtuaReport', () => {
  it('separa as contas, com saldo inicial, final e lançamentos com sinal', () => {
    const report = parseAtuaReport(ROWS, 'atua.xlsx')
    expect(report.period).toEqual({ start: '2026-09-15', end: '2026-09-15' })
    expect(report.accounts.map((a) => a.key)).toEqual(['BANCO ALFA', 'BANCO BETA'])

    const [alfa, beta] = report.accounts
    expect(alfa.openingBalance).toBe(-1000)
    expect(alfa.closingBalance).toBe(-950.5)
    expect(alfa.entries.map((e) => e.amount)).toEqual([-250.5, 300])
    expect(alfa.entries[0]).toMatchObject({ id: '101', document: 'NF-10/2', date: '2026-09-15' })
    expect(beta.openingBalance).toBe(80)
    expect(beta.closingBalance).toBe(-220)
  })

  it('débito gravado positivo continua saindo negativo', () => {
    const rows = [HEADER, row(1, '15/09/2026', null, 'PAGAMENTO', null, 90, 1, 'CONTA', -90)]
    expect(parseAtuaReport(rows, 'x.xlsx').accounts[0].entries[0].amount).toBe(-90)
  })

  it('conta sem lançamentos no dia mantém o saldo anterior como final', () => {
    const rows = [HEADER, row(2, '15/09/2026', null, 'Saldo Anterior', null, null, 1, 'PARADA', 42)]
    const [account] = parseAtuaReport(rows, 'x.xlsx').accounts
    expect(account.closingBalance).toBe(42)
    expect(account.entries).toHaveLength(0)
  })

  it('explica quais colunas faltam quando o arquivo não é o relatório do Atua', () => {
    expect(() => parseAtuaReport([['Data', 'Histórico', 'Valor']], 'extrato.xlsx')).toThrow(/faltam as colunas/)
  })
})
