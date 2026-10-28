import { describe, it, expect } from 'vitest'
import { parseLancamentosSheet } from './itauLancamentos'
import { parseItauPdf } from './itauPdf'
import type { PdfTextItem } from '../bankReconciliation/statementPdf'
import type { ProFrotasSheet } from '../proFrotas/sheet'
import type { ItauStatement } from '../../types/sispag'

/** [id, data, histórico, favorecido, CPF/CNPJ, valor, papel, lote] de cada lançamento */
function movements(statement: ItauStatement) {
  return statement.movements.map((m) => [m.id, m.date, m.description, m.counterparty, m.document, m.amount, m.kind, m.family])
}

// ── Excel: "Lançamentos" detalhado, uma linha por pagamento do SISPAG ─────────

const SHEET_HEAD: unknown[][] = [
  [],
  ['Atualização:', '12/01/2026 13:30:18'],
  ['Nome:', 'EMPRESA EXEMPLO'],
  ['Agência:', '1234'],
  ['Conta:', '0056789-0'],
  [],
  ['Lançamentos'],
  ['Periodo:', '01/12/2025 até 31/12/2025'],
  [],
  ['Data', 'Lançamento', 'Razão Social', 'CPF/CNPJ', 'Valor (R$)', 'Saldo (R$)'],
]

function sheetRows({ dropAcme = false } = {}): unknown[][] {
  return [
    ...SHEET_HEAD,
    ['30/11/2025', 'SALDO ANTERIOR', null, null, null, -1000],
    ['01/12/2025', 'RECEBIMENTOS CLIENTE EXEMPLO', 'CLIENTE EXEMPLO LTDA', '11.111.111/0001-11', 5000, null],
    ['01/12/2025', 'PAGAMENTOS A FORNECEDORES', 'JOAO DA SILVA', '123.456.789-09', -1120, null],
    ...(dropAcme ? [] : [['01/12/2025', 'PAGAMENTOS A FORNECEDORES', 'ACME LTDA', '22.222.222/0001-22', -380.5, null]]),
    // A aplicação automática passa dinheiro da conta para a aplicação: o saldo total não muda
    ['01/12/2025', 'APL APLIC AUT MAIS', null, null, -2499.5, null],
    ['01/12/2025', 'SALDO TOTAL DISPONÍVEL DIA', null, null, null, 2499.5],
    ['01/12/2025', 'SALDO MOVIMENTAÇÃO CONTA', null, null, null, 0],
    ['01/12/2025', 'SALDO APLIC. AUT.', null, null, null, 2499.5],
    ['02/12/2025', 'DEV TED 1A2B3C4DMOT2', 'JOAO DA SILVA', '123.456.789-09', 1120, null],
    ['02/12/2025', 'RES APLIC AUT MAIS', null, null, 380, null],
    ['02/12/2025', 'SISPAG SALARIOS', null, null, -1500, null],
    ['02/12/2025', 'SALDO TOTAL DISPONÍVEL DIA', null, null, null, 2119.5],
    ['31/12/2025', 'SALDO APLIC. AUT.', null, null, null, 2119.5],
  ]
}

function sheet(rows: unknown[][], sheetName = 'Lançamentos'): ProFrotasSheet {
  return { sheetName, rows, firstRow: 1, firstCol: 0 }
}

describe('parseLancamentosSheet', () => {
  it('lê histórico, favorecido e CPF/CNPJ de cada lançamento; as linhas de saldo ficam de fora', () => {
    const statement = parseLancamentosSheet([sheet(sheetRows())], 'extrato.xlsx')
    expect(movements(statement)).toEqual([
      ['L12', '2025-12-01', 'RECEBIMENTOS CLIENTE EXEMPLO CLIENTE EXEMPLO LTDA', 'CLIENTE EXEMPLO LTDA', '11.111.111/0001-11', 5000, 'other', null],
      ['L13', '2025-12-01', 'PAGAMENTOS A FORNECEDORES JOAO DA SILVA', 'JOAO DA SILVA', '123.456.789-09', -1120, 'payment', 'supplier'],
      ['L14', '2025-12-01', 'PAGAMENTOS A FORNECEDORES ACME LTDA', 'ACME LTDA', '22.222.222/0001-22', -380.5, 'payment', 'supplier'],
      ['L15', '2025-12-01', 'APL APLIC AUT MAIS', '', '', -2499.5, 'other', null],
      ['L19', '2025-12-02', 'DEV TED 1A2B3C4DMOT2 JOAO DA SILVA', 'JOAO DA SILVA', '123.456.789-09', 1120, 'return', null],
      ['L20', '2025-12-02', 'RES APLIC AUT MAIS', '', '', 380, 'other', null],
      ['L21', '2025-12-02', 'SISPAG SALARIOS', '', '', -1500, 'payment', 'salary'],
    ])
  })

  it('conta como no relatório SISPAG, período e saldos; confere pelo saldo total do dia, sem a aplicação automática', () => {
    const statement = parseLancamentosSheet([sheet(sheetRows())], 'extrato.xlsx')
    expect(statement).toMatchObject({
      source: 'excel',
      account: '1234 / 56789-0',
      company: 'EMPRESA EXEMPLO',
      period: { start: '2025-12-01', end: '2025-12-31' },
      openingBalance: -1000,
      closingBalance: 2119.5,
      warnings: [],
    })
  })

  it('linha perdida aparece no saldo do dia', () => {
    const statement = parseLancamentosSheet([sheet(sheetRows({ dropAcme: true }))], 'extrato.xlsx')
    expect(statement.warnings.join('\n')).toMatch(/saldo de 01\/12\/2025 no extrato \(R\$\s2\.499,50\) não bate com a soma lida \(R\$\s2\.880,00\)/)
  })

  it('o relatório SISPAG na caixa do extrato diz onde ele vai; planilha estranha diz o que procurou', () => {
    const report = sheet([['favorecido / beneficiário', 'CPF/CNPJ', 'tipo de pagamento', 'data do pagamento', 'valor (R$)', 'status']], 'consultaPagamentos')
    expect(() => parseLancamentosSheet([report], 'sispag.xlsx')).toThrow(/relatório SISPAG/)
    expect(() => parseLancamentosSheet([sheet([['Nome', 'Idade']])], 'x.xlsx')).toThrow(/"Data", "Lançamento" e "Valor \(R\$\)"/)
  })
})

// ── PDF: "Lançamentos do período" consolidado, uma linha por lote do SISPAG ────

// Pedaços de texto como o pdf.js entrega o PDF: valores alinhados à direita, colunas fixas
const H = 9
const cell = (page: number, x: number, y: number, text: string): PdfTextItem => ({ page, x, y, width: text.length * 4.5, height: H, text })
const right = (page: number, edge: number, y: number, text: string): PdfTextItem => cell(page, edge - text.length * 4.5, y, text)
const COL = { date: 35.1, description: 84.2, name: 220.7, document: 357.1, value: 502.1, balance: 558.4 }

/** Célula de uma, duas ou três linhas, centrada na altura da data */
function cellLines(page: number, x: number, y: number, texts: string[]): PdfTextItem[] {
  const top = y + ((texts.length - 1) * 10.6) / 2
  return texts.map((text, i) => cell(page, x, top - i * 10.6, text))
}

function row(page: number, y: number, date: string, r: { description: string[]; name?: string[]; document?: string; value?: string; balance?: string }) {
  return [
    cell(page, COL.date, y, date),
    ...cellLines(page, COL.description, y, r.description),
    ...cellLines(page, COL.name, y, r.name ?? []),
    ...(r.document ? [cell(page, COL.document, y, r.document)] : []),
    ...(r.value ? [right(page, COL.value, y, r.value)] : []),
    ...(r.balance ? [right(page, COL.balance, y, r.balance)] : []),
  ]
}

function pdfItems({ dropValue = false } = {}): PdfTextItem[] {
  return [
    // ── página 1: empresa, conta, limite, período e títulos das colunas ──
    cell(1, 34.4, 747.8, 'EMPRESA EXEMPLO'),
    cell(1, 93.5, 747.8, 'CNPJ 99.999.999/0001-99'),
    cell(1, 435.7, 747.8, 'Agência'),
    cell(1, 470.0, 747.8, '1234'),
    cell(1, 491.9, 747.8, 'Conta'),
    cell(1, 518.3, 747.8, '0056789-0'),
    cell(1, 35.1, 712.1, 'Saldo total'),
    cell(1, 35.1, 691.8, '-R$ 500.100,00'),
    cell(1, 34.4, 654.5, 'Lançamentos do período:'),
    cell(1, 130.8, 654.5, '01/12/2025 até 31/12/2025'),
    cell(1, COL.date, 628.1, 'Data'),
    cell(1, COL.description, 628.1, 'Lançamentos'),
    cell(1, COL.name, 628.1, 'Razão Social'),
    cell(1, COL.document, 628.1, 'CNPJ/CPF'),
    right(1, COL.value, 628.1, 'Valor (R$)'),
    right(1, COL.balance, 628.1, 'Saldo (R$)'),
    ...row(1, 615.3, '30/11/2025', { description: ['SALDO ANTERIOR'], balance: '-1.000,00' }),
    ...row(1, 597.2, '01/12/2025', {
      description: ['RECEBIMENTOS CLIENTE', 'EXEMPLO ...'],
      name: ['CLIENTE EXEMPLO', 'LTDA.'],
      document: '11.111.111/0001-11',
      value: '5.000,00',
    }),
    ...row(1, 579.1, '01/12/2025', { description: ['SISPAG FORNECEDORES'], ...(dropValue ? {} : { value: '-1.500,50' }) }),
    ...row(1, 561.0, '01/12/2025', { description: ['SISPAG FORNECEDORES PIX QR-', 'CODE'], value: '-76,71' }),
    ...row(1, 548.2, '01/12/2025', { description: ['SALDO TOTAL DISPONÍVEL DIA'], balance: '2.422,79' }),
    ...row(1, 530.1, '02/12/2025', { description: ['DEV TED 1A2B3C4DMOT2'], name: ['JOAO DA SILVA'], document: '123.456.789-09', value: '300,00' }),
    // A página corta a linha: o começo do histórico fica no pé da página 1…
    cell(1, COL.description, 512.0, 'SISPAG FORNECEDORES PIX'),
    // ── página 2: sem títulos; …e a data, o valor e o resto do histórico abrem a página 2 ──
    ...row(2, 805.3, '02/12/2025', { description: ['TRANSFERENCIA'], value: '-200,00' }),
    ...row(2, 792.5, '02/12/2025', { description: ['SISPAG SALARIOS'], value: '-1.000,00' }),
    ...row(2, 779.7, '02/12/2025', { description: ['SALDO TOTAL DISPONÍVEL DIA'], balance: '1.522,79' }),
    ...row(2, 60.0, '03/12/2025', { description: ['SISPAG FORNECEDORES PIX QR-'], value: '-50,00' }),
    // ── página 3: o fim do histórico da última linha da página 2 vem antes da primeira data ──
    cell(3, COL.description, 805.3, 'CODE'),
    ...row(3, 787.2, '03/12/2025', { description: ['SALDO TOTAL DISPONÍVEL DIA'], balance: '1.472,79' }),
    cell(3, 34.4, 760.0, 'aviso:'),
    cell(3, 57.3, 760.0, 'Os saldos acima são baseados nas informações disponíveis até esse instante'),
    cell(3, 34.4, 727.0, 'atualizado em 12/01/2026 13:27:44'),
  ]
}

describe('parseItauPdf: "Lançamentos do período"', () => {
  it('junta as linhas quebradas de histórico e razão social, inclusive entre páginas; rodapé e saldos ficam de fora', () => {
    const statement = parseItauPdf(pdfItems(), 'extrato.pdf')
    expect(movements(statement)).toEqual([
      ['P1-2', '2025-12-01', 'RECEBIMENTOS CLIENTE EXEMPLO ... CLIENTE EXEMPLO LTDA.', 'CLIENTE EXEMPLO LTDA.', '11.111.111/0001-11', 5000, 'other', null],
      ['P1-3', '2025-12-01', 'SISPAG FORNECEDORES', '', '', -1500.5, 'payment', 'supplier'],
      ['P1-4', '2025-12-01', 'SISPAG FORNECEDORES PIX QR-CODE', '', '', -76.71, 'payment', 'supplier'],
      ['P1-6', '2025-12-02', 'DEV TED 1A2B3C4DMOT2 JOAO DA SILVA', 'JOAO DA SILVA', '123.456.789-09', 300, 'return', null],
      ['P2-7', '2025-12-02', 'SISPAG FORNECEDORES PIX TRANSFERENCIA', '', '', -200, 'payment', 'supplier'],
      ['P2-8', '2025-12-02', 'SISPAG SALARIOS', '', '', -1000, 'payment', 'salary'],
      ['P2-10', '2025-12-03', 'SISPAG FORNECEDORES PIX QR-CODE', '', '', -50, 'payment', 'supplier'],
    ])
  })

  it('empresa, conta como no relatório SISPAG, período e saldos, conferidos dia a dia', () => {
    const statement = parseItauPdf(pdfItems(), 'extrato.pdf')
    expect(statement).toMatchObject({
      source: 'pdf',
      account: '1234 / 56789-0',
      company: 'EMPRESA EXEMPLO',
      period: { start: '2025-12-01', end: '2025-12-31' },
      openingBalance: -1000,
      closingBalance: 1472.79,
      warnings: [],
    })
  })

  it('valor que não foi lido aparece no saldo do dia', () => {
    const statement = parseItauPdf(pdfItems({ dropValue: true }), 'extrato.pdf')
    expect(statement.warnings.join('\n')).toMatch(/saldo de 01\/12\/2025 no extrato \(R\$\s2\.422,79\) não bate com a soma lida \(R\$\s3\.923,29\)/)
  })
})
