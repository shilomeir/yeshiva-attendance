/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

// Frankfurt (frxjddevnehprauoapiv) is the active Supabase project — migrated
// from the old Tokyo project on 2026-04-19 (commit 56ff988). A later commit
// (a1487e8, 2026-05-08) accidentally inverted the override and forced traffic
// back to Tokyo (`tybpsilcgpwlmqsewreu`) by tagging Frankfurt as "BROKEN" —
// that was a bug. This file now treats Frankfurt as canonical.
//
// If VITE_SUPABASE_URL is provided in the build env, it wins (Vercel /
// .env.local). Otherwise we fall back to the Frankfurt project.
const CANONICAL_SUPABASE_URL = 'https://frxjddevnehprauoapiv.supabase.co'

// URLs we know are stale or never valid — ignore them even if injected via env.
const STALE_SUPABASE_URLS = new Set([
  'https://tybpsilcgpwlmqsewreu.supabase.co', // pre-migration Tokyo project
  'https://placeholder.supabase.co',
])

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const envSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const supabaseUrl = envSupabaseUrl && !STALE_SUPABASE_URLS.has(envSupabaseUrl)
  ? envSupabaseUrl
  : CANONICAL_SUPABASE_URL
const supabaseAnonKey = envSupabaseAnonKey || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
