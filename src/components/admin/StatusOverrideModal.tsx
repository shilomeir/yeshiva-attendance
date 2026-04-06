import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { api } from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import type { Student, StudentStatus } from '@/types'

const STATUS_OPTIONS: { value: StudentStatus; label: string }[] = [
  { value: 'ON_CAMPUS', label: 'בישיבה' },
  { value: 'OFF_CAMPUS', label: 'מחוץ לישיבה' },
]

interface StatusOverrideModalProps {
  student: Student
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function StatusOverrideModal({ student, open, onClose, onSuccess }: StatusOverrideModalProps) {
  const [newStatus, setNewStatus] = useState<StudentStatus>(student.currentStatus)
  const [note, setNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newStatus === student.currentStatus) {
      onClose()
      return
    }

    setIsSubmitting(true)
    try {
      await api.createAdminOverride(student.id, newStatus, note || undefined)

      toast({
        title: 'הסטטוס עודכן בהצלחה',
        description: `${student.fullName} — הסטטוס שונה`,
      })

      onSuccess()
      onClose()
    } catch {
      toast({ title: 'שגיאה בעדכון הסטטוס', variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>עדכון סטטוס תלמיד</DialogTitle>
          <DialogDescription>{student.fullName}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Current status */}
          <div className="flex items-center justify-between rounded-lg bg-[var(--bg-2)] p-3">
            <span className="text-sm text-[var(--text-muted)]">סטטוס נוכחי:</span>
            <StatusBadge status={student.currentStatus} />
          </div>

          {/* New status */}
          <div className="flex flex-col gap-2">
            <Label>סטטוס חדש</Label>
            <Select value={newStatus} onValueChange={(v) => setNewStatus(v as StudentStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Note */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="note">הערה (אופציונלי)</Label>
            <Input
              id="note"
              placeholder="הסבר לשינוי הסטטוס..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              ביטול
            </Button>
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  מעדכן...
                </>
              ) : (
                'שמירה'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
