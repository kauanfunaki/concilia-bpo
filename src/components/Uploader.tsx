import { useRef, useState } from 'react'
import { parseFile } from '../core/parser'
import type { UploadedFile } from '../types'
import type { HistoryEntry } from '../hooks/useFileHistory'

const MAX_SIZE_MB = 20
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024
const VALID_EXTENSIONS = ['.xls', '.xlsx']

interface UploaderProps {
  recentFiles: HistoryEntry[]
  onFileParsed: (base: 'base1' | 'base2', file: UploadedFile) => void
  onError: (base: 'base1' | 'base2', message: string) => void
  onRemoveHistory: (id: string) => void
  onNext?: () => void
}

interface FileState {
  name: string | null
  error: string | null
  loading: boolean
}

const empty: FileState = { name: null, error: null, loading: false }

export default function Uploader({ recentFiles, onFileParsed, onError, onRemoveHistory, onNext }: UploaderProps) {
  const [b1, setB1] = useState<FileState>(empty)
  const [b2, setB2] = useState<FileState>(empty)
  const ref1 = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>
  const ref2 = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>

  const bothOk = b1.name !== null && b2.name !== null && !b1.error && !b2.error && !b1.loading && !b2.loading

  async function handleFile(base: 'base1' | 'base2', file: File) {
    const setState = base === 'base1' ? setB1 : setB2
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!VALID_EXTENSIONS.includes(ext)) {
      const msg = 'Formato inválido. Envie um arquivo .xls ou .xlsx.'
      setState({ name: null, error: msg, loading: false })
      onError(base, msg)
      return
    }
    if (file.size > MAX_SIZE_BYTES) {
      const msg = 'Arquivo muito grande. O limite é 20 MB.'
      setState({ name: null, error: msg, loading: false })
      onError(base, msg)
      return
    }
    setState({ name: null, error: null, loading: true })
    try {
      const parsed = await parseFile(file)
      setState({ name: file.name, error: null, loading: false })
      onFileParsed(base, parsed)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível ler o arquivo.'
      setState({ name: null, error: msg, loading: false })
      onError(base, msg)
    }
  }

  function handleSelectRecent(base: 'base1' | 'base2', entry: HistoryEntry) {
    const setState = base === 'base1' ? setB1 : setB2
    setState({ name: entry.name, error: null, loading: false })
    onFileParsed(base, { name: entry.name, sheets: entry.sheets, rawData: entry.rawData })
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Hero */}
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Conciliação de Bases</h2>
        <p className="mt-1 text-gray-500 dark:text-slate-400 text-sm">
          Faça o upload das duas planilhas Excel ou selecione um arquivo recente.
        </p>
      </div>

      {/* Cards de upload */}
      <div className="grid grid-cols-2 gap-5 mb-6">
        <FileCard
          label="Base 1"
          sublabel="Referência"
          color="blue"
          state={b1}
          inputRef={ref1}
          onPickFile={() => ref1.current?.click()}
          onFileChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile('base1', f) }}
          onDrop={(f) => handleFile('base1', f)}
          onReplace={() => ref1.current?.click()}
        />
        <FileCard
          label="Base 2"
          sublabel="A validar"
          color="violet"
          state={b2}
          inputRef={ref2}
          onPickFile={() => ref2.current?.click()}
          onFileChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile('base2', f) }}
          onDrop={(f) => handleFile('base2', f)}
          onReplace={() => ref2.current?.click()}
        />
      </div>

      {/* Histórico */}
      {recentFiles.length > 0 && (
        <div className="mb-8 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">Arquivos recentes</p>
          <div className="space-y-2">
            {recentFiles.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 group">
                {/* Ícone */}
                <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                {/* Nome + data */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-slate-200 truncate">{entry.name}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">
                    {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(entry.savedAt))}
                    {' · '}{entry.sheets.length} aba{entry.sheets.length !== 1 ? 's' : ''}
                  </p>
                </div>
                {/* Ações */}
                <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleSelectRecent('base1', entry)}
                    className="px-2.5 py-1 text-xs font-medium bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 rounded-md hover:bg-blue-100 dark:hover:bg-blue-500/25 transition-colors"
                  >
                    Base 1
                  </button>
                  <button
                    onClick={() => handleSelectRecent('base2', entry)}
                    className="px-2.5 py-1 text-xs font-medium bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 rounded-md hover:bg-violet-100 dark:hover:bg-violet-500/25 transition-colors"
                  >
                    Base 2
                  </button>
                  <button
                    onClick={() => onRemoveHistory(entry.id)}
                    title="Remover do histórico"
                    className="px-2 py-1 text-xs text-gray-400 dark:text-slate-500 hover:text-red-500 transition-colors rounded-md hover:bg-red-50 dark:hover:bg-red-500/15"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Botão Próximo */}
      <div className="flex justify-end">
        <button
          disabled={!bothOk || !onNext}
          onClick={onNext}
          className="px-7 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm
            disabled:opacity-40 disabled:cursor-not-allowed
            hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          Próximo →
        </button>
      </div>
    </div>
  )
}

// ── FileCard ─────────────────────────────────────────────────────────────────

interface FileCardProps {
  label: string
  sublabel: string
  color: 'blue' | 'violet'
  state: FileState
  inputRef: React.RefObject<HTMLInputElement>
  onPickFile: () => void
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDrop: (file: File) => void
  onReplace: () => void
}

function FileCard({ label, sublabel, color, state, inputRef, onPickFile, onFileChange, onDrop, onReplace }: FileCardProps) {
  const [dragOver, setDragOver] = useState(false)

  const accent = color === 'blue'
    ? { ring: 'ring-blue-400 bg-blue-50 dark:bg-blue-500/10', badge: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400', btn: 'bg-blue-600 hover:bg-blue-700' }
    : { ring: 'ring-violet-400 bg-violet-50 dark:bg-violet-500/10', badge: 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300', btn: 'bg-violet-600 hover:bg-violet-700' }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }
  function handleDragLeave() { setDragOver(false) }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onDrop(file)
  }

  const baseCard = 'rounded-xl border-2 transition-all duration-150 bg-white dark:bg-slate-900 shadow-sm'
  const borderClass = dragOver
    ? `border-dashed ${color === 'blue' ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10' : 'border-violet-400 bg-violet-50 dark:bg-violet-500/10'}`
    : state.error
    ? 'border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10'
    : state.name
    ? `border-${color === 'blue' ? 'blue' : 'violet'}-200`
    : 'border-gray-200 dark:border-slate-700 border-dashed hover:border-gray-300 dark:hover:border-slate-500'

  return (
    <div
      className={`${baseCard} ${borderClass} p-5`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${accent.badge}`}>{label}</span>
        <span className="text-xs text-gray-400 dark:text-slate-500">{sublabel}</span>
      </div>

      {/* Conteúdo central */}
      <div className="flex flex-col items-center text-center min-h-[100px] justify-center">
        {state.loading ? (
          <>
            <div className="animate-spin rounded-full h-8 w-8 border-3 border-blue-500 border-t-transparent mb-2" />
            <p className="text-xs text-gray-500 dark:text-slate-400">Lendo arquivo...</p>
          </>
        ) : state.name ? (
          <>
            <div className={`w-10 h-10 rounded-full ${color === 'blue' ? 'bg-blue-100 dark:bg-blue-500/20' : 'bg-violet-100 dark:bg-violet-500/20'} flex items-center justify-center mb-2`}>
              <svg className={`w-5 h-5 ${color === 'blue' ? 'text-blue-600 dark:text-blue-400' : 'text-violet-600 dark:text-violet-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-800 dark:text-slate-200 max-w-full truncate px-2">{state.name}</p>
            <button onClick={onReplace} className="mt-2 text-xs text-gray-400 dark:text-slate-500 underline hover:text-gray-600 dark:hover:text-slate-300">
              Trocar arquivo
            </button>
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">Arraste um arquivo aqui ou</p>
            <button
              onClick={onPickFile}
              className={`px-4 py-1.5 text-xs font-semibold text-white rounded-lg ${accent.btn} transition-colors`}
            >
              Selecionar arquivo
            </button>
            <p className="mt-2 text-xs text-gray-400 dark:text-slate-500">.xls / .xlsx · até 20 MB</p>
          </>
        )}
      </div>

      {state.error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-2 py-1.5" role="alert">
          {state.error}
        </p>
      )}

      <input ref={inputRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={onFileChange} />
    </div>
  )
}
