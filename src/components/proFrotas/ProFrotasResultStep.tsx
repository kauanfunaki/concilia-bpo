import { useMemo, useState } from 'react'
import NoteDetail from './NoteDetail'
import { CATEGORY_STYLE } from './categoryStyle'
import type { LoadedXmlSource } from './ProFrotasValidation'
import { zipXmlFiles } from '../../core/proFrotas/archive'
import { downloadBlob, downloadProFrotasReport, formatCnpj, zipFileName } from '../../core/proFrotas/report'
import { formatDateBR, formatMoney } from '../../core/bankReconciliation/money'
import { CATEGORY_LABEL } from '../../types/proFrotas'
import type { Category, ResultNote, ValidationResult, XmlNote } from '../../types/proFrotas'

interface ProFrotasResultStepProps {
  result: ValidationResult
  sources: LoadedXmlSource[]
  onBack: () => void
  onReset: () => void
}

// Ordem da tela: o que pede atenção primeiro
const SCREEN_ORDER: Category[] = ['divergentGroup', 'divergent', 'notFound', 'disregarded', 'identical']

const PAGE = 200

type ZipKind = 'conciliados' | 'conferencia' | 'pendentes'

export default function ProFrotasResultStep({ result, sources, onBack, onReset }: ProFrotasResultStepProps) {
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [selected, setSelected] = useState<ResultNote | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const bytes = useMemo(() => {
    const map = new Map<XmlNote, Uint8Array>()
    for (const s of sources) for (const e of s.entries) map.set(e.note, e.bytes)
    return map
  }, [sources])

  const byCategory = useMemo(() => {
    const map = Object.fromEntries(SCREEN_ORDER.map((c) => [c, [] as ResultNote[]])) as Record<Category, ResultNote[]>
    for (const n of result.notes) map[n.category].push(n)
    return map
  }, [result])

  const zipNotes: Record<ZipKind, XmlNote[]> = useMemo(() => {
    const xmlsOf = (cats: Category[]) => cats.flatMap((c) => byCategory[c]).map((n) => n.xml).filter((x): x is XmlNote => x !== null)
    return {
      conciliados: xmlsOf(['identical', 'divergentGroup', 'divergent']),
      conferencia: xmlsOf(['divergentGroup', 'divergent', 'disregarded']),
      pendentes: result.pending,
    }
  }, [byCategory, result])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    const pool = filter === 'all' ? SCREEN_ORDER.flatMap((c) => byCategory[c]) : byCategory[filter]
    if (!q) return pool
    return pool.filter(
      (n) =>
        n.sheet.number === qDigits.replace(/^0+/, '') ||
        (qDigits.length >= 4 && n.sheet.stationCnpj.includes(qDigits)) ||
        (n.xml?.issuerName || n.sheet.stationName).toLowerCase().includes(q)
    )
  }, [byCategory, filter, search])

  async function run(id: string, task: () => Promise<void> | void) {
    setBusy(id)
    setError(null)
    // Deixa o "Gerando…" aparecer antes do trabalho pesado
    await new Promise((resolve) => setTimeout(resolve, 0))
    try {
      await task()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gerar o arquivo.')
    } finally {
      setBusy(null)
    }
  }

  function downloadZip(kind: ZipKind) {
    return run(kind, () => {
      const files = zipNotes[kind].flatMap((note) => {
        const content = bytes.get(note)
        return content ? [{ name: note.fileName, bytes: content }] : []
      })
      downloadBlob(zipXmlFiles(files), zipFileName(kind, result.settings.periodEnd), 'application/zip')
    })
  }

  const { settings, stats } = result

  return (
    <div className="max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Validação Pro Frotas · até {formatDateBR(settings.periodEnd)}</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            {result.companyName || 'Empresa'} · {formatCnpj(settings.companyCnpj)} · prazo de {settings.maxDays} dias · tolerância de {formatMoney(settings.tolerance)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onBack} className={secondaryButton}>← Arquivos</button>
          <button onClick={onReset} className={secondaryButton}>+ Nova validação</button>
          <button
            disabled={busy !== null}
            onClick={() => run('relatorio', () => downloadProFrotasReport(result))}
            className="inline-flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            <DownloadIcon />
            {busy === 'relatorio' ? 'Gerando…' : 'Baixar relatório'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-3 py-2" role="alert">
          {error}
        </p>
      )}

      {/* Pendentes: é a memória entre um período e outro — não pode passar despercebido */}
      {result.pending.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-3 p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl">
          <div className="flex-1 min-w-[260px] text-sm text-blue-900 dark:text-blue-200">
            <p className="font-semibold">
              {result.pending.length.toLocaleString('pt-BR')} XML(s) da Receita ainda sem cobrança na planilha
            </p>
            <p className="text-xs mt-0.5 text-blue-800/80 dark:text-blue-200/80">
              Baixe o ZIP de pendentes e envie junto na próxima validação — a nota pode entrar na cobrança seguinte.
              {result.expired.length > 0 && ` ${result.expired.length.toLocaleString('pt-BR')} XML(s) sem par já passaram de ${settings.maxDays} dias e saíram.`}
            </p>
          </div>
          <button
            disabled={busy !== null}
            onClick={() => downloadZip('pendentes')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <DownloadIcon />
            {busy === 'pendentes' ? 'Gerando…' : 'Baixar pendentes'}
          </button>
        </div>
      )}

      {/* Resumo por situação */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-5">
        {(['identical', 'divergentGroup', 'divergent', 'notFound', 'disregarded'] as Category[]).map((c) => {
          const notes = byCategory[c]
          const total = notes.reduce((s, n) => s + n.sheetAmount, 0)
          const active = filter === c
          return (
            <button
              key={c}
              onClick={() => {
                setFilter(active ? 'all' : c)
                setShown(PAGE)
              }}
              className={[
                'text-left bg-white dark:bg-slate-900 border rounded-xl shadow-sm p-4 transition-colors',
                active ? `${CATEGORY_STYLE[c].card} ring-2 ring-blue-500/40` : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-500',
              ].join(' ')}
            >
              <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                <span className={`w-2 h-2 rounded-full ${CATEGORY_STYLE[c].dot}`} />
                {CATEGORY_LABEL[c]}
              </p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{notes.length.toLocaleString('pt-BR')}</p>
              <p className="text-xs tabular-nums text-gray-500 dark:text-slate-400">{formatMoney(total)} na planilha</p>
            </button>
          )
        })}
      </div>

      {/* XMLs e o que ficou de fora */}
      <div className="grid gap-4 lg:grid-cols-2 mb-5">
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">XMLs</p>
          <div className="space-y-2">
            <ZipRow
              label="Conciliados"
              detail="Idênticas e divergentes — as notas que estão na cobrança"
              count={zipNotes.conciliados.length}
              busy={busy === 'conciliados'}
              disabled={busy !== null}
              onClick={() => downloadZip('conciliados')}
            />
            <ZipRow
              label="Para conferência"
              detail="Divergentes e desconsideradas, para abrir a nota"
              count={zipNotes.conferencia.length}
              busy={busy === 'conferencia'}
              disabled={busy !== null}
              onClick={() => downloadZip('conferencia')}
            />
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-4 text-xs text-gray-600 dark:text-slate-400">
          <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">O que ficou de fora</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            <Stat label="Lançamentos lidos da planilha" value={stats.sheetLines} />
            <Stat label="Sem número de nota (“-” ou estorno)" value={stats.sheetWithoutNote} muted />
            <Stat label="Sem valor no boleto ou sem CNPJ" value={stats.sheetIncomplete} muted />
            <Stat label="De outra empresa" value={stats.sheetOtherCompany} muted />
            <Stat label="Notas da planilha validadas" value={stats.sheetNotes} strong />
            <Stat label="NF-e lidas dos XMLs" value={stats.xmlNotes} />
            <Stat label="Repetidas entre ZIPs" value={stats.xmlDuplicates} muted />
            <Stat label="De entrada (tpNF 0)" value={stats.xmlInbound} muted />
            <Stat label="Para outro destinatário" value={stats.xmlOtherRecipient} muted />
            <Stat label={`Sem par, passaram de ${settings.maxDays} dias`} value={result.expired.length} muted />
          </dl>
        </div>
      </div>

      {/* Tabela */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <FilterChip label="Todas" count={result.notes.length} active={filter === 'all'} onClick={() => { setFilter('all'); setShown(PAGE) }} />
        {SCREEN_ORDER.map((c) => (
          <FilterChip
            key={c}
            label={CATEGORY_LABEL[c]}
            count={byCategory[c].length}
            dot={CATEGORY_STYLE[c].dot}
            active={filter === c}
            onClick={() => { setFilter(c); setShown(PAGE) }}
          />
        ))}
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setShown(PAGE) }}
          placeholder="Nº da nota, CNPJ ou posto"
          className="ml-auto w-full sm:w-64 px-3 py-1.5 text-xs bg-white dark:bg-slate-900 text-gray-800 dark:text-slate-200 border border-gray-300 dark:border-slate-600 rounded-lg"
        />
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl">
          <p className="text-gray-400 dark:text-slate-500 text-sm">Nenhuma nota para o filtro selecionado.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-900">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-700 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                <th className="px-3 py-2.5 text-left">Situação</th>
                <th className="px-3 py-2.5 text-right">Nº Nota</th>
                <th className="px-3 py-2.5 text-left">Posto</th>
                <th className="px-3 py-2.5 text-left">Abastecimento</th>
                <th className="px-3 py-2.5 text-left">Emissão</th>
                <th className="px-3 py-2.5 text-right">Dias</th>
                <th className="px-3 py-2.5 text-right">Planilha</th>
                <th className="px-3 py-2.5 text-right">XML</th>
                <th className="px-3 py-2.5 text-right">Diferença</th>
                <th className="px-3 py-2.5 text-left">Observação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {rows.slice(0, shown).map((n) => (
                <tr
                  key={n.id}
                  onClick={() => setSelected(n)}
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded-md ${CATEGORY_STYLE[n.category].pill}`}>
                      {CATEGORY_LABEL[n.category]}
                      {n.groupNumber !== null && ` · grupo ${n.groupNumber}`}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900 dark:text-slate-100">{n.sheet.number}</td>
                  <td className="px-3 py-2 min-w-[220px]">
                    <p className="text-gray-900 dark:text-slate-100 truncate max-w-[280px]">{n.xml?.issuerName || n.sheet.stationName || '—'}</p>
                    <p className="text-[11px] text-gray-400 dark:text-slate-500 tabular-nums">{formatCnpj(n.sheet.stationCnpj)}</p>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums text-gray-700 dark:text-slate-300">{n.sheet.fuelDate ? formatDateBR(n.sheet.fuelDate) : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums text-gray-700 dark:text-slate-300">{n.xml?.issueDate ? formatDateBR(n.xml.issueDate) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-slate-300">{n.days ?? '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-gray-900 dark:text-slate-100">{formatMoney(n.sheetAmount)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-gray-900 dark:text-slate-100">{n.xmlAmount === null ? '—' : formatMoney(n.xmlAmount)}</td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${n.difference ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-gray-400 dark:text-slate-500'}`}>
                    {n.difference === null ? '—' : formatMoney(n.difference)}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 min-w-[200px]">{n.note}</td>
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

      {selected && <NoteDetail note={selected} result={result} onClose={() => setSelected(null)} />}
    </div>
  )
}

const secondaryButton =
  'px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm'

function ZipRow(props: { label: string; detail: string; count: number; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-slate-200">{props.label}</p>
        <p className="text-xs text-gray-500 dark:text-slate-400">{props.detail}</p>
      </div>
      <button
        disabled={props.disabled || props.count === 0}
        onClick={props.onClick}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/40 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/15 disabled:opacity-40 transition-colors whitespace-nowrap"
      >
        <DownloadIcon />
        {props.busy ? 'Gerando…' : `ZIP (${props.count.toLocaleString('pt-BR')})`}
      </button>
    </div>
  )
}

function Stat({ label, value, muted = false, strong = false }: { label: string; value: number; muted?: boolean; strong?: boolean }) {
  return (
    <>
      <dt className={muted ? 'pl-3 text-gray-400 dark:text-slate-500' : strong ? 'font-semibold text-gray-800 dark:text-slate-200' : ''}>{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? 'font-semibold text-gray-800 dark:text-slate-200' : ''}`}>{value.toLocaleString('pt-BR')}</dd>
    </>
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

function DownloadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}
