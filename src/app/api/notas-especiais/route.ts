import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { isAdminSession } from '@/lib/session';
import { isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { lerEmitentePayload, lerErpConfig } from '@/lib/erpConfig';
import {
  getFocusConfig,
  isFocusConfigured,
  emitirNfe,
  consultarNota,
  interpretarResultado,
  emitenteDaConfig,
  FocusNfePayloadV2,
} from '@/lib/focusNfe';
import { importarAvulsa, invalidaPresenca } from '@/lib/focusArquivos';
import {
  NotaEspecialInput,
  montarNotaEspecial,
  validarNotaEspecial,
} from '@/lib/notaEspecial';

/**
 * BLOCO 182 — NOTAS ESPECIAIS (admin, fora do app) — emissão MANUAL de NF-e
 * modelo 55 para devolução, bonificação e qualquer nota batida na mão.
 *
 * Pedido do dono (18/11): "aba do admin para notas especiais, notas de
 * devolução e bonificação... colocar o destinatário, os produtos, calcular
 * alíquota e trocar os códigos de emissão, como 5102 seria 5202, 6202 fora
 * do estado, cst 0101 seria 0900, nota sairia sem pagamento ao invés de
 * dinheiro... uma forma de eu bater qualquer tipo de nota manualmente".
 *
 * GET  /api/notas-especiais  -> status da integração (Focus configurada,
 *                               ambiente, UF/regime do emitente) p/ o chip da tela.
 * POST /api/notas-especiais  { acao: 'EMITIR', nota: NotaEspecialInput, chaveUnica }
 *                            -> valida (motor puro do notaEspecial.ts), monta o
 *                               payload v2.0, chama a Focus (NF-e) e, quando
 *                               autoriza, ARQUIVA no Portal Fiscal como AVULSA
 *                               (DANFE + XML + metadados — a nota especial nasce
 *                               lista no portal, com DANFE/XML e cancelamento).
 *
 * Idempotência: `chaveUnica` vira a REF na Focus (`ESP-{chave}`) — o MESMO
 * toque duplo/reenvio consulta ANTES de emitir e devolve a nota já existente
 * (nunca duas notas iguais). Sessão: MESMA do portal fiscal (PIN admin).
 */

const BAD = (status: number, erro: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, erro, ...extra }, { status });

const sanitizeRef = (v: unknown): string =>
  String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);

export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponível.');
  }
  if (!isAdminSession(req)) return BAD(401, 'Sessão ADMIN expirada. Entre com o PIN novamente.');

  const cfg = getFocusConfig();
  let uf = cfg.ufEmitente;
  let regime = cfg.regime;
  let emitenteNome = cfg.razao || cfg.fantasia || '';
  try {
    const erp = await lerErpConfig();
    if (erp.emitente?.uf) uf = erp.emitente.uf;
    if (erp.emitente?.regime) regime = erp.emitente.regime;
    if (erp.emitente?.razao) emitenteNome = erp.emitente.razao;
  } catch { /* env sozinho */ }

  return NextResponse.json({
    ok: true,
    focus: {
      configurado: isFocusConfigured(),
      ambiente: cfg.ambiente,
      ufEmitente: String(uf || 'RS').toUpperCase(),
      regime,
      emitenteNome: String(emitenteNome || '').slice(0, 80),
      emitenteCnpj: String(cfg.cnpj || ''),
    },
  });
}

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponível.');
  }
  if (!isAdminSession(req)) return BAD(401, 'Sessão ADMIN expirada. Entre com o PIN novamente.');
  if (!isFocusConfigured()) {
    return BAD(503, 'Focus NFe nao configurada. Defina FOCUS_NFE_TOKEN no Vercel (docs/NOTAS-FISCAIS.md).');
  }

  const body = await req.json().catch(() => ({}));
  if (body.acao !== 'EMITIR') return BAD(400, `Acao desconhecida: ${String(body.acao || '(vazio)')}`);

  const nota = body.nota as NotaEspecialInput | undefined;
  if (!nota || typeof nota !== 'object') return BAD(422, 'Payload da nota ausente.');

  const cfg = getFocusConfig();
  const erp = await lerErpConfig();
  const ufEmitente = String(erp.emitente?.uf || cfg.ufEmitente || 'RS').toUpperCase();
  // Emitente: MESMA fonte da emissão normal (app_settings sobrescreve env).
  const emitentePayload = { ...emitenteDaConfig(), ...((await lerEmitentePayload()) as Partial<FocusNfePayloadV2>) };

  // ---- VALIDAÇÃO (motor puro — mesmas mensagens que a tela mostra) ----
  const val = validarNotaEspecial(nota, ufEmitente);
  if (val.erros.length > 0) {
    return BAD(422, val.erros[0], { erros: val.erros, avisos: val.avisos });
  }

  // ---- REF idempotente (chaveUnica do client) ----
  const chave = sanitizeRef(body.chaveUnica) || `B182${Date.now().toString(36)}`.toUpperCase();
  const ref = `ESP-${chave}`;

  // Guarda anti-duplo-clique REAL: a mesma chaveUnica já emitida devolve a
  // nota existente (a Focus aceita consultar por ref) — nunca sai duas.
  const existe = await consultarNota('nfe', ref);
  if (existe.ok && existe.data && !('erro' in existe.data) && String((existe.data as Record<string, unknown>).status || '')) {
    const prev = interpretarResultado(existe.data as Record<string, unknown>);
    return NextResponse.json({
      ok: prev.autorizada || prev.processando,
      jaEmitida: true,
      nota: montarResposta(ref, prev, []),
    });
  }

  // ---- MONTAGEM + EMISSÃO ----
  const montada = montarNotaEspecial(nota, { ufEmitente, emitentePayload, agora: new Date() });
  const r = await emitirNfe('nfe', ref, montada.payload);
  if (!r.ok || !r.data || 'erro' in r.data) {
    const erro = (r.data as { erro?: string }).erro || `HTTP ${r.status}`;
    return BAD(502, erro, { avisos: val.avisos, ref });
  }

  const res = interpretarResultado(r.data as Record<string, unknown>);

  // -------------------------------------------------------------------
  // BLOCO 182 — a nota especial AUTORIZADA entra NO PORTAL FISCAL como
  // avulsa (DANFE + XML + metadados com cliente/valor/pagamento) em
  // background — o dono acha a devolução/bonificação no mesmo lugar de
  // todas as outras notas, com DANFE/XML e cancelamento dentro do prazo.
  // Best-effort: falha de rede não afeta a emissão (importador cobre).
  // -------------------------------------------------------------------
  if (res.autorizada) {
    after(async () => {
      try {
        await importarAvulsa(ref, 'NFE');
        invalidaPresenca();
      } catch (e) {
        console.warn('[notas-especiais] arquivamento da avulsa falhou (importador cobre):', (e as Error).message);
      }
    });
  }

  const resposta = montarResposta(ref, res, montada.cfopsAjustados, montada.valorTotal);
  return NextResponse.json({
    ok: res.autorizada || res.processando,
    nota: resposta,
    avisos: val.avisos,
  });
}

function montarResposta(
  ref: string,
  res: ReturnType<typeof interpretarResultado>,
  cfopsAjustados: string[],
  valorTotal?: number,
) {
  return {
    status: res.autorizada ? 'AUTORIZADA' : res.processando ? 'EMITINDO' : res.cancelada ? 'CANCELADA' : 'REJEITADA',
    ref,
    numero: res.numero || '',
    serie: res.serie || '',
    chave: res.chave || '',
    protocolo: res.protocolo || '',
    pdfUrl: res.pdfUrl || '',
    xmlUrl: res.xmlUrl || '',
    dataAutorizacao: res.dataAutorizacao || '',
    erro: res.autorizada || res.processando ? '' : res.motivo || 'Aguardando SEFAZ',
    valorTotal: valorTotal ?? res.total ?? 0,
    cfopsAjustados,
    tipo: 'NFE',
  };
}
