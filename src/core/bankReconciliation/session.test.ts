import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildAccountResults, summarizeAccount, updateRow } from './session'
import { buildBankWorkbook, exportFileName } from './bankExporter'
import { defaultProfile, presetAccountsMissing, suggestAccount } from './accountProfiles'
import type { Statement, SystemReport } from '../../types/bankReconciliation'

const PERIOD = { start: '2026-09-15', end: '2026-09-15' }

const SYSTEM: SystemReport = {
  fileName: 'sistema.xlsx',
  period: PERIOD,
  accounts: [
    {
      key: 'BANCO ALFA',
      code: '1',
      name: 'BANCO ALFA',
      openingBalance: -1000,
      closingBalance: -1150,
      entries: [
        { id: 'a1', date: '2026-09-15', document: 'NF-1/1', history: 'REF. PGTO TITULO NR. NF-1/1 - FORNECEDOR UM', complement: '', amount: -200 },
        { id: 'a2', date: '2026-09-15', document: '', history: ': TRANSF CRD - ALFA', complement: '', amount: 100 },
        { id: 'a3', date: '2026-09-15', document: 'NF-9', history: 'REF. PGTO TITULO NR. NF-9 - FORNECEDOR NOVE', complement: '', amount: -50 },
      ],
    },
    { key: 'CAIXA ECONOMICA', code: '2', name: 'CAIXA ECONOMICA', openingBalance: 0, closingBalance: 0, entries: [] },
  ],
}

const STATEMENT: Statement = {
  fileName: 'Extrato Alfa.xlsx',
  source: 'excel',
  warnings: [],
  balances: [{ order: 0, date: '2026-09-14', label: 'SALDO DIA', balance: 10 }],
  movements: [
    { id: 'm1', order: 1, date: '2026-09-15', description: 'PIX ENVIADO PARA FORNECEDOR UM', counterparty: '', document: '', amount: -200, balance: -190 },
    { id: 'm2', order: 2, date: '2026-09-15', description: 'PIX RECEBIDO DE ALFA', counterparty: '', document: '', amount: 100, balance: -90 },
    { id: 'm3', order: 3, date: '2026-09-15', description: 'PIX ENVIADO PARA DESCONHECIDO', counterparty: '', document: '', amount: -30, balance: -120 },
    { id: 'm4', order: 4, date: '2026-09-16', description: 'FORA DO PERIODO', counterparty: '', document: '', amount: -999, balance: -1119 },
  ],
}

describe('suggestAccount', () => {
  it('escolhe a conta cujos lançamentos batem com os valores do extrato', () => {
    const suggestion = suggestAccount(STATEMENT, SYSTEM.accounts, PERIOD)
    expect(suggestion.key).toBe('BANCO ALFA')
    expect(suggestion.reason).toMatch(/2 valor/)
  })

  it('sem valor em comum, o nome do arquivo decide', () => {
    const statement = { ...STATEMENT, fileName: 'Extrato Caixa.xlsx', movements: [] }
    expect(suggestAccount(statement, SYSTEM.accounts, PERIOD).key).toBe('CAIXA ECONOMICA')
  })

  it('empate não sugere nada', () => {
    const statement = { ...STATEMENT, fileName: 'extrato.xlsx', movements: [] }
    expect(suggestAccount(statement, SYSTEM.accounts, PERIOD).key).toBeNull()
  })
})

describe('perfis', () => {
  it('perfil da Inovati só vale para relatório da Inovati', () => {
    expect(defaultProfile({ key: 'CAIXA ECONOMICA', name: 'CAIXA ECONOMICA' }, true)).toMatchObject({ sheetName: 'CAIXA', company: 'INOVATI TRANSPORTES' })
    expect(defaultProfile({ key: 'CAIXA ECONOMICA', name: 'CAIXA ECONOMICA' }, false)).toMatchObject({ sheetName: 'CAIXA ECONOMICA', company: '' })
    expect(defaultProfile({ key: 'BTG INOVATI LOGISTICA', name: 'BTG INOVATI LOGISTICA' }, true)).toMatchObject({ sheetName: 'INOVATI LOG', company: 'INOVATI LOGÍSTICA' })
  })

  it('oferece as contas do perfil que não vieram no relatório', () => {
    const accounts = [{ ...SYSTEM.accounts[0], key: 'BTG INOVATI LOGISTICA' }]
    expect(presetAccountsMissing(accounts).map((a) => a.key)).toEqual(['BTG MATRIZ', 'BTG MT', 'QI TECH', 'CAIXA'])
    expect(presetAccountsMissing(SYSTEM.accounts)).toEqual([])
  })
})

describe('buildAccountResults + summarizeAccount', () => {
  const [result] = buildAccountResults(SYSTEM, [], [{ statement: STATEMENT, accountKey: 'BANCO ALFA' }], PERIOD, {})

  it('só concilia contas com extrato e respeita o período', () => {
    expect(result.accountKey).toBe('BANCO ALFA')
    expect(result.rows.map((r) => [r.situation, r.document])).toEqual([
      ['Lançamento conciliado', 'NF-1'],
      ['Lançamento conciliado', 'TRANSF CRD - ALFA'],
      ['Aguardando composição', ''],
      ['Lançamento não encontrado', 'NF-9'],
    ])
    expect(result.balances).toEqual({ systemOpening: -1000, systemClosing: -1150, bankOpening: 10, bankClosing: -120 })
    expect(result.statementTotal).toBe(-130)
  })

  it('a diferença de saldo fecha com as pendências', () => {
    const summary = summarizeAccount(result)
    expect(summary).toMatchObject({ difference: 20, explained: 20, closes: true, statementCloses: true, attention: 2 })
  })

  it('situação trocada à mão entra na conferência', () => {
    const edited = updateRow(result, result.rows[2].id, { situation: 'Lançamento conciliado', document: 'MANUAL' })
    expect(edited.rows[2]).toMatchObject({ situation: 'Lançamento conciliado', document: 'MANUAL', edited: true })
    expect(summarizeAccount(edited).closes).toBe(false)
  })

  it('preferência salva sobrepõe o perfil padrão', () => {
    const [custom] = buildAccountResults(SYSTEM, [], [{ statement: STATEMENT, accountKey: 'BANCO ALFA' }], PERIOD, {
      'BANCO ALFA': { sheetName: 'ALFA', company: 'EMPRESA X' },
    })
    expect(custom.profile).toMatchObject({ sheetName: 'ALFA', company: 'EMPRESA X', bankLabel: 'Banco Alfa' })
  })
})

describe('buildBankWorkbook', () => {
  const [result] = buildAccountResults(SYSTEM, [], [{ statement: STATEMENT, accountKey: 'BANCO ALFA' }], PERIOD, {
    'BANCO ALFA': { sheetName: 'ALFA', company: 'EMPRESA X', bankLabel: 'Alfa - Matriz', balanceLabel: 'Alfa' },
  })

  it('gera a aba no layout do modelo e a Config oculta, e sobrevive à releitura', async () => {
    const workbook = await buildBankWorkbook([result])
    const reread = new ExcelJS.Workbook()
    await reread.xlsx.load(await workbook.xlsx.writeBuffer())

    expect(reread.worksheets.map((w) => [w.name, w.state])).toEqual([
      ['Config', 'hidden'],
      ['ALFA', 'visible'],
    ])
    const config = reread.getWorksheet('Config')!
    expect([5, 6, 7, 8, 9].map((r) => config.getCell(`B${r}`).value)).toContain('Valores iguais')

    const ws = reread.getWorksheet('ALFA')!
    expect(ws.getCell('C2').value).toBe('EMPRESA X\nRelatório de Conciliação')
    expect(ws.getCell('F3').value).toBe('Alfa - Matriz')
    expect(['B4', 'C4', 'D4', 'E4', 'F4'].map((a) => ws.getCell(a).value)).toEqual(['Data', 'Lançamento', 'Valor', 'Situação', 'Documento'])

    expect(ws.getCell('C5').value).toBe('PIX ENVIADO PARA FORNECEDOR UM')
    expect(ws.getCell('D5').value).toBe(-200)
    expect(ws.getCell('E5').value).toBe('Lançamento conciliado')
    expect(ws.getCell('F5').value).toBe('NF-1')
    expect((ws.getCell('B5').value as Date).toISOString().slice(0, 10)).toBe('2026-09-15')
    expect(ws.getCell('E8').value).toBe('Lançamento não encontrado')

    expect(ws.getCell('I2').value).toBe('SALDO')
    expect([ws.getCell('I4').value, ws.getCell('J5').value, ws.getCell('J6').value]).toEqual(['Atua', -1000, -1150])
    expect([ws.getCell('I8').value, ws.getCell('J9').value, ws.getCell('J10').value]).toEqual(['Alfa', 10, -120])
    expect(ws.getCell('J15').value).toMatchObject({ formula: 'J14-J13', result: 20 })
    expect(ws.getCell('E5').dataValidation).toMatchObject({ type: 'list', formulae: ['Config!$B$5:$B$9'] })
  })

  it('nome de arquivo por banco e geral', () => {
    expect(exportFileName(PERIOD)).toBe('Conciliação_15.09.xlsx')
    expect(exportFileName(PERIOD, 'BTG - MATRIZ')).toBe('Conciliação_BTG - MATRIZ_15.09.xlsx')
    expect(exportFileName({ start: '2026-09-14', end: '2026-09-15' })).toBe('Conciliação_14.09_a_15.09.xlsx')
  })
})
