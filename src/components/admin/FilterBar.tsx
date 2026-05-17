import { Search } from 'lucide-react'
import { useStudentsStore } from '@/store/studentsStore'

type FilterType = 'ALL' | 'OFF_CAMPUS' | 'PENDING'

const FILTERS: { value: FilterType; label: string }[] = [
  { value: 'ALL', label: 'כולם' },
  { value: 'OFF_CAMPUS', label: 'מחוץ לישיבה' },
  { value: 'PENDING', label: 'ממתינים' },
]

export function FilterBar() {
  const { filter, searchQuery, setFilter, setSearch } = useStudentsStore()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Status filter pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {FILTERS.map(({ value, label }) => {
          const active = filter === value
          return (
            <button
              key={value}
              onClick={() => setFilter(value)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 13px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${active ? 'var(--ink)' : 'var(--hairline)'}`,
                background: active ? 'var(--ink)' : 'rgba(255,255,255,0.55)',
                color: active ? '#fff' : 'var(--ink-muted)',
                fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit',
                transition: 'all 0.18s', whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{
          position: 'absolute', insetInlineStart: 12, top: '50%',
          transform: 'translateY(-50%)', color: 'var(--ink-faint)',
          pointerEvents: 'none',
        }} />
        <input
          placeholder="חיפוש לפי שם, ת.ז. או טלפון..."
          value={searchQuery}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%', borderRadius: 10,
            border: '1px solid var(--hairline)',
            background: 'rgba(255,255,255,0.7)',
            color: 'var(--ink)', paddingInlineStart: 34, paddingInlineEnd: 14,
            paddingTop: 9, paddingBottom: 9, fontSize: 13.5, fontFamily: 'inherit',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  )
}
