import { useState } from 'react'
import StatusBadge from './StatusBadge'
import { exportReport } from '../core/exporter'
import type { ReconciliationReport, ReconciliationStatus } from '../types'

type Filter = 'Todos' | ReconciliationStatus

const PAGE_SIZE = 100
const PAGINATION_THRESHOLD = 500

interface ReportTableProps {
  report: ReconciliationReport
  warnings: string[]
  onNewConfig: () => void
  onReset: () => void
}

const STATUS_STYLE: Record<ReconciliationStatus, { row: string; dot: string }> = {
  'De Acordo':         { row: 'bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/25', dot: 'bg-emerald-500' },
  'Valor Divergente':  { row: 'bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/25',    dot: 'bg-amber-500'   },
  'Nota não encontrada': { row: 'bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/25',      dot: 'bg-red-500'     },
}

export default function ReportTable({ report, warnings, onNewConfig, onReset }: ReportTableProps) {
  const [filter, setFilter] = useState<Filter>('Todos')
  const [page, setPage] = useState(1)

  const { summary } = report

  const filtered = filter === 'Todos'
    ? report.records
    : report.records.filter((r) => r.status === filter)

  const usePagination = filtered.length > PAGINATION_THRESHOLD
  const totalPages = usePagination ? Math.ceil(filtered.length / PAGE_SIZE) : 1
  const paginated = usePagination ? filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : filtered

  function handleFilter(f: Filter) { setFilter(f); setPage(1) }

  const extraColumns = report.visibleColumns.slice(4)

  return (
    <div className="max-w-full">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Relatório de Conciliação</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(report.generatedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onNewConfig}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
          >
            ← Alterar configuração
          </button>
          <button
            onClick={onReset}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
          >
            + Nova conciliação
          </button>
        </div>
      </div>

      {/* Avisos */}
      {warnings.length > 0 && (
        <div className="mb-5 space-y-2">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-sm text-amber-800 dark:text-amber-300">
              <span className="flex-shrink-0 mt-0.5">⚠</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Cards de métrica — clicáveis para filtrar */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <MetricCard
          label="Total"
          value={summary.total}
          active={filter === 'Todos'}
          colorClass="border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          activeClass="ring-2 ring-blue-400"
          textClass="text-gray-900 dark:text-slate-100"
          onClick={() => handleFilter('Todos')}
        />
        <MetricCard
          label="De Acordo"
          value={summary.deAcordo}
          active={filter === 'De Acordo'}
          colorClass="border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10"
          activeClass="ring-2 ring-emerald-500"
          textClass="text-emerald-700 dark:text-emerald-400"
          onClick={() => handleFilter('De Acordo')}
        />
        <MetricCard
          label="Divergente"
          value={summary.divergente}
          active={filter === 'Valor Divergente'}
          colorClass="border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10"
          activeClass="ring-2 ring-amber-500"
          textClass="text-amber-700 dark:text-amber-300"
          onClick={() => handleFilter('Valor Divergente')}
        />
        <MetricCard
          label="Não encontrada"
          value={summary.naoEncontrada}
          active={filter === 'Nota não encontrada'}
          colorClass="border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10"
          activeClass="ring-2 ring-red-500"
          textClass="text-red-700 dark:text-red-400"
          onClick={() => handleFilter('Nota não encontrada')}
        />
      </div>

      {/* Tabela */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl">
          <p className="text-gray-400 dark:text-slate-500 text-sm">Nenhum registro para o filtro selecionado.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-900">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-700">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">{report.visibleColumns[0]}</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Valor Base 2</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Valor Base 1</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Status</th>
                {extraColumns.map((col) => (
                  <th key={col} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                    {formatColHeader(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {paginated.map((rec, i) => (
                <tr key={i} className={`transition-colors ${STATUS_STYLE[rec.status].row}`}>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-800 dark:text-slate-200">{rec.keyValue || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-800 dark:text-slate-200">{fmtVal(rec.valueBase2)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-800 dark:text-slate-200">{fmtVal(rec.valueBase1)}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={rec.status} />
                  </td>
                  {extraColumns.map((col) => (
                    <td key={col} className="px-4 py-2.5 text-xs text-gray-600 dark:text-slate-400">
                      {fmtCell(rec.displayFields[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginação */}
      {usePagination && (
        <div className="mt-4 flex items-center justify-center gap-4 text-sm">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
          >
            ← Anterior
          </button>
          <span className="text-gray-500 dark:text-slate-400">Página {page} de {totalPages}</span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
          >
            Próximo →
          </button>
        </div>
      )}

      {/* Exportar */}
      <div className="mt-6 flex justify-center">
        <button
          onClick={() => exportReport(report)}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-emerald-700 active:bg-emerald-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Exportar Excel
        </button>
      </div>
    </div>
  )
}

// ── MetricCard ────────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string
  value: number
  active: boolean
  colorClass: string
  activeClass: string
  textClass: string
  onClick: () => void
}

function MetricCard({ label, value, active, colorClass, activeClass, textClass, onClick }: MetricCardProps) {
  return (
    <button
      onClick={onClick}
      className={[
        'text-left p-4 rounded-xl border-2 transition-all duration-150 cursor-pointer',
        colorClass,
        active ? activeClass : 'hover:shadow-sm',
      ].join(' ')}
    >
      <div className={`text-2xl font-bold ${textClass}`}>{value.toLocaleString('pt-BR')}</div>
      <div className={`text-xs font-semibold mt-0.5 ${textClass} opacity-80`}>{label}</div>
    </button>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtVal(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return String(v)
}

function formatColHeader(col: string): string {
  if (col.startsWith('base1:')) return `${col.slice(6)} (Base 1)`
  if (col.startsWith('base2:')) return `${col.slice(6)} (Base 2)`
  return col
}
