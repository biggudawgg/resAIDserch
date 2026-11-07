import { cx } from '../../lib/cx'
import { providerLabel } from '../../lib/providers'

export function ProviderDot({ provider }: { provider: string }) {
  return <span className={cx('pdot', `pdot-${provider}`)} aria-hidden />
}

export function ProviderChip({ provider, model }: { provider: string | null; model?: string | null }) {
  if (!provider) return <span className="pchip pchip-muted">—</span>
  return (
    <span className="pchip">
      <ProviderDot provider={provider} />
      {providerLabel(provider)}
      {model && <span className="pchip-model">{model}</span>}
    </span>
  )
}
