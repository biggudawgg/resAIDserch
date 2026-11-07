import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

export interface Crumb {
  label: string
  to?: string
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  breadcrumb?: Crumb[]
}) {
  return (
    <div className="page-header">
      {breadcrumb && (
        <nav className="breadcrumb" aria-label="Breadcrumb">
          {breadcrumb.map((crumb, index) => (
            <Fragment key={crumb.label}>
              {index > 0 && <ChevronRight aria-hidden />}
              {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
            </Fragment>
          ))}
        </nav>
      )}
      <div className="page-header-row">
        <div className="page-heading">
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-desc">{description}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </div>
  )
}
