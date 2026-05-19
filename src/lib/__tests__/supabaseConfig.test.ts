import { describe, expect, it } from 'vitest'
import { resolveSupabaseConfig } from '@/lib/supabase'

describe('resolveSupabaseConfig', () => {
  it('keeps a provided project URL with its matching anon key', () => {
    const config = resolveSupabaseConfig({
      url: 'https://frxjddevnehprauoapiv.supabase.co',
      anonKey: 'sb_publishable_project_key',
    })

    expect(config.supabaseUrl).toBe('https://frxjddevnehprauoapiv.supabase.co')
    expect(config.supabaseAnonKey).toBe('sb_publishable_project_key')
  })

  it('uses the project URL encoded in a JWT anon key when env values are mismatched', () => {
    const config = resolveSupabaseConfig({
      url: 'https://frxjddevnehprauoapiv.supabase.co',
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWYiOiJ0eWJwc2lsY2dwd2xtcXNld3JldSJ9.sig',
    })

    expect(config.supabaseUrl).toBe('https://tybpsilcgpwlmqsewreu.supabase.co')
  })
})
