// config.ts
// Fix: Use type assertion to allow accessing 'process' on 'window'
export const supabaseUrl: string = (window as any).process?.env?.SUPABASE_URL || '';
export const supabaseAnonKey: string = (window as any).process?.env?.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Erro de Configuração: SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórios.');
  console.error('Por favor, verifique se estão definidos no <script> em index.html.');
  throw new Error('As variáveis de ambiente do Supabase não estão configuradas corretamente.');
}