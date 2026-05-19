/**
 * Central runtime configuration.
 * Static defaults are used immediately; loadFromDb() overrides them with
 * values stored in app_settings (called once on app init).
 */
export interface AppConfig {
  campusLat: number
  campusLng: number
  campusRadiusMeters: number
  areaRadiusMeters: number
  /** Days before COMPLETED/CANCELLED/REJECTED departures are purged */
  departureRetentionDays: number
  /** Maximum hours a student may request for a single departure */
  maxDepartureHours: number
  /** Minutes after departure start within which a student may self-cancel */
  selfCancelWindowMinutes: number
}

const defaults: AppConfig = {
  campusLat: 31.5253,
  campusLng: 35.1056,
  campusRadiusMeters: 300,
  areaRadiusMeters: 5000,
  departureRetentionDays: 30,
  maxDepartureHours: 72,
  selfCancelWindowMinutes: 60,
}

let _config: AppConfig = { ...defaults }

export function getConfig(): AppConfig {
  return _config
}

/**
 * Optionally called during app boot to override defaults from app_settings rows.
 * Unknown keys are silently ignored.
 */
export function applyConfigOverrides(rows: Array<{ key: string; value: string }>): void {
  const overrides: Partial<AppConfig> = {}
  for (const { key, value } of rows) {
    switch (key) {
      case 'campus_lat':              overrides.campusLat = parseFloat(value); break
      case 'campus_lng':              overrides.campusLng = parseFloat(value); break
      case 'campus_radius_meters':    overrides.campusRadiusMeters = parseInt(value, 10); break
      case 'area_radius_meters':      overrides.areaRadiusMeters = parseInt(value, 10); break
      case 'departure_retention_days': overrides.departureRetentionDays = parseInt(value, 10); break
      case 'max_departure_hours':     overrides.maxDepartureHours = parseInt(value, 10); break
      case 'self_cancel_window_minutes': overrides.selfCancelWindowMinutes = parseInt(value, 10); break
    }
  }
  _config = { ..._config, ...overrides }
}
