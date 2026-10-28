import { useMemo, useState } from 'react'
import ItemDetail from './ItemDetail'
import { SITUATION_STYLE } from './situationStyle'
import { formatDateBR, formatMoney, formatPeriod } from '../../core/bankReconciliation/money'
import { downloadSispagReport } from '../../core/sispag/exporter'
import { indexResult, itemMatches, reportLabel, statementLabel } from '../../core/sispag/view'
import { DIVERGENT, RULE_LABEL, SITUATION_LABEL, SITUATIONS } from '../../types/sispag'
import type { ResultItem, Situation, SispagResult } from '../../types/sispag'

interface SispagResultStepProps {
  result: SispagResult
  onBack: () => void
  onReset: () => void
}

const PAGE = 200

type Filter = Situation | 'all' | 'divergent'

export default function SispagResultStep({ result, onBack, onReset }: SispagResultStepProps) {
  const index = useMemo(() => indexResult(result), [result])
  const divergent = useMemo(() => result.items.filter((i) => DIVERGENT.includes(i.situation)), [result])
  const [filter, setFilter] = useState<Filter>(divergent.length ? 'divergent' : 'all')
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [selected, setSelected] = useState<ResultItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [daysOpen, setDaysOpen] = useState(() => result.days.some((d) => Math.abs(d.difference) >= 0.01))

  const bySituation = useMemo(() => {
    const map = Object.fromEntries(SITUATIONS.map((s) => [s, [] as ResultItem[]])) as Record<Situation, ResultItem[]>
    for (const item of result.items) map[item.situation].push(item)
    return map
  }, [result])

  // Pagamentos por situação final: o lote conciliado também leva as TEDs devolvidas, que contam lá
  const payments = useMemo(() => {
    const totals = Object.fromEntries(SITUATIONS.map((s) => [s, { count: 0, value: 0 }])) as Record<Situation, { count: number; value: number }>
    for (const [id, situation] of Object.entries(result.paymentSituation)) {
      totals[situation].count++
      totals[situation].value += index.payment.get(id)?.amount ?? 0
    }
    return totals
  }, [result, index])

  const rows = useMemo(() => {
    const pool =
      filter === 'all'
        ? SITUATIONS.flatMap((s) => bySituation[s])
        : filter === 'divergent'
          ? DIVERGENT.flatMap((s) => bySituation[s])
          : bySituation[filter]
    const sorted = filter === 'all' || filter === 'divergent' ? pool : [...pool].sort((a, b) => a.date.localeCompare(b.date))
    return search.trim() ? sorted.filter((i) => itemMatches(i, index, search)) : sorted
  }, [bySituation, filter, search, index])

  async function handleDownload() {
    setBusy(true)
    setError(null)
    // Deixa o "Gerando…" aparecer antes do trabalho pesado
    await new Promise((resolve) => setTimeout(resolve, 0))
    try {
      await downloadSispagReport(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gerar a planilha.')
    } finally {
      setBusy(false)
    }
  }

  const { report, statement, totals } = result
  const closes = totals.difference === 0 && divergent.length === 0
  const pick = (next: Filter) => {
    setFilter(next)
    setShown(PAGE)
  }

  return (
    <div className="max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Conferência SISPAG · {formatPeriod(result.period)}</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            {[report.company, report.cnpj, report.account || statement.account].filter(Boolean).join(' · ')}
            {report.modality && ` · modalidade ${report.modality}`}
          </p>
          {(result.outside.payments > 0 || result.outside.movements > 0) && (
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
              Fora do período em comum: {result.outside.payments.toLocaleString('pt-BR')} pagamento(s) do relatório e{' '}
              {result.outside.movements.toLocaleString('pt-BR')} linha(s) do SISPAG no extrato.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onBack} className={secondaryButton}>← Arquivos</button>
          <button onClick={onReset} className={secondaryButton}>+ Nova conferência</button>
          <button
            disabled={busy}
            onClick={handleDownload}
            className="inline-flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {busy ? 'Gerando…' : 'Baixar planilha'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-3 py-2" role="alert">
          {error}
        </p>
      )}

      {/* Fechamento: a pergunta que a conferência responde */}
      <div
        className={[
          'mb-5 p-4 rounded-xl border',
          closes
            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
            : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-200',
        ].join(' ')}
      >
        <p className="text-sm font-semibold">
          {closes
            ? 'Extrato e relatório SISPAG fecham.'
            : `${divergent.length.toLocaleString('pt-BR')} item(ns) para conferir · diferença de ${formatMoney(totals.difference)} nos débitos`}
        </p>
        <p className="text-xs mt-1 tabular-nums opacity-90">
          {formatMoney(totals.debits)} debitados pelo SISPAG = {formatMoney(totals.done)} efetuados + {formatMoney(totals.returned)} não efetuados que saíram e
          voltaram ({formatMoney(totals.returns)} em devoluções e estornos)
          {totals.otherModality > 0 && `. Fora disso, ${formatMoney(totals.otherModality)} de outra modalidade, que o relatório não traz`}.
        </p>
      </div>

      {/* Resumo por situação */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-5">
        <SummaryCard
          label="Conciliados"
          dot={SITUATION_STYLE.matched.dot}
          main={`${payments.matched.count.toLocaleString('pt-BR')} pagamentos`}
          detail={`${bySituation.matched.reduce((s, i) => s + i.movementIds.length, 0).toLocaleString('pt-BR')} linhas do extrato · ${formatMoney(payments.matched.value)}`}
          active={filter === 'matched'}
          onClick={() => pick(filter === 'matched' ? 'all' : 'matched')}
        />
        <SummaryCard
          label="Devolvidos"
          dot={SITUATION_STYLE.returned.dot}
          main={`${payments.returned.count.toLocaleString('pt-BR')} pagamentos`}
          detail={`Não efetuados que saíram e voltaram · ${formatMoney(payments.returned.value)}`}
          active={filter === 'returned'}
          onClick={() => pick(filter === 'returned' ? 'all' : 'returned')}
        />
        <SummaryCard
          label="Para conferir"
          dot={divergent.length ? 'bg-red-500' : 'bg-emerald-500'}
          main={`${divergent.length.toLocaleString('pt-BR')} item(ns)`}
          detail={divergent.length ? DIVERGENT.filter((s) => bySituation[s].length).map((s) => `${bySituation[s].length} ${lowerFirst(SITUATION_LABEL[s])}`).join(' · ') : 'Nenhuma divergência'}
          active={filter === 'divergent'}
          alert={divergent.length > 0}
          onClick={() => pick(filter === 'divergent' ? 'all' : 'divergent')}
        />
        <SummaryCard
          label="Não efetuados"
          dot={SITUATION_STYLE.notDone.dot}
          main={`${payments.notDone.count.toLocaleString('pt-BR')} pagamentos`}
          detail={`Fora do extrato, sem débito · ${formatMoney(totals.notDone)}`}
          active={filter === 'notDone'}
          onClick={() => pick(filter === 'notDone' ? 'all' : 'notDone')}
        />
      </div>

      {/* Fechamento por dia */}
      <div className="mb-5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm">
        <button onClick={() => setDaysOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
          <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
            Fechamento por dia · {result.days.length} dia(s){' '}
            {result.days.some((d) => Math.abs(d.difference) >= 0.01) ? (
              <span className="normal-case text-amber-700 dark:text-amber-300">
                · {result.days.filter((d) => Math.abs(d.difference) >= 0.01).length} com diferença
              </span>
            ) : (
              <span className="normal-case text-emerald-700 dark:text-emerald-400">· todos fecham</span>
            )}
          </span>
          <span className="text-xs text-gray-400 dark:text-slate-500">{daysOpen ? 'Recolher' : 'Ver dias'}</span>
        </button>
        {daysOpen && (
          <div className="overflow-x-auto border-t border-gray-100 dark:border-slate-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-800/50 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                  <th className="px-3 py-2 text-left">Dia</th>
                  <th className="px-3 py-2 text-right">Débitos SISPAG</th>
                  <th className="px-3 py-2 text-right">Pagamentos</th>
                  <th className="px-3 py-2 text-right">Diferença</th>
                  <th className="px-3 py-2 text-right">Devoluções</th>
                  <th className="px-3 py-2 text-right">Outra modalidade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {result.days.map((d) => {
                  const off = Math.abs(d.difference) >= 0.01
                  return (
                    <tr key={d.date} className={off ? 'bg-amber-50/60 dark:bg-amber-500/5' : ''}>
                      <td className="px-3 py-1.5 tabular-nums text-gray-800 dark:text-slate-200">{formatDateBR(d.date)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-800 dark:text-slate-200">{formatMoney(d.debits)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-800 dark:text-slate-200">{formatMoney(d.debited)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${off ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-gray-400 dark:text-slate-500'}`}>
                        {formatMoney(d.difference)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-slate-400">{d.returns ? formatMoney(d.returns) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-slate-400">{d.otherModality ? formatMoney(d.otherModality) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Itens */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <FilterChip label="Todos" count={result.items.length} active={filter === 'all'} onClick={() => pick('all')} />
        {divergent.length > 0 && <FilterChip label="Para conferir" count={divergent.length} active={filter === 'divergent'} onClick={() => pick('divergent')} />}
        {SITUATIONS.filter((s) => bySituation[s].length > 0).map((s) => (
          <FilterChip key={s} label={SITUATION_LABEL[s]} count={bySituation[s].length} dot={SITUATION_STYLE[s].dot} active={filter === s} onClick={() => pick(s)} />
        ))}
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setShown(PAGE)
          }}
          placeholder="Favorecido, CPF/CNPJ, referência ou valor"
          className="ml-auto w-full sm:w-72 px-3 py-1.5 text-xs bg-white dark:bg-slate-900 text-gray-800 dark:text-slate-200 border border-gray-300 dark:border-slate-600 rounded-lg"
        />
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl">
          <p className="text-gray-400 dark:text-slate-500 text-sm">
            {filter === 'divergent' && !search ? 'Nenhuma divergência: tudo o que saiu pelo SISPAG está no relatório.' : 'Nenhum item para o filtro selecionado.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-900">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-700 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                <th className="px-3 py-2.5 text-left">Situação</th>
                <th className="px-3 py-2.5 text-left">Data</th>
                <th className="px-3 py-2.5 text-left">Extrato</th>
                <th className="px-3 py-2.5 text-right">Valor extrato</th>
                <th className="px-3 py-2.5 text-left">SISPAG</th>
                <th className="px-3 py-2.5 text-right">Valor SISPAG</th>
                <th className="px-3 py-2.5 text-left">Regra</th>
                <th className="px-3 py-2.5 text-left">Observação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {rows.slice(0, shown).map((item) => (
                <tr key={item.id} onClick={() => setSelected(item)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded-md ${SITUATION_STYLE[item.situation].pill}`}>
                      {SITUATION_LABEL[item.situation]}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums text-gray-700 dark:text-slate-300">{formatDateBR(item.date)}</td>
                  <td className="px-3 py-2 min-w-[180px] text-gray-900 dark:text-slate-100">
                    <span className="block truncate max-w-[260px]">{statementLabel(item, index) || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-gray-900 dark:text-slate-100">
                    {item.movementIds.length ? formatMoney(item.statementAmount) : '—'}
                  </td>
                  <td className="px-3 py-2 min-w-[200px] text-gray-900 dark:text-slate-100">
                    <span className="block truncate max-w-[280px]">{reportLabel(item, index) || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-gray-900 dark:text-slate-100">
                    {item.paymentIds.length ? formatMoney(item.reportAmount) : '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500 dark:text-slate-400">{item.rule === 'none' ? '—' : RULE_LABEL[item.rule]}</td>
                  <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 min-w-[220px]">
                    {item.note}
                    {item.hint && <span className="block text-amber-700 dark:text-amber-300">{item.hint}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown && (
            <div className="border-t border-gray-100 dark:border-slate-800 px-3 py-2 flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
              <span>
                Mostrando {shown.toLocaleString('pt-BR')} de {rows.length.toLocaleString('pt-BR')}
              </span>
              <button onClick={() => setShown((s) => s + PAGE)} className="font-semibold text-blue-700 dark:text-blue-400 hover:underline">
                Mostrar mais {Math.min(PAGE, rows.length - shown)}
              </button>
            </div>
          )}
        </div>
      )}

      {selected && <ItemDetail item={selected} index={index} onClose={() => setSelected(null)} />}
    </div>
  )
}

// "Só no SISPAG" → "só no SISPAG": a sigla continua em maiúsculas
function lowerFirst(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1)
}

const secondaryButton =
  'px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm'

function SummaryCard(props: { label: string; dot: string; main: string; detail: string; active: boolean; alert?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className={[
        'text-left bg-white dark:bg-slate-900 border rounded-xl shadow-sm p-4 transition-colors',
        props.active ? 'border-blue-300 dark:border-blue-500/50 ring-2 ring-blue-500/40' : props.alert ? 'border-red-300 dark:border-red-500/40' : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-500',
      ].join(' ')}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
        <span className={`w-2 h-2 rounded-full ${props.dot}`} />
        {props.label}
      </p>
      <p className="mt-2 text-xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{props.main}</p>
      <p className="text-xs tabular-nums text-gray-500 dark:text-slate-400">{props.detail}</p>
    </button>
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
      <span className={active ? 'text-blue-100' : 'text-gray-400 dark:text-slate-500'}>{count.toLocaleString('pt-BR')}</span>
    </button>
  )
}
