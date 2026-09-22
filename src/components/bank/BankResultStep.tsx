import { useState } from 'react'
import { downloadBankWorkbook, exportFileName } from '../../core/bankReconciliation/bankExporter'
import { loadLogos } from '../../core/bankReconciliation/logos'
import { formatDateBR, formatMoney, formatPeriod, parseMoney } from '../../core/bankReconciliation/money'
import { summarizeAccount, updateRow } from '../../core/bankReconciliation/session'
import { SITUATIONS } from '../../types/bankReconciliation'
import type { AccountBalances, AccountProfile, AccountResult, Period, ResultRow, Situation } from '../../types/bankReconciliation'

interface BankResultStepProps {
  results: AccountResult[]
  period: Period
  onUpdateResult: (result: AccountResult) => void
  onSaveProfile: (accountKey: string, patch: Partial<AccountProfile>) => void
  onBack: () => void
  onReset: () => void
}

const SITUATION_STYLE: Record<Situation, { row: string; pill: string; dot: string }> = {
  'Lançamento conciliado': { row: 'hover:bg-gray-50 dark:hover:bg-slate-800', pill: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30', dot: 'bg-emerald-500' },
  'Valores iguais': { row: 'bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/25', pill: 'bg-amber-100 dark:bg-amber-500/20 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-500/40', dot: 'bg-amber-500' },
  'Aguardando composição': { row: 'bg-sky-50 dark:bg-sky-500/10 hover:bg-sky-100 dark:hover:bg-sky-500/25', pill: 'bg-sky-100 dark:bg-sky-500/20 text-sky-900 dark:text-sky-200 border-sky-300 dark:border-sky-500/40', dot: 'bg-sky-500' },
  'Lançamento não encontrado': { row: 'bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/25', pill: 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 border-red-300 dark:border-red-500/40', dot: 'bg-red-500' },
  'Recebimento Frota': { row: 'bg-violet-50 dark:bg-violet-500/10 hover:bg-violet-100 dark:hover:bg-violet-500/25', pill: 'bg-violet-100 dark:bg-violet-500/20 text-violet-900 dark:text-violet-200 border-violet-300 dark:border-violet-500/40', dot: 'bg-violet-500' },
}

const CRITERION_LABEL: Record<ResultRow['criterion'], string> = {
  value: 'Valor',
  'same-value': 'Valor + nome',
  sum: 'Soma',
  none: '—',
}

export default function BankResultStep({ results, period, onUpdateResult, onSaveProfile, onBack, onReset }: BankResultStepProps) {
  const [activeKey, setActiveKey] = useState(results[0]?.accountKey ?? '')
  const [exporting, setExporting] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const active = results.find((r) => r.accountKey === activeKey) ?? results[0]

  async function exportAccounts(accounts: AccountResult[], fileName: string, id: string) {
    setExporting(id)
    setExportError(null)
    try {
      await downloadBankWorkbook(accounts, fileName, await loadLogos(accounts))
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Não foi possível gerar a planilha.')
    } finally {
      setExporting(null)
    }
  }

  if (!active) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl">
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Nenhuma conta com extrato vinculado.</p>
        <button onClick={onBack} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">
          ← Voltar aos arquivos
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Conciliação bancária · {formatPeriod(period)}</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            {results.length} conta(s). Situação e documento podem ser ajustados na tabela antes de exportar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onBack} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm">
            ← Arquivos
          </button>
          <button onClick={onReset} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm">
            + Nova conciliação
          </button>
          <button
            disabled={exporting !== null}
            onClick={() => exportAccounts(results, exportFileName(period), 'geral')}
            className="inline-flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            <DownloadIcon />
            {exporting === 'geral' ? 'Gerando…' : `Exportar geral (${results.length} ${results.length === 1 ? 'banco' : 'bancos'})`}
          </button>
        </div>
      </div>

      {exportError && (
        <p className="mb-4 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-3 py-2" role="alert">
          {exportError}
        </p>
      )}

      {/* Abas por conta */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-slate-700 mb-5" role="tablist">
        {results.map((r) => {
          const summary = summarizeAccount(r)
          const selected = r.accountKey === active.accountKey
          return (
            <button
              key={r.accountKey}
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveKey(r.accountKey)}
              className={[
                'px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 -mb-px transition-colors flex items-center gap-2',
                selected ? 'border-blue-600 text-blue-700 dark:text-blue-400 bg-white dark:bg-slate-900' : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-100',
              ].join(' ')}
            >
              {r.profile.sheetName}
              {summary.attention > 0 ? (
                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300">{summary.attention}</span>
              ) : (
                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">✓</span>
              )}
            </button>
          )
        })}
      </div>

      <AccountPanel
        key={active.accountKey}
        result={active}
        exporting={exporting === active.accountKey}
        onChange={onUpdateResult}
        onSaveProfile={(patch) => onSaveProfile(active.accountKey, patch)}
        onExport={() => exportAccounts([active], exportFileName(period, active.profile.sheetName), active.accountKey)}
      />
    </div>
  )
}

// ── Painel da conta ──────────────────────────────────────────────────────────

interface AccountPanelProps {
  result: AccountResult
  exporting: boolean
  onChange: (result: AccountResult) => void
  onSaveProfile: (patch: Partial<AccountProfile>) => void
  onExport: () => void
}

function AccountPanel({ result, exporting, onChange, onSaveProfile, onExport }: AccountPanelProps) {
  const [filter, setFilter] = useState<Situation | 'Todas'>('Todas')
  const summary = summarizeAccount(result)
  const rows = filter === 'Todas' ? result.rows : result.rows.filter((r) => r.situation === filter)

  function setBalance(field: keyof AccountBalances, value: number | null) {
    onChange({ ...result, balances: { ...result.balances, [field]: value } })
  }

  function setProfile(patch: Partial<AccountProfile>) {
    onChange({ ...result, profile: { ...result.profile, ...patch } })
    onSaveProfile(patch)
  }

  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-3 mb-5">
        {/* SALDO */}
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">Saldo</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 dark:text-slate-500">
                <th className="text-left font-medium pb-1" />
                <th className="text-right font-medium pb-1">Inicial</th>
                <th className="text-right font-medium pb-1">Final</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-1 pr-2 text-gray-700 dark:text-slate-300 font-medium">Atua</td>
                <td className="py-1 pl-2"><MoneyInput value={result.balances.systemOpening} onChange={(v) => setBalance('systemOpening', v)} /></td>
                <td className="py-1 pl-2"><MoneyInput value={result.balances.systemClosing} onChange={(v) => setBalance('systemClosing', v)} /></td>
              </tr>
              <tr>
                <td className="py-1 pr-2 text-gray-700 dark:text-slate-300 font-medium">Banco</td>
                <td className="py-1 pl-2"><MoneyInput value={result.balances.bankOpening} onChange={(v) => setBalance('bankOpening', v)} /></td>
                <td className="py-1 pl-2"><MoneyInput value={result.balances.bankClosing} onChange={(v) => setBalance('bankClosing', v)} /></td>
              </tr>
            </tbody>
          </table>
          {summary.statementCloses === false && (
            <p className="mt-2 text-xs text-red-700 dark:text-red-400">
              ✗ Saldo inicial do banco + movimentos ({formatMoney(result.statementTotal)}) não chega no saldo final. Confira o extrato.
            </p>
          )}
          {(result.balances.bankOpening === null || result.balances.bankClosing === null) && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">O extrato não trouxe saldo. Informe o saldo do banco para a conferência.</p>
          )}
        </div>

        {/* Conferência */}
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">Conferência</p>
          <dl className="text-sm space-y-1">
            <Line label="Variação no Atua" value={summary.systemVariation} />
            <Line label="Variação no banco" value={summary.bankVariation} />
            <Line label="Diferença" value={summary.difference} strong />
            <Line label="Pendências (banco − sistema)" value={summary.explained} />
            {result.ignoredCount > 0 && (
              <Line label={`Redundantes ignorados (${result.ignoredCount})`} value={summary.ignoredTotal} />
            )}
          </dl>
          {summary.closes === true && (
            <p className="mt-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg px-2 py-1.5">✓ A diferença de saldo é explicada pelas pendências.</p>
          )}
          {summary.closes === false && summary.difference !== null && (
            <p className="mt-3 text-xs font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-2 py-1.5">
              ✗ Sobram {formatMoney(Math.round((summary.difference - summary.explained - summary.ignoredTotal) * 100) / 100)} sem explicação.
            </p>
          )}
        </div>

        {/* Planilha */}
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">Na planilha</p>
          <div className="grid grid-cols-2 gap-2">
            <ProfileInput label="Nome da aba" value={result.profile.sheetName} maxLength={31} onChange={(v) => setProfile({ sheetName: v })} />
            <ProfileInput label="Empresa (título)" value={result.profile.company} onChange={(v) => setProfile({ company: v })} />
            <ProfileInput label="Banco (cabeçalho)" value={result.profile.bankLabel} onChange={(v) => setProfile({ bankLabel: v })} />
            <ProfileInput label="Banco (bloco SALDO)" value={result.profile.balanceLabel} onChange={(v) => setProfile({ balanceLabel: v })} />
          </div>
          <p className="mt-2 text-[11px] text-gray-400 dark:text-slate-500 truncate" title={result.statementNames.join(', ')}>
            {result.accountName} · {result.statementNames.join(', ')}
          </p>
          <button
            disabled={exporting}
            onClick={onExport}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/40 text-sm font-semibold rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/15 disabled:opacity-50 transition-colors"
          >
            <DownloadIcon />
            {exporting ? 'Gerando…' : 'Exportar este banco'}
          </button>
        </div>
      </div>

      {/* Filtros por situação */}
      <div className="flex flex-wrap gap-2 mb-3">
        <FilterChip label="Todas" count={result.rows.length} active={filter === 'Todas'} onClick={() => setFilter('Todas')} />
        {SITUATIONS.map((s) => (
          <FilterChip key={s} label={s} count={summary.counts[s]} dot={SITUATION_STYLE[s].dot} active={filter === s} onClick={() => setFilter(s)} />
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl">
          <p className="text-gray-400 dark:text-slate-500 text-sm">Nenhuma linha para o filtro selecionado.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-900">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-700 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                <th className="px-3 py-2.5 text-left">Data</th>
                <th className="px-3 py-2.5 text-left">Lançamento</th>
                <th className="px-3 py-2.5 text-right">Valor</th>
                <th className="px-3 py-2.5 text-left">Situação</th>
                <th className="px-3 py-2.5 text-left">Documento</th>
                <th className="px-3 py-2.5 text-left">Como casou</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {rows.map((row) => (
                <tr key={row.id} className={`transition-colors ${SITUATION_STYLE[row.situation].row}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-slate-300 tabular-nums">{formatDateBR(row.date)}</td>
                  <td className="px-3 py-2 min-w-[280px]">
                    <p className="text-gray-900 dark:text-slate-100">{row.description}</p>
                    {row.source === 'system' ? (
                      <p className="text-[11px] text-red-700 dark:text-red-400">Só no sistema</p>
                    ) : (
                      row.bankHistory !== row.description && <p className="text-[11px] text-gray-400 dark:text-slate-500">{row.bankHistory}</p>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap tabular-nums font-medium ${row.amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-slate-100'}`}>
                    {formatMoney(row.amount)}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={row.situation}
                      onChange={(e) => onChange(updateRow(result, row.id, { situation: e.target.value as Situation }))}
                      className={`px-2 py-1 text-xs font-medium border rounded-md ${SITUATION_STYLE[row.situation].pill}`}
                    >
                      {SITUATIONS.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.document}
                      onChange={(e) => onChange(updateRow(result, row.id, { document: e.target.value }))}
                      className="w-full min-w-[160px] px-2 py-1 text-xs border border-gray-200 dark:border-slate-700 rounded-md bg-white/70 dark:bg-slate-900/70 font-mono"
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 min-w-[200px]">
                    <span className="font-semibold text-gray-600 dark:text-slate-400">{CRITERION_LABEL[row.criterion]}</span>
                    {row.criterion !== 'none' && ' · '}
                    {row.criterion !== 'none' ? row.note : ''}
                    {row.suggestion && <p className="text-amber-700 dark:text-amber-300">{row.suggestion}</p>}
                    {row.edited && <p className="text-blue-700 dark:text-blue-400">Alterado à mão</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Peças ────────────────────────────────────────────────────────────────────

function MoneyInput({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const format = (v: number | null) => (v === null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  return (
    <input
      key={value ?? 'vazio'}
      defaultValue={format(value)}
      placeholder="informar"
      onBlur={(e) => {
        const text = e.target.value.trim()
        const parsed = text === '' ? null : parseMoney(text)
        if (text !== '' && parsed === null) {
          e.target.value = format(value)
          return
        }
        if (parsed !== value) onChange(parsed)
      }}
      className={`bg-white dark:bg-slate-900 w-full px-2 py-1 text-right text-sm tabular-nums border border-gray-200 dark:border-slate-700 rounded-md ${value !== null && value < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-slate-200'}`}
    />
  )
}

function ProfileInput({ label, value, maxLength, onChange }: { label: string; value: string; maxLength?: number; onChange: (value: string) => void }) {
  return (
    <label className="text-[11px] text-gray-500 dark:text-slate-400">
      {label}
      <input
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white dark:bg-slate-900 mt-0.5 block w-full px-2 py-1 text-xs text-gray-800 dark:text-slate-200 border border-gray-200 dark:border-slate-700 rounded-md"
      />
    </label>
  )
}

function Line({ label, value, strong = false }: { label: string; value: number | null; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className={strong ? 'font-semibold text-gray-800 dark:text-slate-200' : 'text-gray-500 dark:text-slate-400'}>{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold' : ''} ${value !== null && value < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-slate-200'}`}>
        {value === null ? '—' : formatMoney(value)}
      </dd>
    </div>
  )
}

function FilterChip({ label, count, active, dot, onClick }: { label: string; count: number; active: boolean; dot?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full border transition-colors',
        active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-500',
      ].join(' ')}
    >
      {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}
      {label}
      <span className={active ? 'text-blue-100' : 'text-gray-400 dark:text-slate-500'}>{count}</span>
    </button>
  )
}

function DownloadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}
