import { Fragment, type ReactNode } from 'react'

function inline(text: string, key: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={`${key}-${i}`}>{part}</Fragment>
      ),
    )
}

/** Renders the briefing's small markdown subset (paragraphs, **bold**, "- " lists) as React nodes. */
export function RichText({ text }: { text: string }) {
  return (
    <div className="prose">
      {text.split(/\n{2,}/).map((block, bi) => {
        const lines = block.split('\n').filter((line) => line.trim())
        const listStart = lines.findIndex((line) => line.startsWith('- '))
        const head = listStart === -1 ? lines : lines.slice(0, listStart)
        const items = listStart === -1 ? [] : lines.slice(listStart).map((line) => line.replace(/^- /, ''))
        return (
          <Fragment key={bi}>
            {head.length > 0 && (
              <p>
                {head.map((line, li) => (
                  <Fragment key={li}>
                    {li > 0 && <br />}
                    {inline(line, `${bi}-${li}`)}
                  </Fragment>
                ))}
              </p>
            )}
            {items.length > 0 && (
              <ul>
                {items.map((item, ii) => (
                  <li key={ii}>{inline(item, `${bi}-i${ii}`)}</li>
                ))}
              </ul>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
