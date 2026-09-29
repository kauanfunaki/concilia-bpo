import DropZone from '../bank/DropZone'
import SheetSetup from './SheetSetup'
import type { LayoutChange, LoadedSheet, LoadedXmlSource, Progress, Recipient, SettingsDraft } from './ProFrotasValidation'
import { formatCnpj } from '../../core/proFrotas/cnpj'
import { missingRequired } from '../../core/proFrotas/sheet'
import type { CompanyOption } from '../../core/proFrotas/validator'

interface ProFrotasFilesStepProps {
  sheets: LoadedSheet[]
  conversions: Record<string, string>
  sources: LoadedXmlSource[]
  companies: CompanyOption[]
  recipients: Recipient[]
  otherCnpjOpen: boolean
  otherRecipients: Recipient[]
  onOtherCnpj: (open: boolean) => void
  settings: SettingsDraft
  progress: Progress | null
  sheetErrors: string[]
  xmlErrors: string[]
  onSheetFiles: (files: File[]) => void
  onXmlFiles: (files: File[], origin: LoadedXmlSource['origin']) => void
  onLayout: (id: string, change: LayoutChange) => void
  onConversion: (from: string, to: string | null) => void
  onRemoveSheet: (id: string) => void
  onRemoveSource: (id: string) => void
  onSettings: (patch: Partial<SettingsDraft>) => void
  onValidate: () => void
  onShowResult?: () => void
}

const card = 'bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-5 mb-5'
const input = 'bg-white dark:bg-slate-900 mt-1 block px-3 py-1.5 text-sm text-gray-800 dark:text-slate-200 border border-gray-300 dark:border-slate-600 rounded-lg'

export default function ProFrotasFilesStep(props: ProFrotasFilesStepProps) {
  const { sheets, sources, settings, progress, conversions } = props
  const receita = sources.filter((s) => s.origin === 'receita')
  const pendentes = sources.filter((s) => s.origin === 'pendentes')
  const outroCnpj = sources.filter((s) => s.origin === 'outroCnpj')
  const xmlCount = sources.reduce((n, s) => n + s.entries.length, 0)

  const blockers: string[] = []
  if (progress) blockers.push('Aguarde a leitura dos arquivos.')
  if (sheets.length === 0) blockers.push('Envie a planilha da Pro Frotas.')
  const unmapped = sheets.find((s) => missingRequired(s.layout.mapping).length > 0)
  if (unmapped) blockers.push(`Escolha as colunas obrigatórias de ${unmapped.fileName}.`)
  if (xmlCount === 0) blockers.push('Envie os XMLs da Receita.')
  if (!settings.companyCnpj) blockers.push('Escolha a empresa.')
  if (!settings.periodEnd) blockers.push('Informe a data final do período.')
  if (!(settings.maxDays > 0)) blockers.push('O prazo máximo precisa ser maior que zero.')
  if (!(settings.tolerance >= 0)) blockers.push('A tolerância não pode ser negativa.')

  // Destinatário das notas × empresa escolhida: sem nenhum XML para ela, o CNPJ da planilha precisa de conversão
  const selectedRecipient = props.recipients.find((r) => r.cnpj === settings.companyCnpj)
  const otherRecipients = props.recipients.filter((r) => r.cnpj !== settings.companyCnpj).slice(0, 3)
  const convertedFrom = Object.keys(conversions).filter((from) => conversions[from] === settings.companyCnpj)
  // CNPJ como está na planilha, antes de qualquer conversão para a empresa escolhida
  const sheetCnpj = convertedFrom[0] ?? settings.companyCnpj

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Validação Pro Frotas</h2>
        <p className="mt-1 text-gray-500 dark:text-slate-400 text-sm">
          Planilha de cobrança da Pro Frotas × XMLs das notas dos postos baixados da Receita. Tudo é lido aqui no navegador: os arquivos não saem do computador.
        </p>
      </div>

      {/* ── Planilha ─────────────────────────────────────────────────────── */}
      <section className={card}>
        <StepTitle n={1} title="Planilha da Pro Frotas" />
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
          "Relatório Detalhamento da Cobrança". As colunas vêm pré-selecionadas pelo título e podem ser trocadas em "Colunas e CNPJ", onde também dá para converter o CNPJ da Empresa.
          Lançamento com Postergado = Sim fica de fora do cálculo.
        </p>
        <DropZone accept=".xlsx,.xls" hint=".xlsx / .xls · até 30 MB" multiple onFiles={props.onSheetFiles} />
        <Errors errors={props.sheetErrors} />
        {sheets.length > 0 && (
          <ul className="mt-4 divide-y divide-gray-100 dark:divide-slate-800 border border-gray-100 dark:border-slate-800 rounded-lg">
            {sheets.map((s) => (
              <SheetSetup
                key={s.id}
                sheet={s}
                conversions={conversions}
                onLayout={(change) => props.onLayout(s.id, change)}
                onConversion={props.onConversion}
                onRemove={() => props.onRemoveSheet(s.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── XMLs da Receita ──────────────────────────────────────────────── */}
      <section className={card}>
        <StepTitle n={2} title="XMLs da Receita" />
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
          O ZIP do Download de DF-e do portal da Receita do PR, ou os XMLs soltos. Pode enviar vários: XML repetido entre ZIPs conta uma vez só.
        </p>
        <DropZone accept=".zip,.xml" hint=".zip / .xml · até 400 MB" multiple onFiles={(files) => props.onXmlFiles(files, 'receita')} />
        <Errors errors={props.xmlErrors} />
        <FileList items={receita.map(sourceItem)} onRemove={props.onRemoveSource} />
      </section>

      {/* ── Pendentes ────────────────────────────────────────────────────── */}
      <section className={card}>
        <StepTitle n={3} title="Pendentes do período anterior" optional />
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
          O ZIP "Pendentes Pro Frotas" que esta tela gerou na última validação: são as notas da Receita que ainda não apareceram na cobrança e podem entrar nesta.
        </p>
        <DropZone accept=".zip" hint=".zip gerado na validação anterior" multiple onFiles={(files) => props.onXmlFiles(files, 'pendentes')} />
        <FileList items={pendentes.map(sourceItem)} onRemove={props.onRemoveSource} />
      </section>

      {/* ── Notas para outro CNPJ (ocasional) ───────────────────────────── */}
      <section className={card}>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={props.otherCnpjOpen}
            onChange={(e) => props.onOtherCnpj(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-blue-600"
          />
          <span>
            <span className="text-sm font-bold text-gray-900 dark:text-slate-100">Há notas emitidas para outro CNPJ</span>
            <span className="ml-2 text-[11px] text-gray-400 dark:text-slate-500">ocasional</span>
            <span className="block text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Quando parte dos abastecimentos da planilha saiu com nota para outro CNPJ (outra empresa do grupo, por exemplo) e essas notas aparecem como não encontradas.
            </span>
          </span>
        </label>
        {props.otherCnpjOpen && (
          <div className="mt-4">
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
              Envie o ZIP com os XMLs desse CNPJ. Eles entram no confronto só para achar as notas da planilha: o que sobrar não vai para os pendentes, e cada nota casada sai
              marcada com o CNPJ para o qual foi emitida.
            </p>
            <DropZone accept=".zip,.xml" hint=".zip / .xml · até 400 MB" multiple onFiles={(files) => props.onXmlFiles(files, 'outroCnpj')} />
            <FileList items={outroCnpj.map(sourceItem)} onRemove={props.onRemoveSource} />
            {props.otherRecipients.length > 0 && (
              <div className="mt-3 text-xs text-gray-600 dark:text-slate-300">
                <p className="font-semibold mb-1">Destinatários que entram no confronto:</p>
                <ul className="space-y-0.5">
                  {props.otherRecipients.map((r) => (
                    <li key={r.cnpj}>
                      <span className="tabular-nums font-medium">{formatCnpj(r.cnpj)}</span> · {r.name} · {r.notes.toLocaleString('pt-BR')} NF-e
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {outroCnpj.length > 0 && props.otherRecipients.length === 0 && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Os XMLs enviados aqui são todos para a própria empresa: não há outro CNPJ a considerar.</p>
            )}
          </div>
        )}
      </section>

      {progress && <ProgressBar progress={progress} />}

      {/* ── Parâmetros e ação ────────────────────────────────────────────── */}
      <section className={`${card} flex flex-wrap items-end gap-4`}>
        <div className="w-full">
          <StepTitle n={4} title="Parâmetros" />
        </div>
        <label className="text-xs text-gray-500 dark:text-slate-400 min-w-[260px] flex-1">
          Empresa
          <select
            value={settings.companyCnpj}
            disabled={props.companies.length === 0}
            onChange={(e) => props.onSettings({ companyCnpj: e.target.value })}
            className={`${input} w-full disabled:bg-gray-50 dark:disabled:bg-slate-800`}
          >
            {props.companies.length === 0 && <option value="">Vem da planilha</option>}
            {props.companies.map((c) => (
              <option key={c.cnpj} value={c.cnpj}>
                {c.name || 'Sem nome'} · {formatCnpj(c.cnpj)} ({c.lines.toLocaleString('pt-BR')} linhas)
              </option>
            ))}
          </select>
          {convertedFrom.length > 0 && (
            <span className="mt-1 block text-[11px] text-violet-700 dark:text-violet-300">
              Convertido de {convertedFrom.map(formatCnpj).join(', ')}, como está na planilha
            </span>
          )}
          {selectedRecipient && (
            <span className="mt-1 block text-[11px] text-emerald-700 dark:text-emerald-400">
              {selectedRecipient.notes.toLocaleString('pt-BR')} NF-e dos XMLs são para este CNPJ
            </span>
          )}
        </label>
        <label className="text-xs text-gray-500 dark:text-slate-400">
          Data final do período
          <input
            type="date"
            value={settings.periodEnd}
            onChange={(e) => props.onSettings({ periodEnd: e.target.value, periodEndTouched: true })}
            className={input}
          />
        </label>
        <label className="text-xs text-gray-500 dark:text-slate-400">
          Prazo máximo (dias)
          <input
            type="number"
            min={1}
            value={settings.maxDays}
            onChange={(e) => props.onSettings({ maxDays: Number(e.target.value) })}
            className={`${input} w-28`}
          />
        </label>
        <label className="text-xs text-gray-500 dark:text-slate-400">
          Tolerância (R$)
          <input
            type="number"
            min={0}
            step={0.01}
            value={settings.tolerance}
            onChange={(e) => props.onSettings({ tolerance: Number(e.target.value) })}
            className={`${input} w-28`}
          />
        </label>
        {settings.companyCnpj && !selectedRecipient && otherRecipients.length > 0 && (
          <div className="w-full p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-xs text-amber-900 dark:text-amber-200" role="alert">
            <p className="font-semibold">Nenhuma NF-e dos XMLs enviados é para o CNPJ {formatCnpj(settings.companyCnpj)}.</p>
            <p className="mt-0.5">Se as notas saem para outro CNPJ, converta o CNPJ da Empresa da planilha. Os XMLs são para:</p>
            <ul className="mt-2 space-y-1">
              {otherRecipients.map((r) => (
                <li key={r.cnpj} className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums font-medium">{formatCnpj(r.cnpj)}</span>
                  <span>
                    {r.name} · {r.notes.toLocaleString('pt-BR')} NF-e
                  </span>
                  <button
                    onClick={() => props.onConversion(sheetCnpj, r.cnpj)}
                    className="px-2 py-0.5 font-semibold text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-500/40 rounded-md hover:bg-violet-50 dark:hover:bg-violet-500/15"
                  >
                    {r.cnpj === sheetCnpj ? 'Usar o CNPJ da planilha' : `Converter ${formatCnpj(sheetCnpj)} → ${formatCnpj(r.cnpj)}`}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-gray-400 dark:text-slate-500 w-full">
          A data final vem do último abastecimento da planilha. Nota emitida mais de {settings.maxDays || '—'} dias depois do abastecimento é desconsiderada;
          XML sem par fica pendente até passar desse prazo, contado da data final.
        </p>

        <div className="w-full flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">
          {blockers.length > 0 && <p className="text-xs text-gray-500 dark:text-slate-400 mr-auto">{blockers[0]}</p>}
          {props.onShowResult && (
            <button
              onClick={props.onShowResult}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
            >
              Voltar ao resultado
            </button>
          )}
          <button
            disabled={blockers.length > 0}
            onClick={props.onValidate}
            className="px-7 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            Validar →
          </button>
        </div>
      </section>
    </div>
  )
}

function sourceItem(s: LoadedXmlSource) {
  const parts = [`${s.entries.length.toLocaleString('pt-BR')} NF-e`]
  const cancelled = s.entries.filter((e) => e.note.cancelled).length + s.cancellations.length
  if (cancelled) parts.push(`${cancelled.toLocaleString('pt-BR')} cancelamento(s)`)
  if (s.others) parts.push(`${s.others.toLocaleString('pt-BR')} outro(s) evento(s) ou documento(s) ignorado(s)`)
  if (s.errors.length) parts.push(`${s.errors.length} XML(s) ilegível(is)`)
  return {
    id: s.id,
    name: s.fileName,
    detail: parts.join(' · '),
    warning: s.errors.length ? s.errors.slice(0, 5).map((e) => `${e.file}: ${e.message}`).join('\n') : undefined,
  }
}

function StepTitle({ n, title, optional = false }: { n: number; title: string; optional?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400">{n}</span>
      <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">{title}</h3>
      {optional && <span className="text-[11px] text-gray-400 dark:text-slate-500">opcional</span>}
    </div>
  )
}

function Errors({ errors }: { errors: string[] }) {
  return (
    <>
      {errors.map((error) => (
        <p key={error} className="mt-3 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2" role="alert">
          {error}
        </p>
      ))}
    </>
  )
}

function FileList({ items, onRemove }: { items: { id: string; name: string; detail: string; warning?: string }[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null
  return (
    <ul className="mt-4 divide-y divide-gray-100 dark:divide-slate-800 border border-gray-100 dark:border-slate-800 rounded-lg">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-800 dark:text-slate-200 truncate">{item.name}</p>
            <p className={`text-xs ${item.warning ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-slate-400'}`} title={item.warning}>
              {item.detail}
            </p>
          </div>
          <button
            onClick={() => onRemove(item.id)}
            className="text-xs text-gray-400 dark:text-slate-500 underline hover:text-red-600 dark:hover:text-red-400"
          >
            Remover
          </button>
        </li>
      ))}
    </ul>
  )
}

function ProgressBar({ progress }: { progress: Progress }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : null
  return (
    <div className="mb-5 bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-500/30 rounded-xl px-4 py-3" role="status">
      <div className="flex items-center gap-2">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
        <p className="text-xs text-gray-600 dark:text-slate-300 flex-1">{progress.label}</p>
        {pct !== null && (
          <p className="text-xs tabular-nums text-gray-500 dark:text-slate-400">
            {progress.done.toLocaleString('pt-BR')} de {progress.total.toLocaleString('pt-BR')}
          </p>
        )}
      </div>
      {pct !== null && (
        <div className="mt-2 h-1.5 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
