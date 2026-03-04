import type { GPSStatus } from '@/types'

// Campus coordinates: Yeshivat Shvi Hevron
export const CAMPUS_LAT = 31.5253
export const CAMPUS_LNG = 35.1056
export const CAMPUS_RADIUS_METERS = 300

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

export async function getCurrentPosition(): Promise<GPSResult | GPSError> {
  if (!('geolocation' in navigator)) {
    return { status: 'UNAVAILABLE', message: 'Geolocation not supported' }
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
