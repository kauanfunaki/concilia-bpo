import { describe, it, expect } from 'vitest'
import { accountDigits, classifyMovement, documentsMatch, paymentFamily, splitCounterparty } from './classify'

describe('paymentFamily', () => {
  it.each([
    ['TED outro titular', 'ted'],
    ['TED mesmo titular', 'ownTransfer'],
    ['DARF código de barras', 'tax'],
    ['DAS código barras', 'tax'],
    ['IPTU/ISS e outros tributos', 'tax'],
    ['FGTS', 'tax'],
    ['Tributos com código de barras', 'tax'],
    ['Boleto Itaú', 'supplier'],
    ['Boleto outros bancos', 'supplier'],
    ['PIX Transferências', 'supplier'],
    ['PIX Qr Code', 'supplier'],
    ['Conta Corrente', 'supplier'],
    ['Concessionária', 'supplier'],
    ['Crédito em conta salário', 'salary'],
    ['', 'supplier'],
  ])('%s → %s', (type, family) => {
    expect(paymentFamily(type)).toBe(family)
  })
})

describe('classifyMovement', () => {
  it.each([
    ['Sispag Fornecedores', -3500, 'payment', 'supplier'],
    ['Sispag Fornecedores TED', -2231933.8, 'payment', 'ted'],
    ['Sispag Transf Titul TED', -12757.1, 'payment', 'ownTransfer'],
    ['Sispag Tributos', -7660.85, 'payment', 'tax'],
    ['Sispag Salários', -20000, 'payment', 'salary'],
    ['PAGAMENTOS A FORNECEDORES AUTO MECANICA EXEMPLO 33.333.333/0001-33', -695, 'payment', 'supplier'],
    ['SISPAG TRIBUTOS DAS SIMPLES NACIONAL 00.394.460/0058-87', -26153.64, 'payment', 'tax'],
    ['Dev TED 078952 MOT02', 50, 'return', null],
    ['Dev TED c54cf70bMOT61', 1302.2, 'return', null],
    ['Est Sispag Fornecedores', 1302.2, 'reversal', null],
  ])('%s', (description, amount, kind, family) => {
    expect(classifyMovement(description, amount)).toEqual({ kind, family })
  })

  it('crédito do SISPAG de outra empresa, tarifa e aplicação ficam de fora', () => {
    expect(classifyMovement('Sispag X ACME EXPRESS LT', 400000).kind).toBe('other')
    expect(classifyMovement('Tar/Custas Cobrança', -4.57).kind).toBe('other')
    expect(classifyMovement('Apl Aplic Aut Mais', -288682.8).kind).toBe('other')
    expect(classifyMovement('PIX TRANSF JOAO LU05/03', 300).kind).toBe('other')
  })
})

describe('splitCounterparty', () => {
  it('separa favorecido e documento do histórico do OFX', () => {
    expect(splitCounterparty('PAGAMENTOS A FORNECEDORES AUTO MECANICA E GUINCHOS EXEMPLO 33.333.333/0001-33')).toEqual({
      counterparty: 'AUTO MECANICA E GUINCHOS EXEMPLO',
      document: '33.333.333/0001-33',
    })
    expect(splitCounterparty('PAGAMENTOS A FORNECEDORES BELTRANO DE SOUZA LIMA 777.777.777-77').document).toBe('777.777.777-77')
  })

  it('sem documento no fim não há favorecido: "Sispag Fornecedores TED" é só o lote', () => {
    expect(splitCounterparty('Sispag Fornecedores TED')).toEqual({ counterparty: '', document: '' })
    expect(splitCounterparty('Sispag Fornecedores')).toEqual({ counterparty: '', document: '' })
  })
})

describe('documentsMatch', () => {
  it('compara pelos dígitos', () => {
    expect(documentsMatch('33.333.333/0001-33', '33333333000133')).toBe(true)
    expect(documentsMatch('33.333.333/0001-33', '33.333.333/0001-34')).toBe(false)
  })

  it('aceita o CPF mascarado do PIX', () => {
    expect(documentsMatch('***.456.789-**', '123.456.789-09')).toBe(true)
    expect(documentsMatch('***.456.789-**', '123.456.788-09')).toBe(false)
  })

  it('documento curto ou vazio não casa', () => {
    expect(documentsMatch('-', '-')).toBe(false)
    expect(documentsMatch('', '123.456.789-00')).toBe(false)
  })
})

describe('accountDigits', () => {
  it('iguala a conta do relatório com a do OFX', () => {
    expect(accountDigits('1234 / 56789-0')).toBe(accountDigits('1234567890'))
  })
})
