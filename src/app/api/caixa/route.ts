import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest, isAdminSession } from '@/lib/session';
import { registrarPagamentoCaixa, type CaixaMetodo, type CaixaOrigem } from '@/lib/caixaLedger';
// BLOCO 118.3: caixa exclusivo do David (Rota 5) — casamento por nome server-side
import { isDavidNome } from '@/lib/equipe';

/**
 * BLOCO 118 — CAIXA: FECHAMENTO PERSISTIDO + LEDGER DE PAGAMENTOS
 * BLOCO 118.3 (regra do dono): o CAIXA é EXCLUSIVO do DAVID (Rota 5).
 * BLOCO 165 (mudança de regra do dono, 16/11/2026): "o caixa do david esta
 * zerado! mas deve aparecer todos os recebidos em dinheiro, pix e boletos!
 * desde sexta dia 13" — o caixa passa a mostrar DINHEIRO/PIX À VISTA + os
 * BOLETOS gerados nas vendas a prazo dele (o recebimento real segue no Contas
 * a Receber). Recebimento MANUAL do admin e pix do PORTAL continuam fora;
 * vendas de OUTROS vendedores não entram (compensação deles é comissão).
 * Fonte principal do ledger: TRIGGER SQL trg_caixa_david_sales (bloco 165)
 * — à prova de sessão expirada (causa do caixa zerado). O POST é redundância
 * idempotente. Ajuste manual do admin entra via AJUSTE.
 *
 * GET  /api/caixa                      [ADMIN | SECRETARIO | VENDEDOR]
 *   Caixa corrente (aberto) + histórico de fechamentos:
 *   { ok, aberto: { desde, pagamentos[], totais{dinheiro,pix,deposito,boleto,total} },
 *          historico: [{id, fechadoEm, fechadoPorNome, totais, qtde, observacao}] }
 *   BLOCO 165: BOLETO (venda a prazo do David) entrou no caixa — o dono quer
 *   "todos os recebidos em dinheiro, pix e boletos". total = soma de TUDO.
 *   Pagamentos NÃO trazem a foto inline — o <img> busca por GET /api/caixa/foto?id=.
 *
 *   BLOCO 167 (regra do dono): "quando fechar caixa zera e começa tudo denovo.
 *   As vendas a prazo só zera quando o pagamento a prazo ocorrer."
 *   - O FECHAR trava SOMENTE o À VISTA (dinheiro/pix/depósito). Os BOLETOS
 *     PENDENTES continuam no caixa aberto e só "zeram" (pago_em) quando o
 *     pagamento a prazo ocorrer de verdade (webhook do Inter / boletos-sync /
 *     recebimento manual — trigger trg_baixa_boleto_caixa do SQL 167).
 *   - FECHAR continua EXCLUSIVO do ADMIN (isAdminSession) a qualquer momento.
 *   - O caixa "sempre atualiza": polling de 20s no front (CaixaFechamento).
 *
 * POST /api/caixa                      body { acao: 'REGISTRAR' | 'FECHAR' | 'EXCLUIR' }
 *   REGISTRAR [ADMIN | SECRETARIO | VENDEDOR]:
 *     { origem VENDA|ENTREGA|AJUSTE, metodo, valor, saleId?, cliente?, vendedor?, comprovante?, detalhe? }
 *     Grava 1 linha no ledger (dataURL de comprovante vai ao Storage). Idempotente
 *     por venda+método+valor ainda abertos. VENDA/ENTREGA só para vendedor David.
 *     BLOCO 165: a fonte PRINCIPAL é a trigger SQL trg_caixa_david_sales (grava
 *     direto no banco, à prova de sessão expirada) — este POST é redundância
 *     (a idempotência impede duplicar).
 *     RECEBIMENTO/PORTAL recusados (recebimento manual/portal não entra).
 *   EXCLUIR [ADMIN | SECRETARIO] (BLOCO 124):
 *     { id } — apaga UMA linha do LEDGER do caixa ABERTO (fechamento_id null).
 *     Correção do dono: entrada errada no caixa (ex. recebimento a prazo que
 *     poluiu o caixa à vista do David) sai da tela, mas NADA da venda é
 *     tocado (sales/sale_items/comissão/comprovante ficam intactos). Linha já
 *     presa em fechamento é imutável (histórico) -> 409.
 *   FECHAR [ADMIN]:
 *     { observacao? } — cria o snapshot em caixa_fechamentos_geral (totais + jsonb dos
 *     pagamentos) e prende os pagamentos abertos (fechamento_id = id). O caixa
 *     volta a zerar (novo período).
 *
 * SQL: sql/bloco118_caixa_fechamento.sql (tabelas + RLS fechada, service_role only).
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// BLOCO 167: coluna pago_em (SQL 167) pode ainda não existir no banco — o
// filtro "boleto pendente" só entra quando a coluna existe (cache por instância
// com fallback automático no primeiro erro 42703).
// ---------------------------------------------------------------------------
let pagoEmOkCache: boolean | null = null;

function erroColunaFaltando(e: any): boolean {
  const code = String(e?.code || e?.details?.code || '');
  return code === '42703' || /pago_em|does not exist|schema cache/i.test(String(e?.message || ''));
}

/** Query do LEDGER ABERTO do caixa: à vista aberto + boletos PENDENTES (167).
 *  BLOCO 217: limite paramétrico — GET usa 600 (UI), FECHAR usa 5000: o
 *  snapshot do fechamento precisa enxergar TODOS os pagamentos que o update
 *  vai prender (antes, com 600, um caixa com mais de 600 pagamentos à vista
 *  gravaria totais MENORES que o real — números não reais). */
function openLedgerQuery(supabase: any, campos: string, limite = 600) {
  const q = supabase
    .from('caixa_pagamentos')
    .select(campos)
    .is('fechamento_id', null)
    .order('criado_em', { ascending: true })
    .limit(limite);
  // pago_em IS NULL = boleto pendente (não pago). Com a coluna:
  // "metodo != BOLETO OU pago_em IS NULL" = à vista aberto + boletos pendentes.
  return pagoEmOkCache === false ? q : q.or('metodo.neq.BOLETO,pago_em.is.null');
}

/** 503 amigável quando o SQL do bloco 118 ainda não rodou. */
function sqlFaltando(e: any) {
  const msg = String(e?.message || '');
  const code = String(e?.code || '');
  return code === '42P01' || code === 'PGRST205' || /caixa_pagamentos|caixa_fechamentos_geral|does not exist|schema cache/i.test(msg);
}

export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (!['ADMIN', 'SECRETARIO', 'VENDEDOR'].includes(session.perfil)) {
    return NextResponse.json({ ok: false, error: 'Acesso restrito.' }, { status: 403 });
  }

  const supabase = getServiceClient();
  try {
    // Ledger do caixa ABERTO (fechamento_id null): à vista aberto + boletos
    // pendentes — boleto JÁ PAGO (pago_em preenchido) some da conferência (167).
    let { data: rows, error: rowsErr } = await openLedgerQuery(
      supabase,
      'id, criado_em, origem, sale_id, cliente, vendedor, metodo, valor, comprovante, detalhe, usuario_nome'
    );
    // SQL 167 ainda não rodou (coluna pago_em não existe): cai no filtro antigo.
    if (rowsErr && erroColunaFaltando(rowsErr) && pagoEmOkCache !== false) {
      pagoEmOkCache = false;
      ({ data: rows, error: rowsErr } = await openLedgerQuery(
        supabase,
        'id, criado_em, origem, sale_id, cliente, vendedor, metodo, valor, comprovante, detalhe, usuario_nome'
      ));
    } else if (!rowsErr && pagoEmOkCache === null) {
      pagoEmOkCache = true;
    }
    if (rowsErr && sqlFaltando(rowsErr)) {
      return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
    }
    if (rowsErr) throw rowsErr;

    const pags = (rows || []) as any[];
    const totais = { dinheiro: 0, pix: 0, deposito: 0, boleto: 0, total: 0 };
    for (const p of pags) {
      const v = Number(p.valor || 0);
      const m = String(p.metodo || '').toUpperCase();
      if (m === 'DINHEIRO') totais.dinheiro += v;
      else if (m === 'PIX') totais.pix += v;
      else if (m === 'DEPOSITO') totais.deposito += v;
      else if (m === 'BOLETO') totais.boleto += v;
      totais.total += v;
    }
    totais.dinheiro = round2(totais.dinheiro);
    totais.pix = round2(totais.pix);
    totais.deposito = round2(totais.deposito);
    totais.boleto = round2(totais.boleto);
    totais.total = round2(totais.total);

    // Último fechamento = início da janela do caixa corrente
    const { data: ultimo } = await supabase
      .from('caixa_fechamentos_geral')
      .select('fechado_em')
      .order('fechado_em', { ascending: false })
      .limit(1);

    // Histórico (sem o jsonb pesado)
    const { data: hist, error: histErr } = await supabase
      .from('caixa_fechamentos_geral')
      .select('id, fechado_em, fechado_por_nome, total_dinheiro, total_pix, total_deposito, total_geral, qtde_pagamentos, observacao')
      .order('fechado_em', { ascending: false })
      .limit(60);
    if (histErr && sqlFaltando(histErr)) {
      return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      aberto: {
        desde: ultimo?.[0]?.fechado_em || null,
        pagamentos: pags.map((p) => ({
          id: p.id,
          criadoEm: p.criado_em,
          origem: p.origem,
          saleId: p.sale_id,
          cliente: p.cliente,
          vendedor: p.vendedor,
          metodo: p.metodo,
          valor: Number(p.valor || 0),
          temComprovante: !!p.comprovante,
          detalhe: p.detalhe,
          usuarioNome: p.usuario_nome,
        })),
        totais,
      },
      historico: (hist || []).map((f: any) => ({
        id: f.id,
        fechadoEm: f.fechado_em,
        fechadoPorNome: f.fechado_por_nome,
        totais: {
          dinheiro: Number(f.total_dinheiro || 0),
          pix: Number(f.total_pix || 0),
          deposito: Number(f.total_deposito || 0),
          total: Number(f.total_geral || 0),
        },
        qtdePagamentos: Number(f.qtde_pagamentos || 0),
        observacao: f.observacao,
      })),
    });
  } catch (e: any) {
    console.error('[api/caixa][GET] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro ao carregar o caixa.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (!['ADMIN', 'SECRETARIO', 'VENDEDOR'].includes(session.perfil)) {
    return NextResponse.json({ ok: false, error: 'Acesso restrito.' }, { status: 403 });
  }

  const supabase = getServiceClient();
  try {
    const body = await req.json();
    const acao = String(body.acao || '').toUpperCase();

    // ---------------- REGISTRAR (ledger) ----------------
    if (acao === 'REGISTRAR') {
      const metodo = String(body.metodo || '').toUpperCase() as CaixaMetodo;
      if (!['DINHEIRO', 'PIX', 'DEPOSITO', 'BOLETO'].includes(metodo)) {
        return NextResponse.json({ ok: false, error: 'Metodo invalido (DINHEIRO/PIX/DEPOSITO/BOLETO).' }, { status: 400 });
      }
      const valor = Number(body.valor || 0);
      if (!(valor > 0)) {
        return NextResponse.json({ ok: false, error: 'Valor invalido.' }, { status: 400 });
      }
      const origem = String(body.origem || 'AJUSTE').toUpperCase() as CaixaOrigem;
      // BLOCO 118.3 (regra do dono): a prazo NÃO entra no caixa — contas a
      // receber (boletos/pix do portal/recebimentos manuais) ficam nas telas
      // próprias. Só VENDA/ENTREGA (à vista) e AJUSTE (manual do admin).
      if (!['VENDA', 'ENTREGA', 'AJUSTE'].includes(origem)) {
        return NextResponse.json({ ok: false, error: 'Origem invalida: a prazo (recebimento/portal) NAO entra no caixa.' }, { status: 400 });
      }
      // BLOCO 118.3: VENDA/ENTREGA só do DAVID (Rota 5) — os demais vendedores
      // ganham comissão e não têm caixa. Defesa server-side (protege de front
      // antigo em cache).
      const vendNome118 = String(body.vendedor || '').trim();
      if (origem !== 'AJUSTE' && vendNome118 && !isDavidNome(vendNome118)) {
        return NextResponse.json({ ok: false, error: 'Caixa e exclusivo do vendedor David (Rota 5).' }, { status: 403 });
      }
      const comprovante =
        typeof body.comprovante === 'string' && body.comprovante.startsWith('data:image') && body.comprovante.length > 3_500_000
          ? null
          : typeof body.comprovante === 'string'
            ? body.comprovante
            : null;

      // Nome de quem registrou (só tem o id na sessão)
      let usuarioNome: string | null = null;
      if (session.sub && !/^(ADMIN|ENTREGADOR|SECRETARIO)$/.test(session.sub)) {
        const { data: u } = await supabase.from('app_users').select('nome').eq('id', session.sub).limit(1).maybeSingle();
        usuarioNome = (u as any)?.nome || null;
      }

      const r = await registrarPagamentoCaixa(supabase, {
        origem,
        metodo,
        valor,
        saleId: body.saleId ? String(body.saleId) : null,
        cliente: body.cliente ? String(body.cliente) : null,
        vendedor: body.vendedor ? String(body.vendedor) : null,
        comprovante,
        detalhe: body.detalhe ? String(body.detalhe) : null,
        usuarioId: session.sub,
        usuarioNome,
      });
      if (!r.ok) {
        if (sqlFaltando({ message: r.erro })) {
          return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
        }
        return NextResponse.json({ ok: false, error: 'Nao foi possivel registrar no caixa.' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, id: r.id });
    }

    // ---------------- EXCLUIR (correção do ledger) — BLOCO 124 ----------------
    // ADMIN ou SECRETARIO (mesmo guard das mutações de fila do 114/123). Apaga
    // SOMENTE a linha do caixa aberto: venda, itens, comissão etc. ficam.
    if (acao === 'EXCLUIR') {
      if (!isAdminSession(req) && session.perfil !== 'SECRETARIO') {
        return NextResponse.json({ ok: false, error: 'Somente admin/secretario excluem registro do caixa.' }, { status: 403 });
      }
      const idExcluir = String(body.id || '').trim();
      // Postgres: eq em coluna uuid com texto invalido estoura 22P02 -> valida
      // o formato ANTES da query (id lixo vira 400 limpo, nao 500).
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idExcluir)) {
        return NextResponse.json({ ok: false, error: 'Registro invalido.' }, { status: 400 });
      }
      const { data: rowEx, error: rowExErr } = await supabase
        .from('caixa_pagamentos')
        .select('id, origem, metodo, valor, cliente, sale_id, fechamento_id')
        .eq('id', idExcluir)
        .limit(1)
        .maybeSingle();
      if (rowExErr && sqlFaltando(rowExErr)) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
      }
      if (rowExErr) throw rowExErr;
      if (!rowEx) {
        return NextResponse.json({ ok: false, error: 'Registro nao encontrado no caixa.' }, { status: 404 });
      }
      if (rowEx.fechamento_id) {
        return NextResponse.json({ ok: false, error: 'Esse registro já está em um caixa FECHADO — histórico imutável.' }, { status: 409 });
      }
      // Dupla trava: apaga por id E só se ainda estiver aberto
      const { error: delErr } = await supabase
        .from('caixa_pagamentos')
        .delete()
        .eq('id', idExcluir)
        .is('fechamento_id', null);
      if (delErr) throw delErr;
      return NextResponse.json({
        ok: true,
        excluido: {
          id: rowEx.id,
          origem: rowEx.origem,
          metodo: rowEx.metodo,
          valor: Number(rowEx.valor || 0),
          cliente: rowEx.cliente,
          saleId: rowEx.sale_id,
        },
      });
    }

    // ---------------- FECHAR (snapshot) — ADMIN ----------------
    // BLOCO 167 (regra do dono): "quando fechar caixa zera e começa tudo
    // denovo. As vendas a prazo só zera quando o pagamento a prazo ocorrer."
    // Fecha SOMENTE o À VISTA (dinheiro/pix/depósito) — os BOLETOS PENDENTES
    // continuam no caixa aberto (só saem com pago_em — trigger SQL 167).
    if (acao === 'FECHAR') {
      if (!isAdminSession(req)) {
        return NextResponse.json({ ok: false, error: 'Somente o admin fecha o caixa.' }, { status: 403 });
      }

      // Leitura com o MESMO filtro do GET (boleto pendente não entra no
      // fechamento; boleto pago não aparece mais na conferência).
      // BLOCO 217: limite 5000 — snapshot precisa bater com o update global.
      let { data: rows, error: rowsErr } = await openLedgerQuery(
        supabase,
        'id, criado_em, origem, sale_id, cliente, vendedor, metodo, valor, detalhe, usuario_nome',
        5000
      );
      if (rowsErr && erroColunaFaltando(rowsErr) && pagoEmOkCache !== false) {
        pagoEmOkCache = false;
        ({ data: rows, error: rowsErr } = await openLedgerQuery(
          supabase,
          'id, criado_em, origem, sale_id, cliente, vendedor, metodo, valor, detalhe, usuario_nome',
          5000
        ));
      } else if (!rowsErr && pagoEmOkCache === null) {
        pagoEmOkCache = true;
      }
      if (rowsErr && sqlFaltando(rowsErr)) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
      }
      if (rowsErr) throw rowsErr;

      // TRAVA = só o à vista (dinheiro/pix/depósito). Boletos pendentes ficam.
      const trava = ((rows || []) as any[]).filter(
        (p) => String(p.metodo || '').toUpperCase() !== 'BOLETO'
      );
      const totais = { dinheiro: 0, pix: 0, deposito: 0, boleto: 0, total: 0 };
      for (const p of trava) {
        const v = Number(p.valor || 0);
        const m = String(p.metodo || '').toUpperCase();
        if (m === 'DINHEIRO') totais.dinheiro += v;
        else if (m === 'PIX') totais.pix += v;
        else if (m === 'DEPOSITO') totais.deposito += v;
        else if (m === 'BOLETO') totais.boleto += v; // não ocorre (trava sem boleto)
        totais.total += v;
      }
      totais.dinheiro = round2(totais.dinheiro);
      totais.pix = round2(totais.pix);
      totais.deposito = round2(totais.deposito);
      totais.boleto = round2(totais.boleto);
      // BLOCO 167: total_geral = DINHEIRO QUE ENTROU (à vista). Boletos
      // pendentes NÃO são dinheiro no caixa — continuam abertos até o
      // pagamento; o recebido via boleto cai na conta da empresa.
      totais.total = round2(totais.dinheiro + totais.pix + totais.deposito + totais.boleto);

      // Nome do admin que fecha
      let nomeAdmin: string | null = null;
      if (session.sub && !/^ADMIN$/.test(session.sub)) {
        const { data: u } = await supabase.from('app_users').select('nome').eq('id', session.sub).limit(1).maybeSingle();
        nomeAdmin = (u as any)?.nome || null;
      }

      const observacao = String(body.observacao || '').slice(0, 300) || null;
      const janelaInicio = trava.length > 0 ? trava[0].criado_em : null;

      const { data: fech, error: fErr } = await supabase
        .from('caixa_fechamentos_geral')
        .insert({
          janela_inicio: janelaInicio,
          fechado_por_id: session.sub,
          fechado_por_nome: nomeAdmin,
          total_dinheiro: totais.dinheiro,
          total_pix: totais.pix,
          total_deposito: totais.deposito,
          total_geral: totais.total,
          qtde_pagamentos: trava.length,
          observacao,
          // Snapshot de rastreio — SOMENTE os pagamentos À VISTA travados (167).
          pagamentos: trava.map((p) => ({
            pid: p.id,
            criado_em: p.criado_em,
            origem: p.origem,
            sale_id: p.sale_id,
            cliente: p.cliente,
            vendedor: p.vendedor,
            metodo: p.metodo,
            valor: Number(p.valor || 0),
            detalhe: p.detalhe,
            usuario_nome: p.usuario_nome,
          })),
        })
        .select('id, fechado_em, total_geral')
        .single();
      if (fErr && sqlFaltando(fErr)) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
      }
      if (fErr) throw fErr;

      // Prende SOMENTE os pagamentos À VISTA (167): os boletos pendentes
      // continuam com fechamento_id null — sobrevivem ao fechamento até o
      // pagamento a prazo ocorrer.
      const { error: upErr } = await supabase
        .from('caixa_pagamentos')
        .update({ fechamento_id: fech.id })
        .is('fechamento_id', null)
        .neq('metodo', 'BOLETO');
      if (upErr) throw upErr;

      // Boletos pendentes que ficaram abertos (aviso na resposta/UI).
      // Resiliente: se pago_em ainda não existe (SQL 167 pendente), conta todos.
      let pendentesRows: any[] = [];
      let bq = supabase
        .from('caixa_pagamentos')
        .select('valor')
        .is('fechamento_id', null)
        .eq('metodo', 'BOLETO');
      if (pagoEmOkCache !== false) bq = bq.is('pago_em', null);
      const { data: bqData, error: bqErr } = await bq;
      if (bqErr && erroColunaFaltando(bqErr) && pagoEmOkCache !== false) {
        pagoEmOkCache = false;
        const alt = await supabase
          .from('caixa_pagamentos')
          .select('valor')
          .is('fechamento_id', null)
          .eq('metodo', 'BOLETO');
        pendentesRows = alt.data || [];
      } else if (!bqErr) {
        pendentesRows = bqData || [];
      }
      const boletosPendentes = {
        qtde: pendentesRows.length,
        valor: round2(pendentesRows.reduce((a, b) => a + Number(b.valor || 0), 0)),
      };

      return NextResponse.json({
        ok: true,
        fechamento: {
          id: fech.id,
          fechadoEm: fech.fechado_em,
          totalGeral: Number(fech.total_geral || 0),
          qtde: trava.length,
        },
        boletosPendentes,
      });
    }

    return NextResponse.json({ ok: false, error: 'Acao desconhecida.' }, { status: 400 });
  } catch (e: any) {
    console.error('[api/caixa][POST] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro no caixa. Tente novamente.' }, { status: 500 });
  }
}
