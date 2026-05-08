import { useState } from 'react'
import { ChevronDown, Info } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils/cn'
import { getStudentHelpSections } from './studentHelpContent'

export function StudentHelpSheet() {
  const [open, setOpen] = useState(false)
  const [openSectionId, setOpenSectionId] = useState('home')
  const sections = getStudentHelpSections()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-center rounded-xl p-2 text-[var(--text-muted)] hover:bg-[var(--bg-2)] hover:text-[var(--blue)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)] focus-visible:ring-offset-2"
          aria-label="הסבר על הדשבורד"
          title="הסבר על הדשבורד"
        >
          <Info className="h-4.5 w-4.5" style={{ height: '1.125rem', width: '1.125rem' }} />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl pb-8">
        <SheetHeader className="mb-4 pe-7 text-start">
          <SheetTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-[var(--blue)]" />
            איך משתמשים בדשבורד?
          </SheetTitle>
          <SheetDescription>
            כאן יש הסבר קצר לפי נושאים. פותחים רק את מה שצריך וקוראים בקצב שלך.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2">
          {sections.map((section) => {
            const isOpen = openSectionId === section.id

            return (
              <div
                key={section.id}
                className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-2)]"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
                  aria-expanded={isOpen}
                  onClick={() => setOpenSectionId(isOpen ? '' : section.id)}
                >
                  <span className="font-semibold text-[var(--text)]">{section.title}</span>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform',
                      isOpen && 'rotate-180'
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                    <ul className="flex list-disc flex-col gap-2 pe-4 text-sm leading-6 text-[var(--text-muted)]">
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
