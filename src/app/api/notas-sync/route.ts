import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasNotaColumns, hasBoletoColumns } from '@/lib/serverSchema';
import { isFocusConfigured, consultarNota, interpretarResultado, FocusDoc, garantirHooksFocus } from '@/lib/focusNfe';
// BLOCO 154: as notas AVULSAS (painel da Focus / XML de terceiro / arquivadas
// de venda excluida) tambem sincronizam status no cron.
import { listarMetasAvulsas, importarAvulsa, invalidaPresenca } from '@/lib/focusArquivos';

/**
 * BLOCO 108 — SINCRONIZACAO AUTOMATICA DE NOTAS (cron da Vercel).
 *
 * A emissao pode voltar "processando_autorizacao" (202) — a SEFAZ demora.
 * Antes disso so atualizava com clique ("Atualizar situacao"); agora o cron
 * consulta a Focus de 5 em 5 minutos e espelha o resultado na venda.
 *
 * GET /api/notas-sync  (sem sessao!)
 *   Autorizacao: header `Authorization: Bearer ${CRON_SECRET}` — a Vercel Cron
 *   envia esse header automaticamente quando a env CRON_SECRET existe.
 *   ADMIN logado tambem pode chamar (botao futuro "sincronizar agora").
 *
 * VARRE: sales com nota_status = 'EMITINDO' e nota_ref preenchida (max 15
 * por rodada — rate limit da Focus respeitado). Atualiza status/numero/pdf/
 * xml/chave e grava nota_emitida_em quando autoriza. Degradacao graciosa
 * total: colunas ausentes ou Focus nao configurada = no-op ok.
 */

const LIMITE = 15;

export async function GET(req: NextRequest) {
  // Preview/bridge primeiro (padrao do projeto): no sandbox quem responde e a
  // producao — o token do portal do admin nasce assinado LA, entao a roda de
  // "Sincronizar status" do portal só valida se rodar no mesmo ambiente.
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
  }

  // --- autorizacao: cron (Bearer CRON_SECRET OU x-vercel-cron) OU admin ---
  // BLOCO 222: a Vercel SEMPRE marca as invocacoes do proprio cron com o
  // header x-vercel-cron: 1, mesmo sem CRON_SECRET configurada. Sem isso o
  // cron tomava 401 e o sync de notas nunca rodava (mesma causa raiz
  // diagnosticada no sync de boletos em producao).
  const auth = req.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET || '';
  const viaCron = (secret && auth === `Bearer ${secret}`) || req.headers.get('x-vercel-cron') === '1';
  const session = sessionFromRequest(req);
  const viaAdmin = session?.perfil === 'ADMIN';
  if (!viaCron && !viaAdmin) {
    return NextResponse.json({ ok: false, erro: 'Nao autorizado (cron ou admin).' }, { status: 401 });
  }

  if (!(await hasNotaColumns())) {
    return NextResponse.json({ ok: true, processadas: 0, motivo: 'SCHEMA_ANTIGO' });
  }
  if (!isFocusConfigured()) {
    return NextResponse.json({ ok: true, processadas: 0, motivo: 'FOCUS_NAO_CONFIGURADA' });
  }

  // BLOCO 147: auto-reparo dos gatilhos da Focus a cada rodada do cron — se
  // o `nfce` (ou qualquer outro) sumir da conta, o cron recria em minutos.
  // Sem isso, notas batidas no painel da Focus ficavam invisiveis ate o
  // proximo backup mensal (bug "7 no painel, 5 no nosso").
  let hooksReparados: string[] = [];
  if (process.env.FOCUS_WEBHOOK_SECRET || process.env.CRON_SECRET) {
    const origin2 = process.env.DM_PROD_URL || 'https://sistema-doce-mania1.vercel.app';
    try {
      const g = await garantirHooksFocus(`${origin2.replace(/\/$/, '')}/api/focus/webhook`);
      hooksReparados = g.criados;
    } catch { /* best-effort — o importador tambem repara */ }
  }

  const db = getServiceClient();
  const temEmitidaEm = await hasNotaEmitidaEmSafe();
  const temBoletoCols = await hasBoletoColumns();

  const { data: pendentes, error } = await db
    .from('sales')
    .select('id, nota_ref, nota_tipo, nota_status, nota_numero, nota_pdf_url, nota_xml_url, nota_erro')
    .eq('nota_status', 'EMITINDO')
    .not('nota_ref', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(LIMITE);

  // updated_at pode nao existir — fallback sem ordenacao fina
  let fila = (pendentes || []) as Record<string, unknown>[];
  if (error) {
    const retry = await db
      .from('sales')
      .select('id, nota_ref, nota_tipo, nota_status, nota_numero, nota_pdf_url, nota_xml_url, nota_erro')
      .eq('nota_status', 'EMITINDO')
      .not('nota_ref', 'is', null)
      .limit(LIMITE);
    fila = (retry.data || []) as Record<string, unknown>[];
  }

  const resultados: { saleId: string; status: string; erro?: string }[] = [];

  for (const s of fila) {
    const saleId = String(s.id);
    const ref = String(s.nota_ref || '');
    if (!ref) continue;
    const doc: FocusDoc = s.nota_tipo === 'NFCE' ? 'nfce' : 'nfe';

    try {
      const r = await consultarNota(doc, ref);
      if (!r.ok || !r.data || 'erro' in r.data) {
        resultados.push({ saleId, status: 'CONSULTA_FALHOU', erro: (r.data as { erro?: string }).erro || `HTTP ${r.status}` });
        continue;
      }
      const res = interpretarResultado(r.data as Record<string, unknown>);
      const patch: Record<string, unknown> = {
        nota_status: res.autorizada ? 'AUTORIZADA' : res.cancelada ? 'CANCELADA' : res.motivo ? 'REJEITADA' : 'EMITINDO',
        nota_numero: res.numero || s.nota_numero || null,
        nota_pdf_url: res.pdfUrl || s.nota_pdf_url || null,
        nota_xml_url: res.xmlUrl || s.nota_xml_url || null,
        nota_erro: res.autorizada ? null : res.motivo || null,
      };
      if (res.chave && temBoletoCols) patch.nota_chave = res.chave;
      if (res.autorizada && temEmitidaEm) patch.nota_emitida_em = new Date().toISOString();

      const { error: updErr } = await db.from('sales').update(patch).eq('id', saleId);
      if (updErr && temEmitidaEm && JSON.stringify(updErr).includes('nota_emitida_em')) {
        delete patch.nota_emitida_em;
        await db.from('sales').update(patch).eq('id', saleId);
      }
      resultados.push({ saleId, status: String(patch.nota_status) });
    } catch (e: unknown) {
      resultados.push({ saleId, status: 'EXCECAO', erro: (e as Error).message });
    }
  }

  // -----------------------------------------------------------------
  // BLOCO 154 — STATUS DAS AVULSAS TAMBEM SINCRONIZA ("100% sincronizado
  // com a api focus principalmente na questao de quando muda o status da
  // nota"): notas importadas do painel da Focus / XML de terceiro /
  // arquivadas de venda excluida podem mudar de status na SEFAZ
  // (cancelamento tardio, denegacao). O cron reconsulta as que ainda NAO
  // estao em estado final e atualiza os metadados (reimportacao idempotente
  // — mesma ref = mesmo JSON sobrescrito). Lote curto: rate limit.
  // -----------------------------------------------------------------
  const FINAIS = new Set(['AUTORIZADO', 'CANCELADO', 'REJEITADO', 'ERRO_AUTORIZACAO', 'DENEGADO', 'INUTILIZADO']);
  let avulsasAtualizadas = 0;
  try {
    const metas = await listarMetasAvulsas();
    const aRefrescar = metas
      .filter((m) => !FINAIS.has(String(m.status || '').toUpperCase()))
      .slice(0, 6);
    for (const m of aRefrescar) {
      const r = await importarAvulsa(m.ref, m.doc === 'NFCE' ? 'NFCE' : 'NFE');
      if (r.ok) avulsasAtualizadas++;
    }
    if (avulsasAtualizadas > 0) invalidaPresenca();
  } catch { /* best-effort — o portal cobre depois */ }

  return NextResponse.json({
    ok: true,
    varridas: fila.length,
    processadas: resultados.length,
    autorizadas: resultados.filter((r) => r.status === 'AUTORIZADA').length,
    avulsasAtualizadas,
    hooksReparados,
    resultados,
  });
}

/** sonda tolerante (evita import de hasNotaEmitidaEm? — reusa serverSchema) */
async function hasNotaEmitidaEmSafe(): Promise<boolean> {
  const { hasNotaEmitidaEm } = await import('@/lib/serverSchema');
  return hasNotaEmitidaEm();
}
