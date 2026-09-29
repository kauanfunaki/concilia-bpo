import { describe, it, expect } from 'vitest'
import { formatCnpj, isValidCnpj, normalizeCnpj } from './cnpj'

describe('normalizeCnpj', () => {
  it.each([
    ['44.555.666/0001-72', '44555666000172'],
    [4555666000172, '04555666000172'],
    ['12.abc.345/01de-35', '12ABC34501DE35'],
    [null, ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeCnpj(input)).toBe(expected)
  })
})

describe('formatCnpj', () => {
  it('formata numérico e alfanumérico; o resto fica como está', () => {
    expect(formatCnpj('44555666000172')).toBe('44.555.666/0001-72')
    expect(formatCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35')
    expect(formatCnpj('123')).toBe('123')
  })
})

describe('isValidCnpj', () => {
  it('confere os dígitos verificadores', () => {
    expect(isValidCnpj('11222333000181')).toBe(true)
    expect(isValidCnpj('11222333000182')).toBe(false)
    expect(isValidCnpj('11111111111111')).toBe(false)
    expect(isValidCnpj('1122233300018')).toBe(false)
  })

  it('aceita o CNPJ alfanumérico (exemplo da Receita: 12.ABC.345/01DE-35)', () => {
    expect(isValidCnpj('12ABC34501DE35')).toBe(true)
    expect(isValidCnpj('12ABC34501DE36')).toBe(false)
  })
})
