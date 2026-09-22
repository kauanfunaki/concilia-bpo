import type { ReconciliationStatus } from '../types'

interface StatusBadgeProps {
  status: ReconciliationStatus
}

const CONFIG: Record<ReconciliationStatus, { label: string; className: string }> = {
  'De Acordo': {
    label: '✓ De Acordo',
    className: 'bg-green-100 dark:bg-green-500/20 text-green-800 dark:text-green-300 border border-green-300 dark:border-green-500/40',
  },
  'Valor Divergente': {
    label: '⚠ Valor Divergente',
    className: 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-500/40',
  },
  'Nota não encontrada': {
    label: '✗ Nota não encontrada',
    className: 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-500/40',
  },
}

/**
 * Badge colorido por status de conciliação.
 * Requisito 8.3
 */
export default function StatusBadge({ status }: StatusBadgeProps) {
  const { label, className } = CONFIG[status]
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}
