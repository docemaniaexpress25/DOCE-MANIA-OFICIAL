import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasNotaColumns, hasBoletoColumns } from '@/lib/serverSchema';
import { isFocusConfigured, consultarNota, interpretarResultado, FocusDoc } from '@/lib/focusNfe';

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
  // --- autorizacao: cron (Bearer CRON_SECRET) OU admin logado ---
  const auth = req.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET || '';
  const viaCron = secret && auth === `Bearer ${secret}`;
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

  return NextResponse.json({
    ok: true,
    varridas: fila.length,
    processadas: resultados.length,
    autorizadas: resultados.filter((r) => r.status === 'AUTORIZADA').length,
    resultados,
  });
}

/** sonda tolerante (evita import de hasNotaEmitidaEm? — reusa serverSchema) */
async function hasNotaEmitidaEmSafe(): Promise<boolean> {
  const { hasNotaEmitidaEm } = await import('@/lib/serverSchema');
  return hasNotaEmitidaEm();
}
