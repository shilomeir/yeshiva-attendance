/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

const CANONICAL_SUPABASE_URL = 'https://frxjddevnehprauoapiv.supabase.co'
const CANONICAL_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyeGpkZGV2bmVocHJhdW9hcGl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MjE1MDQsImV4cCI6MjA5MTk5NzUwNH0.kodqsmJs8gZUraMBgFTG0PWnUv7uJEUoZczdfkTi8kw'

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const envSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const supabaseUrl = envSupabaseUrl || CANONICAL_SUPABASE_URL
const supabaseAnonKey = envSupabaseAnonKey || CANONICAL_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
