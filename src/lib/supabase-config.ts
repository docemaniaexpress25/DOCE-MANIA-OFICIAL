export const supabaseUrl: string = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://eyjhqjrczzpfthsddlpg.supabase.co';
export const supabaseAnonKey: string = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5amhxanJjenpwZnRoc2RkbHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0MjczNTYsImV4cCI6MjA4NTAwMzM1Nn0.seIcDpp3VMz44Zuziahln1NTI4Hrqv879Hzzp-pUrl0';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY devem estar configurados.');
}
