import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://zxhdgyndsnzusbmbjywe.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4aGRneW5kc256dXNibWJqeXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTk5MTcsImV4cCI6MjA5NjkzNTkxN30.uXXmXGQoMpYqDlH8VHu8GwcYbno8f-6FAZjMirW9EyA'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)