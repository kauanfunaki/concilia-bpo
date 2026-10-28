import { describe, it, expect } from 'vitest'
import { parseSispagReport } from './sispagReport'
import type { ProFrotasSheet } from '../proFrotas/sheet'

const HEADER = ['favorecido / beneficiário', 'CPF/CNPJ', 'tipo de pagamento', 'referência da empresa', 'data do pagamento', 'valor (R$)', 'status']

// Reproduz a "Consulta de pagamentos" exportada do Itaú, com as linhas em branco preservadas
function consulta(rows: unknown[][], total: number | null = null): ProFrotasSheet {
  return {
    sheetName: 'consultaPagamentos',
    firstRow: 1,
    firstCol: 0,
    rows: [
      [null],
      ['Dados da conta'],
      [null],
      ['Agência/conta', '1234 / 56789-0', null, 'Nome da empresa:', 'EMPRESA EXEMPLO LTDA'],
      ['CNPJ:', '99.999.999/0001-99'],
      [null],
      ['Resultado da busca'],
      ['Conta:', 'Conta em operação', 'Tipo:', 'Todos'],
      ['Período:', '01/03/2025 - 31/03/2025', 'Status:', 'todos'],
      ['Modalidade:', 'Fornecedores / Impostos e tributos'],
      [null],
      HEADER,
      ...rows,
      ...(total === null ? [] : [['Total:', null, null, null, null, total, null]]),
    ],
  }
}

describe('parseSispagReport', () => {
  it('lê os dados da conta e os pagamentos, com a linha do Excel de cada um', () => {
    const report = parseSispagReport(
      [
        consulta(
          [
            ['FORNECEDOR EXEMPLO LTDA', '44.444.444/0001-44', 'Boleto outros bancos', '7477241235', '31/03/2025', 85, 'Não efetuado'],
            ['BELTRANO DE SOUZA', '555.555.555-55', 'TED outro titular', '7497544810', '31/03/2025', 240, 'Efetuado'],
            ['FULANO DE TAL', '***.456.789-**', 'PIX Transferências', '-', '01/03/2025', '1.800,00', 'Efetuado'],
          ],
          2125
        ),
      ],
      'SISPAG.xls'
    )
    expect(report).toMatchObject({
      fileName: 'SISPAG.xls',
      company: 'EMPRESA EXEMPLO LTDA',
      cnpj: '99.999.999/0001-99',
      account: '1234 / 56789-0',
      modality: 'Fornecedores / Impostos e tributos',
      period: { start: '2025-03-01', end: '2025-03-31' },
      fileTotal: 2125,
      warnings: [],
    })
    expect(report.payments.map((p) => [p.row, p.payee, p.date, p.amount, p.done, p.family, p.reference])).toEqual([
      [13, 'FORNECEDOR EXEMPLO LTDA', '2025-03-31', 85, false, 'supplier', '7477241235'],
      [14, 'BELTRANO DE SOUZA', '2025-03-31', 240, true, 'ted', '7497544810'],
      [15, 'FULANO DE TAL', '2025-03-01', 1800, true, 'supplier', ''],
    ])
  })

  it('avisa quando o "Total:" do arquivo não bate com a soma lida', () => {
    const report = parseSispagReport([consulta([['A', '', 'PIX Transferências', '', '05/03/2025', 100, 'Efetuado']], 150)], 'x.xls')
    expect(report.warnings.join()).toMatch(/não bate com a soma/)
  })

  it('soma solta no fim da planilha (sem data e sem favorecido) não vira pagamento nem aviso', () => {
    const sheet = consulta([['A', '', 'PIX Transferências', '', '05/03/2025', 100, 'Efetuado']])
    sheet.rows.push([null, null, null, null, null, 3007094.66, null])
    const report = parseSispagReport([sheet], 'x.xlsx')
    expect(report.payments).toHaveLength(1)
    expect(report.warnings).toEqual([])
  })

  it('vale a aba com mais pagamentos: a conferência feita à mão em outra aba fica de fora', () => {
    const manual: ProFrotasSheet = {
      sheetName: 'Planilha1',
      firstRow: 1,
      firstCol: 0,
      rows: [HEADER, ['A', '', 'TED outro titular', '', '06/01/2025', 10, 'Efetuado', 'x']],
    }
    const main = consulta([
      ['A', '', 'TED outro titular', '', '06/01/2025', 10, 'Efetuado'],
      ['B', '', 'TED outro titular', '', '06/01/2025', 20, 'Efetuado'],
    ])
    expect(parseSispagReport([main, manual], 'x.xlsx').payments).toHaveLength(2)
    expect(parseSispagReport([manual, main], 'x.xlsx').payments).toHaveLength(2)
  })

  it('sem período no cabeçalho, usa as datas dos pagamentos', () => {
    const sheet: ProFrotasSheet = {
      sheetName: 'x',
      firstRow: 1,
      firstCol: 0,
      rows: [HEADER, ['A', '', 'PIX Transferências', '', '10/03/2025', 1, 'Efetuado'], ['B', '', 'PIX Transferências', '', '05/03/2025', 1, 'Efetuado']],
    }
    expect(parseSispagReport([sheet], 'x.xlsx').period).toEqual({ start: '2025-03-05', end: '2025-03-10' })
  })

  it('planilha sem as colunas do SISPAG dá erro explicando o que falta', () => {
    const sheet: ProFrotasSheet = { sheetName: 'x', firstRow: 1, firstCol: 0, rows: [['Data', 'Histórico', 'Valor']] }
    expect(() => parseSispagReport([sheet], 'x.xlsx')).toThrow(/Consulta de pagamentos/)
  })
})
