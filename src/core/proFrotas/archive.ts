import { unzipSync, zipSync } from 'fflate'

/** Arquivo XML solto ou tirado de um ZIP */
export interface XmlFile {
  name: string
  bytes: Uint8Array
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * XMLs de um arquivo enviado: o próprio .xml ou todos os .xml de um .zip,
 * inclusive de ZIPs dentro do ZIP (o app antigo também descompactava em cascata).
 */
export function extractXmlFiles(bytes: Uint8Array, fileName: string): XmlFile[] {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.xml')) return [{ name: baseName(fileName), bytes }]
  if (/\.(rar|7z|tar|gz)$/.test(lower)) {
    throw new Error('Formato não suportado no navegador. Envie o ZIP que o portal da Receita gera ou os XMLs soltos.')
  }
  if (!lower.endsWith('.zip')) throw new Error('Formato inválido. Envie .zip ou .xml.')

  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, { filter: (f) => /\.(xml|zip)$/i.test(f.name) })
  } catch {
    throw new Error('Não foi possível abrir o ZIP. Verifique se o arquivo está corrompido.')
  }

  const files: XmlFile[] = []
  for (const [path, content] of Object.entries(entries)) {
    if (path.toLowerCase().endsWith('.zip')) files.push(...extractXmlFiles(content, baseName(path)))
    else files.push({ name: baseName(path), bytes: content })
  }
  return files
}

/** ZIP com os XMLs; nome repetido ganha sufixo para nenhum sobrescrever outro */
export function zipXmlFiles(files: XmlFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) {
    let name = file.name
    for (let n = 2; entries[name]; n++) name = file.name.replace(/(\.xml)?$/i, ` (${n})$1`)
    entries[name] = file.bytes
  }
  return zipSync(entries, { level: 6 })
}
