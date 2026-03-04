import { AbsenceCalendar } from '@/components/admin/AbsenceCalendar'
import { AbsenceRequestsList } from '@/components/admin/AbsenceRequestsList'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function CalendarPage() {
  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <h2 className="text-2xl font-bold text-[var(--text)]">לוח שנה ובקשות</h2>

      <Tabs defaultValue="calendar">
        <TabsList>
          <TabsTrigger value="calendar">לוח שנה</TabsTrigger>
          <TabsTrigger value="requests">בקשות ממתינות</TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="mt-4">
          <AbsenceCalendar />
        </TabsContent>

        <TabsContent value="requests" className="mt-4">
          <AbsenceRequestsList />
        </TabsContent>
      </Tabs>
    </div>
  )
}
