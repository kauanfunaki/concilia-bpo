import { describe, it, expect } from 'vitest'
import { isRedundantText } from './redundantRecords'

describe('isRedundantText', () => {
  it.each([
    'Aplicação Conta Remunerada',
    'APLICACAO CONTA REMUNERADA',
    'Resgate Conta Remunerada',
    'Débito na Conta Corrente',
    'DEBITO NA CONTA CORRENTE',
    'Crédito na Conta Corrente',
    'Aplicação Conta Remunerada - 000123',
    '  crédito   na conta corrente  ',
  ])('redundante: %j', (text) => {
    expect(isRedundantText(text)).toBe(true)
  })

  it.each([
    'PIX RECEBIDO DE CLIENTE',
    'Débito automático conta de luz',
    'TED para conta corrente de terceiro',
    'Resgate de CDB',
    '',
  ])('não é redundante: %j', (text) => {
    expect(isRedundantText(text)).toBe(false)
  })
})
