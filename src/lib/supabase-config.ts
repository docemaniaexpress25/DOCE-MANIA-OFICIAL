// config.ts
export const supabaseUrl: string = "https://eyjhqjrczzpfthsddlpg.supabase.co";
export const supabaseAnonKey: string = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5amhxanJjenpwZnRoc2RkbHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0MjczNTYsImV4cCI6MjA4NTAwMzM1Nn0.seIcDpp3VMz44Zuziahln1NTI4Hrqv879Hzzp-pUrl0";

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Configuração do Supabase ausente.');
}