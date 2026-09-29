import type { Category } from '../../types/proFrotas'

/** Cores de cada situação na tela: pílula da tabela, bolinha dos filtros e borda do card */
export const CATEGORY_STYLE: Record<Category, { pill: string; dot: string; card: string }> = {
  identical: {
    pill: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
    dot: 'bg-emerald-500',
    card: 'border-emerald-200 dark:border-emerald-500/30',
  },
  divergentGroup: {
    pill: 'bg-orange-100 dark:bg-orange-500/20 text-orange-900 dark:text-orange-200 border-orange-300 dark:border-orange-500/40',
    dot: 'bg-orange-500',
    card: 'border-orange-300 dark:border-orange-500/40',
  },
  divergent: {
    pill: 'bg-amber-100 dark:bg-amber-500/20 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-500/40',
    dot: 'bg-amber-500',
    card: 'border-amber-300 dark:border-amber-500/40',
  },
  cancelled: {
    pill: 'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-900 dark:text-fuchsia-200 border-fuchsia-300 dark:border-fuchsia-500/40',
    dot: 'bg-fuchsia-500',
    card: 'border-fuchsia-300 dark:border-fuchsia-500/40',
  },
  notFound: {
    pill: 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 border-red-300 dark:border-red-500/40',
    dot: 'bg-red-500',
    card: 'border-red-300 dark:border-red-500/40',
  },
  disregarded: {
    pill: 'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-500/40',
    dot: 'bg-slate-500',
    card: 'border-slate-300 dark:border-slate-500/40',
  },
}
