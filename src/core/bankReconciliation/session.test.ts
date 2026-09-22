import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildAccountResults, summarizeAccount, updateRow } from './session'
import { buildBankWorkbook, exportFileName } from './bankExporter'
import { defaultProfile, presetAccountsMissing, suggestAccount } from './accountProfiles'
import type { Statement, SystemReport } from '../../types/bankReconciliation'

const PERIOD = { start: '2026-09-15', end: '2026-09-15' }

// PNG transparente de 1x1: o teste precisa de uma imagem válida, não da logo real. Ler a logo
// do disco exigiria os tipos do Node, que o build do app não tem (o tsc do build checa os testes)
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0))

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

  it('logo do banco: do perfil da Inovati ou pelo nome da conta', () => {
    expect(defaultProfile({ key: 'CAIXA ECONOMICA', name: 'CAIXA ECONOMICA' }, true)).toMatchObject({ logo: 'inovati', bankLogo: 'caixa' })
    expect(defaultProfile({ key: 'BTG INOVATI LOGISTICA', name: 'BTG INOVATI LOGISTICA' }, true)).toMatchObject({ logo: 'inovati', bankLogo: 'btg' })
    expect(defaultProfile({ key: 'QI TECH', name: 'QI TECH' }, true)).toMatchObject({ bankLogo: 'qitech' })
    // Outro cliente: sem a logo da Inovati, mas com a do banco
    expect(defaultProfile({ key: 'BTG PACTUAL FILIAL SP', name: 'BTG PACTUAL FILIAL SP' }, false)).toMatchObject({ logo: null, bankLogo: 'btg' })
    expect(defaultProfile({ key: 'CAIXA ECONOMICA FEDERAL', name: 'CAIXA ECONOMICA FEDERAL' }, false)).toMatchObject({ bankLogo: 'caixa' })
    // "CAIXA" sozinho pode ser o caixa da empresa, não o banco
    expect(defaultProfile({ key: 'CAIXA', name: 'CAIXA' }, false)).toMatchObject({ bankLogo: null })
    expect(defaultProfile({ key: 'BANCO ALFA', name: 'BANCO ALFA' }, false)).toMatchObject({ bankLogo: null })
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

  it('registro redundante fica fora da conciliação, mas dentro do saldo do banco', () => {
    const withSweep: Statement = {
      ...STATEMENT,
      movements: [
        ...STATEMENT.movements.slice(0, 3),
        { id: 'r1', order: 3.1, date: '2026-09-15', description: 'Aplicação Conta Remunerada', counterparty: '', document: '', amount: -90, balance: -210, ignored: true },
        { id: 'r2', order: 3.2, date: '2026-09-15', description: 'Resgate Conta Remunerada', counterparty: '', document: '', amount: 90, balance: -120, ignored: true },
      ],
    }
    const [swept] = buildAccountResults(SYSTEM, [], [{ statement: withSweep, accountKey: 'BANCO ALFA' }], PERIOD, {})
    expect(swept.rows.map((r) => r.description)).not.toContain('Aplicação Conta Remunerada')
    expect(swept.rows).toHaveLength(4)
    expect(swept).toMatchObject({ ignoredCount: 2, ignoredTotal: 0, statementTotal: -130 })
    expect(summarizeAccount(swept).closes).toBe(true)
  })

  it('redundantes que não se anulam no período também explicam a diferença', () => {
    const onlyApplication: Statement = {
      ...STATEMENT,
      movements: [
        ...STATEMENT.movements.slice(0, 3),
        { id: 'r1', order: 3.1, date: '2026-09-15', description: 'Aplicação Conta Remunerada', counterparty: '', document: '', amount: -90, balance: -210, ignored: true },
      ],
    }
    const [swept] = buildAccountResults(SYSTEM, [], [{ statement: onlyApplication, accountKey: 'BANCO ALFA' }], PERIOD, {})
    expect(swept.balances.bankClosing).toBe(-210)
    expect(summarizeAccount(swept)).toMatchObject({ difference: -70, explained: 20, ignoredTotal: -90, closes: true })
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
    // A conferência é interna: a planilha que vai para o cliente não traz o bloco
    expect(['I12', 'I13', 'I14', 'I15', 'J13', 'J14', 'J15'].map((a) => ws.getCell(a).value)).toEqual([null, null, null, null, null, null, null])
    expect(ws.getCell('E5').dataValidation).toMatchObject({ type: 'list', formulae: ['Config!$B$5:$B$9'] })
  })

  it('embute a logo do perfil no canto esquerdo do cabeçalho, uma vez por arquivo', async () => {
    const logo = PNG
    const withLogo = { ...result, profile: { ...result.profile, logo: 'inovati' as const } }
    const other = { ...result, accountKey: 'OUTRA', profile: { ...result.profile, sheetName: 'SEM LOGO', logo: null } }
    const workbook = await buildBankWorkbook([withLogo, other], { inovati: logo })
    const reread = new ExcelJS.Workbook()
    await reread.xlsx.load(await workbook.xlsx.writeBuffer())

    expect(reread.model.media).toHaveLength(1)
    const images = reread.getWorksheet('ALFA')!.getImages()
    expect(images).toHaveLength(1)
    expect(images[0].range.tl).toMatchObject({ nativeCol: 1, nativeRow: 1 })
    expect(reread.getWorksheet('SEM LOGO')!.getImages()).toHaveLength(0)
  })

  it('logo do banco no canto direito, junto da logo da empresa', async () => {
    const png = PNG
    const btg = { ...result, profile: { ...result.profile, logo: 'inovati' as const, bankLogo: 'btg' as const } }
    const caixa = { ...result, accountKey: 'CX', profile: { ...result.profile, sheetName: 'CAIXA', logo: 'inovati' as const, bankLogo: 'caixa' as const } }
    const workbook = await buildBankWorkbook([btg, caixa], {
      inovati: png,
      btg: PNG,
      caixa: PNG,
    })
    const reread = new ExcelJS.Workbook()
    await reread.xlsx.load(await workbook.xlsx.writeBuffer())

    expect(reread.model.media).toHaveLength(3)
    const anchors = (sheet: string) =>
      reread.getWorksheet(sheet)!.getImages().map((i) => [i.range.tl.nativeCol, i.range.tl.nativeRow]).sort()
    expect(anchors('ALFA')).toEqual([[1, 1], [5, 1]])
    expect(anchors('CAIXA')).toEqual([[1, 1], [5, 0]])
  })

  it('sem o arquivo da logo, a planilha sai sem ela', async () => {
    const withLogo = { ...result, profile: { ...result.profile, logo: 'inovati' as const } }
    const workbook = await buildBankWorkbook([withLogo])
    expect(workbook.getWorksheet('ALFA')!.getImages()).toHaveLength(0)
  })

  it('nome de arquivo por banco e geral', () => {
    expect(exportFileName(PERIOD)).toBe('Conciliação_15.09.xlsx')
    expect(exportFileName(PERIOD, 'BTG - MATRIZ')).toBe('Conciliação_BTG - MATRIZ_15.09.xlsx')
    expect(exportFileName({ start: '2026-09-14', end: '2026-09-15' })).toBe('Conciliação_14.09_a_15.09.xlsx')
  })
})
