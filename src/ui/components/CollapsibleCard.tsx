import { useState, type ReactNode } from 'react';

const STORAGE_PREFIX = 'tally.card.';

function readOpen(id: string, defaultOpen: boolean): boolean {
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + id);
    return v === null ? defaultOpen : v === '1';
  } catch {
    return defaultOpen;
  }
}

/**
 * A card whose body can be collapsed; the choice is remembered on this device (layout preference only, never data).
 * `summary` is shown in the header while collapsed. The body isn't rendered while collapsed, so its queries don't run.
 */
export function CollapsibleCard({
  id,
  title,
  summary,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const bodyId = `card-body-${id}`;

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_PREFIX + id, next ? '1' : '0');
    } catch {
      // Private mode can block storage; the card still toggles for this visit.
    }
  }

  return (
    <section className={`card card-collapsible${open ? '' : ' is-collapsed'}`}>
      <h2 className="card-title">
        <button type="button" className="card-toggle" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={toggle}>
          <span className="card-toggle-text">
            <span>{title}</span>
            {!open && summary && <span className="card-summary">{summary}</span>}
          </span>
          <svg className="card-chevron" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      {open && <div id={bodyId}>{children}</div>}
    </section>
  );
}
