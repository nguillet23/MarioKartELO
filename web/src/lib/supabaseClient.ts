import { createClient } from '@supabase/supabase-js'

// Trimmed defensively: a stray trailing newline from copy-pasting into a
// GitHub Actions secret is invisible in the UI but breaks the Realtime
// WebSocket URL, which (unlike REST headers) doesn't tolerate one.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
