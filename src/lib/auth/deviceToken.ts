import { v4 as uuidv4 } from 'uuid'

const DEVICE_TOKEN_KEY = 'yeshiva_device_token'

export function getDeviceToken(): string {
  const existing = localStorage.getItem(DEVICE_TOKEN_KEY)
  if (existing) return existing

  const newToken = uuidv4()
  localStorage.setItem(DEVICE_TOKEN_KEY, newToken)
  return newToken
}

export function readDeviceToken(): string | null {
  return localStorage.getItem(DEVICE_TOKEN_KEY)
}

export function writeDeviceToken(token: string): void {
  localStorage.setItem(DEVICE_TOKEN_KEY, token)
}

export function clearDeviceToken(): void {
  localStorage.removeItem(DEVICE_TOKEN_KEY)
}
