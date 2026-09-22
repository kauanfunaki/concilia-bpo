import { describe, it, expect } from 'vitest'
import { detectLayout, parseDirection, parseStatementRows, parseStatementWorkbook } from './statementSheet'
import { statementPeriodBalance } from './statementBalance'

// Mesmo formato do extrato da Caixa: título mesclado, valores em texto pt-BR e "SALDO DIA"
const CAIXA_LIKE: unknown[][] = [
  ['Extrato de 01/09/2026 à 17/09/2026'],
  ['Data Lancamento', 'Data Movimento', 'Histórico', 'Documento', 'Valor Lançamento', 'Saldo', 'CPF/CNPJ', 'Nome/Razão Social'],
  ['10/09/2026', '10/09/2026', 'PIX RECEBIDO DADOS CONTA', '100956', '1.905,40', '1.905,40', '111', 'CLIENTE UM LTDA'],
  ['10/09/2026', '10/09/2026', 'DEB PIX CHAVE', '101659', '-\u00a01.905,32', '0,08', '222', 'EMPRESA PROPRIA LTDA'],
  ['10/09/2026', '10/09/2026', 'SALDO DIA', '000000', '0,00', '0,08', null, null],
  ['15/09/2026', '15/09/2026', 'PIX RECEBIDO DADOS CONTA', '150722', '1.512,00', '1.512,08', '111', 'CLIENTE UM LTDA'],
  ['15/09/2026', '15/09/2026', 'DEB PIX CHAVE', '151746', '-\u00a01.512,08', '0,00', '222', 'EMPRESA PROPRIA LTDA'],
  ['15/09/2026', '15/09/2026', 'SALDO DIA', '000000', '0,00', '0,00', null, null],
]

describe('detectLayout', () => {
  it('acha o cabeçalho abaixo do título e prefere a data de lançamento', () => {
    const layout = detectLayout({ sheetName: 'Extrato', rows: CAIXA_LIKE })
    expect(layout).toMatchObject({
      headerRow: 1,
      mapping: { date: 0, description: 2, document: 3, amount: 4, balance: 5, counterparty: 7 },
    })
  })

  it('reconhece crédito e débito em colunas separadas', () => {
    const layout = detectLayout({ sheetName: 'x', rows: [['Data', 'Descrição', 'Crédito (R$)', 'Débito (R$)', 'Saldo (R$)']] })
    expect(layout?.mapping).toEqual({ date: 0, description: 1, credit: 2, debit: 3, balance: 4 })
  })

  it('sem data ou sem valor não é cabeçalho de extrato', () => {
    expect(detectLayout({ sheetName: 'x', rows: [['Nome', 'Documento', 'Saldo']] })).toBeNull()
  })
})

describe('parseStatementRows', () => {
  it('separa movimentos das linhas de saldo e lê valores com espaço duro', () => {
    const { statement } = parseStatementWorkbook([{ sheetName: 'Extrato', rows: CAIXA_LIKE }], 'extrato.xlsx')
    expect(statement.movements.map((m) => m.amount)).toEqual([1905.4, -1905.32, 1512, -1512.08])
    expect(statement.movements[0]).toMatchObject({ description: 'PIX RECEBIDO DADOS CONTA', counterparty: 'CLIENTE UM LTDA', balance: 1905.4 })
    expect(statement.balances.map((b) => [b.date, b.balance])).toEqual([
      ['2026-09-10', 0.08],
      ['2026-09-15', 0],
    ])
  })

  it('crédito e débito positivos viram entrada e saída', () => {
    const rows = [
      ['Data', 'Histórico', 'Crédito', 'Débito'],
      ['15/09/2026', 'RECEBIMENTO', '100,00', null],
      ['15/09/2026', 'PAGAMENTO', null, '40,00'],
    ]
    const layout = detectLayout({ sheetName: 'x', rows })!
    expect(parseStatementRows(rows, layout).movements.map((m) => m.amount)).toEqual([100, -40])
  })

  it('coluna D/C define o sinal', () => {
    const rows = [
      ['Data', 'Histórico', 'Valor', 'D/C'],
      ['15/09/2026', 'TARIFA', '6,90', 'D'],
      ['15/09/2026', 'PIX', '10,00', 'C'],
    ]
    const layout = detectLayout({ sheetName: 'x', rows })!
    expect(parseStatementRows(rows, layout).movements.map((m) => m.amount)).toEqual([-6.9, 10])
  })

  it('extrato do mais recente para o mais antigo é invertido', () => {
    const rows = [
      ['Data', 'Histórico', 'Valor', 'Saldo'],
      ['16/09/2026', 'B', '-5,00', '15,00'],
      ['15/09/2026', 'A', '10,00', '20,00'],
    ]
    const parsed = parseStatementRows(rows, detectLayout({ sheetName: 'x', rows })!)
    expect(parsed.movements.map((m) => m.description)).toEqual(['A', 'B'])
    expect(parsed.warnings.join()).toMatch(/invertida/)
  })

  it('"SALDO ANTERIOR" sem data no topo vira o saldo inicial', () => {
    const rows = [
      ['Data', 'Histórico', 'Valor', 'Saldo'],
      [null, 'SALDO ANTERIOR', null, '1.000,00'],
      ['15/09/2026', 'PAGAMENTO', '-100,00', null],
    ]
    const parsed = parseStatementRows(rows, detectLayout({ sheetName: 'x', rows })!)
    expect(statementPeriodBalance(parsed, { start: '2026-09-15', end: '2026-09-15' })).toEqual({ opening: 1000, closing: 900 })
  })
})

describe('statementPeriodBalance', () => {
  const { statement } = parseStatementWorkbook([{ sheetName: 'Extrato', rows: CAIXA_LIKE }], 'extrato.xlsx')

  it('inicial = SALDO DIA anterior; final = SALDO DIA do período', () => {
    expect(statementPeriodBalance(statement, { start: '2026-09-15', end: '2026-09-15' })).toEqual({ opening: 0.08, closing: 0 })
  })

  it('sem linha de saldo anterior, usa o saldo corrido do primeiro movimento', () => {
    expect(statementPeriodBalance(statement, { start: '2026-09-10', end: '2026-09-10' })).toEqual({ opening: 0, closing: 0.08 })
  })

  it('período sem movimento fica com o último saldo conhecido', () => {
    expect(statementPeriodBalance(statement, { start: '2026-09-12', end: '2026-09-12' })).toEqual({ opening: 0.08, closing: 0.08 })
  })
})

// Mesmo formato do extrato da QI Tech: "Tipo" (tipo da transação) e "D/C" em colunas separadas,
// do mais recente para o mais antigo, com linhas "Saldo do dia" sem valor
const QI_LIKE: unknown[][] = [
  ['Data Referência', 'Hora da transação', 'Tipo', 'Descrição', 'Valor Transação (R$)', 'D/C', 'Saldo após transação (R$)', 'Saldo Final (R$)'],
  ['17/09/2026', null, 'Saldo do dia', null, null, null, null, '0'],
  ['17/09/2026', '15:50:20', 'Tarifa de PIX', '208 0050 00000-0 BANCO XYZ S.A.', '-6.9', 'D', '0', null],
  ['17/09/2026', '15:50:20', 'Transferência de PIX', '208 0050 00000-0 BANCO XYZ S.A.', '-2000', 'D', '6.9', null],
  ['17/09/2026', '07:06:02', 'Depósito', '341 1111 22222-3 CLIENTE UM S A', '1500', 'C', '2006.9', null],
  ['16/09/2026', null, 'Saldo do dia', null, null, null, null, '506.9'],
  ['16/09/2026', '16:56:45', 'Depósito de PIX', '341 2100 33333-4 CLIENTE DOIS S.A.', '500', 'C', '506.9', null],
  ['16/09/2026', '02:06:36', 'Liquidação de Boleto', 'Liquidação | Quantidade: 1', '6.9', 'C', '6.9', null],
]

describe('extrato com "Tipo" e "D/C" (QI Tech)', () => {
  it('"Tipo" vira tipo da transação e "D/C" fica com a natureza', () => {
    const layout = detectLayout({ sheetName: 'Extrato', rows: QI_LIKE })
    expect(layout?.mapping).toMatchObject({ date: 0, kind: 2, description: 3, amount: 4, direction: 5, balance: 6 })
  })

  it('depósito entra como entrada: "Depósito" começa com D, mas não é débito', () => {
    const { statement } = parseStatementWorkbook([{ sheetName: 'Extrato', rows: QI_LIKE }], 'qi.xls')
    expect(statement.movements.map((m) => [m.kind, m.amount])).toEqual([
      ['Liquidação de Boleto', 6.9],
      ['Depósito de PIX', 500],
      ['Depósito', 1500],
      ['Transferência de PIX', -2000],
      ['Tarifa de PIX', -6.9],
    ])
    expect(statement.warnings.join(' ')).not.toMatch(/sem data ou sem valor|não bate com o saldo/)
  })

  it('coluna "Tipo" que só tem D e C é a natureza', () => {
    const rows = [
      ['Data', 'Histórico', 'Valor', 'Tipo'],
      ['15/09/2026', 'TARIFA', '6,90', 'D'],
      ['15/09/2026', 'PIX', '10,00', 'C'],
    ]
    const layout = detectLayout({ sheetName: 'x', rows })!
    expect(layout.mapping).toMatchObject({ direction: 3 })
    expect(parseStatementRows(rows, layout).movements.map((m) => m.amount)).toEqual([-6.9, 10])
  })

  it('avisa quando o sinal não bate com o saldo corrido do extrato', () => {
    // Sem a coluna D/C mapeada, os débitos (valor sem sinal) entram positivos
    const rows = [
      ['Data', 'Histórico', 'Valor', 'Saldo'],
      ['15/09/2026', 'RECEBIMENTO', '100,00', '100,00'],
      ['15/09/2026', 'PAGAMENTO', '40,00', '60,00'],
      ['15/09/2026', 'TARIFA', '10,00', '50,00'],
    ]
    const { warnings } = parseStatementRows(rows, detectLayout({ sheetName: 'x', rows })!)
    expect(warnings.join(' ')).toMatch(/2 movimento\(s\) com sinal que não bate com o saldo/)
  })
})

describe('parseDirection', () => {
  it.each([
    ['D', -1],
    ['d', -1],
    ['Débito', -1],
    ['DEB', -1],
    ['Saída', -1],
    ['C', 1],
    ['Crédito', 1],
    ['CRED', 1],
    ['Entrada', 1],
    ['Depósito de PIX', 0],
    ['Depósito', 0],
    ['Tarifa de PIX', 0],
    ['', 0],
    [null, 0],
  ])('%j → %d', (value, expected) => {
    expect(parseDirection(value)).toBe(expected)
  })
})

describe('registros redundantes na planilha', () => {
  it('marca como ignorado mesmo quando o texto está numa coluna não mapeada', () => {
    const rows = [
      ['Data', 'Histórico', 'Valor', 'Saldo', 'Categoria extra'],
      ['15/09/2026', 'PIX RECEBIDO DE CLIENTE', '100,00', '100,00', null],
      ['15/09/2026', 'Aplicação Conta Remunerada', '-100,00', '0,00', null],
      ['15/09/2026', 'MOVIMENTO 123', '-50,00', '-50,00', 'Débito na Conta Corrente'],
    ]
    const { movements } = parseStatementRows(rows, detectLayout({ sheetName: 'x', rows })!)
    expect(movements.map((m) => Boolean(m.ignored))).toEqual([false, true, true])
  })
})
