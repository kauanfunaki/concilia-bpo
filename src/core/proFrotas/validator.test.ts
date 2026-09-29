import { describe, it, expect } from 'vitest'
import { detectCompanies, noteNumber, prepareSheetNotes, prepareXmls, suggestPeriodEnd, validateProFrotas } from './validator'
import type { SheetLine, ValidationSettings, XmlNote } from '../../types/proFrotas'

const EMPRESA = '11222333000181'
const POSTO_A = '44555666000172'
const POSTO_B = '77888999000163'

let row = 1
function line(noteText: string, amount: number | null, overrides: Partial<SheetLine> = {}): SheetLine {
  row++
  return {
    source: { file: 'cobranca.xlsx', row },
    noteText,
    series: '1',
    stationCnpj: POSTO_A,
    stationName: 'Posto Alfa Ltda',
    companyCnpj: EMPRESA,
    companyName: 'Transportadora Exemplo Ltda',
    fuelDate: '2026-09-10',
    amount,
    postponed: false,
    ...overrides,
  }
}

let seq = 0
function xml(number: string, amount: number, overrides: Partial<XmlNote> = {}): XmlNote {
  seq++
  return {
    key: String(seq).padStart(44, '4'),
    number,
    series: '1',
    type: 1,
    issueDate: '2026-09-12',
    issuerCnpj: POSTO_A,
    issuerName: 'POSTO ALFA LTDA',
    recipientCnpj: EMPRESA,
    recipientName: 'TRANSPORTADORA EXEMPLO LTDA',
    amount,
    fileName: `${seq}.xml`,
    items: [],
    ...overrides,
  }
}

const SETTINGS: ValidationSettings = { companyCnpj: EMPRESA, periodEnd: '2026-09-15', maxDays: 60, tolerance: 1.01 }

function run(lines: SheetLine[], xmls: XmlNote[], settings: Partial<ValidationSettings> = {}) {
  return validateProFrotas(lines, xmls, { ...SETTINGS, ...settings })
}

function byNumber(result: ReturnType<typeof run>, number: string) {
  return result.notes.find((n) => n.sheet.number === number)!
}

describe('noteNumber', () => {
  it.each([
    ['NFe289', '289'],
    ['Nfe00123', '123'],
    [' NF-e 4521 ', '4521'],
    ['7788', '7788'],
  ])('%j → %j', (text, expected) => {
    expect(noteNumber(text)).toBe(expected)
  })

  it.each(['-', '', 'ESTORNADO', 'Estorno NFe12', 'NFe'])('%j fica de fora', (text) => {
    expect(noteNumber(text)).toBeNull()
  })
})

describe('prepareSheetNotes', () => {
  it('soma as linhas da mesma nota do mesmo posto e guarda as linhas de origem', () => {
    const a = line('NFe100', 150)
    const b = line('NFe100', 99.5)
    const c = line('NFe100', 10, { stationCnpj: POSTO_B })
    const { notes } = prepareSheetNotes([a, b, c], EMPRESA)
    expect(notes).toHaveLength(2)
    expect(notes[0]).toMatchObject({ number: '100', stationCnpj: POSTO_A, amount: 249.5, groupId: null })
    expect(notes[0].sources).toEqual([a.source, b.source])
  })

  it('linha com várias notas vira grupo: a 1ª leva o valor, as outras zero', () => {
    const { notes } = prepareSheetNotes([line('NFe200, NFe201', 300)], EMPRESA)
    expect(notes.map((n) => [n.number, n.amount])).toEqual([['200', 300], ['201', 0]])
    expect(notes[0].groupId).toBeTruthy()
    expect(notes[1].groupId).toBe(notes[0].groupId)
  })

  it('token inválido não rouba o valor da linha', () => {
    const { notes } = prepareSheetNotes([line('-, NFe300', 80)], EMPRESA)
    expect(notes).toEqual([expect.objectContaining({ number: '300', amount: 80, groupId: null })])
  })

  it('grupos que dividem uma nota viram um grupo só', () => {
    const { notes } = prepareSheetNotes([line('NFe1, NFe2', 10), line('NFe2, NFe3', 20)], EMPRESA)
    expect(new Set(notes.map((n) => n.groupId)).size).toBe(1)
    expect(notes.map((n) => [n.number, n.amount])).toEqual([['1', 10], ['2', 20], ['3', 0]])
  })

  it('nota avulsa repetida em várias linhas de grupo continua no grupo', () => {
    // O caso real: "NFe15285, NFe15284" em várias linhas, entre linhas só com a 15284
    const lines = [line('NFe84', 100), line('NFe85, NFe84', 20), line('NFe84', 50), line('NFe85, NFe84', 30)]
    const { notes } = prepareSheetNotes(lines, EMPRESA)
    expect(notes.map((n) => [n.number, n.amount])).toEqual([['84', 150], ['85', 50]])
    expect(notes[0].groupId).toBeTruthy()
    expect(notes[1].groupId).toBe(notes[0].groupId)
  })

  it('ponto e vírgula também separa as notas da linha', () => {
    const { notes } = prepareSheetNotes([line('NFe210; NFe211', 90)], EMPRESA)
    expect(notes.map((n) => [n.number, n.amount])).toEqual([['210', 90], ['211', 0]])
  })

  it('Postergado = Sim fica de fora, mesmo com nota e valor', () => {
    const result = prepareSheetNotes([line('NFe220', 50, { postponed: true }), line('NFe220', 30), line('NFe221', 10, { postponed: true })], EMPRESA)
    expect(result.postponed).toBe(2)
    expect(result.notes).toEqual([expect.objectContaining({ number: '220', amount: 30 })])
  })

  it('conta o que ficou de fora: outra empresa, sem nota e sem valor', () => {
    const result = prepareSheetNotes(
      [line('NFe1', 10), line('NFe2', 10, { companyCnpj: '99999999000199' }), line('-', 10), line('ESTORNADO', 5), line('NFe3', 0), line('NFe4', null)],
      EMPRESA
    )
    expect(result).toMatchObject({ otherCompany: 1, withoutNote: 2, incomplete: 2 })
    expect(result.notes).toHaveLength(1)
  })
})

describe('prepareXmls', () => {
  it('conta a mesma chave uma vez só e separa entrada e outro destinatário', () => {
    const a = xml('1', 10)
    const result = prepareXmls([a, { ...a, fileName: 'copia.xml' }, xml('2', 10, { type: 0 }), xml('3', 10, { recipientCnpj: '99999999000199' })], EMPRESA)
    expect(result).toMatchObject({ duplicates: 1, inbound: 1, otherRecipient: 1 })
    expect(result.candidates).toEqual([a])
  })
})

describe('validateProFrotas', () => {
  it('nota com XML de mesmo valor é idêntica', () => {
    const result = run([line('NFe10', 250)], [xml('10', 250)])
    expect(byNumber(result, '10')).toMatchObject({ category: 'identical', sheetAmount: 250, xmlAmount: 250, difference: 0, days: 2 })
  })

  it('diferença até R$ 1,01 é tolerada; acima disso é divergente', () => {
    const result = run([line('NFe11', 100), line('NFe12', 100)], [xml('11', 101.01), xml('12', 101.02)])
    expect(byNumber(result, '11')).toMatchObject({ category: 'identical', difference: 1.01 })
    expect(byNumber(result, '11').note).toContain('dentro da tolerância')
    expect(byNumber(result, '12')).toMatchObject({ category: 'divergent', sheetAmount: 100, xmlAmount: 101.02, difference: 1.02 })
  })

  it('o casamento é pelo número da nota e CNPJ do posto', () => {
    const result = run([line('NFe13', 50)], [xml('13', 50, { issuerCnpj: POSTO_B })])
    expect(byNumber(result, '13').category).toBe('notFound')
    expect(result.pending).toHaveLength(1)
  })

  it('grupo compara a soma, com a mesma tolerância da nota avulsa', () => {
    // No app antigo a soma tinha de bater ao centavo: R$ 0,01 de diferença virava grupo divergente
    const result = run([line('NFe20, NFe21', 374.87)], [xml('20', 37.19), xml('21', 337.69)])
    expect(byNumber(result, '20')).toMatchObject({ category: 'identical', sheetAmount: 37.19, xmlAmount: 37.19 })
    expect(byNumber(result, '21')).toMatchObject({ category: 'identical', sheetAmount: 337.69 })
  })

  it('grupo com a soma fora da tolerância sai numerado, nota a nota', () => {
    const result = run(
      [line('NFe30, NFe31', 500), line('NFe40, NFe41', 90)],
      [xml('30', 200), xml('31', 250), xml('40', 60), xml('41', 20)]
    )
    expect(byNumber(result, '30')).toMatchObject({ category: 'divergentGroup', groupNumber: 1, sheetAmount: 500, xmlAmount: 200, difference: -300 })
    expect(byNumber(result, '31')).toMatchObject({ category: 'divergentGroup', groupNumber: 1, sheetAmount: 0, xmlAmount: 250 })
    expect(byNumber(result, '40')).toMatchObject({ category: 'divergentGroup', groupNumber: 2 })
    expect(byNumber(result, '30').note).toContain('Soma do grupo')
  })

  it('grupo incompleto: cada nota segue sozinha, com aviso', () => {
    const result = run([line('NFe50, NFe51', 300)], [xml('50', 300)])
    expect(byNumber(result, '50')).toMatchObject({ category: 'identical', note: 'Grupo incompleto: sem XML da nota 51' })
    expect(byNumber(result, '51')).toMatchObject({ category: 'notFound', sheetAmount: 0 })
  })

  it('não encontrada conta os dias do abastecimento até o fim do período', () => {
    const result = run([line('NFe60', 10, { fuelDate: '2026-09-01' })], [])
    expect(byNumber(result, '60')).toMatchObject({ category: 'notFound', xml: null, days: 14 })
  })

  it('emitida mais de 60 dias depois do abastecimento é desconsiderada', () => {
    const result = run(
      [line('NFe70', 10, { fuelDate: '2026-06-01' }), line('NFe71', 10, { fuelDate: '2026-07-14' })],
      [xml('70', 10, { issueDate: '2026-08-01' }), xml('71', 10, { issueDate: '2026-09-12' })]
    )
    expect(byNumber(result, '70')).toMatchObject({ category: 'disregarded', days: 61 })
    expect(byNumber(result, '71')).toMatchObject({ category: 'identical', days: 60 })
  })

  it('XML sem par fica pendente até passar do prazo, contado do fim do período', () => {
    const recent = xml('80', 10, { issueDate: '2026-09-14' })
    const limit = xml('81', 10, { issueDate: '2026-07-17' })
    const old = xml('82', 10, { issueDate: '2026-07-16' })
    const result = run([], [recent, limit, old])
    expect(result.pending).toEqual([recent, limit])
    expect(result.expired).toEqual([old])
  })

  it('mesma nota e posto em duas séries: a série da planilha desempata', () => {
    const serie2 = xml('90', 500, { series: '2' })
    const serie1 = xml('90', 10, { series: '1' })
    const result = run([line('NFe90', 10, { series: '2' })], [serie1, serie2])
    expect(byNumber(result, '90')).toMatchObject({ category: 'divergent', xml: serie2 })
    expect(result.pending).toEqual([serie1])
  })

  it('XML repetido entre ZIPs não sobra como pendente', () => {
    const a = xml('95', 10)
    const result = run([line('NFe95', 10)], [a, { ...a, fileName: 'outro-zip.xml' }])
    expect(byNumber(result, '95').category).toBe('identical')
    expect(result.pending).toEqual([])
    expect(result.stats.xmlDuplicates).toBe(1)
  })
})

describe('empresa e período', () => {
  it('sugere a empresa mais frequente e o último abastecimento dela', () => {
    const lines = [line('NFe1', 1, { fuelDate: '2026-09-03' }), line('NFe2', 1, { fuelDate: '2026-09-14' }), line('NFe3', 1, { companyCnpj: '99999999000199', companyName: 'Outra', fuelDate: '2026-09-30' })]
    expect(detectCompanies(lines)).toEqual([
      { cnpj: EMPRESA, name: 'Transportadora Exemplo Ltda', lines: 2 },
      { cnpj: '99999999000199', name: 'Outra', lines: 1 },
    ])
    expect(suggestPeriodEnd(lines, EMPRESA)).toBe('2026-09-14')
  })
})
