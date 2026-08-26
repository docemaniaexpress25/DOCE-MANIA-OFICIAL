
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey } from './config'; // Importa as variáveis do novo config.ts

// O cliente Supabase só será criado se supabaseUrl e supabaseAnonKey forem válidos,
// devido à validação em config.ts que lança um erro caso contrário.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
