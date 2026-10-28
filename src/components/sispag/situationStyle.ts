import type { Situation } from '../../types/sispag'

/** Cores de cada situação na tela: pílula da tabela, bolinha dos filtros e borda do card */
export const SITUATION_STYLE: Record<Situation, { pill: string; dot: string; card: string }> = {
  matched: {
    pill: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
    dot: 'bg-emerald-500',
    card: 'border-emerald-200 dark:border-emerald-500/30',
  },
  returned: {
    pill: 'bg-sky-50 dark:bg-sky-500/10 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-500/30',
    dot: 'bg-sky-500',
    card: 'border-sky-200 dark:border-sky-500/30',
  },
  returnedDone: {
    pill: 'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-900 dark:text-fuchsia-200 border-fuchsia-300 dark:border-fuchsia-500/40',
    dot: 'bg-fuchsia-500',
    card: 'border-fuchsia-300 dark:border-fuchsia-500/40',
  },
  statementOnly: {
    pill: 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 border-red-300 dark:border-red-500/40',
    dot: 'bg-red-500',
    card: 'border-red-300 dark:border-red-500/40',
  },
  reportOnly: {
    pill: 'bg-orange-100 dark:bg-orange-500/20 text-orange-900 dark:text-orange-200 border-orange-300 dark:border-orange-500/40',
    dot: 'bg-orange-500',
    card: 'border-orange-300 dark:border-orange-500/40',
  },
  returnUnmatched: {
    pill: 'bg-amber-100 dark:bg-amber-500/20 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-500/40',
    dot: 'bg-amber-500',
    card: 'border-amber-300 dark:border-amber-500/40',
  },
  otherModality: {
    pill: 'bg-violet-100 dark:bg-violet-500/20 text-violet-900 dark:text-violet-200 border-violet-300 dark:border-violet-500/40',
    dot: 'bg-violet-500',
    card: 'border-violet-300 dark:border-violet-500/40',
  },
  notDone: {
    pill: 'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-500/40',
    dot: 'bg-slate-400',
    card: 'border-slate-300 dark:border-slate-500/40',
  },
}
