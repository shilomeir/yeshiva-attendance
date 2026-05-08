/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

const CANONICAL_SUPABASE_URL = 'https://tybpsilcgpwlmqsewreu.supabase.co'
const BROKEN_SUPABASE_URLS = new Set([
  'https://frxjddevnehprauoapiv.supabase.co',
  'https://placeholder.supabase.co',
])

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const envSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const supabaseUrl = envSupabaseUrl && !BROKEN_SUPABASE_URLS.has(envSupabaseUrl)
  ? envSupabaseUrl
  : CANONICAL_SUPABASE_URL
const supabaseAnonKey = envSupabaseAnonKey || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)