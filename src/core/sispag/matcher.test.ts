import { describe, it, expect, beforeEach } from 'vitest'
import { commonPeriod, findSubset, reconcileSispag } from './matcher'
import { classifyMovement, paymentFamily, splitCounterparty } from './classify'
import type { ItauMovement, ItauStatement, SispagPayment, SispagReport, SispagResult } from '../../types/sispag'

const MARCH = { start: '2025-03-01', end: '2025-03-31' }

let seq = 0
beforeEach(() => {
  seq = 0
})

function mov(date: string, description: string, amount: number): ItauMovement {
  seq++
  return {
    id: `m${seq}`,
    order: seq,
    date,
    description,
    ...splitCounterparty(description),
    amount,
    balance: null,
    ...classifyMovement(description, amount),
  }
}

function pay(date: string, amount: number, type: string, status = 'Efetuado', payee = '', document = ''): SispagPayment {
  seq++
  return {
    id: `p${seq}`,
    row: seq,
    payee: payee || `Favorecido ${seq}`,
    document,
    type,
    reference: '',
    date,
    amount,
    status,
    done: status === 'Efetuado',
    family: paymentFamily(type),
  }
}

function statementOf(movements: ItauMovement[], period = MARCH): ItauStatement {
  return { fileName: 'extrato.pdf', source: 'pdf', account: '1234 / 56789-0', company: '', period, openingBalance: null, closingBalance: null, movements, warnings: [] }
}

function reportOf(payments: SispagPayment[], period = MARCH): SispagReport {
  return {
    fileName: 'sispag.xls',
    company: 'EMPRESA EXEMPLO LTDA',
    cnpj: '99.999.999/0001-99',
    account: '1234 / 56789-0',
    modality: 'Fornecedores / Impostos e tributos',
    period,
    payments,
    fileTotal: null,
    warnings: [],
  }
}

function run(movements: ItauMovement[], payments: SispagPayment[]): SispagResult {
  return reconcileSispag(statementOf(movements), reportOf(payments))
}

/** [situação, regra, linhas do extrato, pagamentos] de cada item */
function summary(result: SispagResult) {
  return result.items.map((i) => [i.situation, i.rule, i.movementIds, i.paymentIds])
}

describe('reconcileSispag', () => {
  it('uma linha do extrato para cada pagamento, no mesmo dia e com o mesmo valor', () => {
    const l1 = mov('2025-03-05', 'Sispag Fornecedores', -3500)
    const l2 = mov('2025-03-05', 'Sispag Fornecedores', -129)
    const p1 = pay('2025-03-05', 129, 'Boleto outros bancos')
    const p2 = pay('2025-03-05', 3500, 'PIX Transferências')
    const result = run([l1, l2], [p1, p2])
    expect(summary(result)).toEqual([
      ['matched', 'value', [l1.id], [p2.id]],
      ['matched', 'value', [l2.id], [p1.id]],
    ])
    expect(result.totals).toMatchObject({ debits: 3629, done: 3629, difference: 0 })
  })

  it('lote de TED numa linha só, com TED devolvida (extrato de março/2025)', () => {
    const lote = mov('2025-03-05', 'Sispag Fornecedores TED', -1500)
    const dev = mov('2025-03-05', 'Dev TED 078952 MOT02', 200)
    const a = pay('2025-03-05', 1000, 'TED outro titular')
    const b = pay('2025-03-05', 300, 'TED outro titular')
    const devolvida = pay('2025-03-05', 200, 'TED outro titular', 'Não efetuado')
    const result = run([lote, dev], [a, b, devolvida])
    expect(summary(result)).toEqual([
      ['returned', 'return', [dev.id], [devolvida.id]],
      ['matched', 'batch', [lote.id], [a.id, b.id, devolvida.id]],
    ])
    expect(result.paymentSituation).toEqual({ [a.id]: 'matched', [b.id]: 'matched', [devolvida.id]: 'returned' })
    expect(result.totals).toMatchObject({ debits: 1500, done: 1300, returned: 200, returns: 200, difference: 0 })
  })

  it('TED listada uma a uma como "Sispag Fornecedores" (extrato de janeiro/2025)', () => {
    const l1 = mov('2025-03-06', 'Sispag Fornecedores', -480)
    const l2 = mov('2025-03-06', 'Sispag Fornecedores', -6360.48)
    const ted = pay('2025-03-06', 480, 'TED outro titular')
    const mesmoTitular = pay('2025-03-06', 6360.48, 'TED mesmo titular')
    expect(summary(run([l1, l2], [ted, mesmoTitular]))).toEqual([
      ['matched', 'value', [l1.id], [ted.id]],
      ['matched', 'value', [l2.id], [mesmoTitular.id]],
    ])
  })

  it('créditos em conta do mesmo dia em duas linhas: combinação e depois o resto do lote', () => {
    const pequena = mov('2025-03-07', 'Sispag Fornecedores', -350)
    const grande = mov('2025-03-07', 'Sispag Fornecedores', -1050)
    const [p50, p100, p250, p400, p600] = [50, 100, 250, 400, 600].map((v) => pay('2025-03-07', v, 'Conta Corrente'))
    const result = run([pequena, grande], [p50, p100, p250, p400, p600])
    expect(summary(result)).toEqual([
      ['matched', 'sum', [pequena.id], [p250.id, p100.id]],
      ['matched', 'batch', [grande.id], [p50.id, p400.id, p600.id]],
    ])
  })

  it('tributos somados numa linha "Sispag Tributos" não se misturam com fornecedores do mesmo valor', () => {
    const tributos = mov('2025-03-10', 'Sispag Tributos', -7660.85)
    const fornecedor = mov('2025-03-10', 'Sispag Fornecedores', -3419.89)
    const iss = [3419.89, 3070.59, 1170.37].map((v) => pay('2025-03-10', v, 'IPTU/ISS e outros tributos'))
    const boleto = pay('2025-03-10', 3419.89, 'Boleto outros bancos')
    const result = run([tributos, fornecedor], [...iss, boleto])
    expect(summary(result)).toEqual([
      ['matched', 'value', [fornecedor.id], [boleto.id]],
      ['matched', 'batch', [tributos.id], iss.map((p) => p.id)],
    ])
  })

  it('pagamento agendado para sábado vale no próximo dia com movimento no extrato', () => {
    const linha = mov('2025-03-05', 'Sispag Fornecedores', -96.6)
    const sabado = pay('2025-03-01', 96.6, 'PIX Transferências')
    const result = run([linha], [sabado])
    expect(summary(result)).toEqual([['matched', 'value', [linha.id], [sabado.id]]])
    expect(result.days).toEqual([{ date: '2025-03-05', debits: 96.6, returns: 0, otherModality: 0, debited: 96.6, difference: 0 }])
  })

  it('PIX não efetuado que saiu e voltou no mesmo dia ("Est Sispag Fornecedores")', () => {
    const debito = mov('2025-03-08', 'Sispag Fornecedores', -1302.2)
    const estorno = mov('2025-03-08', 'Est Sispag Fornecedores', 1302.2)
    const pix = pay('2025-03-08', 1302.2, 'PIX Transferências', 'Não efetuado')
    expect(summary(run([debito, estorno], [pix]))).toEqual([
      ['returned', 'return', [estorno.id], [pix.id]],
      ['matched', 'value', [debito.id], [pix.id]],
    ])
  })

  it('"Sispag Salários" é outra modalidade e não rouba pagamento de mesmo valor do lote', () => {
    const salarios = mov('2025-03-21', 'Sispag Salários', -20000)
    const lote = mov('2025-03-21', 'Sispag Fornecedores', -27841.5)
    const creditos = [20000, 1690, 1160, 3957.5, 1034].map((v) => pay('2025-03-21', v, 'Conta Corrente'))
    const result = run([salarios, lote], creditos)
    expect(summary(result)).toEqual([
      ['matched', 'batch', [lote.id], creditos.map((p) => p.id)],
      ['otherModality', 'none', [salarios.id], []],
    ])
    expect(result.items[1].note).toMatch(/Fornecedores \/ Impostos e tributos/)
    expect(result.totals).toMatchObject({ debits: 27841.5, otherModality: 20000, difference: 0 })
  })

  it('divergências, com a pista do outro lado quando há valor igual', () => {
    const semPagamento = mov('2025-03-12', 'Sispag Fornecedores', -999)
    const pixManual = mov('2025-03-12', 'PIX TRANSF FULANO', -555)
    const devSemPar = mov('2025-03-12', 'Dev TED 111111 MOT02', 77)
    const debitoTed = mov('2025-03-12', 'Sispag Fornecedores TED', -88)
    const devDeEfetuado = mov('2025-03-12', 'Dev TED 222222 MOT02', 88)
    const naoEfetuado999 = pay('2025-03-12', 999, 'TED outro titular', 'Não efetuado', 'MOVIDA')
    const efetuadoSemDebito = pay('2025-03-12', 555, 'PIX Transferências')
    const tedEfetuada = pay('2025-03-12', 88, 'TED outro titular')
    const naoEfetuado = pay('2025-03-12', 66, 'Boleto Itaú', 'Não efetuado')
    const result = run(
      [semPagamento, pixManual, devSemPar, debitoTed, devDeEfetuado],
      [naoEfetuado999, efetuadoSemDebito, tedEfetuada, naoEfetuado]
    )
    const bySituation = Object.fromEntries(result.items.map((i) => [i.situation, i]))
    expect(bySituation.returnUnmatched.movementIds).toEqual([devSemPar.id])
    expect(bySituation.returnedDone).toMatchObject({ movementIds: [devDeEfetuado.id], paymentIds: [tedEfetuada.id] })
    expect(bySituation.statementOnly).toMatchObject({ movementIds: [semPagamento.id] })
    expect(bySituation.statementOnly.hint).toMatch(/não efetuado de mesmo valor: MOVIDA/)
    expect(bySituation.reportOnly).toMatchObject({ paymentIds: [efetuadoSemDebito.id] })
    expect(bySituation.reportOnly.hint).toMatch(/PIX TRANSF FULANO/)
    expect(result.paymentSituation).toMatchObject({
      [tedEfetuada.id]: 'returnedDone',
      [efetuadoSemDebito.id]: 'reportOnly',
      [naoEfetuado.id]: 'notDone',
      [naoEfetuado999.id]: 'notDone',
    })
    // A TED efetuada e devolvida casou com o débito; o resto é a diferença do dia
    expect(result.totals).toMatchObject({ debits: 1087, done: 643, returned: 0, difference: 444 })
    expect(result.days[0].difference).toBe(444)
  })

  it('no OFX, o documento do favorecido escolhe entre pagamentos de mesmo valor', () => {
    const acme = mov('2025-03-14', 'PAGAMENTOS A FORNECEDORES ACME LTDA 11.111.111/0001-11', -100)
    const beta = mov('2025-03-14', 'PAGAMENTOS A FORNECEDORES BETA SA 22.222.222/0001-22', -100)
    const pBeta = pay('2025-03-14', 100, 'Boleto outros bancos', 'Efetuado', 'BETA SA', '22.222.222/0001-22')
    const pAcme = pay('2025-03-14', 100, 'Boleto outros bancos', 'Efetuado', 'ACME LTDA', '11.111.111/0001-11')
    expect(summary(run([acme, beta], [pBeta, pAcme]))).toEqual([
      ['matched', 'value', [acme.id], [pAcme.id]],
      ['matched', 'value', [beta.id], [pBeta.id]],
    ])
  })

  it('mesmo valor em outra data (até 5 dias) casa como "outra data"', () => {
    const linha = mov('2025-03-17', 'Sispag Fornecedores', -410)
    const outra = mov('2025-03-14', 'Sispag Fornecedores', -1)
    const pagamento = pay('2025-03-14', 410, 'Boleto outros bancos')
    const result = run([outra, linha], [pagamento])
    expect(result.items.find((i) => i.rule === 'shifted')).toMatchObject({ movementIds: [linha.id], paymentIds: [pagamento.id] })
  })

  it('só o período em comum entra; sem dia em comum, erro', () => {
    const linha = mov('2025-03-05', 'Sispag Fornecedores', -10)
    const marco = pay('2025-03-05', 10, 'PIX Transferências')
    const fevereiro = pay('2025-02-28', 20, 'PIX Transferências')
    const result = reconcileSispag(statementOf([linha]), reportOf([marco, fevereiro], { start: '2025-02-01', end: '2025-03-31' }))
    expect(result.period).toEqual(MARCH)
    expect(result.outside).toEqual({ payments: 1, movements: 0 })
    expect(() => reconcileSispag(statementOf([linha]), reportOf([fevereiro], { start: '2025-02-01', end: '2025-02-28' }))).toThrow(/nenhum dia em comum/)
    expect(commonPeriod(statementOf([linha]), reportOf([fevereiro], { start: '2025-02-01', end: '2025-02-28' }))).toBeNull()
  })
})

describe('findSubset', () => {
  const items = (...cents: number[]) => cents.map((c) => ({ cents: c }))

  it('acha a combinação e diz se é a única', () => {
    expect(findSubset(items(5000, 10000, 25000), 35000)).toEqual({ items: [{ cents: 25000 }, { cents: 10000 }], ambiguous: false })
    expect(findSubset(items(100, 200, 300, 400), 500)?.ambiguous).toBe(true)
    expect(findSubset(items(100, 200), 1000)).toBeNull()
  })

  it('pagamentos de mesmo valor não contam como outra combinação', () => {
    expect(findSubset(items(12000, 12000, 5000), 17000)?.ambiguous).toBe(false)
  })
})
