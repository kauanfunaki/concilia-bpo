import type { StatementMovement, SystemEntry } from '../../types/bankReconciliation'

/**
 * Tira a categoria do histórico do Atua:
 * "COMBUSTIVEL - DIESEL : : REF. PGTO TITULO NR. 59482 - AUTO POSTO" → "REF. PGTO TITULO NR. 59482 - AUTO POSTO"
 * ": TRANSF CRD - BTG" → "TRANSF CRD - BTG"
 */
export function stripCategory(history: string): string {
  let text = history
  const separator = text.lastIndexOf(': :')
  if (separator >= 0) text = text.slice(separator + 3)
  return text.replace(/^\s*:\s*/, '').replace(/\s+/g, ' ').trim()
}

/**
 * Texto da coluna "Documento" para um lançamento do sistema.
 * - com nr_documento: o número sem a parcela ("STUDIO-36 PARCELAS/28" → "STUDIO-36 PARCELAS")
 * - recebimento de fatura: o número da fatura ("FATURA NR. 8439/1" → "8439")
 * - sem documento: o histórico sem a categoria ("TRANSF CRD - BTG")
 */
export function entryDocument(entry: SystemEntry): string {
  const document = entry.document.trim()
  if (document) return document.replace(/\/\d*$/, '').trim()

  const history = stripCategory(entry.history)
  const invoice = history.match(/FATURA\s+N[RO]?\.?\s*([^\s/]+)/i)
  if (invoice) return invoice[1]
  return history.replace(/^REF\.?\s+/i, '').trim()
}

/** Coluna "Lançamento" de um lançamento do sistema que não apareceu no extrato */
export function entryDescription(entry: SystemEntry): string {
  return stripCategory(entry.history) || entry.complement
}

/** Texto usado na comparação de nomes do lado do sistema */
export function entryNameText(entry: SystemEntry): string {
  let text = stripCategory(entry.history)
  if (entry.document) text = text.split(entry.document).join(' ')
  return `${text} ${entry.complement}`
}

/** Texto usado na comparação de nomes do lado do extrato */
export function movementNameText(movement: StatementMovement): string {
  return `${movement.description} ${movement.counterparty}`
}

/** Coluna "Lançamento" de um movimento do extrato: o nome, quando o banco separa; senão o histórico */
export function movementDescription(movement: StatementMovement): string {
  return movement.counterparty || movement.description
}
