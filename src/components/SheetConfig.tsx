import { useState } from 'react'
import { getSheetHeaders } from '../core/parser'
import type { UploadedFile, ReconciliationConfig, BaseConfig } from '../types'

interface SheetConfigProps {
  base1: UploadedFile
  base2: UploadedFile
  onConfigured: (config: ReconciliationConfig) => void
  onBack: () => void
}

interface BaseFormState {
  sheet: string
  keyField: string
  valueColumn: string
  selectedDisplayFields: string[]
  headers: string[]
  error: string | null
}

function safeHeaders(file: UploadedFile, sheet: string): string[] {
  try { return getSheetHeaders(file, sheet) } catch { return [] }
}

function emptyBase(file: UploadedFile): BaseFormState {
  const sheet = file.sheets[0] ?? ''
  const headers = sheet ? safeHeaders(file, sheet) : []
  return { sheet, keyField: '', valueColumn: '', selectedDisplayFields: [], headers, error: null }
}

function toBaseConfig(s: BaseFormState): BaseConfig {
  return { sheet: s.sheet, keyField: s.keyField, valueColumn: s.valueColumn, selectedDisplayFields: s.selectedDisplayFields }
}

export default function SheetConfig({ base1, base2, onConfigured, onBack }: SheetConfigProps) {
  const [b1, setB1] = useState<BaseFormState>(() => emptyBase(base1))
  const [b2, setB2] = useState<BaseFormState>(() => emptyBase(base2))
  const [tolerance, setTolerance] = useState<number>(0)

  const b1Error = b1.keyField && b1.valueColumn && b1.keyField === b1.valueColumn
    ? 'O campo-chave e a coluna de valor não podem ser iguais.' : null
  const b2Error = b2.keyField && b2.valueColumn && b2.keyField === b2.valueColumn
    ? 'O campo-chave e a coluna de valor não podem ser iguais.' : null

  const canProceed = b1.sheet && b1.keyField && b1.valueColumn &&
    b2.sheet && b2.keyField && b2.valueColumn && !b1Error && !b2Error

  function handleSheetChange(base: 'b1' | 'b2', sheet: string) {
    const file = base === 'b1' ? base1 : base2
    const headers = safeHeaders(file, sheet)
    const set = base === 'b1' ? setB1 : setB2
    set((p) => ({
      ...p, sheet, headers, keyField: '', valueColumn: '', selectedDisplayFields: [],
      error: headers.length === 0 ? 'A aba selecionada não contém dados ou cabeçalhos.' : null,
    }))
  }

  function toggleDisplayField(base: 'b1' | 'b2', field: string) {
    const set = base === 'b1' ? setB1 : setB2
    set((p) => ({
      ...p,
      selectedDisplayFields: p.selectedDisplayFields.includes(field)
        ? p.selectedDisplayFields.filter((f) => f !== field)
        : [...p.selectedDisplayFields, field],
    }))
  }

  function handleSubmit() {
    if (!canProceed) return
    onConfigured({
      base1: toBaseConfig(b1),
      base2: toBaseConfig(b2),
      valueTolerance: tolerance,
    })
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Título */}
      <div className="mb-7">
        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Configurar Conciliação</h2>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-slate-400">Selecione as abas, os campos-chave e as colunas de valor de cada base.</p>
      </div>

      {/* Painéis das bases */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <BasePanel
          label="Base 1"
          sublabel="Referência"
          color="blue"
          file={base1}
          state={b1}
          colError={b1Error}
          onSheetChange={(s) => handleSheetChange('b1', s)}
          onKeyFieldChange={(v) => setB1((p) => ({ ...p, keyField: v }))}
          onValueChange={(v) => setB1((p) => ({ ...p, valueColumn: v }))}
          onToggleDisplay={(f) => toggleDisplayField('b1', f)}
        />
        <BasePanel
          label="Base 2"
          sublabel="A validar"
          color="violet"
          file={base2}
          state={b2}
          colError={b2Error}
          onSheetChange={(s) => handleSheetChange('b2', s)}
          onKeyFieldChange={(v) => setB2((p) => ({ ...p, keyField: v }))}
          onValueChange={(v) => setB2((p) => ({ ...p, valueColumn: v }))}
          onToggleDisplay={(f) => toggleDisplayField('b2', f)}
        />
      </div>

      {/* Tolerância de valor */}
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
            </svg>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-semibold text-gray-800 dark:text-slate-200 mb-0.5">Tolerância de valor</label>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
              Diferença máxima aceita entre os valores para considerar "De Acordo".
              Use <strong>0</strong> para correspondência exata.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-slate-400 font-medium">R$</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={tolerance}
                onChange={(e) => setTolerance(Math.max(0, parseFloat(e.target.value) || 0))}
                className="bg-white dark:bg-slate-900 w-36 border border-gray-300 dark:border-slate-600 rounded-lg text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                placeholder="0,00"
              />
              {tolerance > 0 && (
                <span className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-2 py-1 rounded-full">
                  ±{tolerance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Rodapé */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 flex items-center gap-1 transition-colors"
        >
          ← Mudar arquivos
        </button>
        <button
          disabled={!canProceed}
          onClick={handleSubmit}
          className="px-7 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm
            disabled:opacity-40 disabled:cursor-not-allowed
            hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          Conciliar →
        </button>
      </div>
    </div>
  )
}

// ── BasePanel ─────────────────────────────────────────────────────────────────

interface BasePanelProps {
  label: string
  sublabel: string
  color: 'blue' | 'violet'
  file: UploadedFile
  state: BaseFormState
  colError: string | null
  onSheetChange: (s: string) => void
  onKeyFieldChange: (v: string) => void
  onValueChange: (v: string) => void
  onToggleDisplay: (f: string) => void
}

function BasePanel({
  label, sublabel, color, file, state, colError,
  onSheetChange, onKeyFieldChange, onValueChange, onToggleDisplay,
}: BasePanelProps) {
  const badge = color === 'blue' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300'
  const ring = color === 'blue' ? 'focus:ring-blue-400' : 'focus:ring-violet-400'

  const displayHeaders = state.headers.filter(
    (h) => h !== state.keyField && h !== state.valueColumn
  )

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badge}`}>{label}</span>
        <span className="text-xs text-gray-400 dark:text-slate-500">{sublabel}</span>
        <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto truncate max-w-[120px]" title={file.name}>{file.name}</span>
      </div>

      <div className="space-y-3">
        {/* Aba */}
        <Field label="Aba">
          <select
            value={state.sheet}
            onChange={(e) => onSheetChange(e.target.value)}
            className={`bg-white dark:bg-slate-900 w-full border border-gray-300 dark:border-slate-600 rounded-lg text-sm px-3 py-1.5 focus:outline-none focus:ring-2 ${ring} focus:border-transparent`}
          >
            {file.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {state.error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{state.error}</p>}
        </Field>

        {/* Campo-chave */}
        <Field label="Campo-chave de comparação">
          <select
            value={state.keyField}
            onChange={(e) => onKeyFieldChange(e.target.value)}
            className={`bg-white dark:bg-slate-900 w-full border border-gray-300 dark:border-slate-600 rounded-lg text-sm px-3 py-1.5 focus:outline-none focus:ring-2 ${ring} focus:border-transparent`}
          >
            <option value="">— Selecione —</option>
            {state.headers.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </Field>

        {/* Coluna de valor */}
        <Field label="Coluna de Valor da Nota">
          <select
            value={state.valueColumn}
            onChange={(e) => onValueChange(e.target.value)}
            className={`bg-white dark:bg-slate-900 w-full border border-gray-300 dark:border-slate-600 rounded-lg text-sm px-3 py-1.5 focus:outline-none focus:ring-2 ${ring} focus:border-transparent`}
          >
            <option value="">— Selecione —</option>
            {state.headers.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </Field>

        {colError && <p className="text-xs text-red-600 dark:text-red-400">{colError}</p>}

        {/* Campos adicionais */}
        {displayHeaders.length > 0 && (
          <Field label="Campos adicionais no relatório">
            <div className="space-y-1 max-h-28 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-lg p-2 bg-gray-50 dark:bg-slate-800/50">
              {displayHeaders.map((h) => (
                <label key={h} className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={state.selectedDisplayFields.includes(h)}
                    onChange={() => onToggleDisplay(h)}
                    className={`accent-${color === 'blue' ? 'blue' : 'violet'}-600`}
                  />
                  {h}
                </label>
              ))}
            </div>
          </Field>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 dark:text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  )
}
