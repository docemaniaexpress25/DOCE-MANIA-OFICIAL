import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { agendarAutoSyncBoletos } from '@/lib/autoSync';

/**
 * BLOCO 221 — AVISOS DE BAIXA PARA OS ADMINS (sino do app).
 *
 * O dono pediu: "gere um aviso, uma mensagem! para que toda baixa a gente
 * seja comunicado! no caso os admin do sistema!". Toda baixa automatica
 * grava um aviso na tabela `notificacoes` (lib/notificacoes). Este endpoint
 * alimenta o SINO global do admin:
 *
 *   GET  /api/notificacoes
 *     -> { ok, naoLidas: n, itens: [{ id, tipo, titulo, mensagem, saleId,
 *          origem, valor, lida, criadoEm }] }  (ultimos 40, mais novo 1o)
 *     O GET tambem AGENDA o auto-sync horario (lib/autoSync) — o polling do
 *     sino (60 s) mantem o sync rodando varias vezes por dia.
 *
 *   POST /api/notificacoes  { acao: 'ler_todas' }
 *     -> marca tudo como lido (o badge do sino zera de verdade, no banco).
 *
 * Autorizacao: sessao ADMIN ou SECRETARIO. Degradacao graciosa: SQL 221
 * pendente (tabela ausente) responde 503 com instrucao — o app do admin
 * segue funcionando so com o realtime (som) que ja existia.
 */

const LIMITE_ITENS = 40;

function tabelaAusente(msg: string): boolean {
  return /notificacoes|does not exist|schema cache|42P01/i.test(msg || '');
}

export async function GET(req: NextRequest) {
  // BLOCO 221: ponte de dev (Bloco 12) — preview sem service key repassa para
  // a producao, igual ao painel do webhook (inter-painel).
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (session.perfil !== 'ADMIN' && session.perfil !== 'SECRETARIO') {
    return NextResponse.json({ ok: false, error: 'Avisos sao para admin/secretario.' }, { status: 403 });
  }

  // Auto-sync horario dispara junto (nao atrasa a resposta — roda via after()).
  agendarAutoSyncBoletos();

  const db = getServiceClient();
  const { data, error } = await db
    .from('notificacoes')
    .select('id, tipo, titulo, mensagem, sale_id, origem, valor, lida, criado_em')
    .eq('perfil_alvo', 'ADMIN')
    .order('criado_em', { ascending: false })
    .limit(LIMITE_ITENS);

  if (error) {
    const msg = String(error.message || '');
    if (tabelaAusente(msg)) {
      return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 221 (tabela notificacoes).' }, { status: 503 });
    }
    console.error('[api/notificacoes] erro:', msg);
    return NextResponse.json({ ok: false, error: 'Erro ao carregar os avisos.' }, { status: 500 });
  }

  const itens = (data || []) as Record<string, unknown>[];
  return NextResponse.json({
    ok: true,
    naoLidas: itens.filter(n => !n.lida).length,
    itens: itens.map(n => ({
      id: n.id,
      tipo: n.tipo,
      titulo: n.titulo,
      mensagem: n.mensagem,
      saleId: n.sale_id,
      origem: n.origem,
      valor: Number(n.valor) || 0,
      lida: !!n.lida,
      criadoEm: n.criado_em,
    })),
  });
}

export async function POST(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (session.perfil !== 'ADMIN' && session.perfil !== 'SECRETARIO') {
    return NextResponse.json({ ok: false, error: 'Avisos sao para admin/secretario.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const acao = String(body.acao || 'ler_todas');
  if (acao !== 'ler_todas') {
    return NextResponse.json({ ok: false, error: 'Acao desconhecida.' }, { status: 400 });
  }

  const db = getServiceClient();
  const { error } = await db
    .from('notificacoes')
    .update({ lida: true })
    .eq('perfil_alvo', 'ADMIN')
    .eq('lida', false);

  if (error) {
    const msg = String(error.message || '');
    if (tabelaAusente(msg)) {
      return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 221 (tabela notificacoes).' }, { status: 503 });
    }
    console.error('[api/notificacoes] marcar lidas falhou:', msg);
    return NextResponse.json({ ok: false, error: 'Erro ao marcar como lidas.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
