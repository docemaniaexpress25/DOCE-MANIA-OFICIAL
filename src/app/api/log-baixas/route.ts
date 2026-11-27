import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasBoletoColumns } from '@/lib/serverSchema';
import { agendarAutoSyncBoletos } from '@/lib/autoSync';

/**
 * BLOCO 221 — LOG DE BAIXAS (o dono pediu: "quero o log de baixas facil de
 * visualizar em tela limpa!").
 *
 * GET /api/log-baixas (ADMIN/SECRETARIO) -> snapshot focado SO nas BAIXAS
 * (nao nos eventos tecnicos de status), na ordem em que aconteceram:
 *
 *   resumo:  { hojeQtde, hojeTotal, seteQtde, seteTotal, trintaQtde,
 *              trintaTotal, filaAbertaQtde, filaAbertaTotal, ultimoSync }
 *   baixas:  vendas com baixa_origem marcada (SQL 172), mais nova primeiro —
 *            cliente, valor, origem (WEBHOOK_INTER/CRON_INTER/MANUAL/
 *            PIX_PORTAL), hora da baixa e metodo.
 *   eventos: ultimos eventos do webhook/cron (webhook_logs, SQL 167) para a
 *            secao "eventos tecnicos" da tela.
 *
 * O GET tambem AGENDA o auto-sync horario (lib/autoSync via after()) — abrir
 * a tela do Log ja revalida os boletos no Inter de hora em hora.
 * Degradacao graciosa: colunas/tabelas ausentes = listas vazias, nao erro.
 */

const LIMITE_BAIXAS = 200;
const LIMITE_EVENTOS = 50;

const STATUS_ABERTOS = ['EM_PROCESSAMENTO', 'A_RECEBER', 'ATRASADO'];

export async function GET(req: NextRequest) {
  // Ponte de dev (Bloco 12) — mesmo padrao do inter-painel.
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (session.perfil !== 'ADMIN' && session.perfil !== 'SECRETARIO') {
    return NextResponse.json({ ok: false, error: 'Somente admin/secretario veem o log de baixas.' }, { status: 403 });
  }

  // Auto-sync horario: abrir o Log conta como "uso do sistema" (after()).
  agendarAutoSyncBoletos();

  const db = getServiceClient();
  const agora = new Date();
  const inicioHojeSp = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora) + 'T00:00:00-03:00');
  const inicioHojeMs = inicioHojeSp.getTime();
  const corte7 = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const corte30 = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ---------- BAIXAS (sales.baixa_origem marcada — SQL 172) ----------
  let baixas: Array<Record<string, unknown>> = [];
  const nomes = new Map<string, string>();
  try {
    const { data, error } = await db
      .from('sales')
      .select('id, valor_total, valor_pago, metodo_pagamento, data_venda, data_vencimento, baixa_origem, baixa_em, detalhe_pagamento, client_id')
      .not('baixa_origem', 'is', null)
      .order('baixa_em', { ascending: false })
      .limit(LIMITE_BAIXAS);
    if (error) throw error;
    baixas = (data || []) as Array<Record<string, unknown>>;

    // Nomes dos clientes (1 query — nome_fantasia || nome || razao_social)
    const ids = Array.from(new Set(baixas.map(b => String(b.client_id || '')).filter(Boolean))).slice(0, 200);
    if (ids.length > 0) {
      const { data: cl } = await db.from('clients').select('id, nome_fantasia, nome, razao_social').in('id', ids);
      for (const c of (cl || []) as Record<string, unknown>[]) {
        nomes.set(String(c.id), String(c.nome_fantasia || c.nome || c.razao_social || 'Cliente'));
      }
    }
  } catch (e: unknown) {
    // SQL 172 pendente (colunas ausentes) — log vazio, tela segue.
    console.warn('[api/log-baixas] leitura das baixas falhou (SQL 172 rodado?):', (e as Error)?.message);
  }

  // ---------- FILA ABERTA (o que ainda NAO foi baixado) ----------
  let filaAbertaQtde = 0;
  let filaAbertaTotal = 0;
  if (await hasBoletoColumns()) {
    try {
      const { data, error } = await db
        .from('sales')
        .select('valor_total')
        .in('inter_boleto_status', STATUS_ABERTOS);
      if (!error) {
        const fila = (data || []) as Array<{ valor_total: unknown }>;
        filaAbertaQtde = fila.length;
        filaAbertaTotal = fila.reduce((acc, s) => acc + (Number(s.valor_total) || 0), 0);
      }
    } catch { /* schema antigo — segue */ }
  }

  // ---------- EVENTOS TECNICOS (webhook_logs — SQL 167) ----------
  let eventos: Array<Record<string, unknown>> = [];
  let ultimoSync: { em: string; resultado: string } | null = null;
  try {
    const { data, error } = await db
      .from('webhook_logs')
      .select('criado_em, origem, codigo, seu_numero, sale_id, resultado, processado')
      .order('criado_em', { ascending: false })
      .limit(LIMITE_EVENTOS);
    if (!error) eventos = (data || []) as Array<Record<string, unknown>>;
    const cron = eventos.find(e => e.origem === 'CRON');
    if (cron) ultimoSync = { em: String(cron.criado_em || ''), resultado: String(cron.resultado || '') };
  } catch (e: unknown) {
    console.warn('[api/log-baixas] eventos tecnicos indisponiveis (SQL 167 rodado?):', (e as Error)?.message);
  }

  // ---------- RESUMO (hoje / 7 dias / 30 dias) ----------
  const soma = (filtro: (baixaEm: number) => boolean) =>
    baixas.filter(b => {
      const t = b.baixa_em ? new Date(String(b.baixa_em)).getTime() : 0;
      return t > 0 && filtro(t);
    });
  const hoje = soma(t => t >= inicioHojeMs);
  const sete = soma(t => t >= corte7.getTime());
  const trinta = soma(t => t >= corte30.getTime());
  const total = (lista: Array<Record<string, unknown>>) => lista.reduce((acc, b) => acc + (Number(b.valor_total) || 0), 0);

  return NextResponse.json({
    ok: true,
    agora: agora.toISOString(),
    resumo: {
      hojeQtde: hoje.length,
      hojeTotal: total(hoje),
      seteQtde: sete.length,
      seteTotal: total(sete),
      trintaQtde: trinta.length,
      trintaTotal: total(trinta),
      filaAbertaQtde,
      filaAbertaTotal,
      ultimoSync,
    },
    baixas: baixas.map(b => ({
      id: b.id,
      cliente: nomes.get(String(b.client_id || '')) || (b.client_id ? 'Cliente' : 'Venda sem cliente'),
      valor: Number(b.valor_total) || 0,
      valorPago: Number(b.valor_pago) || 0,
      metodo: String(b.metodo_pagamento || ''),
      origem: String(b.baixa_origem || ''),
      baixaEm: String(b.baixa_em || ''),
      vencimento: String(b.data_vencimento || ''),
      detalhe: String(b.detalhe_pagamento || ''),
    })),
    eventos: eventos.map(e => ({
      criadoEm: String(e.criado_em || ''),
      origem: String(e.origem || ''),
      resultado: String(e.resultado || ''),
      processado: !!e.processado,
    })),
  });
}
