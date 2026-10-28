import { parseMoney } from '../bankReconciliation/money'
import { classifyMovement, splitCounterparty } from './classify'
import type { ItauMovement, ItauStatement } from '../../types/sispag'

/**
 * Leitura do extrato em OFX (SGML, versão 1.x), como o Itaú exporta: um <STMTTRN> por lançamento,
 * com valor já assinado em <TRNAMT>. No OFX de 2026 o histórico do SISPAG traz o favorecido e o
 * CPF/CNPJ ("PAGAMENTOS A FORNECEDORES <nome> <doc>"), o que ajuda a escolher o par certo entre
 * pagamentos de mesmo valor.
 */

/** O cabeçalho diz o charset; o Itaú grava em 1252 */
export function decodeOfx(bytes: Uint8Array): string {
  const head = new TextDecoder('ascii').decode(bytes.slice(0, 1024))
  const utf8 = /ENCODING:\s*UTF-?8|CHARSET:\s*UTF-?8|encoding="utf-8"/i.test(head)
  return new TextDecoder(utf8 ? 'utf-8' : 'windows-1252').decode(bytes)
}

function tag(block: string, name: string): string {
  return new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block)?.[1]?.trim() ?? ''
}

function ofxDate(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** "1234567890" do Itaú é agência (4) + conta (5) + dígito */
function accountLabel(bankId: string, branch: string, account: string): string {
  if (branch) return `${branch} / ${account}`
  if (/^0*341$/.test(bankId) && /^\d{10}$/.test(account)) return `${account.slice(0, 4)} / ${account.slice(4, 9)}-${account.slice(9)}`
  return account
}

export function parseOfx(text: string, fileName: string): ItauStatement {
  if (!/<OFX>/i.test(text)) throw new Error('O arquivo não parece um OFX: falta a marca <OFX>.')

  const warnings: string[] = []
  let skipped = 0
  const movements: ItauMovement[] = []
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0])
  blocks.forEach((block, i) => {
    const date = ofxDate(tag(block, 'DTPOSTED'))
    const amount = parseMoney(tag(block, 'TRNAMT'))
    if (!date || amount === null || amount === 0) {
      skipped++
      return
    }
    const description = (tag(block, 'MEMO') || tag(block, 'NAME')).replace(/\s+/g, ' ')
    const { kind, family } = classifyMovement(description, amount)
    const { counterparty, document } = splitCounterparty(description)
    movements.push({
      id: `O${i + 1}`,
      order: movements.length,
      date,
      description,
      counterparty,
      document,
      amount,
      balance: null,
      kind,
      family,
    })
  })

  if (movements.length === 0) warnings.push('Nenhum lançamento no OFX.')
  if (skipped) warnings.push(`${skipped} lançamento(s) sem data ou valor ficaram de fora.`)

  const start = ofxDate(tag(text, 'DTSTART'))
  const end = ofxDate(tag(text, 'DTEND'))
  const dates = movements.map((m) => m.date).sort()
  const period = start && end ? { start, end } : dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null
  const ledger = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|$)/i.exec(text)?.[1] ?? ''

  return {
    fileName,
    source: 'ofx',
    account: accountLabel(tag(text, 'BANKID'), tag(text, 'BRANCHID'), tag(text, 'ACCTID')),
    company: '',
    period,
    openingBalance: null,
    closingBalance: ledger ? parseMoney(tag(ledger, 'BALAMT')) : null,
    movements,
    warnings,
  }
}
