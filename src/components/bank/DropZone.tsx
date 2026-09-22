import { useRef, useState } from 'react'

interface DropZoneProps {
  accept: string
  hint: string
  multiple?: boolean
  onFiles: (files: File[]) => void
}

export default function DropZone({ accept, hint, multiple = false, onFiles }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={[
        'rounded-xl border-2 border-dashed px-4 py-6 flex flex-col items-center text-center transition-colors',
        dragOver ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10' : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-500',
      ].join(' ')}
    >
      <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-3">
        <svg className="w-5 h-5 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      </div>
      <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">Arraste {multiple ? 'os arquivos' : 'o arquivo'} aqui ou</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="px-4 py-1.5 text-xs font-semibold text-white rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors"
      >
        Selecionar {multiple ? 'arquivos' : 'arquivo'}
      </button>
      <p className="mt-2 text-xs text-gray-400 dark:text-slate-500">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </div>
  )
}
