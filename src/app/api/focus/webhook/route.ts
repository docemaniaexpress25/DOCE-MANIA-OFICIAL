import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { hasNotaColumns, hasBoletoColumns, hasNotaEmitidaEm } from '@/lib/serverSchema';
import { consultarNota, interpretarResultado, FocusDoc, FocusNotaResultado } from '@/lib/focusNfe';

/**
 * BLOCO 116 — WEBHOOK DA FOCUS NFE: status da nota em TEMPO REAL.
 *
 * A documentacao oficial (doc.focusnfe.com.br — utilizando-webhooks +
 * reference/webhooks) recomenda gatilho em vez de polling: quando um
 * documento muda de status na SEFAZ, a Focus envia POST JSON para esta URL.
 * BLOCO 117 (doc utilizando-webhooks — boas praticas): a Focus monitora a
 * LATENCIA dos endpoints de webhook e prioriza quem responde rapido. Por isso:
 * valida segredo, acha a venda e RESPONDE 200 na hora; a re-consulta na Focus
 * e o patch na venda rodam dentro de after() (next/server, background do
 * runtime). Resultado igual ao de antes, com zero retencao da conexao.
 *
 * Eventos recebidos aqui (doc docs/webhooks — cada gatilho monitora UM evento
 * e a notificacao traz os MESMOS dados da consulta GET): nfe (NF-e autorizada),
 * nfce (NFC-e autorizada) e nfce_contingencia (desfecho da NFC-e offline:
 * efetivada/cancelada/inutilizada). A logica e a mesma para os tres: pega a
 * ref do corpo e RECONSULTA na Focus (nunca confia no payload).
 *
 * O cron diario (/api/notas-sync) continua como fallback (reenvios da Focus
 * duram 48h; depois disso o polling sincroniza o que sobrar).
 *
 * SEGURANCA (mesma filosofia do webhook do Inter — nunca confiar no payload):
 * 1. A Focus manda o segredo no header `x-dm-token` (registrado no gatilho
 *    via API /v2/hooks, campo authorization/authorization_header). O segredo
 *    e o env FOCUS_WEBHOOK_SECRET (fallback CRON_SECRET) na Vercel.
 * 2. Mesmo com header valido, o app NAO usa o corpo: RE-CONSULTA a nota
 *    direto na API da Focus (GET /v2/nfe|nfce/{ref}) e so ai espelha o
 *    resultado na venda. Payload mentiroso nao move nota.
 *
 * O que faz quando a nota esta AUTORIZADA/CANCELADA/REJEITADA:
 *   sales.nota_status / nota_numero / nota_pdf_url / nota_xml_url / nota_erro
 *   (+ nota_chave p/ boleto Inter e nota_emitida_em — BLOCOS 25/108).
 *
 * Idempotente: reenvio da Focus reprocessa sem efeitos colaterais (o patch
 * e deterministico). Responde 200 SEMPRE (uma resposta 2xx reconhecida
 * encerra os reenvios do evento).
 */

const BAD = (status: number, erro: string) => NextResponse.json({ ok: false, erro }, { status });

/** Segredo que o INSTALAR_WEBHOOK registra na Focus e que ela manda de volta. */
function segredoDoWebhook(): string {
  return process.env.FOCUS_WEBHOOK_SECRET || process.env.CRON_SECRET || '';
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    webhook: 'focus-nfe',
    configurado: isServerSupabaseConfigured() && !!segredoDoWebhook(),
    instrucao:
      'Instale pelo ERP Fiscal (Configuracoes) — cria os gatilhos nfe/nfce/nfce_contingencia na Focus apontando para esta URL. A notificacao e RE-CONSULTADA na Focus antes de atualizar a venda (resposta imediata, reconsulta em background).',
  });
}

export async function POST(req: NextRequest) {
  // A Focus chama a URL publico direto (sem sessao) — ponte dev nao se aplica.
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: true, processado: false, motivo: 'SERVIDOR_NAO_CONFIGURADO' });
  }

  const segredo = segredoDoWebhook();
  if (!segredo) {
    // Sem segredo no servidor nao ha como validar: nao atualiza (200 encerra reenvios)
    return NextResponse.json({ ok: true, processado: false, motivo: 'SEM_SEGREDO' });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // O gatilho e instalado com authorization_header = x-dm-token; aceito tambem
  // Authorization: Bearer <segredo> por robustez (se o dono registrar assim).
  const viaHeader = String(req.headers.get('x-dm-token') || '').trim();
  const viaAuth = String(req.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (viaHeader !== segredo && viaAuth !== segredo) {
    console.warn('[focus-webhook] segredo invalido — payload descartado');
    return NextResponse.json({ ok: false, processado: false, motivo: 'SEGREDO_INVALIDO' }, { status: 401 });
  }

  // ref do documento alterado (mesmo formato da operacao de consulta)
  const nested = (body.nfe || body.notafiscal || body.documento) as Record<string, unknown> | undefined;
  const ref = String(body.ref || body.referencia || nested?.ref || '').trim();
  const evento = String(body.event || '').trim();
  if (!ref) {
    return NextResponse.json({ ok: true, processado: false, motivo: 'SEM_REF' });
  }

  if (!(await hasNotaColumns())) {
    return NextResponse.json({ ok: true, processado: false, motivo: 'SCHEMA_ANTIGO' });
  }

  const db = getServiceClient();
  const COLS = 'id, nota_ref, nota_tipo, nota_status';

  // 1. Acha a venda pela ref exata (a ultima emissao desta venda)
  let sale: Record<string, unknown> | null = null;
  const { data: pelaRef } = await db.from('sales').select(COLS).eq('nota_ref', ref).limit(1).maybeSingle();
  sale = (pelaRef as Record<string, unknown> | null) || null;

  // 2. Fallback: ref antiga apos reemissao (nota_ref agora e -r2...) — acha
  //    pelo saleId e a reconsulta abaixo usa a ref ATUAL do banco.
  let saleId = sale ? String(sale.id) : '';
  if (!sale) {
    const saleIdDaRef = ref.match(/^VENDA-(.+?)(?:-r\d+)?$/i);
    const id = saleIdDaRef ? saleIdDaRef[1] : '';
    if (id) {
      const { data: peloId } = await db.from('sales').select(COLS).eq('id', id).limit(1).maybeSingle();
      sale = (peloId as Record<string, unknown> | null) || null;
      saleId = sale ? String(sale.id) : '';
    }
  }
  if (!sale || !saleId) {
    return NextResponse.json({ ok: true, processado: false, motivo: 'VENDA_NAO_ENCONTRADA' });
  }

  const refAtual = String(sale.nota_ref || ref);
  const docNota: FocusDoc = sale.nota_tipo === 'NFCE' ? 'nfce' : 'nfe';

  // BLOCO 117 (doc utilizando-webhooks): resposta IMEDIATA apos validar —
  // a re-consulta na Focus e o patch na venda rodam no after().
  after(async () => {
    try {
      // 3. Re-consulta na Focus (nunca confia no payload)
      const r = await consultarNota(docNota, refAtual);
      if (!r.ok || !r.data || 'erro' in r.data) {
        // Falha na reconsulta: o cron/botao manual cobre depois — nunca travamos.
        console.warn(`[focus-webhook] (${evento}) falha reconsulta ref=${refAtual}`);
        return;
      }

      const res = interpretarResultado(r.data as unknown as FocusNotaResultado);
      const patch: Record<string, unknown> = {
        nota_status: res.autorizada
          ? 'AUTORIZADA'
          : res.cancelada
            ? 'CANCELADA'
            : res.processando
              ? 'EMITINDO'
              : 'REJEITADA',
        nota_numero: res.numero || null,
        nota_pdf_url: res.pdfUrl || null,
        nota_xml_url: res.xmlUrl || null,
        nota_erro: res.autorizada ? null : res.motivo || null,
      };
      if (res.chave && (await hasBoletoColumns())) patch.nota_chave = res.chave;
      if (res.autorizada && (await hasNotaEmitidaEm())) patch.nota_emitida_em = new Date().toISOString();

      const { error } = await getServiceClient().from('sales').update(patch).eq('id', saleId);
      if (error) console.error('[focus-webhook] falha ao atualizar venda:', error.message);
    } catch (e: unknown) {
      console.error('[focus-webhook] excecao no after():', (e as Error).message);
    }
  });

  return NextResponse.json({ ok: true, processado: true, evento, venda: saleId });
}
