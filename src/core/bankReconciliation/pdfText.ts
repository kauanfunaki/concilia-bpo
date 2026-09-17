import type { PdfTextItem } from './statementPdf'

// Um worker só para todos os PDFs da sessão
let workerPort: Worker | null = null

/**
 * Extrai os pedaços de texto (com posição) de todas as páginas do PDF, no navegador.
 * O pdf.js só é carregado quando alguém sobe um PDF.
 */
export async function extractPdfItems(data: ArrayBuffer): Promise<PdfTextItem[]> {
  const pdfjs = await import('pdfjs-dist')
  if (!workerPort) {
    // Importado como worker do Vite, o arquivo sai .js: o .mjs original depende de o servidor
    // (nginx do Docker) conhecer o tipo "mjs", e sem isso o PDF só falharia em produção
    const { default: PdfWorker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')
    workerPort = new PdfWorker()
    pdfjs.GlobalWorkerOptions.workerPort = workerPort
  }

  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise
  } catch (err) {
    if (err instanceof Error && err.name === 'PasswordException') {
      throw new Error('O PDF está protegido por senha. Gere o extrato sem senha ou use a versão em Excel.')
    }
    throw new Error('Não foi possível ler o PDF. Verifique se o arquivo está corrompido.')
  }

  const items: PdfTextItem[] = []
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        items.push({
          page: pageNumber,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height || Math.abs(item.transform[3]),
          text: item.str,
        })
      }
    }
  } finally {
    await doc.destroy()
  }

  if (items.length === 0) {
    throw new Error('O PDF não tem texto selecionável (parece digitalizado). Use o extrato em Excel.')
  }
  return items
}
