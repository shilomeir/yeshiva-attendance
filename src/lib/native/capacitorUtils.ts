import { Capacitor } from '@capacitor/core'

/** Returns true when running inside the native Android/iOS APK */
export const isNative = (): boolean => Capacitor.isNativePlatform()

/** Returns true when running on Android (native only) */
export const isAndroid = (): boolean => Capacitor.getPlatform() === 'android'

/** Returns true when running in the browser / PWA */
export const isWeb = (): boolean => !isNative()
