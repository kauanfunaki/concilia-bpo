import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { formatDateBR, parseDate, parseMoney, roundCents } from './money'

describe('parseMoney', () => {
  it.each([
    ['25.171,60', 25171.6],
    ['-\u00a017,38', -17.38],
    ['- 25.020,00', -25020],
    ['1.234,56 D', -1234.56],
    ['1.234,56C', 1234.56],
    ['(90,00)', -90],
    ['17,38-', -17.38],
    ['R$ 1.507,68', 1507.68],
    ['R$\u00a0-1.507,68', -1507.68],
    ['1500.50', 1500.5],
    ['1.234', 1234],
    ['1,234,567.89', 1234567.89],
    [-40355.84999999998, -40355.85],
    [0, 0],
  ])('%j → %d', (input, expected) => {
    expect(parseMoney(input)).toBe(expected)
  })

  it.each([null, undefined, '', 'abc', 'SALDO', '12/09/2026', {}])('%j → null', (input) => {
    expect(parseMoney(input)).toBeNull()
  })

  it('PBT: número formatado em pt-BR volta ao mesmo valor', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000_00, max: 10_000_000_00 }), (cents) => {
        const value = cents / 100
        const text = value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        expect(parseMoney(text)).toBe(roundCents(value))
      })
    )
  })
})

describe('parseDate', () => {
  it.each([
    ['15/09/2026', '2026-09-15'],
    ['15/09/26', '2026-09-15'],
    ['5-9-2026', '2026-09-05'],
    ['15/09/2026 10:30:00', '2026-09-15'],
    ['2026-09-15', '2026-09-15'],
    ['15/set/2026', '2026-09-15'],
    ['15 SET 2026', '2026-09-15'],
    [46280, '2026-09-15'],
  ])('%j → %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected)
  })

  it('dia e mês sem ano usam o ano informado', () => {
    expect(parseDate('15/09', 2026)).toBe('2026-09-15')
    expect(parseDate('15/09')).toBeNull()
  })

  it.each(['31/02/2026', '15/13/2026', 'SALDO DIA', '', 12345, null])('%j → null', (input) => {
    expect(parseDate(input)).toBeNull()
  })

  it('formatDateBR', () => {
    expect(formatDateBR('2026-09-15')).toBe('15/09/2026')
  })
})
