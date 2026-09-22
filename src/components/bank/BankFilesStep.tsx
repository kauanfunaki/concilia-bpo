import DropZone from './DropZone'
import StatementItem from './StatementItem'
import type { StatementFile } from './BankReconciliation'
import { formatMoney, formatPeriod } from '../../core/bankReconciliation/money'
import type { Period, SystemAccount, SystemReport } from '../../types/bankReconciliation'

interface BankFilesStepProps {
  system: SystemReport | null
  systemLoading: boolean
  systemError: string | null
  period: Period | null
  statements: StatementFile[]
  accounts: SystemAccount[]
  statementLoading: boolean
  statementErrors: string[]
  hasEditedResults: boolean
  fallbackYear: number
  onSystemFile: (file: File) => void
  onStatementFiles: (files: File[]) => void
  onUpdateStatement: (id: string, patch: Partial<StatementFile>) => void
  onRemoveStatement: (id: string) => void
  onAddCustomAccount: (statementId: string, name: string) => void
  onPeriod: (period: Period) => void
  onReconcile: () => void
  onShowResults?: () => void
}

export default function BankFilesStep(props: BankFilesStepProps) {
  const { system, period, statements } = props

  const blockers: string[] = []
  if (!system) blockers.push('Envie o relatório do sistema.')
  if (statements.length === 0) blockers.push('Envie ao menos um extrato.')
  if (statements.some((s) => !s.accountKey)) blockers.push('Escolha a conta de cada extrato.')
  if (statements.some((s) => s.statement.source === 'pdf' && !s.reviewed)) {
    blockers.push('Confira as linhas lidas dos PDFs e marque "Conferi as linhas".')
  }
  if (period && period.start > period.end) blockers.push('A data inicial do período é depois da final.')
  if (props.statementLoading) blockers.push('Aguarde a leitura dos extratos.')

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Conciliação bancária</h2>
        <p className="mt-1 text-gray-500 dark:text-slate-400 text-sm">
          Relatório de caixa do sistema do cliente × extratos dos bancos, com o relatório no modelo da planilha de conciliação.
        </p>
      </div>

      {/* ── Relatório do sistema ───────────────────────────────────────────── */}
      <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-5 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400">1</span>
          <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">Relatório do sistema (Atua)</h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">"Rel. Caixa Financeiro" exportado do Atua, com todas as contas do dia.</p>

        {props.systemLoading ? (
          <Spinner label="Lendo relatório..." />
        ) : system ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-slate-200">{system.fileName}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {system.accounts.length} conta(s)
                  {system.period && ` · ${formatPeriod(system.period)}`}
                </p>
              </div>
              <label className="text-xs text-gray-400 dark:text-slate-500 underline hover:text-gray-600 dark:hover:text-slate-300 cursor-pointer">
                Trocar arquivo
                <input
                  type="file"
                  accept=".xls,.xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) props.onSystemFile(file)
                  }}
                />
              </label>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-800">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-800/50 text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                    <th className="px-3 py-2 text-left font-semibold">Conta</th>
                    <th className="px-3 py-2 text-right font-semibold">Lançamentos</th>
                    <th className="px-3 py-2 text-right font-semibold">Saldo inicial</th>
                    <th className="px-3 py-2 text-right font-semibold">Saldo final</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {system.accounts.map((a) => (
                    <tr key={a.key}>
                      <td className="px-3 py-2 text-gray-800 dark:text-slate-200">{a.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-400">{a.entries.length}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-400">{fmt(a.openingBalance)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-400">{fmt(a.closingBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <DropZone accept=".xls,.xlsx" hint=".xls / .xlsx · até 20 MB" onFiles={(files) => props.onSystemFile(files[0])} />
        )}

        {props.systemError && (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2" role="alert">
            {props.systemError}
          </p>
        )}
      </section>

      {/* ── Extratos ──────────────────────────────────────────────────────── */}
      <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-5 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400">2</span>
          <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">Extratos bancários</h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
          Um arquivo por conta. <strong className="text-gray-700 dark:text-slate-300">Prefira sempre o extrato em Excel (.xlsx ou .xls).</strong>
        </p>

        <div className="mb-4 flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-xs text-amber-900 dark:text-amber-200">
          <span className="flex-shrink-0 mt-0.5">⚠</span>
          <span>
            <strong>PDF só quando o banco não oferecer planilha.</strong> PDF não tem colunas de verdade: a leitura é
            aproximada e pode trazer inconsistências — valor ou sinal trocado, descrição cortada, linha faltando ou
            sobrando. As linhas lidas de um PDF precisam ser conferidas antes de conciliar.
          </span>
        </div>

        <DropZone accept=".xls,.xlsx,.pdf" hint=".xlsx / .xls (recomendado) ou .pdf · até 20 MB" multiple onFiles={props.onStatementFiles} />

        {props.statementLoading && <Spinner label="Lendo extrato..." />}
        {props.statementErrors.map((error) => (
          <p key={error} className="mt-3 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2" role="alert">
            {error}
          </p>
        ))}

        <div className="mt-4 space-y-3">
          {statements.map((file) => (
            <StatementItem
              key={file.id}
              file={file}
              accounts={props.accounts}
              period={period}
              fallbackYear={props.fallbackYear}
              onUpdate={(patch) => props.onUpdateStatement(file.id, patch)}
              onRemove={() => props.onRemoveStatement(file.id)}
              onAddCustomAccount={(name) => props.onAddCustomAccount(file.id, name)}
            />
          ))}
        </div>
      </section>

      {/* ── Período e ação ────────────────────────────────────────────────── */}
      <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-sm p-5 flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2 w-full">
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400">3</span>
          <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">Período da conciliação</h3>
        </div>
        <label className="text-xs text-gray-500 dark:text-slate-400">
          De
          <input
            type="date"
            value={period?.start ?? ''}
            disabled={!period}
            onChange={(e) => period && e.target.value && props.onPeriod({ ...period, start: e.target.value })}
            className="bg-white dark:bg-slate-900 mt-1 block px-3 py-1.5 text-sm text-gray-800 dark:text-slate-200 border border-gray-300 dark:border-slate-600 rounded-lg disabled:bg-gray-50 dark:disabled:bg-slate-800"
          />
        </label>
        <label className="text-xs text-gray-500 dark:text-slate-400">
          Até
          <input
            type="date"
            value={period?.end ?? ''}
            disabled={!period}
            onChange={(e) => period && e.target.value && props.onPeriod({ ...period, end: e.target.value })}
            className="bg-white dark:bg-slate-900 mt-1 block px-3 py-1.5 text-sm text-gray-800 dark:text-slate-200 border border-gray-300 dark:border-slate-600 rounded-lg disabled:bg-gray-50 dark:disabled:bg-slate-800"
          />
        </label>
        <p className="text-xs text-gray-400 dark:text-slate-500 flex-1 min-w-[200px]">
          Vem do relatório do sistema. Movimentos do extrato fora do período ficam de fora.
        </p>

        <div className="w-full flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">
          {blockers.length > 0 && <p className="text-xs text-gray-500 dark:text-slate-400 mr-auto">{blockers[0]}</p>}
          {props.hasEditedResults && (
            <p className="text-xs text-amber-700 dark:text-amber-300 mr-auto">Conciliar de novo refaz o casamento e descarta as alterações feitas à mão.</p>
          )}
          {props.onShowResults && (
            <button
              onClick={props.onShowResults}
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
            Conciliar →
          </button>
        </div>
      </section>
    </div>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-4 justify-center">
      <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent" />
      <p className="text-xs text-gray-500 dark:text-slate-400">{label}</p>
    </div>
  )
}

function fmt(value: number | null): string {
  return value === null ? '—' : formatMoney(value)
}
