import { useCallback, useState } from 'react'
import type { AccountProfile } from '../types/bankReconciliation'

const STORAGE_KEY = 'conciliador-bpo:perfis-conciliacao-bancaria'

type SavedProfiles = Record<string, Partial<AccountProfile>>

function readProfiles(): SavedProfiles {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedProfiles) : {}
  } catch {
    return {}
  }
}

/**
 * Nome da aba, empresa e rótulos editados por conta, lembrados neste navegador.
 * Sem armazenamento disponível, a edição vale só para a sessão.
 */
export function useSavedProfiles() {
  const [profiles, setProfiles] = useState<SavedProfiles>(readProfiles)

  const saveProfile = useCallback((accountKey: string, patch: Partial<AccountProfile>) => {
    setProfiles((prev) => {
      const next = { ...prev, [accountKey]: { ...prev[accountKey], ...patch } }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* navegador sem armazenamento: segue só na memória */
      }
      return next
    })
  }, [])

  return { profiles, saveProfile }
}
