import { Capacitor } from '@capacitor/core'
import type { GPSStatus } from '@/types'

// Campus coordinates: Yeshivat Shvi Hevron
export const CAMPUS_LAT = 31.5253
export const CAMPUS_LNG = 35.1056
export const CAMPUS_RADIUS_METERS = 300
export const AREA_RADIUS_METERS = 5000  // 5km — "in the Hebron area"

export interface GPSResult {
  lat: number
  lng: number
  accuracy: number
  status: GPSStatus
  distanceFromCampus: number
}

export interface GPSError {
  status: GPSStatus
  message: string
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000 // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/** Get current GPS position — works both in browser (PWA) and native Android APK */
export async function getCurrentPosition(): Promise<GPSResult | GPSError> {
  if (Capacitor.isNativePlatform()) {
    return getNativePosition()
  }
  return getWebPosition()
}

/** Native path: uses @capacitor/geolocation for precise Android GPS */
async function getNativePosition(): Promise<GPSResult | GPSError> {
  try {
    const { Geolocation } = await import('@capacitor/geolocation')

    const perm = await Geolocation.requestPermissions()
    if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
      return { status: 'DENIED_BY_USER', message: 'Location permission denied' }
    }

    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
    })

    const { latitude, longitude, accuracy } = position.coords
    const distance = haversineDistance(CAMPUS_LAT, CAMPUS_LNG, latitude, longitude)

    return {
      lat: latitude,
      lng: longitude,
      accuracy: accuracy ?? 0,
      status: 'GRANTED',
      distanceFromCampus: Math.round(distance),
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown GPS error'
    return { status: 'UNAVAILABLE', message }
  }
}

/** Web path: uses browser navigator.geolocation (original implementation unchanged) */
function getWebPosition(): Promise<GPSResult | GPSError> {
  if (!('geolocation' in navigator)) {
    return Promise.resolve({ status: 'UNAVAILABLE', message: 'Geolocation not supported' })
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords
        const distance = haversineDistance(CAMPUS_LAT, CAMPUS_LNG, latitude, longitude)

        resolve({
          lat: latitude,
          lng: longitude,
          accuracy,
          status: 'GRANTED',
          distanceFromCampus: Math.round(distance),
        })
      },
      (error) => {
        if (error.code === GeolocationPositionError.PERMISSION_DENIED) {
          resolve({ status: 'DENIED_BY_USER', message: 'Permission denied by user' })
        } else if (error.code === GeolocationPositionError.TIMEOUT) {
          resolve({ status: 'UNAVAILABLE', message: 'GPS timeout' })
        } else {
          resolve({ status: 'UNAVAILABLE', message: error.message })
        }
      },
      {
        timeout: 10000,
        maximumAge: 30000,
        enableHighAccuracy: true,
      }
    )
  })
}

export function isGPSResult(result: GPSResult | GPSError): result is GPSResult {
  return result.status === 'GRANTED'
}
