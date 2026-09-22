import type { AppStep } from '../types'

const STEPS = [
  { label: 'Upload' },
  { label: 'Configuração' },
  { label: 'Relatório' },
]

const STEP_ORDER: Record<AppStep, number> = {
  upload: 0,
  config: 1,
  processing: 2,
  report: 2,
}

export default function Stepper({ step }: { step: AppStep }) {
  const current = STEP_ORDER[step]

  return (
    <div className="flex items-start justify-center mb-10">
      {STEPS.map((s, i) => {
        const done = current > i
        const active = current === i

        return (
          <div key={i} className="flex items-start">
            <div className="flex flex-col items-center">
              <div
                className={[
                  'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-200',
                  done ? 'bg-blue-600 text-white' :
                  active ? 'bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-500/30' :
                  'bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500',
                ].join(' ')}
              >
                {done ? '✓' : i + 1}
              </div>
              <span className={[
                'mt-2 text-xs font-semibold',
                done || active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-slate-500',
              ].join(' ')}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={[
                'w-28 h-0.5 mt-4 mx-1 transition-colors duration-200',
                current > i ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-700',
              ].join(' ')} />
            )}
          </div>
        )
      })}
    </div>
  )
}
