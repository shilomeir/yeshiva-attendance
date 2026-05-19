/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

const CANONICAL_SUPABASE_URL = 'https://tybpsilcgpwlmqsewreu.supabase.co'
const PLACEHOLDER_SUPABASE_URL = 'https://placeholder.supabase.co'

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const envSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

function getProjectRefFromUrl(url?: string) {
  return url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/)?.[1]
}

function getProjectRefFromJwt(anonKey?: string) {
  const payload = anonKey?.split('.')[1]
  if (!payload) return undefined

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const decoded = atob(padded)
    const json = JSON.parse(decoded) as { ref?: string }
    return json.ref
  } catch {
    return undefined
  }
}

export function resolveSupabaseConfig(env: { url?: string; anonKey?: string }) {
  const configuredUrl = env.url && env.url !== PLACEHOLDER_SUPABASE_URL
    ? env.url
    : CANONICAL_SUPABASE_URL
  const supabaseAnonKey = env.anonKey || 'placeholder-key'
  const urlProjectRef = getProjectRefFromUrl(configuredUrl)
  const keyProjectRef = getProjectRefFromJwt(supabaseAnonKey)
  const supabaseUrl = keyProjectRef && urlProjectRef && keyProjectRef !== urlProjectRef
    ? `https://${keyProjectRef}.supabase.co`
    : configuredUrl

  return { supabaseUrl, supabaseAnonKey }
}

const { supabaseUrl, supabaseAnonKey } = resolveSupabaseConfig({
  url: envSupabaseUrl,
  anonKey: envSupabaseAnonKey,
})

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
