import { useEffect } from 'react'
import { SITUATION_STYLE } from './situationStyle'
import { formatDateBR, formatMoney } from '../../core/bankReconciliation/money'
import { itemMovements, itemPayments } from '../../core/sispag/view'
import type { ResultIndex } from '../../core/sispag/view'
import { RULE_LABEL, SITUATION_LABEL } from '../../types/sispag'
import type { ResultItem } from '../../types/sispag'

interface ItemDetailProps {
  item: ResultItem
  index: ResultIndex
  onClose: () => void
}

// Lote grande (centenas de TEDs numa linha): a lista rola dentro do quadro
const MAX_ROWS = 500

/** As linhas do extrato e os pagamentos do SISPAG que formam o item, lado a lado com as somas */
export default function ItemDetail({ item, index, onClose }: ItemDetailProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const movements = itemMovements(item, index)
  const payments = [...itemPayments(item, index)].sort((a, b) => b.amount - a.amount)
  const difference = Math.round((item.statementAmount - item.reportAmount) * 100) / 100
  const showDifference = movements.length > 0 && payments.length > 0 && difference !== 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={SITUATION_LABEL[item.situation]}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl my-8 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl"
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">{formatDateBR(item.date)}</h3>
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium border rounded-md ${SITUATION_STYLE[item.situation].pill}`}>
                {SITUATION_LABEL[item.situation]}
              </span>
              {item.rule !== 'none' && <span className="text-xs text-gray-500 dark:text-slate-400">regra: {RULE_LABEL[item.rule]}</span>}
            </div>
            {item.note && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{item.note}</p>}
            {item.hint && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{item.hint}</p>}
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-xl leading-none px-1">
            ×
          </button>
        </div>

        <div className="p-5 space-y-5">
          <section>
            <SectionTitle title="Extrato do Itaú" count={movements.length} total={item.statementAmount} />
            {movements.length === 0 ? (
              <p className="text-sm text-red-700 dark:text-red-400">Nenhuma linha do extrato.</p>
            ) : (
              <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-100 dark:border-slate-800">
                <table className="min-w-full text-sm">
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-gray-600 dark:text-slate-400">{formatDateBR(m.date)}</td>
                        <td className="px-3 py-1.5 text-gray-800 dark:text-slate-200">{m.description}</td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums text-gray-900 dark:text-slate-100">{formatMoney(Math.abs(m.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <SectionTitle title="Relatório SISPAG" count={payments.length} total={item.reportAmount} />
            {payments.length === 0 ? (
              <p className="text-sm text-red-700 dark:text-red-400">Nenhum pagamento do relatório.</p>
            ) : (
              <div className="max-h-96 overflow-auto rounded-lg border border-gray-100 dark:border-slate-800">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-slate-800">
                    <tr className="text-xs text-gray-500 dark:text-slate-400">
                      <th className="px-3 py-1.5 text-right font-semibold">Linha</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Data</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Favorecido</th>
                      <th className="px-3 py-1.5 text-left font-semibold">CPF/CNPJ</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Tipo</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Status</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {payments.slice(0, MAX_ROWS).map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-400 dark:text-slate-500">{p.row}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-gray-600 dark:text-slate-400">{formatDateBR(p.date)}</td>
                        <td className="px-3 py-1.5 text-gray-800 dark:text-slate-200">{p.payee || '—'}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-gray-600 dark:text-slate-400">{p.document || '—'}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-gray-600 dark:text-slate-400">{p.type || '—'}</td>
                        <td className={`px-3 py-1.5 whitespace-nowrap text-xs ${p.done ? 'text-gray-500 dark:text-slate-400' : 'font-semibold text-slate-700 dark:text-slate-300'}`}>
                          {p.status || '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums text-gray-900 dark:text-slate-100">{formatMoney(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {payments.length > MAX_ROWS && (
                  <p className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 border-t border-gray-100 dark:border-slate-800">
                    Mostrando os {MAX_ROWS} maiores de {payments.length.toLocaleString('pt-BR')}. A lista inteira está na planilha.
                  </p>
                )}
              </div>
            )}
          </section>

          {showDifference && (
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">
              Diferença (extrato − SISPAG): {formatMoney(difference)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ title, count, total }: { title: string; count: number; total: number }) {
  return (
    <p className="flex items-baseline justify-between gap-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">
      <span>
        {title} · {count.toLocaleString('pt-BR')}
      </span>
      <span className="tabular-nums normal-case text-sm text-gray-900 dark:text-slate-100">{formatMoney(total)}</span>
    </p>
  )
}
