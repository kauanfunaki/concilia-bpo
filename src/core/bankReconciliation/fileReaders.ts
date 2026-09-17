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
  return workbook.SheetNames.map((sheetName) => ({
    sheetName,
    rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    }),
  }))
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}
