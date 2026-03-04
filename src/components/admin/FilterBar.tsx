import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useStudentsStore } from '@/store/studentsStore'
import { cn } from '@/lib/utils/cn'

type FilterType = 'ALL' | 'OFF_CAMPUS' | 'PENDING' | 'OVERDUE'

const FILTERS: { value: FilterType; label: string }[] = [
  { value: 'ALL', label: 'כולם' },
  { value: 'OFF_CAMPUS', label: 'מחוץ לישיבה' },
  { value: 'PENDING', label: 'ממתינים' },
  { value: 'OVERDUE', label: 'באיחור' },
]

export function FilterBar() {
  const { filter, searchQuery, setFilter, setSearch } = useStudentsStore()

  return (
    <div className="flex flex-col gap-3">
      {/* Filter buttons */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(({ value, label }) => (
          <Button
            key={value}
            variant={filter === value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(value)}
            className={cn(
              filter === value ? '' : 'text-[var(--text-muted)]'
            )}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <Input
          placeholder="חיפוש לפי שם, ת.ז. או טלפון..."
          value={searchQuery}
          onChange={(e) => setSearch(e.target.value)}
          className="ps-9"
        />
      </div>
    </div>
  )
}
