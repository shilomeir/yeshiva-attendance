/** Supervisor auth types — kept for backward compatibility until Step 6 replaces
 *  the supervisor architecture with the supervisors DB table. */

export interface ClassSupervisorInfo {
  classId: string
  gradeName: string
}
