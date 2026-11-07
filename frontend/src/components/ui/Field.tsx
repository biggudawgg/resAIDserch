import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from '../../lib/cx'

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
}: {
  label: ReactNode
  htmlFor: string
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  children: ReactNode
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {optional && <span className="field-optional">Optional</span>}
      </label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx('input', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx('input textarea', className)} {...rest} />
})

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cx('select-wrap', className)}>
      <select className="input select" {...rest}>
        {children}
      </select>
      <ChevronDown className="select-chevron" aria-hidden />
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="switch-row">
      <div className="switch-text">
        <label className="switch-label" htmlFor={id}>
          {label}
        </label>
        {description && <p className="switch-desc">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className={cx('switch', checked && 'is-on')}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: Array<{ value: T; label: string; icon?: ReactNode }>
  value: T
  onChange: (value: T) => void
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <div className={cx('segmented', size === 'sm' && 'segmented-sm')} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={cx('segmented-item', option.value === value && 'is-active')}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function FilterTabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: Array<{ value: T; label: string; count?: number }>
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="filter-tabs" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={item.value === value}
          className={cx('filter-tab', item.value === value && 'is-active')}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {item.count !== undefined && <span className="filter-count">{item.count}</span>}
        </button>
      ))}
    </div>
  )
}
