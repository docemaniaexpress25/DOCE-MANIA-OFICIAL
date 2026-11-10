import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/serverSupabase';
import { getSpedyConfig, verificarAssinaturaWebhook, decompoeIntegrationId } from '@/lib/spedy';
import { hasNotaColumns } from '@/lib/serverSchema';

/**
 * WEBHOOK DA SPEDY (Bloco 95) — receptor das notificações de ciclo de vida
 * das notas e das notas recebidas (compras).
 *
 * POST /api/spedy/webhook
 * Headers assinados (Standard Webhooks): webhook-id, webhook-timestamp,
 * webhook-signature ("v1,base64" — uma ou mais durante rotação).
 * Corpo: { id, event, data } — data = mesmo formato do GET correspondente.
 *
 * Eventos esperados:
 *   invoice.status_changed   -> qualquer transição (criação, autorização,
 *                               rejeição, cancelamento, contingência)
 *   invoice.authorized / rejected / canceled / contingency -> específicos
 *   inbound_invoice.detected -> compra detectada (resumo, isComplete=false)
 *   inbound_invoice.completed-> XML completo liberado após manifestação (NF-e)
 *   inbound_invoice.event    -> evento novo em nota recebida
 *
 * Comportamento (padrão de transição do projeto):
 * 1. Sem SPEDY_WEBHOOK_SECRET configurado -> 503 com instrução (o endpoint
 *    fica EXPOSTO na internet: sem segredo ele não aceita nada).
 * 2. Assinatura inválida -> 401 (Spedy reenvia; forjado é barrado).
 * 3. Tabela spedy_webhook_events ausente -> 200 sem armazenar (log local),
 *    para o SQL do Bloco 95 rodar DEPOIS do deploy sem quebrar entregas.
 * 4. SPEDY_ENABLED != '1' -> armazena, responde processado=false (estado
 *    observador: nada no app muda até o dono ligar).
 * 5. SPEDY_ENABLED = '1' -> além de armazenar, atualiza sales.nota_* nas
 *    transições de status (baixa de estoque na autorização entra na fase
 *    seguinte, com sonda de estoque, como no fluxo do Bloco 85/Focus).
 *
 * Resposta 200 SEMPRE para evento válido (dedup pelo id da entrega — a Spedy
 * pode reenviar o mesmo evento; repetido é reconhecido e ignorado).
 */

interface SpedyEvento {
  id?: string;
  event?: string;
  data?: Record<string, unknown>;
}

const BAD = (status: number, erro: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, erro, ...extra }, { status });

export async function POST(req: NextRequest) {
  const cfg = getSpedyConfig();

  const corpoCru = await req.text();
  if (!corpoCru) return BAD(400, 'Corpo vazio');

  // 1. Segredo/assinatura obrigatórios (Standard Webhooks)
  const assinatura = await verificarAssinaturaWebhook(req.headers, corpoCru);
  if (!assinatura.valido) {
    console.warn('[spedy-webhook] assinatura recusada:', assinatura.motivo);
    return BAD(cfg.webhookSecret ? 401 : 503, assinatura.motivo, {
      instrucao: cfg.webhookSecret ? undefined : 'Configure SPEDY_WEBHOOK_SECRET (valor de GET /v1/webhooks/secret).',
    });
  }

  // 2. Parse do envelope
  let evento: SpedyEvento;
  try {
    evento = JSON.parse(corpoCru) as SpedyEvento;
  } catch {
    return BAD(400, 'Corpo não é JSON válido');
  }
  const eventoId = evento.id || req.headers.get('webhook-id') || '';
  const tipoEvento = evento.event || '';
  const data = evento.data || {};

  // 3. Armazenamento bruto (dedup pela PK id). Tabela ausente não quebra a entrega.
  let armazenado = false;
  let duplicado = false;
  try {
    const db = getServiceClient();
    const { error } = await db.from('spedy_webhook_events').insert({
      id: eventoId || null,
      event: tipoEvento,
      payload: evento as unknown,
      recebido_em: new Date().toISOString(),
    });
    if (!error) armazenado = true;
    else if (error.code === '23505') duplicado = true; // entrega repetida
    else console.warn('[spedy-webhook] falha ao armazenar (tabela ausente?):', error.message);
  } catch (e) {
    console.warn('[spedy-webhook] exceção ao armazenar:', (e as Error).message);
  }

  // 4. Processamento (desligado até o dono ligar SPEDY_ENABLED=1)
  let processado = false;
  let acao = 'armazenado';

  if (cfg.enabled && !duplicado) {
    const refNota = (data.integrationId as string) || '';
    const { saleId } = decompoeIntegrationId(refNota);

    if (tipoEvento.startsWith('invoice.') && saleId) {
      // Transição de nota EMITIDA por nós -> espelha no espelho da venda.
      const status = String(data.status || '');
      if (await hasNotaColumns()) {
        const patch: Record<string, unknown> = { nota_status: status };
        if (status === 'authorized') {
          if (data.number != null) patch.nota_numero = String(data.number);
          const accessKey = data.accessKey as string | undefined;
          if (accessKey) patch.nota_ref = accessKey;
          patch.nota_erro = null;
          // TODO Fase seguinte (Bloco 96+): baixa de estoque aqui — só na
          // AUTORIZAÇÃO (fato gerador), com sonda de estoque, como no Focus.
        } else if (status === 'rejected') {
          const det = (data.processingDetail as string) || '';
          patch.nota_erro = det.slice(0, 500) || 'Rejeitada pela SEFAZ';
        } else if (status === 'canceled') {
          patch.nota_status = 'cancelado';
        } else if (status === 'inContingent') {
          patch.nota_erro = 'Contingência (SVC/offline) — aguardando autorização definitiva';
        }
        try {
          await getServiceClient().from('sales').update(patch).eq('id', saleId);
          processado = true;
          acao = `sales.nota_status=${status}`;
        } catch (e) {
          console.warn('[spedy-webhook] falha ao atualizar sales:', (e as Error).message);
        }
      }
    } else if (tipoEvento.startsWith('inbound_invoice.')) {
      // Compras detectadas/completas -> TODO Fase 2 (entrada automática no
      // estoque central + custo real). Por enquanto só armazena o bruto.
      processado = true;
      acao = `inbound armazenado (${tipoEvento})`;
    }
  }

  return NextResponse.json({
    ok: true,
    armazenado,
    duplicado,
    processado,
    acao,
  });
}

// Confirmação de vida do endpoint (sem segredo, só informa que existe).
export async function GET() {
  const cfg = getSpedyConfig();
  return NextResponse.json({
    ok: true,
    webhook: 'spedy',
    configurado: !!cfg.webhookSecret,
    enabled: cfg.enabled,
    ambiente: cfg.ambiente,
  });
}
