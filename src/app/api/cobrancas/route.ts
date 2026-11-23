import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { salvarErpConfig, lerErpConfig, COBRANCA_MENSAGEM_DEFAULT } from '@/lib/erpConfig';
import {
  isInterConfigured,
  listarCobrancas,
  hojeSp,
  type CobrancaColecaoItem,
} from '@/lib/interBoleto';

/**
 * BLOCO 205 — PORTAL DE COBRANCAS (API do dono).
 *
 * GET  /api/cobrancas
 *      -> lista de boletos ATRASADOS buscada na API do Banco Inter
 *         (colecao /cobranca/v3/cobrancas, janela de 180 dias) + cruzamento
 *         com sales_boletos -> sales -> clients para NOME e TELEFONE do
 *         cliente (o botao de cobranca abre o WhatsApp com a mensagem).
 *      Devolve tb a mensagem personalizada (erp_config.cobrancaMensagem).
 *
 * POST /api/cobrancas { acao: 'MENSAGEM', texto }
 *      -> salva a mensagem de cobranca (o dono edita no portal OU nas
 *         Configuracoes — mesma chave erp_config.cobrancaMensagem).
 *
 * Auth: MESMA sessao dos portais (Bearer dm_notas_admin_token, ADMIN).
 * Cache: 60s em memoria (a chamada mTLS ao Inter e lenta — reabrir o portal
 * fica instantaneo; botao ATUALIZAR pede ?forcar=1 pra pular o cache).
 */

const BAD = (status: number, erro: string) => NextResponse.json({ ok: false, erro }, { status });

/** Janela da busca: boletos vencendo nos ULTIMOS 180 dias ate hoje. */
const JANELA_DIAS = 180;

/** Situacoes que FECHAM a cobranca (nao sao atrasadas). O Inter usa estas
 *  nos eventos conhecidos do webhook (Bloco 167/172) + variantes V3. */
const SITUACOES_FECHADAS = new Set([
  'RECEBIDO', 'MARCADO_RECEBIDO', 'PAGO', 'PAGA', 'CONFIRMADO', 'CONFIRMADA',
  'CANCELADO', 'CANCELADA', 'EXPIRADO', 'EXPIRADA', 'REJEITADO', 'REJEITADA',
  'NAOCOBRADO', 'DEVOLVIDO', 'DESCONTADO', 'REMETER', 'FINALIZADO', 'FALHA',
]);

// cache leve (60s) — evita repetir o handshake mTLS a cada refresh do portal
let cacheLista: { ts: number; payload: unknown } | null = null;
const CACHE_MS = 60_000;

export interface BoletoAtrasado {
  codigo: string;
  seuNumero: string;
  situacao: string;
  vencimento: string;        // YYYY-MM-DD
  vencimentoFmt: string;     // DD/MM/YYYY
  valor: number;
  diasAtraso: number;
  cliente: string;           // nome (cadastro -> pagador Inter -> seuNumero)
  telefone: string;          // wa.me pronto (ou vazio)
  saleId: string | null;     // venda atrelada (quando casou no banco)
  parcela: number | null;    // seq da parcela (boleto duplo rota 5)
}

function dataHojeSp(): string { return hojeSp(); }

function dataMenosDiasSp(dias: number): string {
  const d = new Date(new Date(`${hojeSp()}T12:00:00Z`).getTime() - dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Data YYYY-MM-DD -> DD/MM/YYYY */
function fmtData(v: string): string {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

/** Dias de atraso (>= 1) entre vencimento (YYYY-MM-DD) e hoje (SP). */
function diasAtrasoDe(vencimento: string, hoje: string): number {
  const a = new Date(`${vencimento}T12:00:00Z`).getTime();
  const b = new Date(`${hoje}T12:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/** Telefone do cadastro -> wa.me (55 + DDD + numero). Vazio se invalido. */
function telWaMe(tel: string): string {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  while (d.startsWith('0')) d = d.slice(1);
  if (d.length >= 12 && d.length <= 13 && d.startsWith('55')) return d;
  if (d.length >= 10 && d.length <= 11) return `55${d}`;
  return '';
}

export async function GET(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Entre com o PIN novamente.');
  if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin acessa o portal de cobrancas.');

  const forcar = req.nextUrl.searchParams.get('forcar') === '1';
  if (!forcar && cacheLista && Date.now() - cacheLista.ts < CACHE_MS) {
    return NextResponse.json(cacheLista.payload);
  }

  const erp = await lerErpConfig();

  // Inter nao configurado: o portal abre mesmo assim (mostra o aviso de env).
  if (!isInterConfigured()) {
    return NextResponse.json({
      ok: true,
      interConfigurado: false,
      mensagem: erp.cobrancaMensagem,
      mensagemPadrao: COBRANCA_MENSAGEM_DEFAULT,
      atrasados: [] as BoletoAtrasado[],
      totalAtrasado: 0,
    });
  }

  const hoje = dataHojeSp();
  const lista = await listarCobrancas({
    dataInicial: dataMenosDiasSp(JANELA_DIAS),
    dataFinal: hoje,
    size: 100,
    maxPaginas: 5,
  });
  if (!lista.ok) {
    // Erro do Inter: devolve erro (o portal mostra) — mensagem segue pra edição.
    return NextResponse.json({
      ok: false,
      erro: `Falha ao consultar o Inter: ${lista.erro || 'erro desconhecido'}`,
      interConfigurado: true,
      mensagem: erp.cobrancaMensagem,
      mensagemPadrao: COBRANCA_MENSAGEM_DEFAULT,
      atrasados: [],
      totalAtrasado: 0,
    });
  }

  // ---------- cruzamento com o banco (nome/telefone/sale) ----------
  const db = getServiceClient();
  const [boletos, vendas, clientes] = await Promise.all([
    db.from('sales_boletos').select('sale_id, seq, valor, vencimento, status, codigo, seu_numero'),
    db.from('sales').select('id, client_id'),
    db.from('clients').select('id, nome_fantasia, nome, telefone'),
  ]);

  const boletoPorChave = new Map<string, Record<string, unknown>>();
  const addChave = (k: unknown, row: Record<string, unknown>) => {
    const s = String(k || '').trim();
    if (s) boletoPorChave.set(s, row);
  };
  for (const b of boletos.data || []) {
    addChave((b as Record<string, unknown>).codigo, b as Record<string, unknown>);
    addChave((b as Record<string, unknown>).seu_numero, b as Record<string, unknown>);
  }
  const vendaPorId = new Map<string, Record<string, unknown>>();
  for (const s of vendas.data || []) vendaPorId.set(String((s as Record<string, unknown>).id || ''), s as Record<string, unknown>);
  const clientePorId = new Map<string, Record<string, unknown>>();
  for (const c of clientes.data || []) clientePorId.set(String((c as Record<string, unknown>).id || ''), c as Record<string, unknown>);

  const nomeDe = (saleId: string | null, fallbackDoc: string, fallback: string): string => {
    if (saleId) {
      const cli = clientePorId.get(String(vendaPorId.get(saleId)?.client_id || ''));
      const nm = String(cli?.nome_fantasia || cli?.nome || '').trim();
      if (nm) return nm;
    }
    if (fallbackDoc) {
      // cliente pelo documento do pagador (boletos antigos sem sale atrelada)
      for (const c of clientes.data || []) {
        const doc = String((c as Record<string, unknown>).cnpj || '').replace(/\D/g, '') || String((c as Record<string, unknown>).cpf || '').replace(/\D/g, '');
        if (doc && doc === fallbackDoc) {
          const nm = String((c as Record<string, unknown>).nome_fantasia || (c as Record<string, unknown>).nome || '').trim();
          if (nm) return nm;
        }
      }
    }
    return fallback || 'Cliente';
  };

  const telefoneDe = (saleId: string | null): string => {
    if (!saleId) return '';
    const cli = clientePorId.get(String(vendaPorId.get(saleId)?.client_id || ''));
    return telWaMe(String(cli?.telefone || ''));
  };

  const atrasados: BoletoAtrasado[] = lista.itens
    .filter((it: CobrancaColecaoItem) =>
      it.vencimento && it.vencimento < hoje && !SITUACOES_FECHADAS.has(it.situacao.toUpperCase()))
    .map((it: CobrancaColecaoItem) => {
      const row = boletoPorChave.get(it.codigo) || boletoPorChave.get(it.seuNumero) || null;
      const saleId = row ? (String(row.sale_id || '') || null) : null;
      return {
        codigo: it.codigo,
        seuNumero: it.seuNumero,
        situacao: it.situacao,
        vencimento: it.vencimento,
        vencimentoFmt: fmtData(it.vencimento),
        valor: Number(it.valor ?? (row ? Number(row.valor) : 0)) || 0,
        diasAtraso: diasAtrasoDe(it.vencimento, hoje),
        cliente: nomeDe(saleId, it.pagadorDoc, it.pagadorNome),
        telefone: telefoneDe(saleId),
        saleId,
        parcela: row && row.seq != null ? Number(row.seq) : null,
      };
    })
    .sort((a, b) => (b.vencimento < a.vencimento ? 1 : b.vencimento > a.vencimento ? -1 : 0));

  const payload = {
    ok: true,
    interConfigurado: true,
    mensagem: erp.cobrancaMensagem,
    mensagemPadrao: COBRANCA_MENSAGEM_DEFAULT,
    atrasados,
    totalAtrasado: Number(atrasados.reduce((acc, x) => acc + x.valor, 0).toFixed(2)),
    consultadoEm: new Date().toISOString(),
  };
  cacheLista = { ts: Date.now(), payload };
  return NextResponse.json(payload);
}

export async function POST(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Entre com o PIN novamente.');
  if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin acessa o portal de cobrancas.');

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const acao = String(body.acao || '');

  if (acao === 'MENSAGEM') {
    if (typeof body.texto !== 'string') return BAD(422, 'Envie o campo texto.');
    const texto = body.texto.trim().slice(0, 600);
    if (!texto) return BAD(422, 'A mensagem nao pode ficar vazia.');
    const r = await salvarErpConfig({ cobrancaMensagem: texto });
    if (!r.ok) return BAD(500, `Falha ao salvar: ${r.erro}`);
    return NextResponse.json({ ok: true, mensagem: r.config?.cobrancaMensagem || texto });
  }

  return BAD(400, `Acao desconhecida: ${acao}`);
}
