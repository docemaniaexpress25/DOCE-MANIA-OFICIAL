import { getServiceClient } from '@/lib/serverSupabase';

/**
 * Sondas de schema em transicao (Bloco 5 — pre-venda).
 *
 * O codigo ja foi publicado para a Vercel, mas o SQL do Bloco 5 roda no
 * Supabase em um momento DEPOIS do deploy. Enquanto isso, colunas/tabelas
 * novas (app_users.pre_venda, sales.tipo_venda, entrega_rotas...) nao
 * existem e qualquer SELECT citando-as quebra ROTAS CRITICAS
 * (/api/users e /api/login -> lista de vendedores some do login e das cargas).
 *
 * Estrategia: sonda rapida (limit 1) com cache curto de 30s por instancia.
 * - Coluna ausente -> rotas montam queries SEM a coluna (flag preVenda=false).
 * - Depois que o Bloco 5 roda, a sonda se autocorrige em ate 30s.
 */
const TTL_MS = 30_000;

type Probe = { ok: boolean; at: number };
const probes: Record<string, Probe | null> = { preVenda: null, entrega: null, foto: null };

async function probeColumn(table: string, column: string, key: string): Promise<boolean> {
  const now = Date.now();
  const cached = probes[key];
  if (cached && now - cached.at < TTL_MS) return cached.ok;
  try {
    const { error } = await getServiceClient().from(table).select(column).limit(1);
    const ok = !error;
    probes[key] = { ok, at: now };
    return ok;
  } catch {
    // Falha transitoria (rede/timeout): nao cacheia, tenta de novo na proxima.
    return cached?.ok ?? false;
  }
}

/** app_users.pre_venda existe? (Bloco 5 aplicado) */
export function hasPreVendaColumn(): Promise<boolean> {
  return probeColumn('app_users', 'pre_venda', 'preVenda');
}

/** sales.tipo_venda / entrega_rotas existem? (Bloco 5 aplicado) */
export function hasEntregaTables(): Promise<boolean> {
  return probeColumn('sales', 'tipo_venda', 'entrega');
}

/** entrega_eventos.foto existe? (Bloco 6 aplicado — foto do boleto entregue) */
export function hasBoletoFotoColumn(): Promise<boolean> {
  return probeColumn('entrega_eventos', 'foto', 'foto');
}
