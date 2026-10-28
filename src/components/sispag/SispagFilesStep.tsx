import DropZone from '../bank/DropZone'
import { formatMoney, formatPeriod } from '../../core/bankReconciliation/money'
import { accountDigits } from '../../core/sispag/classify'
import { commonPeriod } from '../../core/sispag/matcher'
import type { ItauStatement, SispagReport } from '../../types/sispag'

interface SispagFilesStepProps {
  statement: ItauStatement | null
  report: SispagReport | null
  loading: string | null
  statementError: string | null
  reportError: string | null
  reconcileError: string | null
  onStatementFile: (file: File) => void
  onReportFile: (file: File) => void
  onRemoveStatement: () => void
  onRemoveReport: () => void
  onReconcile: () => void
  onShowResult?: () => void
}

const card = 'bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-5 mb-5'

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0)
}

function present(values: (string | null | false | undefined)[]): string[] {
  return values.filter((v): v is string => Boolean(v))
}

export default function SispagFilesStep(props: SispagFilesStepProps) {
  const { statement, report, loading } = props
  const period = statement && report ? commonPeriod(statement, report) : null

  const blockers: string[] = []
  if (loading) blockers.push('Aguarde a leitura dos arquivos.')
  if (!statement) blockers.push('Envie o extrato do Itaú.')
  if (!report) blockers.push('Envie o relatório SISPAG.')
  if (statement && report && !period) blockers.push('O extrato e o relatório não têm nenhum dia em comum.')

  const notices: string[] = []
  if (statement && report) {
    const a = accountDigits(statement.account)
    const b = accountDigits(report.account)
    if (a && b && a !== b) notices.push(`A conta do extrato (${statement.account}) é diferente da do relatório (${report.account}).`)
    const periods = [statement.period, report.period]
    if (period && periods.some((p) => p && (p.start !== period.start || p.end !== period.end))) {
      notices.push(`Os períodos não são iguais: só ${formatPeriod(period)} entra na conferência.`)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Conferência SISPAG</h2>
        <p className="mt-1 text-gray-500 dark:text-slate-400 text-sm">
          Extrato do Itaú × relatório de pagamentos do SISPAG, dia a dia. Tudo é lido aqui no navegador: os arquivos não saem do computador.
        </p>
      </div>

      {/* ── Extrato ──────────────────────────────────────────────────────── */}
      <section className={card}>
        <StepTitle n={1} title="Extrato do Itaú" />
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
          O "extrato mensal" em PDF (Conta Corrente | Movimentação), os "Lançamentos do período" do Itaú Empresas em PDF ou Excel — consolidado ou
          detalhado — ou o OFX. Entram na conferência as linhas do SISPAG — "Sispag Fornecedores", "Sispag Fornecedores TED", "Sispag Tributos",
          "Pagamentos a fornecedores" — e as devoluções e estornos ("Dev TED", "Est Sispag").
        </p>
        {statement ? (
          <StatementSummary statement={statement} onRemove={props.onRemoveStatement} />
        ) : (
          <DropZone accept=".pdf,.ofx,.xls,.xlsx" hint=".pdf / .ofx / .xlsx · até 30 MB" onFiles={(files) => props.onStatementFile(files[0])} />
        )}
        <ErrorText error={props.statementError} />
      </section>

      {/* ── Relatório SISPAG ─────────────────────────────────────────────── */}
      <section className={card}>
        <StepTitle n={2} title="Relatório SISPAG" />
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
          A "Consulta de pagamentos" do SISPAG exportada em Excel, com todos os status do período: o não efetuado explica as devoluções do extrato.
        </p>
        {report ? (
          <ReportSummary report={report} onRemove={props.onRemoveReport} />
        ) : (
          <DropZone accept=".xls,.xlsx" hint=".xls / .xlsx · até 30 MB" onFiles={(files) => props.onReportFile(files[0])} />
        )}
        <ErrorText error={props.reportError} />
      </section>

      {loading && (
        <div className="mb-5 bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-500/30 rounded-xl px-4 py-3 flex items-center gap-2" role="status">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
          <p className="text-xs text-gray-600 dark:text-slate-300">{loading}</p>
        </div>
      )}

      {/* ── Ação ─────────────────────────────────────────────────────────── */}
      <section className={card}>
        {notices.map((n) => (
          <p key={n} className="mb-3 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
            {n}
          </p>
        ))}
        <ErrorText error={props.reconcileError} />
        <p className="text-xs text-gray-400 dark:text-slate-500">
          Cada débito do SISPAG no extrato é procurado entre os pagamentos do mesmo dia: pelo valor, pelo lote (o Itaú soma TEDs, créditos em conta e tributos numa
          linha só) e pelo total do dia. Pagamento agendado para fim de semana ou feriado vale no próximo dia com movimento.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
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
            onClick={props.onReconcile}
            className="px-7 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            Conferir →
          </button>
        </div>
      </section>
    </div>
  )
}

function StatementSummary({ statement, onRemove }: { statement: ItauStatement; onRemove: () => void }) {
  const payments = statement.movements.filter((m) => m.kind === 'payment')
  const returns = statement.movements.filter((m) => m.kind === 'return' || m.kind === 'reversal')
  const facts = present([
    statement.account && `Conta ${statement.account}`,
    statement.period && formatPeriod(statement.period),
    `${statement.movements.length.toLocaleString('pt-BR')} lançamentos lidos`,
  ])
  return (
    <FileBox name={statement.fileName} badge={statement.source.toUpperCase()} facts={facts} warnings={statement.warnings} onRemove={onRemove}>
      <Figure label="Débitos do SISPAG" count={payments.length} value={sum(payments.map((m) => -m.amount))} />
      <Figure label="Devoluções e estornos" count={returns.length} value={sum(returns.map((m) => m.amount))} />
    </FileBox>
  )
}

function ReportSummary({ report, onRemove }: { report: SispagReport; onRemove: () => void }) {
  const done = report.payments.filter((p) => p.done)
  const notDone = report.payments.filter((p) => !p.done)
  const facts = present([
    [report.company, report.cnpj].filter(Boolean).join(' · '),
    report.account && `Conta ${report.account}`,
    report.period && formatPeriod(report.period),
    report.modality && `Modalidade: ${report.modality}`,
  ])
  return (
    <FileBox name={report.fileName} badge="SISPAG" facts={facts} warnings={report.warnings} onRemove={onRemove}>
      <Figure label="Efetuados" count={done.length} value={sum(done.map((p) => p.amount))} />
      <Figure label="Não efetuados" count={notDone.length} value={sum(notDone.map((p) => p.amount))} />
    </FileBox>
  )
}

function FileBox(props: { name: string; badge: string; facts: string[]; warnings: string[]; onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="border border-gray-100 dark:border-slate-800 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-slate-200">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300">{props.badge}</span>
            <span className="truncate">{props.name}</span>
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{props.facts.join(' · ')}</p>
        </div>
        <button onClick={props.onRemove} className="text-xs text-gray-400 dark:text-slate-500 underline hover:text-red-600 dark:hover:text-red-400">
          Trocar arquivo
        </button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{props.children}</div>
      {props.warnings.map((w) => (
        <p key={w} className="mt-3 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">
          {w}
        </p>
      ))}
    </div>
  )
}

function Figure({ label, count, value }: { label: string; count: number; value: number }) {
  return (
    <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg px-3 py-2">
      <p className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm tabular-nums text-gray-900 dark:text-slate-100">
        <span className="font-bold">{count.toLocaleString('pt-BR')}</span> · {formatMoney(value)}
      </p>
    </div>
  )
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400">{n}</span>
      <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">{title}</h3>
    </div>
  )
}

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p className="mt-3 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2" role="alert">
      {error}
    </p>
  )
}
