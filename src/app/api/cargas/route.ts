import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasEstoquesNotaColumns, hasModoCargaColumn, hasCargaPendenteModoColumn } from '@/lib/serverSchema';

/**
 * BLOCO 29 (ROTA 2) — POST /api/cargas
 * Carga da van com MODO (COM_NF | SEM_NF): 1 ou outro, NUNCA mistura.
 *
 * body: { vendedorId, itens: [{produtoId|produtoid, quantidade}], modo, acao }
 *   acao 'APLICAR'   -> aplica AGORA: calcula o DELTA da van (desejado - atual),
 *                       move CASA na coluna do modo (estoque_nota | estoque_semnf)
 *                       e substitui a carga da van (cargas.modo_nota = modo).
 *   acao 'PENDENTE'  -> grava cargas_pendentes com modo_nota (o ACEITE v2 em
 *                       /api/cargas/aceitar move a casa na coluna certa).
 *
 * Regras do dono:
 * - VAN JA CARREGADA COM OUTRO MODO -> 409 (nao pode misturar na pronta entrega).
 * - CASA SEM SALDO SUFICIENTE -> 409 com a lista do que falta.
 * - So ADMIN carrega.
 * - Perfil LEGADO (vendedor nao rota2) NAO usa esta rota: continua no fluxo antigo.
 */

interface ItemPayload { produtoId?: string; produtoid?: string; quantidade?: number; }

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, erro: 'Servidor nao configurado.' }, { status: 503 });
  }

  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, erro: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  }
  if (session.perfil !== 'ADMIN') {
    return NextResponse.json({ ok: false, erro: 'Somente o admin carrega a van.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, erro: 'Payload invalido.' }, { status: 400 });

  const vendedorId = String(body.vendedorId || '');
  const modo = String(body.modo || '').toUpperCase() === 'SEM_NF' ? 'SEM_NF' : 'COM_NF';
  const acao = String(body.acao || '').toUpperCase() === 'PENDENTE' ? 'PENDENTE' : 'APLICAR';
  const rawItens: ItemPayload[] = Array.isArray(body.itens) ? body.itens : [];

  if (!vendedorId || rawItens.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Carga vazia (vendedor ou itens ausentes).' }, { status: 400 });
  }

  const itens = rawItens
    .map(i => ({
      produtoId: String(i.produtoId || i.produtoid || ''),
      quantidade: Math.max(0, Math.floor(Number(i.quantidade) || 0)),
    }))
    .filter(i => i.produtoId);

  if (itens.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Itens da carga invalidos.' }, { status: 400 });
  }

  // ---- Sondas: SQL do Bloco 29 precisa ter rodado ----
  const [temEstoqueNota, temModoCarga, temPendenteModo] = await Promise.all([
    hasEstoquesNotaColumns(), hasModoCargaColumn(), hasCargaPendenteModoColumn(),
  ]);
  if (!temEstoqueNota || !temModoCarga || !temPendenteModo) {
    return NextResponse.json({ ok: false, erro: 'Banco desatualizado: rode o SQL do Bloco 29 (estoques COM NF / SEM NF).' }, { status: 503 });
  }

  try {
    const supabase = getServiceClient();

    // ---- BLOQUEIO DE MISTURA: van ja carregada com outro modo? ----
    const { data: modosVan } = await supabase
      .from('cargas').select('modo_nota').eq('vendedor_id', vendedorId).not('modo_nota', 'is', null);
    const modosVanSet = new Set((modosVan || []).map((r: any) => r.modo_nota));
    if (modosVanSet.size > 1 || (modosVanSet.size === 1 && !modosVanSet.has(modo))) {
      const outro = [...modosVanSet][0] || modo;
      return NextResponse.json({ ok: false, erro: `VAN JA CARREGADA COM ${outro === 'COM_NF' ? 'NF' : 'SEM NF'} — nao pode misturar. Zere a carga ou use o mesmo modo.` }, { status: 409 });
    }
    const { data: pendModos } = await supabase
      .from('cargas_pendentes').select('modo_nota').eq('vendedor_id', vendedorId).eq('status', 'PENDENTE').not('modo_nota', 'is', null);
    const pendModosSet = new Set((pendModos || []).map((r: any) => r.modo_nota));
    if (pendModosSet.size > 0 && [...pendModosSet].some(m => m !== modo)) {
      return NextResponse.json({ ok: false, erro: `Ja existe carga PENDENTE com outro modo para este vendedor. Cancele-a primeiro.` }, { status: 409 });
    }

    // BLOCO 75 (ESTOQUE TOTAL): a casa é UNICA — toda a mercadoria entra no
    // estoque_principal (Estoque Total) e a carga sai dele. O modo do vendedor
    // continua gravado na carga para rastreio, mas nao escolhe mais cofre.
    const colCasa = 'estoque_principal';

    // ---------- ACAO PENDENTE: grava a pendente com modo (casa move no aceite) ----------
    if (acao === 'PENDENTE') {
      const { error: insErr } = await supabase.from('cargas_pendentes').insert({
        vendedor_id: vendedorId,
        itens: itens.map(i => ({ produtoid: i.produtoId, quantidade: i.quantidade })),
        data_criacao: new Date().toISOString(),
        status: 'PENDENTE',
        modo_nota: modo,
      });
      if (insErr) {
        return NextResponse.json({ ok: false, erro: 'Erro ao gravar a carga pendente.', detalhe: insErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, modo, acao });
    }

    // ---------- ACAO APLICAR: delta da van + movimento de casa ----------
    const { data: cargaAtual, error: cargaErr } = await supabase
      .from('cargas').select('produto_id, quantidade').eq('vendedor_id', vendedorId);
    if (cargaErr) throw cargaErr;
    const atualMap = new Map<string, number>((cargaAtual || []).map((c: any) => [c.produto_id, Number(c.quantidade) || 0]));

    const ids = [...new Set(itens.map(i => i.produtoId))];
    // BLOCO 75: casa unica = Estoque Total
    const { data: prods, error: prodErr } = await supabase
      .from('products').select(`id, nome, estoque_principal`).in('id', ids);
    if (prodErr) throw prodErr;
    const prodMap = new Map<string, any>((prods || []).map((p: any) => [p.id, p]));

    // Delta por produto: desejado (van) - atual (van). Delta>0 tira de casa; delta<0 devolve.
    const deltas: { produtoId: string; delta: number }[] = [];
    const faltas: { produto: string; falta: number }[] = [];
    for (const i of itens) {
      const atual = atualMap.get(i.produtoId) ?? 0;
      const delta = i.quantidade - atual;
      if (delta === 0) continue;
      const p = prodMap.get(i.produtoId);
      if (!p) return NextResponse.json({ ok: false, erro: 'Produto nao encontrado no cadastro.' }, { status: 404 });
      if (delta > 0) {
        const casaSaldo = Number(p[colCasa] ?? 0);
        if (casaSaldo < delta) {
          faltas.push({ produto: p.nome || i.produtoId, falta: delta - casaSaldo });
        }
      }
      deltas.push({ produtoId: i.produtoId, delta });
    }
    if (faltas.length > 0) {
      const lista = faltas.map(f => `${f.produto} (falta ${f.falta})`).join(', ');
      return NextResponse.json({ ok: false, erro: `ESTOQUE TOTAL INSUFICIENTE: ${lista}. Fa a entrada primeiro.` }, { status: 409 });
    }

    // Move casa (Estoque Total) — update direto server-side (1 admin, janela de corrida irrelevante)
    for (const d of deltas) {
      if (d.delta === 0) continue;
      const p = prodMap.get(d.produtoId);
      const novo = Math.max(0, Number(p[colCasa] ?? 0) - d.delta);
      const { error: e2 } = await supabase.from('products').update({ [colCasa]: novo }).eq('id', d.produtoId);
      if (e2) throw e2;
    }

    // Substitui a carga da van pelo estado desejado (com o modo)
    const { error: delErr } = await supabase.from('cargas').delete().eq('vendedor_id', vendedorId);
    if (delErr) throw delErr;
    const rows = itens.filter(i => i.quantidade > 0).map(i => ({
      vendedor_id: vendedorId,
      produto_id: i.produtoId,
      quantidade: i.quantidade,
      modo_nota: modo,
    }));
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('cargas').insert(rows);
      if (insErr) throw insErr;
    }

    return NextResponse.json({ ok: true, modo, acao });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/cargas] erro:', msg);
    return NextResponse.json({ ok: false, erro: 'Erro ao gravar a carga. Tente novamente.', detalhe: msg }, { status: 500 });
  }
}
