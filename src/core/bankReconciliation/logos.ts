import btgLogoUrl from '../../assets/logo-btg.png'
import caixaLogoUrl from '../../assets/logo-caixa.png'
import inovatiLogoUrl from '../../assets/logo-inovati.png'
import qitechLogoUrl from '../../assets/logo-qitech.png'
import type { AccountResult, LogoId } from '../../types/bankReconciliation'
import type { LogoFiles } from './bankExporter'

// Logos com fundo transparente, tiradas de Conciliação_16.09.xlsx
const LOGO_URLS: Record<LogoId, string> = {
  inovati: inovatiLogoUrl,
  btg: btgLogoUrl,
  caixa: caixaLogoUrl,
  qitech: qitechLogoUrl,
}

/**
 * Baixa as logos que as abas exportadas usam. Logo que não carregar fica de fora:
 * a planilha sai sem ela em vez de não sair.
 */
export async function loadLogos(accounts: AccountResult[]): Promise<LogoFiles> {
  const ids = [...new Set(accounts.flatMap((a) => [a.profile.logo, a.profile.bankLogo]).filter((id): id is LogoId => id !== null))]
  const files: LogoFiles = {}
  await Promise.all(
    ids.map(async (id) => {
      try {
        const response = await fetch(LOGO_URLS[id])
        if (response.ok) files[id] = await response.arrayBuffer()
      } catch {
        /* sem a logo, a planilha sai igual */
      }
    })
  )
  return files
}
