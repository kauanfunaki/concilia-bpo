import { describe, it, expect } from 'vitest'
import { groupTextLines, parseStatementPdfLines } from './statementPdf'
import type { PdfTextItem } from './statementPdf'

// Monta uma "página" com colunas em posições fixas, como o pdf.js entrega
function page(lines: (string | [number, string])[][], pageNumber = 1): PdfTextItem[] {
  const items: PdfTextItem[] = []
  lines.forEach((cells, i) => {
    const y = 800 - i * 14
    cells.forEach((cell) => {
      const [x, text] = Array.isArray(cell) ? cell : [40, cell]
      items.push({ page: pageNumber, x, y, width: text.length * 5, height: 10, text })
    })
  })
  return items
}

describe('groupTextLines', () => {
  it('junta pedaços da mesma altura na ordem horizontal', () => {
    const items: PdfTextItem[] = [
      { page: 1, x: 300, y: 700.4, width: 40, height: 10, text: '-17,38' },
      { page: 1, x: 40, y: 700, width: 50, height: 10, text: '15/09/2026' },
      { page: 1, x: 100, y: 699.8, width: 80, height: 10, text: 'PIX ENVIADO' },
      { page: 1, x: 40, y: 686, width: 50, height: 10, text: 'segunda linha' },
    ]
    const lines = groupTextLines(items)
    expect(lines.map((l) => l.text)).toEqual(['15/09/2026 PIX ENVIADO -17,38', 'segunda linha'])
  })
})

describe('parseStatementPdfLines', () => {
  it('lê data, descrição, valor e saldo; saldo anterior e descrição quebrada', () => {
    const items = page([
      [[40, 'Extrato de conta corrente - período 01/09/2026 a 17/09/2026']],
      [[40, 'Data'], [100, 'Descrição'], [380, 'Valor'], [460, 'Saldo']],
      [[100, 'SALDO ANTERIOR'], [460, '1.000,00']],
      [[40, '15/09/2026'], [100, 'PIX ENVIADO PARA JOAO'], [380, '-100,00'], [460, '900,00']],
      [[100, 'DA SILVA']],
      [[40, '15/09/2026'], [100, 'PIX RECEBIDO DE CLIENTE'], [380, '250,50'], [460, '1.150,50']],
      [[100, 'SALDO DO DIA'], [460, '1.150,50']],
      [[40, 'Página 1 de 1']],
    ])
    const statement = parseStatementPdfLines(groupTextLines(items), 'extrato.pdf')
    expect(statement.source).toBe('pdf')
    expect(statement.movements.map((m) => [m.date, m.description, m.amount, m.balance])).toEqual([
      ['2026-09-15', 'PIX ENVIADO PARA JOAO DA SILVA', -100, 900],
      ['2026-09-15', 'PIX RECEBIDO DE CLIENTE', 250.5, 1150.5],
    ])
    expect(statement.balances.map((b) => b.balance)).toEqual([1000, 1150.5])
  })

  it('sem sinal escrito, o saldo corrido decide entrada ou saída', () => {
    const items = page([
      [[100, 'SALDO ANTERIOR'], [460, '500,00']],
      [[40, '15/09'], [100, 'TARIFA PACOTE'], [380, '6,90'], [460, '493,10']],
      [[40, '15/09'], [100, 'CREDITO LIQUIDACAO'], [380, '100,00'], [460, '593,10']],
    ])
    const statement = parseStatementPdfLines(groupTextLines(items), 'x.pdf', 2026)
    expect(statement.movements.map((m) => m.amount)).toEqual([-6.9, 100])
    expect(statement.warnings.join()).not.toMatch(/sem sinal claro/)
  })

  it('colunas Débito e Crédito do cabeçalho definem o sinal', () => {
    const items = page([
      [[40, 'Data'], [100, 'Histórico'], [360, 'Débito'], [440, 'Crédito']],
      [[40, '15/09/2026'], [100, 'BOLETO FORNECEDOR'], [360, '1.234,56']],
      [[40, '15/09/2026'], [100, 'TED RECEBIDA'], [440, '99,00']],
    ])
    const statement = parseStatementPdfLines(groupTextLines(items), 'x.pdf')
    expect(statement.movements.map((m) => m.amount)).toEqual([-1234.56, 99])
  })

  it('"D" e "C" depois do valor', () => {
    const items = page([
      [[40, '15/09/2026'], [100, 'PAGAMENTO'], [380, '40,00 D']],
      [[40, '15/09/2026'], [100, 'DEPOSITO'], [380, '10,00 C']],
    ])
    expect(parseStatementPdfLines(groupTextLines(items), 'x.pdf').movements.map((m) => m.amount)).toEqual([-40, 10])
  })

  it('sem pista nenhuma de sinal, avisa', () => {
    const items = page([[[40, '15/09/2026'], [100, 'MOVIMENTO QUALQUER'], [380, '40,00']]])
    const statement = parseStatementPdfLines(groupTextLines(items), 'x.pdf')
    expect(statement.warnings.join()).toMatch(/sem sinal claro/)
  })

  it('descrição em três linhas, célula alinhada no topo', () => {
    const at = (y: number, x: number, text: string): PdfTextItem => ({ page: 1, x, y, width: text.length * 5, height: 12, text })
    const items = [
      at(600, 40, '15/09/2026'), at(600, 100, 'PIX ENVIADO PARA XYZ'), at(600, 380, '-3.210,00'),
      at(586.5, 100, 'SERVICOS ADMINISTRATIVOS'),
      at(573, 100, 'LTDA'),
      at(553.5, 40, '15/09/2026'), at(553.5, 100, 'PIX ENVIADO PARA CICLANO'), at(553.5, 380, '-400,00'),
    ]
    const statement = parseStatementPdfLines(groupTextLines(items), 'x.pdf')
    expect(statement.movements.map((m) => m.description)).toEqual([
      'PIX ENVIADO PARA XYZ SERVICOS ADMINISTRATIVOS LTDA',
      'PIX ENVIADO PARA CICLANO',
    ])
  })

  it('célula centralizada: a primeira linha da descrição fica acima da linha dos valores', () => {
    const at = (y: number, x: number, text: string): PdfTextItem => ({ page: 1, x, y, width: text.length * 5, height: 10, text })
    const items = [
      at(706, 100, 'PIX RECEBIDO'),
      at(700, 40, '15/09/2026'), at(700, 380, '1.512,00'), at(700, 460, '1.512,08'),
      at(694, 100, 'DADOS CONTA'),
      at(670, 100, 'DEB PIX'),
      at(664, 40, '15/09/2026'), at(664, 380, '-1.512,08'), at(664, 460, '0,00'),
      at(658, 100, 'CHAVE'),
    ]
    const statement = parseStatementPdfLines(groupTextLines(items), 'x.pdf')
    expect(statement.movements.map((m) => m.description)).toEqual(['PIX RECEBIDO DADOS CONTA', 'DEB PIX CHAVE'])
  })

  it('linhas de total não viram movimento', () => {
    const items = page([
      [[40, '15/09/2026'], [100, 'PIX'], [380, '-10,00']],
      [[100, 'Total de débitos'], [380, '-10,00']],
    ])
    expect(parseStatementPdfLines(groupTextLines(items), 'x.pdf').movements).toHaveLength(1)
  })
})
