import { Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/store/uiStore'

export function ThemeToggle() {
  const { theme, toggleTheme } = useUiStore()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'עבור למצב בהיר' : 'עבור למצב כהה'}
      aria-label={theme === 'dark' ? 'עבור למצב בהיר' : 'עבור למצב כהה'}
    >
      {theme === 'dark' ? (
        <Sun className="h-5 w-5 text-[var(--orange)]" />
      ) : (
        <Moon className="h-5 w-5 text-[var(--text-muted)]" />
      )}
    </Button>
  )
}
