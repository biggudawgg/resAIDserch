import type { ProviderId } from '../../api/types'
import { cx } from '../../lib/cx'
import { formatUsd, pct, plural } from '../../lib/format'
import { providerLabel } from '../../lib/providers'
import { ProviderDot } from '../ui/ProviderChip'

interface Item {
  provider: ProviderId
  costUsd: number
  calls: number
}

/** Thin segmented bar (no text) above rows that carry each provider's name, amount and share. */
export function SpendBreakdown({ items }: { items: Item[] }) {
  const rows = items.filter((item) => item.calls > 0 || item.provider !== 'custom')
  const total = rows.reduce((sum, item) => sum + item.costUsd, 0)
  const paid = rows.filter((item) => item.costUsd > 0)
  const summary = total > 0 ? paid.map((i) => `${providerLabel(i.provider)} ${formatUsd(i.costUsd)}`).join(', ') : 'No spend yet'
  return (
    <div className="spend">
      <div className="segbar" role="img" aria-label={`Spend split: ${summary}`}>
        {total > 0 ? (
          paid.map((item) => (
            <span
              key={item.provider}
              className={cx('segbar-part', `bg-${item.provider}`)}
              style={{ flexGrow: item.costUsd }}
              title={`${providerLabel(item.provider)}: ${formatUsd(item.costUsd)} (${pct(item.costUsd / total)})`}
            />
          ))
        ) : (
          <span className="segbar-empty" />
        )}
      </div>
      <ul className="spend-rows">
        {rows.map((item) => (
          <li key={item.provider} className="spend-row">
            <ProviderDot provider={item.provider} />
            <span className="spend-name">{providerLabel(item.provider)}</span>
            <span className="spend-calls">{plural(item.calls, 'call')}</span>
            <span className="spend-cost">{formatUsd(item.costUsd)}</span>
            <span className="spend-share">{total > 0 ? pct(item.costUsd / total) : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
