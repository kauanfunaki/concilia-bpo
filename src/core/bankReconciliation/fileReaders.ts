import * as XLSX from 'xlsx'
import type { SheetRows } from './statementSheet'

export function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo. Verifique se ele está corrompido.'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Intervalo das células que existem de fato. Há exportador que grava um tamanho de aba menor que o
 * dos dados (o extrato do Itaú diz A1:F13 com 4.769 linhas), e o SheetJS só lê o tamanho gravado.
 * Parte do tamanho gravado e só aumenta: arquivo normal sai igual.
 */
export function usedRange(sheet: XLSX.WorkSheet): XLSX.Range | null {
  const ref = sheet['!ref']
  let range = ref ? XLSX.utils.decode_range(ref) : null
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue
    const { r, c } = XLSX.utils.decode_cell(key)
    if (!range) {
      range = { s: { r, c }, e: { r, c } }
      continue
    }
    range.s.r = Math.min(range.s.r, r)
    range.s.c = Math.min(range.s.c, c)
    range.e.r = Math.max(range.e.r, r)
    range.e.c = Math.max(range.e.c, c)
  }
  return range
}

/**
 * Linhas cruas de todas as abas de uma planilha (.xls/.xlsx).
 * Datas ficam como vieram (texto ou serial do Excel): a conversão é do motor, sem fuso no caminho.
 */
export function workbookRows(data: ArrayBuffer | Uint8Array): SheetRows[] {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(data, { type: 'array', cellDates: false })
  } catch {
    throw new Error('Não foi possível ler a planilha. Verifique se o arquivo está corrompido.')
  }
  if (!workbook.SheetNames?.length) {
    throw new Error('Não foi possível ler a planilha. Verifique se o arquivo está corrompido.')
  }
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    // Aba que o SheetJS não conseguiu abrir vem undefined e continua saindo sem linhas
    const range = sheet ? usedRange(sheet) : null
    if (range) sheet['!ref'] = XLSX.utils.encode_range(range)
    return {
      sheetName,
      rows: XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: false,
      }),
    }
  })
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}
