import { createClient } from '@supabase/supabase-js'

// Standard local or production Supabase URL
// Fallback to valid URL so client initialization never throws
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
