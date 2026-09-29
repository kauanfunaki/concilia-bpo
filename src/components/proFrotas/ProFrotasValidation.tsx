import { useEffect, useMemo, useState } from 'react'
import ProFrotasFilesStep from './ProFrotasFilesStep'
import ProFrotasResultStep from './ProFrotasResultStep'
import { fileExtension, readAsArrayBuffer } from '../../core/bankReconciliation/fileReaders'
import { extractXmlFiles } from '../../core/proFrotas/archive'
import { parseProFrotasSheets, readProFrotasWorkbook } from '../../core/proFrotas/sheet'
import { DEFAULT_MAX_DAYS, DEFAULT_TOLERANCE, detectCompanies, suggestPeriodEnd, validateProFrotas } from '../../core/proFrotas/validator'
import { decodeXml, parseNfeXml } from '../../core/proFrotas/xml'
import type { SheetLine, ValidationResult, XmlNote } from '../../types/proFrotas'

const MAX_SHEET_BYTES = 30 * 1024 * 1024
const MAX_ZIP_BYTES = 400 * 1024 * 1024
// XMLs lidos por vez antes de devolver a vez à tela (5.000 notas por quinzena não travam o navegador)
const PARSE_CHUNK = 250

export interface LoadedSheet {
  id: string
  fileName: string
  size: number
  lines: SheetLine[]
}

export interface XmlEntry {
  note: XmlNote
  bytes: Uint8Array
}

export interface LoadedXmlSource {
  id: string
  fileName: string
  size: number
  // Pendentes: o ZIP que esta aba gerou no período anterior
  origin: 'receita' | 'pendentes'
  entries: XmlEntry[]
  others: number
  errors: { file: string; message: string }[]
}

export interface Progress {
  label: string
  done: number
  total: number
}

export interface SettingsDraft {
  companyCnpj: string
  periodEnd: string
  periodEndTouched: boolean
  maxDays: number
  tolerance: number
}

const initialSettings: SettingsDraft = {
  companyCnpj: '',
  periodEnd: '',
  periodEndTouched: false,
  maxDays: DEFAULT_MAX_DAYS,
  tolerance: DEFAULT_TOLERANCE,
}

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0))

export default function ProFrotasValidation() {
  const [sheets, setSheets] = useState<LoadedSheet[]>([])
  const [sources, setSources] = useState<LoadedXmlSource[]>([])
  const [settings, setSettings] = useState<SettingsDraft>(initialSettings)
  const [result, setResult] = useState<ValidationResult | null>(null)
  const [step, setStep] = useState<'files' | 'result'>('files')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [sheetErrors, setSheetErrors] = useState<string[]>([])
  const [xmlErrors, setXmlErrors] = useState<string[]>([])

  const lines = useMemo(() => sheets.flatMap((s) => s.lines), [sheets])
  const companies = useMemo(() => detectCompanies(lines), [lines])

  // O botão Validar fica no fim da página: sem isso o resultado abria no meio da tabela
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  // Empresa e data final sugeridas pela planilha, até a pessoa mudar
  function withSuggestions(next: LoadedSheet[], draft: SettingsDraft): SettingsDraft {
    const allLines = next.flatMap((s) => s.lines)
    const options = detectCompanies(allLines)
    const companyCnpj = options.some((c) => c.cnpj === draft.companyCnpj) ? draft.companyCnpj : options[0]?.cnpj ?? ''
    const periodEnd = draft.periodEndTouched && draft.periodEnd ? draft.periodEnd : suggestPeriodEnd(allLines, companyCnpj) ?? ''
    return { ...draft, companyCnpj, periodEnd }
  }

  function updateSheets(next: LoadedSheet[]) {
    setSheets(next)
    setSettings((draft) => withSuggestions(next, draft))
    setResult(null)
  }

  async function handleSheetFiles(files: File[]) {
    setSheetErrors([])
    let next = sheets
    for (const file of files) {
      if (!['.xlsx', '.xls'].includes(fileExtension(file.name))) {
        setSheetErrors((prev) => [...prev, `${file.name}: envie a planilha da Pro Frotas em .xlsx ou .xls.`])
        continue
      }
      if (file.size > MAX_SHEET_BYTES) {
        setSheetErrors((prev) => [...prev, `${file.name}: arquivo muito grande. O limite é 30 MB.`])
        continue
      }
      if (next.some((s) => s.fileName === file.name && s.size === file.size)) {
        setSheetErrors((prev) => [...prev, `${file.name}: esta planilha já foi enviada.`])
        continue
      }
      setProgress({ label: `Lendo ${file.name}…`, done: 0, total: 0 })
      await yieldToBrowser()
      try {
        const lines = parseProFrotasSheets(readProFrotasWorkbook(await readAsArrayBuffer(file)), file.name)
        next = [...next, { id: crypto.randomUUID(), fileName: file.name, size: file.size, lines }]
      } catch (err) {
        setSheetErrors((prev) => [...prev, `${file.name}: ${err instanceof Error ? err.message : 'não foi possível ler a planilha.'}`])
      }
    }
    setProgress(null)
    updateSheets(next)
  }

  async function handleXmlFiles(files: File[], origin: LoadedXmlSource['origin']) {
    setXmlErrors([])
    const added: LoadedXmlSource[] = []
    for (const file of files) {
      const ext = fileExtension(file.name)
      if (file.size > MAX_ZIP_BYTES) {
        setXmlErrors((prev) => [...prev, `${file.name}: arquivo muito grande. O limite é 400 MB.`])
        continue
      }
      if ([...sources, ...added].some((s) => s.fileName === file.name && s.size === file.size)) {
        setXmlErrors((prev) => [...prev, `${file.name}: este arquivo já foi enviado.`])
        continue
      }
      try {
        setProgress({ label: `Abrindo ${file.name}…`, done: 0, total: 0 })
        await yieldToBrowser()
        const xmlFiles = extractXmlFiles(new Uint8Array(await readAsArrayBuffer(file)), file.name)
        if (xmlFiles.length === 0) throw new Error(ext === '.zip' ? 'o ZIP não tem nenhum XML.' : 'arquivo vazio.')

        const source: LoadedXmlSource = { id: crypto.randomUUID(), fileName: file.name, size: file.size, origin, entries: [], others: 0, errors: [] }
        for (let i = 0; i < xmlFiles.length; i += PARSE_CHUNK) {
          setProgress({ label: `Lendo XMLs de ${file.name}`, done: i, total: xmlFiles.length })
          await yieldToBrowser()
          for (const xmlFile of xmlFiles.slice(i, i + PARSE_CHUNK)) {
            const read = parseNfeXml(decodeXml(xmlFile.bytes), xmlFile.name)
            if (read.kind === 'nfe') source.entries.push({ note: read.note, bytes: xmlFile.bytes })
            else if (read.kind === 'other') source.others++
            else source.errors.push({ file: xmlFile.name, message: read.message })
          }
        }
        added.push(source)
      } catch (err) {
        setXmlErrors((prev) => [...prev, `${file.name}: ${err instanceof Error ? err.message : 'não foi possível ler o arquivo.'}`])
      }
    }
    setProgress(null)
    if (added.length) {
      setSources((prev) => [...prev, ...added])
      setResult(null)
    }
  }

  function handleValidate() {
    const xmls = sources.flatMap((s) => s.entries.map((e) => e.note))
    setResult(
      validateProFrotas(lines, xmls, {
        companyCnpj: settings.companyCnpj,
        periodEnd: settings.periodEnd,
        maxDays: settings.maxDays,
        tolerance: settings.tolerance,
      })
    )
    setStep('result')
  }

  function handleReset() {
    setSheets([])
    setSources([])
    setSettings(initialSettings)
    setResult(null)
    setSheetErrors([])
    setXmlErrors([])
    setStep('files')
  }

  if (step === 'result' && result) {
    return (
      <ProFrotasResultStep
        result={result}
        sources={sources}
        onBack={() => setStep('files')}
        onReset={handleReset}
      />
    )
  }

  return (
    <ProFrotasFilesStep
      sheets={sheets}
      sources={sources}
      companies={companies}
      settings={settings}
      progress={progress}
      sheetErrors={sheetErrors}
      xmlErrors={xmlErrors}
      onSheetFiles={handleSheetFiles}
      onXmlFiles={handleXmlFiles}
      onRemoveSheet={(id) => updateSheets(sheets.filter((s) => s.id !== id))}
      onRemoveSource={(id) => {
        setSources((prev) => prev.filter((s) => s.id !== id))
        setResult(null)
      }}
      onSettings={(patch) => {
        setSettings((draft) => {
          const next = { ...draft, ...patch }
          // Trocar de empresa refaz a sugestão de data, se a pessoa não escolheu uma
          if (patch.companyCnpj && !next.periodEndTouched) next.periodEnd = suggestPeriodEnd(lines, patch.companyCnpj) ?? next.periodEnd
          return next
        })
        setResult(null)
      }}
      onValidate={handleValidate}
      onShowResult={result ? () => setStep('result') : undefined}
    />
  )
}
