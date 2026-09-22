import { useReducer, useState } from 'react'
import Uploader from './components/Uploader'
import BankReconciliation from './components/bank/BankReconciliation'
import ThemeToggle from './components/ThemeToggle'
import SheetConfig from './components/SheetConfig'
import ReportTable from './components/ReportTable'
import Stepper from './components/Stepper'
import { reconcile } from './core/reconciliationEngine'
import { useFileHistory } from './hooks/useFileHistory'
import type {
  AppState,
  UploadedFile,
  ReconciliationConfig,
  ReconciliationReport,
} from './types'

type Action =
  | { type: 'SET_BASE'; base: 'base1' | 'base2'; file: UploadedFile }
  | { type: 'SET_ERROR'; key: string; message: string }
  | { type: 'GO_CONFIG' }
  | { type: 'BACK_TO_CONFIG' }
  | { type: 'SET_REPORT'; report: ReconciliationReport; warnings: string[] }
  | { type: 'RESET' }

const initialState: AppState = {
  step: 'upload',
  base1: null,
  base2: null,
  config: null,
  report: null,
  errors: {},
  warnings: [],
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_BASE':
      return { ...state, [action.base]: action.file }
    case 'SET_ERROR':
      return { ...state, errors: { ...state.errors, [action.key]: action.message } }
    case 'GO_CONFIG':
      return { ...state, step: 'config' }
    case 'BACK_TO_CONFIG':
      return { ...state, step: 'config', config: null, report: null, warnings: [] }
    case 'SET_REPORT':
      return { ...state, step: 'report', report: action.report, warnings: action.warnings }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

type AppMode = 'bases' | 'bank'

const MODE_STORAGE_KEY = 'conciliador-bpo:modo'

function readMode(): AppMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'bank' ? 'bank' : 'bases'
  } catch {
    return 'bases'
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [mode, setMode] = useState<AppMode>(readMode)
  const { entries, addEntry, removeEntry } = useFileHistory()

  const bothBasesParsed = state.base1 !== null && state.base2 !== null

  function handleFileParsed(base: 'base1' | 'base2', file: UploadedFile) {
    dispatch({ type: 'SET_BASE', base, file })
    addEntry(file)
  }

  function handleFileError(base: 'base1' | 'base2', message: string) {
    dispatch({ type: 'SET_ERROR', key: base, message })
  }

  function handleMode(next: AppMode) {
    setMode(next)
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next)
    } catch {
      /* navegador sem armazenamento: o modo vale só para esta aba */
    }
  }

  function handleConfigured(config: ReconciliationConfig) {
    const base1Rows = state.base1!.rawData[config.base1.sheet] ?? []
    const base2Rows = state.base2!.rawData[config.base2.sheet] ?? []
    const { report, warnings } = reconcile(base1Rows, base2Rows, config)
    dispatch({ type: 'SET_REPORT', report, warnings })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700 px-6 py-3 flex items-center gap-3 shadow-sm">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6a2 2 0 012-2h2a2 2 0 012 2v6m-8 0H5a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-2" />
          </svg>
        </div>
        <div>
          <h1 className="text-sm font-bold text-gray-900 dark:text-slate-100 leading-tight">Conciliador BPO</h1>
          <p className="text-xs text-gray-400 dark:text-slate-500">
            {mode === 'bank' ? 'Conciliação bancária: sistema × extrato' : 'Conciliação de Bases Excel'}
          </p>
        </div>
        <nav className="ml-auto flex rounded-lg bg-gray-100 dark:bg-slate-800 p-1" aria-label="Tipo de conciliação">
          {([['bases', 'Bases Excel'], ['bank', 'Bancária']] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => handleMode(value)}
              aria-pressed={mode === value}
              className={[
                'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
                mode === value ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-sm' : 'text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-100',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </nav>
        <ThemeToggle />
      </header>

      {/* Os dois modos ficam montados: trocar de aba não perde os arquivos carregados */}
      <main hidden={mode !== 'bank'} className="max-w-7xl mx-auto px-6 py-10">
        <BankReconciliation />
      </main>

      <main hidden={mode !== 'bases'} className="max-w-5xl mx-auto px-6 py-10">
        {/* Stepper: aparece em todas as etapas exceto upload */}
        {state.step !== 'upload' && <Stepper step={state.step} />}

        {/* Passo 1: Upload */}
        {state.step === 'upload' && (
          <Uploader
            recentFiles={entries}
            onFileParsed={handleFileParsed}
            onError={handleFileError}
            onRemoveHistory={removeEntry}
            onNext={bothBasesParsed ? () => dispatch({ type: 'GO_CONFIG' }) : undefined}
          />
        )}

        {/* Passo 2: Configuração */}
        {state.step === 'config' && state.base1 && state.base2 && (
          <SheetConfig
            base1={state.base1}
            base2={state.base2}
            onConfigured={handleConfigured}
            onBack={() => dispatch({ type: 'RESET' })}
          />
        )}

        {/* Passo 3: Processando */}
        {state.step === 'processing' && (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4" />
              <p className="text-gray-600 dark:text-slate-400 font-medium">Processando conciliação...</p>
            </div>
          </div>
        )}

        {/* Passo 4: Relatório */}
        {state.step === 'report' && state.report && (
          <ReportTable
            report={state.report}
            warnings={state.warnings}
            onNewConfig={() => dispatch({ type: 'BACK_TO_CONFIG' })}
            onReset={() => dispatch({ type: 'RESET' })}
          />
        )}
      </main>
    </div>
  )
}
