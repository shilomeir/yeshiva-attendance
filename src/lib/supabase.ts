/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

const CANONICAL_SUPABASE_URL = 'https://tybpsilcgpwlmqsewreu.supabase.co'
const PLACEHOLDER_SUPABASE_URL = 'https://placeholder.supabase.co'

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const envSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export function resolveSupabaseConfig(env: { url?: string; anonKey?: string }) {
  const supabaseUrl = env.url && env.url !== PLACEHOLDER_SUPABASE_URL
    ? env.url
    : CANONICAL_SUPABASE_URL
  const supabaseAnonKey = env.anonKey || 'placeholder-key'

  return { supabaseUrl, supabaseAnonKey }
}

const { supabaseUrl, supabaseAnonKey } = resolveSupabaseConfig({
  url: envSupabaseUrl,
  anonKey: envSupabaseAnonKey,
})

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
