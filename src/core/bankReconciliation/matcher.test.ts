import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { findSums, reconcileAccount } from './matcher'
import { nameSimilarity } from './names'
import { entryDocument } from './entryText'
import type { StatementMovement, SystemEntry } from '../../types/bankReconciliation'

let seq = 0
function mov(amount: number, description: string, counterparty = ''): StatementMovement {
  seq++
  return { id: `m${seq}`, order: seq, date: '2026-09-15', description, counterparty, document: '', amount, balance: null }
}
function entry(amount: number, history: string, document = ''): SystemEntry {
  seq++
  return { id: `e${seq}`, date: '2026-09-15', document, history, complement: '', amount }
}

describe('nameSimilarity', () => {
  it.each([
    ['PAGAMENTO DE BOLETO ENVIADO PARA ALFATECH', 'GERENCIAMENTO DE RISCO : : REF. PGTO TITULO NR. 221 - ALFA TECH / ALFATECNOLOGIA LTDA'],
    ['PAGAMENTO DE BOLETO ENVIADO PARA VIAPASS S A', 'PEDAGIOS : : REF. PGTO TITULO NR. 11062 - VIAPASS SA'],
    ['PAGAMENTO DE BOLETO ENVIADO PARA SENTINELA GERENCIAMENTO DE RISCO', 'REF. PGTO TITULO NR. 67263 - SENTINNELA GERENCIAMENTO DE RISCOS LTDA'],
    ['PIX RECEBIDO DE ACME TRANSP E LOG LTDA', 'TRANSF ENTRE CONTAS ACME TRANSPORTES'],
  ])('parecidos: %s × %s', (a, b) => {
    expect(nameSimilarity(a, b)).toBeGreaterThanOrEqual(0.5)
  })

  it.each([
    ['PIX ENVIADO PARA FULANO DE TAL', 'REF PGTO DOC. DESCARGA-15-09 P/ DESPESAS DIVERSAS'],
    ['PIX ENVIADO PARA JOAO DA SILVA', 'REF. PGTO TITULO NR. 10 - POSTO CENTRAL LTDA'],
  ])('diferentes: %s × %s', (a, b) => {
    expect(nameSimilarity(a, b)).toBeLessThan(0.5)
  })

  it('só palavras genéricas não contam como nome', () => {
    expect(nameSimilarity('PIX ENVIADO PARA', 'PAGAMENTO DE BOLETO')).toBe(0)
  })
})

describe('entryDocument', () => {
  it.each([
    ['SALA-12 PARCELAS/28', 'X', 'SALA-12 PARCELAS'],
    ['123/456/3', 'X', '123/456'],
    ['LIQ-100200300/', 'X', 'LIQ-100200300'],
    ['9988776', 'X', '9988776'],
    ['', ': REF. RECEB FATURA NR. 5521/1 - CLIENTE', '5521'],
    ['', ': TRANSF APORTE - ALFA', 'TRANSF APORTE - ALFA'],
    ['', 'TARIFAS : : REF VALOR DEVOLVIDO VIAGEM NR. 26/00123', 'VALOR DEVOLVIDO VIAGEM NR. 26/00123'],
  ])('documento %j, histórico %j → %j', (document, history, expected) => {
    expect(entryDocument({ id: '1', date: '', document, history, complement: '', amount: 1 })).toBe(expected)
  })
})

describe('reconcileAccount', () => {
  it('valor único nos dois lados concilia mesmo com nomes diferentes', () => {
    const m = mov(-4321.09, 'PAGAMENTO DE BOLETO ENVIADO PARA POSTO NORTE LTDA')
    const e = entry(-4321.09, 'COMBUSTIVEL : : REF. PGTO TITULO NR. LIQ-1 - POSTO SUL LTDA', 'LIQ-1')
    const [row] = reconcileAccount([e], [m])
    expect(row).toMatchObject({ situation: 'Lançamento conciliado', document: 'LIQ-1', criterion: 'value', source: 'statement' })
  })

  it('valor repetido vira "Valores iguais", com o par escolhido pelo nome', () => {
    const bankA = mov(-500, 'PAGAMENTO DE BOLETO ENVIADO PARA ALFATECH')
    const bankB = mov(-500, 'PIX ENVIADO PARA FULANO DE TAL')
    const sysDescarga = entry(-500, 'CARGA : : REF PGTO DOC. DESCARGA-15 P/ DESPESAS DIVERSAS', 'DESCARGA-15')
    const sysAlfa = entry(-500, 'RISCO : : REF. PGTO TITULO NR. 221 - ALFA TECH / ALFATECNOLOGIA LTDA', '221')
    const rows = reconcileAccount([sysDescarga, sysAlfa], [bankA, bankB])
    expect(rows.map((r) => [r.situation, r.document])).toEqual([
      ['Valores iguais', '221'],
      ['Valores iguais', 'DESCARGA-15'],
    ])
  })

  it('valor repetido sobrando de um lado: o par vai para conferência, a sobra fica pendente', () => {
    const rows = reconcileAccount([entry(-59, 'REF. PGTO TITULO NR. 1 - VIAPASS SA', '1')], [mov(-59, 'PIX ENVIADO PARA VIAPASS'), mov(-59, 'PIX ENVIADO PARA FULANO')])
    expect(rows.map((r) => r.situation)).toEqual(['Valores iguais', 'Aguardando composição'])
  })

  it('vários lançamentos do sistema com o mesmo nome somando um boleto', () => {
    const boleto = mov(-5000, 'PAGAMENTO DE BOLETO ENVIADO PARA VIAPASS S A')
    const parts = [
      entry(-1200, ': REF. PGTO TITULO NR. 2-10-06/1 - VIAPASS SA', '2-10-06/1'),
      entry(-1300.5, ': REF. PGTO TITULO NR. 2-10-05/1 - VIAPASS SA', '2-10-05/1'),
      entry(-2499.5, ': REF. PGTO TITULO NR. 2-10-04/1 - VIAPASS SA', '2-10-04/1'),
      entry(-1000, ': REF. PGTO TITULO NR. 9 - OUTRO FORNECEDOR', '9'),
    ]
    const rows = reconcileAccount(parts, [boleto])
    expect(rows[0]).toMatchObject({ situation: 'Lançamento conciliado', criterion: 'sum' })
    expect(rows[0].document.split(', ').sort()).toEqual(['2-10-04', '2-10-05', '2-10-06'])
    expect(rows.slice(1).map((r) => [r.source, r.situation, r.document])).toEqual([['system', 'Lançamento não encontrado', '9']])
  })

  it('soma que não tem nome parecido não casa', () => {
    const rows = reconcileAccount([entry(-60, 'REF - FORNECEDOR A'), entry(-40, 'REF - FORNECEDOR B')], [mov(-100, 'PIX ENVIADO PARA CICLANO')])
    expect(rows.map((r) => r.situation)).toEqual(['Aguardando composição', 'Lançamento não encontrado', 'Lançamento não encontrado'])
  })

  it('duas combinações com a mesma soma ficam em "Valores iguais"', () => {
    const rows = reconcileAccount(
      [entry(-50, 'REF - VIAPASS SA'), entry(-50, 'REF - VIAPASS SA'), entry(-30, 'REF - VIAPASS SA')],
      [mov(-80, 'BOLETO VIAPASS S A')]
    )
    expect(rows[0]).toMatchObject({ situation: 'Valores iguais', criterion: 'sum' })
  })

  it('movimento só no extrato e lançamento só no sistema, com sugestão pelo nome', () => {
    const rows = reconcileAccount([entry(-800, 'REF. PGTO TITULO NR. 5 - BELTRANO SOUZA', '5')], [mov(-812.4, 'PIX ENVIADO PARA BELTRANO DE SOUZA')])
    expect(rows[0]).toMatchObject({ source: 'statement', situation: 'Aguardando composição', document: '' })
    expect(rows[0].suggestion).toMatch(/5/)
    expect(rows[1]).toMatchObject({ source: 'system', situation: 'Lançamento não encontrado', document: '5', amount: -800 })
  })

  it('usa o nome do banco na coluna Lançamento quando o extrato separa', () => {
    const [row] = reconcileAccount([], [mov(2612, 'PIX RECEBIDO DADOS CONTA', 'RODOVIARIO SUL LTDA')])
    expect(row.description).toBe('RODOVIARIO SUL LTDA')
    expect(row.bankHistory).toBe('PIX RECEBIDO DADOS CONTA · RODOVIARIO SUL LTDA')
  })

  it('PBT: toda linha do extrato e todo lançamento aparecem exatamente uma vez', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -500, max: 500 }).filter((v) => v !== 0), { maxLength: 12 }),
        fc.array(fc.integer({ min: -500, max: 500 }).filter((v) => v !== 0), { maxLength: 12 }),
        (bankValues, systemValues) => {
          const movements = bankValues.map((v) => mov(v, 'PIX VIAPASS'))
          const entries = systemValues.map((v) => entry(v, 'REF - VIAPASS SA'))
          const rows = reconcileAccount(entries, movements)
          expect(rows.filter((r) => r.source === 'statement')).toHaveLength(movements.length)
          // Lançamento repetido entre linhas só quando vários movimentos somam um lançamento
          const byEntry = new Map<string, typeof rows>()
          for (const r of rows) for (const id of r.entryIds) byEntry.set(id, [...(byEntry.get(id) ?? []), r])
          expect([...byEntry.keys()].sort()).toEqual(entries.map((e) => e.id).sort())
          for (const shared of byEntry.values()) {
            if (shared.length > 1) expect(shared.every((r) => r.criterion === 'sum' && r.source === 'statement')).toBe(true)
          }
          // Valor conciliado bate: cada grupo casado soma o mesmo dos dois lados
          for (const r of rows.filter((x) => x.source === 'statement' && x.criterion !== 'none')) {
            const group = rows.filter((x) => x.entryIds.join() === r.entryIds.join())
            const bankTotal = group.reduce((s, x) => s + x.amount, 0)
            const systemTotal = entries.filter((e) => r.entryIds.includes(e.id)).reduce((s, e) => s + e.amount, 0)
            expect(Math.round(bankTotal * 100)).toBe(Math.round(systemTotal * 100))
          }
        }
      )
    )
  })
})

describe('findSums', () => {
  it('acha a combinação exata e para na segunda', () => {
    const pool = [{ amount: 10 }, { amount: 20 }, { amount: 30 }, { amount: 40 }]
    const sums = findSums(pool, 50, () => 1)
    expect(sums).toHaveLength(2)
    for (const combo of sums) expect(combo.reduce((s, i) => s + i.amount, 0)).toBe(50)
  })

  it('um item sozinho não é soma', () => {
    expect(findSums([{ amount: 50 }, { amount: 7 }], 50, () => 1)).toEqual([])
  })
})
