import { useEffect, useState } from 'react'
import SispagFilesStep from './SispagFilesStep'
import SispagResultStep from './SispagResultStep'
import { fileExtension, readAsArrayBuffer } from '../../core/bankReconciliation/fileReaders'
import { readProFrotasWorkbook } from '../../core/proFrotas/sheet'
import { parseItauPdf } from '../../core/sispag/itauPdf'
import { parseLancamentosSheet } from '../../core/sispag/itauLancamentos'
import { decodeOfx, parseOfx } from '../../core/sispag/ofx'
import { parseSispagReport } from '../../core/sispag/sispagReport'
import { reconcileSispag } from '../../core/sispag/matcher'
import type { ItauStatement, SispagReport, SispagResult } from '../../types/sispag'

const MAX_SIZE_BYTES = 30 * 1024 * 1024

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0))

export default function SispagReconciliation() {
  const [statement, setStatement] = useState<ItauStatement | null>(null)
  const [report, setReport] = useState<SispagReport | null>(null)
  const [result, setResult] = useState<SispagResult | null>(null)
  const [step, setStep] = useState<'files' | 'result'>('files')
  const [loading, setLoading] = useState<string | null>(null)
  const [statementError, setStatementError] = useState<string | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [reconcileError, setReconcileError] = useState<string | null>(null)

  // O botão Conferir fica no fim da página: sem isso o resultado abria no meio da tabela
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  async function handleStatementFile(file: File) {
    setStatementError(null)
    const ext = fileExtension(file.name)
    if (!['.pdf', '.ofx', '.xls', '.xlsx'].includes(ext)) {
      setStatementError('Formato inválido. Envie o extrato do Itaú em .pdf, .ofx ou Excel (.xls / .xlsx).')
      return
    }
    if (file.size > MAX_SIZE_BYTES) {
      setStatementError('Arquivo muito grande. O limite é 30 MB.')
      return
    }
    setLoading(`Lendo ${file.name}…`)
    await yieldToBrowser()
    try {
      const buffer = await readAsArrayBuffer(file)
      let next: ItauStatement
      if (ext === '.pdf') {
        const { extractPdfItems } = await import('../../core/bankReconciliation/pdfText')
        next = parseItauPdf(await extractPdfItems(buffer), file.name)
      } else if (ext === '.ofx') {
        next = parseOfx(decodeOfx(new Uint8Array(buffer)), file.name)
      } else {
        next = parseLancamentosSheet(readProFrotasWorkbook(buffer), file.name)
      }
      if (!next.movements.some((m) => m.kind !== 'other')) {
        throw new Error('O extrato não tem nenhuma linha do SISPAG ("Sispag …", "Pagamentos a fornecedores", "Dev TED").')
      }
      setStatement(next)
      setResult(null)
    } catch (err) {
      setStatementError(err instanceof Error ? err.message : 'Não foi possível ler o extrato.')
    } finally {
      setLoading(null)
    }
  }

  async function handleReportFile(file: File) {
    setReportError(null)
    if (!['.xls', '.xlsx'].includes(fileExtension(file.name))) {
      setReportError('Formato inválido. Envie o relatório SISPAG em .xls ou .xlsx.')
      return
    }
    if (file.size > MAX_SIZE_BYTES) {
      setReportError('Arquivo muito grande. O limite é 30 MB.')
      return
    }
    setLoading(`Lendo ${file.name}…`)
    await yieldToBrowser()
    try {
      setReport(parseSispagReport(readProFrotasWorkbook(await readAsArrayBuffer(file)), file.name))
      setResult(null)
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Não foi possível ler o relatório SISPAG.')
    } finally {
      setLoading(null)
    }
  }

  async function handleReconcile() {
    if (!statement || !report) return
    setReconcileError(null)
    setLoading('Conferindo…')
    await yieldToBrowser()
    try {
      setResult(reconcileSispag(statement, report))
      setStep('result')
    } catch (err) {
      setReconcileError(err instanceof Error ? err.message : 'Não foi possível fazer a conferência.')
    } finally {
      setLoading(null)
    }
  }

  function handleReset() {
    setStatement(null)
    setReport(null)
    setResult(null)
    setStatementError(null)
    setReportError(null)
    setReconcileError(null)
    setStep('files')
  }

  if (step === 'result' && result) {
    return <SispagResultStep result={result} onBack={() => setStep('files')} onReset={handleReset} />
  }

  return (
    <SispagFilesStep
      statement={statement}
      report={report}
      loading={loading}
      statementError={statementError}
      reportError={reportError}
      reconcileError={reconcileError}
      onStatementFile={handleStatementFile}
      onReportFile={handleReportFile}
      onRemoveStatement={() => {
        setStatement(null)
        setResult(null)
      }}
      onRemoveReport={() => {
        setReport(null)
        setResult(null)
      }}
      onReconcile={handleReconcile}
      onShowResult={result ? () => setStep('result') : undefined}
    />
  )
}
