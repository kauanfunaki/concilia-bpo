import { useEffect } from 'react'
import { CATEGORY_STYLE } from './categoryStyle'
import { formatCnpj } from '../../core/proFrotas/cnpj'
import { formatSources } from '../../core/proFrotas/report'
import { formatDateBR, formatMoney } from '../../core/bankReconciliation/money'
import { CATEGORY_LABEL } from '../../types/proFrotas'
import type { ResultNote, ValidationResult } from '../../types/proFrotas'

interface NoteDetailProps {
  note: ResultNote
  result: ValidationResult
  onClose: () => void
}

/** A nota lida do XML, lado a lado com a planilha — é o que o DANFE em PDF fazia no app antigo */
export default function NoteDetail({ note, result, onClose }: NoteDetailProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { sheet, xml } = note
  const convertedFrom = result.settings.cnpjConversions?.find((c) => c.to === sheet.companyCnpj)?.from
  const members = sheet.groupId ? result.notes.filter((n) => n.sheet.groupId === sheet.groupId) : []
  const multipleFiles = new Set(result.notes.flatMap((n) => n.sheet.sources.map((s) => s.file))).size > 1

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Nota ${sheet.number}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl my-8 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl"
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">NF-e {sheet.number}</h3>
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium border rounded-md ${CATEGORY_STYLE[note.category].pill}`}>
                {CATEGORY_LABEL[note.category]}
              </span>
            </div>
            {note.note && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{note.note}</p>}
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-xl leading-none px-1">
            ×
          </button>
        </div>

        <div className="grid gap-5 md:grid-cols-2 p-5">
          <section>
            <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Planilha Pro Frotas</p>
            <dl className="text-sm space-y-1">
              <Row label="Posto" value={sheet.stationName || '—'} />
              <Row label="CNPJ do posto" value={formatCnpj(sheet.stationCnpj)} />
              <Row
                label="CNPJ da empresa"
                value={`${formatCnpj(sheet.companyCnpj)}${convertedFrom ? ` (na planilha: ${formatCnpj(convertedFrom)})` : ''}`}
              />
              <Row label="Abastecimento" value={sheet.fuelDate ? formatDateBR(sheet.fuelDate) : '—'} />
              <Row label="Série" value={sheet.series || '—'} />
              <Row label="Valor no boleto" value={formatMoney(note.sheetAmount)} strong />
              <Row label="Origem" value={formatSources(sheet.sources, multipleFiles)} />
            </dl>
          </section>

          <section>
            <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">XML da Receita</p>
            {xml ? (
              <dl className="text-sm space-y-1">
                <Row label="Emitente" value={xml.issuerName || '—'} />
                <Row label="CNPJ emitente" value={formatCnpj(xml.issuerCnpj)} />
                <Row label="Destinatário" value={`${xml.recipientName} · ${formatCnpj(xml.recipientCnpj)}`} />
                <Row label="Emissão" value={xml.issueDate ? formatDateBR(xml.issueDate) : '—'} />
                <Row label="Série" value={xml.series || '—'} />
                <Row label="Valor total" value={formatMoney(xml.amount)} strong />
                <Row label="Chave" value={<span className="font-mono text-[11px] break-all">{xml.key}</span>} />
              </dl>
            ) : (
              <p className="text-sm text-red-700 dark:text-red-400">Nenhum XML da Receita com este número para este posto.</p>
            )}
          </section>
        </div>

        {note.category === 'cancelled' && (
          <p className="mx-5 mb-4 text-sm font-semibold text-fuchsia-800 dark:text-fuchsia-200 bg-fuchsia-50 dark:bg-fuchsia-500/10 rounded-lg px-3 py-2">
            NF-e cancelada{note.cancelledAt ? ` em ${formatDateBR(note.cancelledAt)}` : ''}: o posto cancelou a nota, então ela não comprova esta cobrança.
          </p>
        )}

        {xml && xml.recipientCnpj !== result.settings.companyCnpj && (
          <p className="mx-5 mb-4 text-sm font-semibold text-sky-800 dark:text-sky-200 bg-sky-50 dark:bg-sky-500/10 rounded-lg px-3 py-2">
            Emitida para outro CNPJ: {xml.recipientName} · {formatCnpj(xml.recipientCnpj)}
          </p>
        )}

        {note.category !== 'cancelled' && note.difference !== null && note.difference !== 0 && (
          <p className="mx-5 mb-4 text-sm font-semibold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">
            Diferença (XML − planilha): {formatMoney(note.difference)}
          </p>
        )}

        {members.length > 1 && (
          <div className="px-5 pb-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Notas do mesmo lançamento</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 dark:text-slate-500">
                  <th className="text-left font-medium py-1">Nota</th>
                  <th className="text-left font-medium py-1">Situação</th>
                  <th className="text-right font-medium py-1">Planilha</th>
                  <th className="text-right font-medium py-1">XML</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {members.map((m) => (
                  <tr key={m.id} className={m.id === note.id ? 'font-semibold' : ''}>
                    <td className="py-1 tabular-nums text-gray-800 dark:text-slate-200">{m.sheet.number}</td>
                    <td className="py-1 text-xs text-gray-500 dark:text-slate-400">{CATEGORY_LABEL[m.category]}</td>
                    <td className="py-1 text-right tabular-nums text-gray-800 dark:text-slate-200">{formatMoney(m.sheetAmount)}</td>
                    <td className="py-1 text-right tabular-nums text-gray-800 dark:text-slate-200">{m.xmlAmount === null ? '—' : formatMoney(m.xmlAmount)}</td>
                  </tr>
                ))}
                <tr className="font-semibold border-t border-gray-200 dark:border-slate-700">
                  <td className="py-1 text-gray-800 dark:text-slate-200" colSpan={2}>Soma</td>
                  <td className="py-1 text-right tabular-nums text-gray-800 dark:text-slate-200">{formatMoney(members.reduce((s, m) => s + m.sheetAmount, 0))}</td>
                  <td className="py-1 text-right tabular-nums text-gray-800 dark:text-slate-200">{formatMoney(members.reduce((s, m) => s + (m.xmlAmount ?? 0), 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {xml && xml.items.length > 0 && (
          <div className="px-5 pb-5">
            <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Itens da nota</p>
            <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-800">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-800/50 text-xs text-gray-500 dark:text-slate-400">
                    <th className="px-3 py-1.5 text-left font-semibold">Produto</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Qtd</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Unitário</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {xml.items.map((item, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-gray-800 dark:text-slate-200">{item.description}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-slate-400 whitespace-nowrap">
                        {item.quantity === null ? '—' : `${item.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ${item.unit}`}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-slate-400 whitespace-nowrap">
                        {item.unitPrice === null ? '—' : item.unitPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 })}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-800 dark:text-slate-200 whitespace-nowrap">{item.total === null ? '—' : formatMoney(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 flex-shrink-0 text-gray-500 dark:text-slate-400">{label}</dt>
      <dd className={`min-w-0 ${strong ? 'font-semibold text-gray-900 dark:text-slate-100' : 'text-gray-800 dark:text-slate-200'}`}>{value}</dd>
    </div>
  )
}
