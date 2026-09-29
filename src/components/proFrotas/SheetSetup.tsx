import { useMemo, useState } from 'react'
import type { LayoutChange, LoadedSheet } from './ProFrotasValidation'
import { formatCnpj, isValidCnpj, normalizeCnpj } from '../../core/proFrotas/cnpj'
import { FIELDS, columnSample, missingRequired, sheetColumns } from '../../core/proFrotas/sheet'

interface SheetSetupProps {
  sheet: LoadedSheet
  conversions: Record<string, string>
  onLayout: (change: LayoutChange) => void
  onConversion: (from: string, to: string | null) => void
  onRemove: () => void
}

const select = 'bg-white dark:bg-slate-900 w-full px-2 py-1.5 text-xs text-gray-800 dark:text-slate-200 border border-gray-300 dark:border-slate-600 rounded-md'

/** Planilha enviada: colunas usadas (pré-selecionadas pelo título) e conversão do CNPJ da Empresa */
export default function SheetSetup({ sheet, conversions, onLayout, onConversion, onRemove }: SheetSetupProps) {
  const { layout, workbook, lines } = sheet
  const ws = workbook[layout.sheetIndex]
  const columns = useMemo(() => sheetColumns(ws, layout.headerIndex), [ws, layout.headerIndex])
  const missing = missingRequired(layout.mapping)
  const [open, setOpen] = useState(missing.length > 0)

  // CNPJs da coluna CNPJ da Empresa como vieram na planilha
  const companies = useMemo(() => {
    const byCnpj = new Map<string, { name: string; lines: number }>()
    for (const l of lines) {
      if (!l.companyCnpj) continue
      const c = byCnpj.get(l.companyCnpj) ?? { name: l.companyName, lines: 0 }
      c.lines++
      byCnpj.set(l.companyCnpj, c)
    }
    return [...byCnpj.entries()].sort((a, b) => b[1].lines - a[1].lines)
  }, [lines])
  const postponed = lines.filter((l) => l.postponed).length
  const converted = companies.filter(([cnpj]) => conversions[cnpj])

  const summary = FIELDS.filter((f) => layout.mapping[f.field] !== null)
    .map((f) => `${f.label} ${columns[layout.mapping[f.field]!]?.letter ?? '?'}`)
    .join(' · ')

  return (
    <li className="px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-800 dark:text-slate-200 truncate">{sheet.fileName}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            {missing.length
              ? 'Escolha as colunas para ler os lançamentos.'
              : `${lines.length.toLocaleString('pt-BR')} lançamento(s)${postponed ? ` · ${postponed.toLocaleString('pt-BR')} postergado(s) ficam de fora` : ''}`}
            {workbook.length > 1 && ` · aba "${ws.sheetName}"`}
          </p>
          {!open && !missing.length && <p className="mt-0.5 text-[11px] text-gray-400 dark:text-slate-500">{summary}</p>}
          {converted.map(([cnpj]) => (
            <p key={cnpj} className="mt-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
              CNPJ da Empresa {formatCnpj(cnpj)} convertido para {formatCnpj(conversions[cnpj])}
            </p>
          ))}
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
        >
          {open ? 'Fechar' : 'Colunas e CNPJ'}
        </button>
        <button onClick={onRemove} className="text-xs text-gray-400 dark:text-slate-500 underline hover:text-red-600 dark:hover:text-red-400">
          Remover
        </button>
      </div>

      {missing.length > 0 && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2" role="alert">
          Não reconheci pelo título: {missing.map((f) => f.label).join(', ')}. Escolha a coluna de cada um.
        </p>
      )}

      {open && (
        <div className="mt-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/40 p-3">
          {workbook.length > 1 && (
            <label className="block text-xs text-gray-500 dark:text-slate-400 mb-3 max-w-sm">
              Aba da planilha
              <select value={layout.sheetIndex} onChange={(e) => onLayout({ sheetIndex: Number(e.target.value) })} className={`${select} mt-1`}>
                {workbook.map((w, i) => (
                  <option key={w.sheetName} value={i}>
                    {w.sheetName}
                  </option>
                ))}
              </select>
            </label>
          )}

          <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Colunas</p>
          <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-2">
            Pré-selecionadas pelo título da coluna. O que você trocar fica lembrado neste navegador para as próximas planilhas.
          </p>
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)] items-center">
            {FIELDS.map((f) => {
              const column = layout.mapping[f.field]
              return (
                <div key={f.field} className="contents">
                  <span className="text-xs text-gray-700 dark:text-slate-300">
                    {f.label}
                    {f.required && <span className="text-red-500"> *</span>}
                  </span>
                  <select
                    value={column ?? ''}
                    onChange={(e) => onLayout({ field: f.field, column: e.target.value === '' ? null : Number(e.target.value) })}
                    className={`${select} ${f.required && column === null ? 'border-red-400 dark:border-red-500' : ''}`}
                  >
                    <option value="">{f.required ? '— escolher —' : '— não usar —'}</option>
                    {columns.map((c) => (
                      <option key={c.index} value={c.index}>
                        {c.letter} · {c.title || '(sem título)'}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
                    {column !== null ? `ex.: ${columnSample(ws, layout.headerIndex, column, f.field)}` : f.field === 'postponed' ? 'sem a coluna, nenhum lançamento é tratado como postergado' : ''}
                  </span>
                </div>
              )
            })}
          </div>

          {companies.length > 0 && (
            <>
              <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 mt-4 mb-1">CNPJ da Empresa</p>
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-2">
                Quando as notas saem para outro CNPJ do que está na planilha (filial, incorporação), informe o CNPJ das notas. Em branco, mantém o da planilha.
              </p>
              <div className="space-y-2">
                {companies.map(([cnpj, info]) => (
                  // A chave inclui a conversão: aplicada por fora (sugestão dos XMLs), o campo recomeça com ela
                  <ConversionRow key={`${cnpj}>${conversions[cnpj] ?? ''}`} from={cnpj} name={info.name} lines={info.lines} to={conversions[cnpj] ?? ''} onChange={(to) => onConversion(cnpj, to)} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}

function ConversionRow(props: { from: string; name: string; lines: number; to: string; onChange: (to: string | null) => void }) {
  const [draft, setDraft] = useState(props.to ? formatCnpj(props.to) : '')
  const [error, setError] = useState<string | null>(null)

  function commit() {
    const value = normalizeCnpj(draft)
    if (!value) {
      setError(null)
      props.onChange(null)
      return
    }
    if (!isValidCnpj(value)) {
      setError('CNPJ inválido')
      return
    }
    setError(null)
    setDraft(formatCnpj(value))
    props.onChange(value)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="tabular-nums text-gray-800 dark:text-slate-200">{formatCnpj(props.from)}</span>
      <span className="text-gray-400 dark:text-slate-500 truncate max-w-[220px]" title={props.name}>
        {props.name || 'sem nome'} · {props.lines.toLocaleString('pt-BR')} linhas
      </span>
      <span className="text-gray-400 dark:text-slate-500">→</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        placeholder="manter o da planilha"
        aria-label={`CNPJ das notas para ${formatCnpj(props.from)}`}
        className={`bg-white dark:bg-slate-900 w-48 px-2 py-1 tabular-nums text-gray-800 dark:text-slate-200 border rounded-md ${error ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-slate-600'}`}
      />
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
      {!error && props.to && <span className="text-violet-700 dark:text-violet-300 font-medium">convertido</span>}
    </div>
  )
}
