import { formatDateBR, formatMoney } from '../bankReconciliation/money'
import { formatCnpj } from './cnpj'
import type {
  CancellationEvent,
  ResultNote,
  SheetLine,
  SheetNote,
  ValidationResult,
  ValidationSettings,
  ValidationStats,
  XmlNote,
} from '../../types/proFrotas'

/**
 * Motor da validação Pro Frotas — as regras do app desktop "Validador Pro Frotas",
 * com duas correções aprovadas pelo Kauan em 29/09/2026:
 * - grupo de notas tem a mesma tolerância da nota avulsa (no antigo exigia a soma igual
 *   ao centavo, e todos os 16 grupos divergentes do relatório de 24/09/2025 erravam por R$ 0,01);
 * - XML repetido entre ZIPs sobrepostos ("01-07 a 15-07" e "01-07 a 16-07") conta uma vez,
 *   pela chave de acesso.
 */

export const DEFAULT_MAX_DAYS = 60
export const DEFAULT_TOLERANCE = 1.01

// Folga de ponto flutuante na comparação com a tolerância
const EPSILON = 1e-6

function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

// A Pro Frotas manda valores com 3 casas: a soma guarda as 3, sem o ruído do ponto flutuante
function roundMills(value: number): number {
  return Math.round(value * 1000) / 1000
}

function daysBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const utc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(to) - utc(from)) / 86400000)
}

/** Nº da nota da planilha: "-", vazio e estorno ficam de fora; "NFe00289" → "289" */
export function noteNumber(text: string): string | null {
  const cleaned = text.replace(/[\s​-‏]+/g, '').replace(/[^\p{L}\p{N}_]/gu, '').toUpperCase()
  if (!cleaned || cleaned.includes('ESTORNO') || cleaned.includes('ESTORNADO')) return null
  const digits = cleaned.replace(/\D/g, '').replace(/^0+/, '')
  return digits || null
}

export interface CompanyOption {
  cnpj: string
  name: string
  lines: number
}

/** Empresas da coluna "CNPJ da Empresa", da mais frequente para a menos */
export function detectCompanies(lines: SheetLine[]): CompanyOption[] {
  const byCnpj = new Map<string, CompanyOption>()
  for (const line of lines) {
    if (!line.companyCnpj) continue
    const option = byCnpj.get(line.companyCnpj) ?? { cnpj: line.companyCnpj, name: line.companyName, lines: 0 }
    option.lines++
    if (!option.name) option.name = line.companyName
    byCnpj.set(line.companyCnpj, option)
  }
  return [...byCnpj.values()].sort((a, b) => b.lines - a.lines)
}

/** Sugestão de data final do período: o último abastecimento da empresa na planilha */
export function suggestPeriodEnd(lines: SheetLine[], companyCnpj: string): string | null {
  let last: string | null = null
  for (const line of lines) {
    if (line.companyCnpj === companyCnpj && line.fuelDate && (!last || line.fuelDate > last)) last = line.fuelDate
  }
  return last
}

// ── Planilha ─────────────────────────────────────────────────────────────────

interface PreparedSheet {
  notes: SheetNote[]
  otherCompany: number
  postponed: number
  withoutNote: number
  incomplete: number
}

/**
 * Da linha da planilha à nota: separa "NFe100, NFe101" em grupo (a 1ª leva o valor, as outras
 * zero), descarta "-" e estorno, e soma as linhas da mesma nota do mesmo posto — uma NF-e
 * costuma cobrir vários abastecimentos.
 */
export function prepareSheetNotes(lines: SheetLine[], companyCnpj: string): PreparedSheet {
  let otherCompany = 0
  let postponed = 0
  let withoutNote = 0
  let incomplete = 0
  let groupSeq = 0
  const byKey = new Map<string, SheetNote>()

  // Grupos que dividem uma nota viram um grupo só. "NFe15285, NFe15284" aparece em 7 linhas
  // da planilha de set/2025; o antigo prendia cada nota a um dos 7 grupos com LIMIT 1, as duas
  // caíam em grupos diferentes, e o par de notas que somava certo saía como divergente
  const parent = new Map<string, string>()
  const root = (id: string): string => {
    let r = id
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(id, r)
    return r
  }
  const join = (a: string, b: string) => parent.set(root(b), root(a))

  for (const line of lines) {
    if (line.companyCnpj !== companyCnpj) {
      if (line.companyCnpj) otherCompany++
      else incomplete++
      continue
    }
    // Postergado = Sim: veio de outro período e não entra no cálculo. O app antigo tinha a coluna na
    // configuração mas nunca a lia — na planilha de set/2025 essas linhas saíam só por virem com valor zero
    if (line.postponed) {
      postponed++
      continue
    }
    // Como no antigo: sem CNPJ do posto ou sem valor (inclusive zero), a linha não entra
    if (!line.stationCnpj || !line.amount) {
      incomplete++
      continue
    }

    const tokens = line.noteText.split(/[,;]/).map((t) => t.trim()).filter(Boolean)
    const numbers = tokens.map(noteNumber).filter((n): n is string => n !== null)
    if (numbers.length === 0) {
      withoutNote++
      continue
    }
    const groupId = numbers.length > 1 ? `g${++groupSeq}` : null
    if (groupId) parent.set(groupId, groupId)

    numbers.forEach((number, i) => {
      const amount = i === 0 ? line.amount! : 0
      const key = `${number}|${line.stationCnpj}`
      const existing = byKey.get(key)
      if (existing) {
        existing.amount = roundMills(existing.amount + amount)
        existing.sources.push(line.source)
        if (existing.groupId && groupId) join(existing.groupId, groupId)
        else existing.groupId ??= groupId
        return
      }
      byKey.set(key, {
        id: key,
        number,
        series: line.series.replace(/\D/g, ''),
        stationCnpj: line.stationCnpj,
        stationName: line.stationName,
        companyCnpj: line.companyCnpj,
        fuelDate: line.fuelDate,
        amount: roundMills(amount),
        groupId,
        sources: [line.source],
      })
    })
  }

  // Grupo que sobrou com uma nota só não é grupo
  const notes = [...byKey.values()]
  for (const n of notes) if (n.groupId) n.groupId = root(n.groupId)
  const members = new Map<string, number>()
  for (const n of notes) if (n.groupId) members.set(n.groupId, (members.get(n.groupId) ?? 0) + 1)
  for (const n of notes) if (n.groupId && members.get(n.groupId) === 1) n.groupId = null

  return { notes, otherCompany, postponed, withoutNote, incomplete }
}

// ── XMLs ─────────────────────────────────────────────────────────────────────

interface PreparedXmls {
  candidates: XmlNote[]
  // Chave → data do cancelamento, juntando todas as cópias da nota e os eventos em arquivo à parte
  cancelled: Map<string, string | null>
  duplicates: number
  inbound: number
  otherRecipient: number
}

/**
 * Uma NF-e por chave de acesso; só nota de saída (venda do posto) destinada à empresa — ou a um
 * CNPJ extra, quando parte das notas saiu para outro CNPJ. O cancelamento vale de qualquer cópia:
 * o ZIP baixado antes do cancelamento traz a nota sem o evento; o baixado depois, com ele.
 */
export function prepareXmls(
  xmls: XmlNote[],
  companyCnpj: string,
  extraRecipients: string[] = [],
  events: CancellationEvent[] = []
): PreparedXmls {
  const accepted = new Set([companyCnpj, ...extraRecipients])
  const cancelled = new Map<string, string | null>()
  for (const e of events) if (e.key) cancelled.set(e.key, e.date)
  for (const x of xmls) if (x.key && x.cancelled && !cancelled.get(x.key)) cancelled.set(x.key, x.cancelledAt)

  const seen = new Set<string>()
  const candidates: XmlNote[] = []
  let duplicates = 0
  let inbound = 0
  let otherRecipient = 0
  for (const xml of xmls) {
    const id = xml.key || `${xml.issuerCnpj}|${xml.series}|${xml.number}`
    if (seen.has(id)) {
      duplicates++
      continue
    }
    seen.add(id)
    if (xml.type !== 1) inbound++
    else if (!accepted.has(xml.recipientCnpj)) otherRecipient++
    else candidates.push(xml)
  }
  return { candidates, cancelled, duplicates, inbound, otherRecipient }
}

// ── Confronto ────────────────────────────────────────────────────────────────

export function validateProFrotas(
  lines: SheetLine[],
  xmls: XmlNote[],
  settings: ValidationSettings,
  events: CancellationEvent[] = []
): ValidationResult {
  const { companyCnpj, periodEnd, maxDays, tolerance } = settings
  const sheet = prepareSheetNotes(lines, companyCnpj)
  const receita = prepareXmls(xmls, companyCnpj, settings.extraRecipients, events)
  const within = (a: number, b: number) => Math.abs(a - b) <= tolerance + EPSILON
  const isCancelled = (x: XmlNote) => x.cancelled || (x.key !== '' && receita.cancelled.has(x.key))
  const cancelDate = (x: XmlNote) => receita.cancelled.get(x.key) ?? x.cancelledAt

  const index = new Map<string, XmlNote[]>()
  for (const xml of receita.candidates) {
    const key = `${xml.number}|${xml.issuerCnpj}`
    index.set(key, [...(index.get(key) ?? []), xml])
  }
  const used = new Set<XmlNote>()

  // Mesma nota e posto em mais de um XML (séries diferentes): a série da planilha desempata,
  // depois a nota não cancelada, depois o valor
  function pick(note: SheetNote): XmlNote | null {
    let options = (index.get(`${note.number}|${note.stationCnpj}`) ?? []).filter((x) => !used.has(x))
    if (options.length > 1 && note.series) {
      const sameSeries = options.filter((x) => Number(x.series) === Number(note.series))
      if (sameSeries.length) options = sameSeries
    }
    const valid = options.filter((x) => !isCancelled(x))
    if (valid.length) options = valid
    return options.find((x) => within(x.amount, note.amount)) ?? options[0] ?? null
  }

  const results = new Map<string, ResultNote>()
  const put = (note: SheetNote, partial: Omit<ResultNote, 'id' | 'sheet' | 'days' | 'cancelledAt'> & { cancelledAt?: string | null }) => {
    const days = partial.xml ? daysBetween(note.fuelDate, partial.xml.issueDate) : null
    results.set(note.id, { id: note.id, sheet: note, days, cancelledAt: null, ...partial })
  }

  // 1. Grupos: com XML válido para todas as notas, vale a soma
  const groups = new Map<string, SheetNote[]>()
  for (const note of sheet.notes) {
    if (note.groupId) groups.set(note.groupId, [...(groups.get(note.groupId) ?? []), note])
  }
  let groupNumber = 0
  for (const members of groups.values()) {
    const found = members.map(pick)
    if (found.some((x) => x === null || isCancelled(x))) continue
    found.forEach((x) => used.add(x!))
    const sheetSum = members.reduce((s, n) => s + n.amount, 0)
    const xmlSum = found.reduce((s, x) => s + x!.amount, 0)
    const ok = within(xmlSum, sheetSum)
    const number = ok ? null : ++groupNumber
    const note = `Soma do grupo: XML ${formatMoney(xmlSum)} × planilha ${formatMoney(sheetSum)}`
    members.forEach((member, i) => {
      const xml = found[i]!
      put(member, {
        category: ok ? 'identical' : 'divergentGroup',
        xml,
        // Grupo que bate: cada nota vale o que diz o XML (o antigo gravava assim)
        sheetAmount: ok ? xml.amount : member.amount,
        xmlAmount: xml.amount,
        difference: ok ? 0 : roundCents(xml.amount - member.amount),
        groupNumber: number,
        note,
      })
    })
  }

  // 2. Notas avulsas — e as de grupo incompleto ou com nota cancelada, uma a uma
  for (const note of sheet.notes) {
    if (results.has(note.id)) continue
    const xml = pick(note)
    const missing = note.groupId
      ? groups.get(note.groupId)!.filter((m) => m !== note && !index.has(`${m.number}|${m.stationCnpj}`))
      : []
    const groupNote = missing.length ? `Grupo incompleto: sem XML da nota ${missing.map((m) => m.number).join(', ')}` : ''
    if (!xml) {
      const days = daysBetween(note.fuelDate, periodEnd)
      results.set(note.id, {
        id: note.id,
        category: 'notFound',
        sheet: note,
        xml: null,
        sheetAmount: note.amount,
        xmlAmount: null,
        difference: null,
        days: days === null ? null : Math.max(0, days),
        groupNumber: null,
        cancelledAt: null,
        note: groupNote,
      })
      continue
    }
    used.add(xml)
    const difference = roundCents(xml.amount - note.amount)
    if (isCancelled(xml)) {
      const at = cancelDate(xml)
      put(note, {
        category: 'cancelled',
        xml,
        sheetAmount: note.amount,
        xmlAmount: xml.amount,
        difference,
        groupNumber: null,
        cancelledAt: at,
        note: [`NF-e cancelada${at ? ` em ${formatDateBR(at)}` : ''}`, groupNote].filter(Boolean).join(' · '),
      })
      continue
    }
    const ok = within(xml.amount, note.amount)
    put(note, {
      category: ok ? 'identical' : 'divergent',
      xml,
      sheetAmount: note.amount,
      xmlAmount: xml.amount,
      difference,
      groupNumber: null,
      note: groupNote || (ok && difference !== 0 ? `Diferença de ${formatMoney(difference)} dentro da tolerância` : ''),
    })
  }

  for (const result of results.values()) {
    // 3. Emitida mais de `maxDays` dias depois do abastecimento: desconsiderada
    if (result.xml && result.category !== 'cancelled' && result.days !== null && result.days > maxDays) {
      result.category = 'disregarded'
      result.note = `Emitida ${result.days} dias depois do abastecimento`
    }
    // Nota que saiu para outro CNPJ: a planilha e o relatório precisam dizer isso
    if (result.xml && result.xml.recipientCnpj !== companyCnpj) {
      result.note = [result.note, `Emitida para outro CNPJ: ${formatCnpj(result.xml.recipientCnpj)}`].filter(Boolean).join(' · ')
    }
  }

  // 4. XML sem par na planilha: segue para o próximo período até passar do prazo — menos a nota
  // cancelada, que não vale nunca, e a do outro CNPJ, que só entrou para achar as notas desta planilha
  const pending: XmlNote[] = []
  const expired: XmlNote[] = []
  let xmlCancelled = 0
  let xmlOtherCnpjUnused = 0
  for (const xml of receita.candidates) {
    if (used.has(xml)) continue
    if (isCancelled(xml)) {
      xmlCancelled++
      continue
    }
    if (xml.recipientCnpj !== companyCnpj) {
      xmlOtherCnpjUnused++
      continue
    }
    const age = daysBetween(xml.issueDate, periodEnd)
    if (age !== null && age > maxDays) expired.push(xml)
    else pending.push(xml)
  }

  const stats: ValidationStats = {
    sheetLines: lines.length,
    sheetOtherCompany: sheet.otherCompany,
    sheetPostponed: sheet.postponed,
    sheetWithoutNote: sheet.withoutNote,
    sheetIncomplete: sheet.incomplete,
    sheetNotes: sheet.notes.length,
    xmlNotes: xmls.length,
    xmlDuplicates: receita.duplicates,
    xmlInbound: receita.inbound,
    xmlOtherRecipient: receita.otherRecipient,
    xmlCancelled,
    xmlOtherCnpjUnused,
  }

  const companyName =
    lines.find((l) => l.companyCnpj === companyCnpj && l.companyName)?.companyName ??
    receita.candidates.find((x) => x.recipientCnpj === companyCnpj)?.recipientName ??
    ''

  return { settings, companyName, notes: [...results.values()], pending, expired, stats }
}
