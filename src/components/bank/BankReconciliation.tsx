import { useReducer, useState } from 'react'
import BankFilesStep from './BankFilesStep'
import BankResultStep from './BankResultStep'
import { useSavedProfiles } from '../../hooks/useSavedProfiles'
import { parseAtuaReport } from '../../core/bankReconciliation/atuaReport'
import { fileExtension, readAsArrayBuffer, workbookRows } from '../../core/bankReconciliation/fileReaders'
import { groupTextLines, parseStatementPdfLines } from '../../core/bankReconciliation/statementPdf'
import { parseStatementWorkbook } from '../../core/bankReconciliation/statementSheet'
import type { SheetLayout, SheetRows } from '../../core/bankReconciliation/statementSheet'
import { presetAccountsMissing, suggestAccount } from '../../core/bankReconciliation/accountProfiles'
import { buildAccountResults } from '../../core/bankReconciliation/session'
import type {
  AccountResult,
  Period,
  Statement,
  SystemAccount,
  SystemReport,
} from '../../types/bankReconciliation'

const MAX_SIZE_BYTES = 20 * 1024 * 1024

export interface StatementFile {
  id: string
  statement: Statement
  // Só planilha: linhas cruas e layout em uso, para remapear colunas sem reenviar o arquivo
  sheets: SheetRows[] | null
  layout: SheetLayout | null
  accountKey: string | null
  accountReason: string
  accountChosenByUser: boolean
  // Só PDF: a pessoa confirmou que conferiu as linhas lidas
  reviewed: boolean
}

interface State {
  step: 'files' | 'result'
  system: SystemReport | null
  period: Period | null
  statements: StatementFile[]
  customAccounts: SystemAccount[]
  results: AccountResult[] | null
}

type Action =
  | { type: 'SET_SYSTEM'; system: SystemReport }
  | { type: 'ADD_STATEMENT'; file: StatementFile }
  | { type: 'UPDATE_STATEMENT'; id: string; patch: Partial<StatementFile> }
  | { type: 'REMOVE_STATEMENT'; id: string }
  | { type: 'SET_PERIOD'; period: Period }
  | { type: 'ADD_CUSTOM_ACCOUNT'; account: SystemAccount; statementId: string }
  | { type: 'SHOW_RESULTS'; results: AccountResult[] }
  | { type: 'UPDATE_RESULT'; result: AccountResult }
  | { type: 'BACK_TO_FILES' }
  | { type: 'RESET' }

const initialState: State = {
  step: 'files',
  system: null,
  period: null,
  statements: [],
  customAccounts: [],
  results: null,
}

function availableAccounts(state: Pick<State, 'system' | 'customAccounts'>): SystemAccount[] {
  if (!state.system) return state.customAccounts
  return [...state.system.accounts, ...presetAccountsMissing(state.system.accounts), ...state.customAccounts]
}

function withSuggestion(file: StatementFile, state: State): StatementFile {
  if (file.accountChosenByUser || !state.system) return file
  const suggestion = suggestAccount(file.statement, availableAccounts(state), state.period)
  return { ...file, accountKey: suggestion.key, accountReason: suggestion.reason }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_SYSTEM': {
      const next = { ...state, system: action.system, period: action.system.period, results: null }
      return { ...next, statements: next.statements.map((s) => withSuggestion(s, next)) }
    }
    // Mudou arquivo, vínculo ou período: o resultado anterior deixa de valer
    case 'ADD_STATEMENT':
      return { ...state, results: null, statements: [...state.statements, withSuggestion(action.file, state)] }
    case 'UPDATE_STATEMENT':
      return {
        ...state,
        results: null,
        statements: state.statements.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)),
      }
    case 'REMOVE_STATEMENT':
      return { ...state, results: null, statements: state.statements.filter((s) => s.id !== action.id) }
    case 'SET_PERIOD': {
      const next = { ...state, period: action.period, results: null }
      return { ...next, statements: next.statements.map((s) => withSuggestion(s, next)) }
    }
    case 'ADD_CUSTOM_ACCOUNT':
      return {
        ...state,
        results: null,
        customAccounts: [...state.customAccounts, action.account],
        statements: state.statements.map((s) =>
          s.id === action.statementId
            ? { ...s, accountKey: action.account.key, accountChosenByUser: true, accountReason: '' }
            : s
        ),
      }
    case 'SHOW_RESULTS':
      return { ...state, step: 'result', results: action.results }
    case 'UPDATE_RESULT':
      return {
        ...state,
        results: (state.results ?? []).map((r) => (r.accountKey === action.result.accountKey ? action.result : r)),
      }
    case 'BACK_TO_FILES':
      return { ...state, step: 'files' }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

export default function BankReconciliation() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const { profiles, saveProfile } = useSavedProfiles()
  const [systemLoading, setSystemLoading] = useState(false)
  const [systemError, setSystemError] = useState<string | null>(null)
  const [statementLoading, setStatementLoading] = useState(0)
  const [statementErrors, setStatementErrors] = useState<string[]>([])

  const fallbackYear = Number((state.period?.start ?? new Date().toISOString()).slice(0, 4))

  async function handleSystemFile(file: File) {
    setSystemError(null)
    if (!['.xls', '.xlsx'].includes(fileExtension(file.name))) {
      setSystemError('Formato inválido. Envie o relatório do sistema em .xls ou .xlsx.')
      return
    }
    if (file.size > MAX_SIZE_BYTES) {
      setSystemError('Arquivo muito grande. O limite é 20 MB.')
      return
    }
    setSystemLoading(true)
    try {
      const sheets = workbookRows(await readAsArrayBuffer(file))
      dispatch({ type: 'SET_SYSTEM', system: parseAtuaReport(sheets[0].rows, file.name) })
    } catch (err) {
      setSystemError(err instanceof Error ? err.message : 'Não foi possível ler o relatório do sistema.')
    } finally {
      setSystemLoading(false)
    }
  }

  async function handleStatementFiles(files: File[]) {
    setStatementErrors([])
    for (const file of files) {
      const ext = fileExtension(file.name)
      if (!['.xls', '.xlsx', '.pdf'].includes(ext)) {
        setStatementErrors((prev) => [...prev, `${file.name}: formato inválido. Envie .xlsx, .xls ou .pdf.`])
        continue
      }
      if (file.size > MAX_SIZE_BYTES) {
        setStatementErrors((prev) => [...prev, `${file.name}: arquivo muito grande. O limite é 20 MB.`])
        continue
      }
      setStatementLoading((n) => n + 1)
      try {
        const buffer = await readAsArrayBuffer(file)
        const base = {
          id: crypto.randomUUID(),
          accountKey: null,
          accountReason: '',
          accountChosenByUser: false,
          reviewed: false,
        }
        if (ext === '.pdf') {
          const { extractPdfItems } = await import('../../core/bankReconciliation/pdfText')
          const lines = groupTextLines(await extractPdfItems(buffer))
          const statement = parseStatementPdfLines(lines, file.name, fallbackYear)
          dispatch({ type: 'ADD_STATEMENT', file: { ...base, statement, sheets: null, layout: null } })
        } else {
          const sheets = workbookRows(buffer)
          const { statement, layout } = parseStatementWorkbook(sheets, file.name, fallbackYear)
          dispatch({ type: 'ADD_STATEMENT', file: { ...base, statement, sheets, layout, reviewed: true } })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Não foi possível ler o arquivo.'
        setStatementErrors((prev) => [...prev, `${file.name}: ${message}`])
      } finally {
        setStatementLoading((n) => n - 1)
      }
    }
  }

  function handleReconcile() {
    if (!state.system || !state.period) return
    const accounts = availableAccounts(state)
    const extraAccounts = accounts.filter((a) => !state.system!.accounts.includes(a))
    const results = buildAccountResults(
      state.system,
      extraAccounts,
      state.statements.map((s) => ({ statement: s.statement, accountKey: s.accountKey })),
      state.period,
      profiles
    )
    dispatch({ type: 'SHOW_RESULTS', results })
  }

  if (state.step === 'result' && state.results && state.period) {
    return (
      <BankResultStep
        results={state.results}
        period={state.period}
        onUpdateResult={(result) => dispatch({ type: 'UPDATE_RESULT', result })}
        onSaveProfile={saveProfile}
        onBack={() => dispatch({ type: 'BACK_TO_FILES' })}
        onReset={() => dispatch({ type: 'RESET' })}
      />
    )
  }

  return (
    <BankFilesStep
      system={state.system}
      systemLoading={systemLoading}
      systemError={systemError}
      period={state.period}
      statements={state.statements}
      accounts={availableAccounts(state)}
      statementLoading={statementLoading > 0}
      statementErrors={statementErrors}
      hasEditedResults={(state.results ?? []).some((r) => r.rows.some((row) => row.edited))}
      fallbackYear={fallbackYear}
      onSystemFile={handleSystemFile}
      onStatementFiles={handleStatementFiles}
      onUpdateStatement={(id, patch) => dispatch({ type: 'UPDATE_STATEMENT', id, patch })}
      onRemoveStatement={(id) => dispatch({ type: 'REMOVE_STATEMENT', id })}
      onAddCustomAccount={(statementId, name) =>
        dispatch({
          type: 'ADD_CUSTOM_ACCOUNT',
          statementId,
          account: {
            key: `OUTRA:${name.trim().toUpperCase()}`,
            code: '',
            name: name.trim(),
            openingBalance: null,
            closingBalance: null,
            entries: [],
          },
        })
      }
      onPeriod={(period) => dispatch({ type: 'SET_PERIOD', period })}
      onReconcile={handleReconcile}
      onShowResults={state.results ? () => dispatch({ type: 'SHOW_RESULTS', results: state.results! }) : undefined}
    />
  )
}
