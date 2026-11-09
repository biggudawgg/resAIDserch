import { cx } from '../../lib/cx'

/** The logo is the name: serif "res·serch" with "AID" marked like a highlighter pass over a printed paper. */
export function Wordmark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={cx('wordmark', className)} style={{ fontSize: size }} aria-label="resAIDserch" role="img">
      <span aria-hidden>res</span>
      <span className="wordmark-mark" aria-hidden>
        AID
      </span>
      <span aria-hidden>serch</span>
    </span>
  )
}
