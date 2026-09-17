import { useState } from 'react'
import type { StatementFile } from './BankReconciliation'
import { formatDateBR, formatMoney, parseDate, parseMoney } from '../../core/bankReconciliation/money'
import { inPeriod, statementPeriodBalance, sumAmounts } from '../../core/bankReconciliation/statementBalance'
import { FIELD_LABELS, isMappingUsable, parseStatementRows } from '../../core/bankReconciliation/statementSheet'
import type { SheetLayout } from '../../core/bankReconciliation/statementSheet'
import { cellText } from '../../core/bankReconciliation/text'
import type { Period, StatementField, StatementMovement, SystemAccount } from '../../types/bankReconciliation'

const NEW_ACCOUNT = '__nova_conta__'

interface StatementItemProps {
  file: StatementFile
  accounts: SystemAccount[]
  period: Period | null
  fallbackYear: number
  onUpdate: (patch: Partial<StatementFile>) => void
  onRemove: () => void
  onAddCustomAccount: (name: string) => void
}

export default function StatementItem({ file, accounts, period, fallbackYear, onUpdate, onRemove, onAddCustomAccount }: StatementItemProps) {
  const { statement } = file
  const isPdf = statement.source === 'pdf'
  const [showLines, setShowLines] = useState(isPdf)
  const [showMapping, setShowMapping] = useState(!isPdf && !file.layout)
  const [newAccountName, setNewAccountName] = useState<string | null>(null)

  const periodMovements = period ? statement.movements.filter((m) => inPeriod(m.date, period)) : statement.movements
  const balance = period ? statementPeriodBalance(statement, period) : null
  const total = sumAmounts(periodMovements)
  const statementCloses =
    balance && balance.opening !== null && balance.closing !== null
      ? Math.abs(balance.opening + total - balance.closing) < 0.005
      : null

  function updateMovements(movements: StatementMovement[]) {
    onUpdate({ statement: { ...statement, movements }, reviewed: false })
  }

  function applyLayout(layout: SheetLayout) {
    if (!file.sheets) return
    const sheet = file.sheets.find((s) => s.sheetName === layout.sheetName) ?? file.sheets[0]
    const parsed = isMappingUsable(layout.mapping)
      ? parseStatementRows(sheet.rows, layout, fallbackYear)
      : { movements: [], balances: [], warnings: ['Indique ao menos a coluna de data e a de valor (ou crédito/débito).'] }
    onUpdate({ layout, statement: { ...statement, ...parsed } })
  }

  return (
    <div className={`rounded-xl border ${isPdf ? 'border-amber-200' : 'border-gray-200'} bg-white`}>
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
            isPdf ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
          }`}
        >
          {isPdf ? 'PDF' : 'XLS'}
        </div>
        <div className="flex-1 min-w-[180px]">
          <p className="text-sm font-semibold text-gray-800 truncate">{statement.fileName}</p>
          <p className="text-xs text-gray-500">
            {periodMovements.length} movimento(s) no período · {statement.movements.length} no arquivo
            {balance && (
              <>
                {' · '}saldo {fmt(balance.opening)} → {fmt(balance.closing)}
              </>
            )}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <select
            value={newAccountName !== null ? NEW_ACCOUNT : file.accountKey ?? ''}
            onChange={(e) => {
              if (e.target.value === NEW_ACCOUNT) {
                setNewAccountName('')
                return
              }
              setNewAccountName(null)
              onUpdate({ accountKey: e.target.value || null, accountChosenByUser: true, accountReason: '' })
            }}
            className={`px-3 py-1.5 text-sm border rounded-lg max-w-[280px] ${file.accountKey ? 'border-gray-300 text-gray-800' : 'border-red-300 text-red-700'}`}
          >
            <option value="">Conta no sistema…</option>
            {accounts.map((a) => (
              <option key={a.key} value={a.key}>
                {a.name}
              </option>
            ))}
            <option value={NEW_ACCOUNT}>+ Outra conta (sem lançamentos no sistema)</option>
          </select>
          {file.accountReason && <span className="text-[11px] text-gray-400">{file.accountReason}</span>}
          {newAccountName !== null && (
            <div className="flex gap-1">
              <input
                autoFocus
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="Nome da conta"
                className="px-2 py-1 text-xs border border-gray-300 rounded-md"
              />
              <button
                disabled={!newAccountName.trim()}
                onClick={() => {
                  onAddCustomAccount(newAccountName)
                  setNewAccountName(null)
                }}
                className="px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded-md disabled:opacity-40"
              >
                Criar
              </button>
            </div>
          )}
        </div>

        <button onClick={onRemove} title="Remover extrato" className="px-2 py-1 text-xs text-gray-400 hover:text-red-500 rounded-md hover:bg-red-50">
          ✕
        </button>
      </div>

      {/* Avisos e conferência do extrato */}
      <div className="px-4 pb-3 space-y-2">
        {isPdf && (
          <p className="text-xs text-amber-900 bg-amber-50 rounded-lg px-3 py-2">
            ⚠ Extrato lido de PDF: pode haver inconsistências de valor, sinal ou descrição. Confira as linhas abaixo com o PDF aberto.
          </p>
        )}
        {statement.warnings.map((w) => (
          <p key={w} className="text-xs text-amber-800">
            ⚠ {w}
          </p>
        ))}
        {statementCloses !== null && (
          <p className={`text-xs ${statementCloses ? 'text-emerald-700' : 'text-red-700 font-semibold'}`}>
            {statementCloses
              ? `✓ Saldo inicial + movimentos do período = saldo final (${formatMoney(total)})`
              : `✗ Saldo inicial + movimentos (${formatMoney(total)}) não chega no saldo final — falta ou sobra linha, ou há valor/sinal trocado`}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button onClick={() => setShowLines((v) => !v)} className="text-xs font-medium text-blue-700 hover:underline">
            {showLines ? 'Ocultar linhas lidas' : `Ver linhas lidas (${periodMovements.length})`}
          </button>
          {file.sheets && (
            <button onClick={() => setShowMapping((v) => !v)} className="text-xs font-medium text-blue-700 hover:underline">
              {showMapping ? 'Ocultar colunas' : 'Ajustar colunas'}
            </button>
          )}
        </div>
      </div>

      {showMapping && file.sheets && (
        <ColumnMappingEditor file={file} onApply={applyLayout} />
      )}

      {showLines && (
        <MovementsTable
          movements={statement.movements}
          period={period}
          editable={isPdf}
          fallbackYear={fallbackYear}
          onChange={updateMovements}
        />
      )}

      {isPdf && (
        <label className="flex items-center gap-2 px-4 py-3 border-t border-amber-100 bg-amber-50/60 rounded-b-xl text-xs font-medium text-amber-900 cursor-pointer">
          <input type="checkbox" checked={file.reviewed} onChange={(e) => onUpdate({ reviewed: e.target.checked })} />
          Conferi as linhas lidas do PDF com o extrato original
        </label>
      )}
    </div>
  )
}

// ── Mapeamento de colunas (planilha) ─────────────────────────────────────────

const MAPPABLE_FIELDS: StatementField[] = ['date', 'description', 'counterparty', 'document', 'amount', 'credit', 'debit', 'direction', 'balance']

function ColumnMappingEditor({ file, onApply }: { file: StatementFile; onApply: (layout: SheetLayout) => void }) {
  const sheets = file.sheets ?? []
  const layout: SheetLayout = file.layout ?? { sheetName: sheets[0]?.sheetName ?? '', headerRow: 0, mapping: {} }
  const sheet = sheets.find((s) => s.sheetName === layout.sheetName) ?? sheets[0]
  if (!sheet) return null

  const width = Math.max(0, ...sheet.rows.slice(0, 50).map((r) => r.length))
  const headerCells = layout.headerRow >= 0 ? sheet.rows[layout.headerRow] ?? [] : []
  const columnLabel = (i: number) => {
    const letter = columnLetter(i)
    const title = cellText(headerCells[i])
    return title ? `${letter} · ${title}` : letter
  }

  return (
    <div className="mx-4 mb-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
      <div className="flex flex-wrap gap-3 mb-3">
        {sheets.length > 1 && (
          <label className="text-xs text-gray-500">
            Aba
            <select
              value={sheet.sheetName}
              onChange={(e) => onApply({ ...layout, sheetName: e.target.value })}
              className="mt-1 block px-2 py-1 text-xs border border-gray-300 rounded-md bg-white"
            >
              {sheets.map((s) => (
                <option key={s.sheetName}>{s.sheetName}</option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs text-gray-500">
          Linha do cabeçalho
          <input
            type="number"
            min={0}
            value={layout.headerRow + 1}
            onChange={(e) => onApply({ ...layout, headerRow: Math.max(-1, Number(e.target.value) - 1) })}
            className="mt-1 block w-24 px-2 py-1 text-xs border border-gray-300 rounded-md bg-white"
          />
        </label>
        <p className="text-[11px] text-gray-400 self-end">0 = planilha sem cabeçalho</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {MAPPABLE_FIELDS.map((field) => (
          <label key={field} className="text-xs text-gray-500">
            {FIELD_LABELS[field]}
            <select
              value={layout.mapping[field] ?? ''}
              onChange={(e) => {
                const mapping = { ...layout.mapping }
                if (e.target.value === '') delete mapping[field]
                else mapping[field] = Number(e.target.value)
                onApply({ ...layout, mapping })
              }}
              className="mt-1 block w-full px-2 py-1 text-xs border border-gray-300 rounded-md bg-white"
            >
              <option value="">—</option>
              {Array.from({ length: width }, (_, i) => (
                <option key={i} value={i}>
                  {columnLabel(i)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        Use "Valor (com sinal)" quando o banco traz uma coluna só; "Crédito" e "Débito" quando traz duas.
      </p>
    </div>
  )
}

function columnLetter(index: number): string {
  let n = index + 1
  let letters = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

// ── Linhas lidas ─────────────────────────────────────────────────────────────

interface MovementsTableProps {
  movements: StatementMovement[]
  period: Period | null
  editable: boolean
  fallbackYear: number
  onChange: (movements: StatementMovement[]) => void
}

function MovementsTable({ movements, period, editable, fallbackYear, onChange }: MovementsTableProps) {
  const visible = period ? movements.filter((m) => inPeriod(m.date, period)) : movements

  function patch(id: string, change: Partial<StatementMovement>) {
    onChange(movements.map((m) => (m.id === id ? { ...m, ...change } : m)))
  }

  function addLine() {
    const last = visible[visible.length - 1]
    const order = Math.max(-1, ...movements.map((m) => m.order)) + 1
    onChange([
      ...movements,
      {
        id: `manual-${Date.now()}`,
        order,
        date: last?.date ?? period?.start ?? '',
        description: '',
        counterparty: '',
        document: '',
        amount: 0,
        balance: null,
      },
    ])
  }

  return (
    <div className="mx-4 mb-3 overflow-x-auto rounded-lg border border-gray-100">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
            <th className="px-3 py-2 text-left font-semibold">Data</th>
            <th className="px-3 py-2 text-left font-semibold">Histórico</th>
            <th className="px-3 py-2 text-right font-semibold">Valor</th>
            <th className="px-3 py-2 text-right font-semibold">Saldo</th>
            {editable && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {visible.length === 0 && (
            <tr>
              <td colSpan={editable ? 5 : 4} className="px-3 py-4 text-center text-gray-400">
                Nenhum movimento no período.
              </td>
            </tr>
          )}
          {visible.map((m) => (
            <tr key={m.id} className={m.amount === 0 ? 'bg-red-50' : ''}>
              <td className="px-3 py-1.5 whitespace-nowrap">
                {editable ? (
                  <input
                    defaultValue={formatDateBR(m.date)}
                    onBlur={(e) => {
                      const date = parseDate(e.target.value, fallbackYear)
                      if (date) patch(m.id, { date })
                      else e.target.value = formatDateBR(m.date)
                    }}
                    className="w-24 px-1.5 py-0.5 border border-gray-200 rounded"
                  />
                ) : (
                  formatDateBR(m.date)
                )}
              </td>
              <td className="px-3 py-1.5 text-gray-700">
                {editable ? (
                  <input
                    defaultValue={m.description}
                    onBlur={(e) => e.target.value !== m.description && patch(m.id, { description: e.target.value })}
                    className="w-full min-w-[260px] px-1.5 py-0.5 border border-gray-200 rounded"
                  />
                ) : (
                  [m.description, m.counterparty].filter(Boolean).join(' · ')
                )}
              </td>
              <td className={`px-3 py-1.5 text-right tabular-nums ${m.amount < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                {editable ? (
                  <input
                    defaultValue={m.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    onBlur={(e) => {
                      const amount = parseMoney(e.target.value)
                      if (amount !== null) patch(m.id, { amount })
                      else e.target.value = m.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
                    }}
                    className="w-28 px-1.5 py-0.5 border border-gray-200 rounded text-right"
                  />
                ) : (
                  formatMoney(m.amount)
                )}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{fmt(m.balance)}</td>
              {editable && (
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={() => onChange(movements.filter((x) => x.id !== m.id))}
                    title="Excluir linha"
                    className="text-gray-400 hover:text-red-500"
                  >
                    ✕
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <div className="px-3 py-2 bg-gray-50 flex items-center justify-between">
          <button onClick={addLine} className="text-xs font-medium text-blue-700 hover:underline">
            + Incluir linha que faltou
          </button>
          <span className="text-[11px] text-gray-400">Valor negativo = saída. Linha com valor zero é ignorada.</span>
        </div>
      )}
    </div>
  )
}

function fmt(value: number | null): string {
  return value === null ? '—' : formatMoney(value)
}
