import { normalizeCnpj } from './cnpj'
import type { XmlItem, XmlNote } from '../../types/proFrotas'

/**
 * Leitura do XML de NF-e como vem do portal DF-e da Receita do PR: a NF-e dentro de
 * NFeLog/procNFe, mas também nfeProc ou NFe solta. Tags achadas pelo nome local,
 * com ou sem namespace.
 */

export type XmlReadResult =
  | { kind: 'nfe'; note: XmlNote }
  // XML legível que não é NF-e (evento, CT-e...): fica de fora sem ser erro
  | { kind: 'other' }
  | { kind: 'error'; message: string }

/** Bytes → texto, respeitando o encoding declarado (o padrão da NF-e é UTF-8) */
export function decodeXml(bytes: Uint8Array): string {
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 200))
  const declared = head.match(/encoding\s*=\s*["']([\w.-]+)["']/i)?.[1] ?? ''
  const encoding = /8859-1|1252|latin/i.test(declared) ? 'windows-1252' : 'utf-8'
  return new TextDecoder(encoding).decode(bytes)
}

function first(parent: Element | Document | null | undefined, localName: string): Element | null {
  return parent ? parent.getElementsByTagNameNS('*', localName)[0] ?? null : null
}

function text(parent: Element | null | undefined, localName: string): string {
  return first(parent, localName)?.textContent?.trim() ?? ''
}

function number(value: string): number | null {
  if (!value) return null
  const n = Number(value.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function isoDay(value: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function accessKey(infNFe: Element, doc: Document, fileName: string): string {
  const fromId = (infNFe.getAttribute('Id') ?? '').replace(/\D/g, '')
  if (fromId.length === 44) return fromId
  const fromProtocol = text(first(doc, 'infProt'), 'chNFe').replace(/\D/g, '')
  if (fromProtocol.length === 44) return fromProtocol
  // O portal nomeia o arquivo com a chave
  return fileName.match(/\d{44}/)?.[0] ?? ''
}

export function parseNfeXml(content: string, fileName: string): XmlReadResult {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(content, 'application/xml')
  } catch {
    return { kind: 'error', message: 'XML ilegível' }
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return { kind: 'error', message: 'XML ilegível' }

  const infNFe = first(doc, 'infNFe')
  if (!infNFe) return { kind: 'other' }

  const ide = first(infNFe, 'ide')
  const emit = first(infNFe, 'emit')
  const dest = first(infNFe, 'dest')
  const amount = number(text(first(first(infNFe, 'total'), 'ICMSTot'), 'vNF'))
  const numberText = text(ide, 'nNF').replace(/\D/g, '').replace(/^0+/, '')
  if (!numberText) return { kind: 'error', message: 'NF-e sem número (nNF)' }
  if (amount === null) return { kind: 'error', message: 'NF-e sem valor total (vNF)' }

  const items: XmlItem[] = Array.from(infNFe.getElementsByTagNameNS('*', 'det')).map((det) => {
    const prod = first(det, 'prod')
    return {
      description: text(prod, 'xProd'),
      quantity: number(text(prod, 'qCom')),
      unit: text(prod, 'uCom'),
      unitPrice: number(text(prod, 'vUnCom')),
      total: number(text(prod, 'vProd')),
    }
  })

  return {
    kind: 'nfe',
    note: {
      key: accessKey(infNFe, doc, fileName),
      number: numberText,
      series: text(ide, 'serie'),
      type: Number(text(ide, 'tpNF') || 0),
      issueDate: isoDay(text(ide, 'dhEmi') || text(ide, 'dEmi')),
      issuerCnpj: normalizeCnpj(text(emit, 'CNPJ') || text(emit, 'CPF')),
      issuerName: text(emit, 'xNome'),
      recipientCnpj: normalizeCnpj(text(dest, 'CNPJ') || text(dest, 'CPF')),
      recipientName: text(dest, 'xNome'),
      amount,
      fileName,
      items,
    },
  }
}
