import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.shavei.attendance',
  appName: 'ישיבת שבי חברון',
  webDir: 'dist',
  server: {
    // Loading from Vercel → every web update auto-reflects in the APK
    url: 'https://yeshiva-attendance-two.vercel.app',
    cleartext: false,
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#EAF4FF',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['alert', 'sound', 'badge'],
    },
  },
  android: {
    allowMixedContent: false,
  },
}

export default config
