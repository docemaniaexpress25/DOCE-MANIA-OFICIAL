import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
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
 * BLOCO 218 — CORRECAO: o portal mostrava "Nenhum boletado atrasado" com
 * boletos vencidos reais. 2 causas corrigidas:
 *   1) A colecao do Inter estava na spec V2 deprecada (size/page + resposta
 *      `itens`) — a V3 usa paginacao.paginaAtual/itensPorPagina e responde em
 *      `cobrancas`/`totalPaginas` (fix no listarCobrancas de interBoleto.ts);
 *   2) Os boletos do fluxo ANTIGO (Bloco 25) gravam em sales.inter_boleto_* e
 *      o fallback LOCAL so olhava sales_boletos — boletos vencidos antigos
 *      sumiam. Agora o banco local (sales_boletos + sales.inter_boleto_*)
 *      alimenta o portal tanto no fallback quanto como REDE DE SEGURANCA
 *      mesclada a lista do Inter (dedup por codigo/seuNumero/parcela).
 *
 * GET  /api/cobrancas
 *      -> lista de boletos ATRASADOS (janela de 180 dias) da API do Banco
 *         Inter (colecao /cobranca/v3/cobrancas) MESCLADA com os vencidos em
 *         aberto gravados no banco local (sales_boletos + sales.inter_boleto_*)
 *         + cruzamento com clients para NOME e TELEFONE (o botao de cobranca
 *         abre o WhatsApp com a mensagem).
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

// ---------------------------------------------------------------------------
// BLOCO 218 — BOLETOS VENCIDOS DO BANCO LOCAL (rede de seguranca)
//
// O Inter e a fonte oficial da cobranca, mas o app tem 2 locais de gravacao:
//   - sales_boletos (Bloco 199+, boleto unico/duplo novo);
//   - sales.inter_boleto_* (Bloco 25, fluxo antigo — boletos emitidos ate
//     a migracao, os que o dono precisa cobrar HOJE).
// Sem o Inter configurado, o portal caia SO em sales_boletos e os antigos
// sumiam. Agora `boletosLocaisVencidos` junta os DOIS; no caminho INTER eles
// entram como rede de seguranca (dedup), cobrindo boleto que o Inter nao
// devolveu (paginacao, cobranca emitida fora do app, parcela nunca emitida).
// ---------------------------------------------------------------------------

/** Status de cobranca em aberto (boleto que ainda pode ser cobrado). */
const STATUS_ABERTO = new Set(['NAO_GERADO', 'EM_PROCESSAMENTO', 'A_RECEBER', 'ATRASADO']);

/** Busca vencidos em aberto nos DOIS locais e mapeia p/ BoletoAtrasado. */
async function boletosLocaisVencidos(
  db: SupabaseClient,
  hoje: string,
  clientePorId: Map<string, Record<string, unknown>>,
  vendaPorId: Map<string, Record<string, unknown>>
): Promise<BoletoAtrasado[]> {
  const desde = dataMenosDiasSp(JANELA_DIAS);
  const [bRes, sRes] = await Promise.all([
    db.from('sales_boletos')
      .select('sale_id, seq, valor, vencimento, status, codigo, seu_numero')
      .gte('vencimento', desde)
      .lt('vencimento', hoje)
      .order('vencimento', { ascending: true })
      .limit(500),
    db.from('sales')
      .select('id, client_id, valor_total, inter_boleto_status, inter_boleto_codigo, inter_boleto_seu_numero, inter_boleto_vencimento, inter_boleto_valor')
      .neq('inter_boleto_codigo', null)
      .gte('inter_boleto_vencimento', desde)
      .lt('inter_boleto_vencimento', hoje)
      .order('inter_boleto_vencimento', { ascending: true })
      .limit(500),
  ]);

  const nomeClienteDe = (saleId: string | null): string => {
    const cli = clientePorId.get(String(vendaPorId.get(saleId || '')?.client_id || ''));
    return String(cli?.nome_fantasia || cli?.nome || '') || 'Cliente';
  };
  const telDe = (saleId: string | null): string => {
    const cli = clientePorId.get(String(vendaPorId.get(saleId || '')?.client_id || ''));
    return telWaMe(String(cli?.telefone || ''));
  };

  const lista: BoletoAtrasado[] = [];

  // 1) fluxo novo (sales_boletos — Bloco 199)
  for (const row of bRes.data || []) {
    const b = row as Record<string, unknown>;
    if (!STATUS_ABERTO.has(String(b.status || 'NAO_GERADO').toUpperCase())) continue;
    const saleId = String(b.sale_id || '') || null;
    const venc = String(b.vencimento || '');
    if (!venc || venc >= hoje) continue;
    lista.push({
      codigo: String(b.codigo || `local-${b.seu_numero || saleId}-${b.seq || 1}`),
      seuNumero: String(b.seu_numero || ''),
      situacao: String(b.status || 'ATRASADO'),
      vencimento: venc,
      vencimentoFmt: fmtData(venc),
      valor: Number(b.valor) || 0,
      diasAtraso: diasAtrasoDe(venc, hoje),
      cliente: nomeClienteDe(saleId),
      telefone: telDe(saleId),
      saleId,
      parcela: b.seq != null ? Number(b.seq) : null,
    });
  }

  // 2) fluxo antigo (sales.inter_boleto_* — Bloco 25)
  for (const row of sRes.data || []) {
    const s = row as Record<string, unknown>;
    if (!STATUS_ABERTO.has(String(s.inter_boleto_status || '').toUpperCase())) continue;
    const saleId = String(s.id || '') || null;
    const venc = String(s.inter_boleto_vencimento || '');
    if (!venc || venc >= hoje) continue;
    lista.push({
      codigo: String(s.inter_boleto_codigo || ''),
      seuNumero: String(s.inter_boleto_seu_numero || ''),
      situacao: String(s.inter_boleto_status || 'ATRASADO'),
      vencimento: venc,
      vencimentoFmt: fmtData(venc),
      valor: Number(s.inter_boleto_valor ?? s.valor_total) || 0,
      diasAtraso: diasAtrasoDe(venc, hoje),
      cliente: nomeClienteDe(saleId),
      telefone: telDe(saleId),
      saleId,
      parcela: null,
    });
  }

  return lista.sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0));
}

/** Dedup da mescla Inter + local (mesmo boleto pode estar nos dois). */
function chavesDedup(b: BoletoAtrasado): string[] {
  const ch = [] as string[];
  if (b.codigo) ch.push(`cod:${b.codigo}`);
  if (b.seuNumero) ch.push(`seu:${b.seuNumero}`);
  if (b.saleId) ch.push(`sale:${b.saleId}:${b.parcela ?? 'unico'}`);
  return ch;
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

  /** Mapas de vendas/clientes usados pelo cruzamento (nome/telefone). */
  const carregarMapas = async (db: SupabaseClient) => {
    const [vRes, cRes] = await Promise.all([
      db.from('sales').select('id, client_id'),
      db.from('clients').select('id, nome_fantasia, nome, telefone'),
    ]);
    const vendaPorId = new Map<string, Record<string, unknown>>();
    for (const s of vRes.data || []) vendaPorId.set(String((s as Record<string, unknown>).id || ''), s as Record<string, unknown>);
    const clientePorId = new Map<string, Record<string, unknown>>();
    for (const c of cRes.data || []) clientePorId.set(String((c as Record<string, unknown>).id || ''), c as Record<string, unknown>);
    return { vendaPorId, clientePorId };
  };

  // Inter nao configurado: o portal abre MESMO ASSIM com os boletos do
  // BANCO LOCAL (sales_boletos Bloco 199 + sales.inter_boleto_* Bloco 25)
  // vencidos e em aberto — assim a cobranca já funciona hoje; quando as
  // credenciais do Inter forem cadastradas (env Vercel), a lista passa a
  // vir da API oficial sozinha.
  if (!isInterConfigured()) {
    const hoje = dataHojeSp();
    let atrasados: BoletoAtrasado[] = [];
    try {
      const db = getServiceClient();
      const { vendaPorId, clientePorId } = await carregarMapas(db);
      atrasados = await boletosLocaisVencidos(db, hoje, clientePorId, vendaPorId);
    } catch {
      // sales_boletos/inter_* ainda nao existem (SQL pendente) — segue vazio
    }
    return NextResponse.json({
      ok: true,
      interConfigurado: false,
      fonte: 'LOCAL',
      mensagem: erp.cobrancaMensagem,
      mensagemPadrao: COBRANCA_MENSAGEM_DEFAULT,
      atrasados,
      totalAtrasado: Number(atrasados.reduce((acc, x) => acc + x.valor, 0).toFixed(2)),
      consultadoEm: new Date().toISOString(),
    });
  }

  const hoje = dataHojeSp();
  const lista = await listarCobrancas({
    dataInicial: dataMenosDiasSp(JANELA_DIAS),
    dataFinal: hoje,
    size: 500,          // BLOCO 218: spec V3 aceita ate 1000/pagina
    maxPaginas: 5,      // ate 2500 cobrancas na janela
  });
  if (!lista.ok) {
    // Erro do Inter: devolve erro (o portal mostra) — mensagem segue pra edição.
    return NextResponse.json({
      ok: false,
      erro: `Falha ao consultar o Inter: ${lista.erro || 'erro desconhecido'}`,
      interConfigurado: true,
      fonte: 'INTER',
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

  // BLOCO 218: rede de seguranca — os vencidos do BANCO LOCAL (sales_boletos
  // + sales.inter_boleto_*) que NAO vieram do Inter entram na lista (dedup por
  // codigo/seuNumero/sale+parcela). Garante que nenhum vencido escape da
  // cobranca (paginacao do Inter, cobranca criada fora do app, parcela nunca
  // emitida, etc). Reusa os mapas vendas/clientes ja carregados acima.
  try {
    const locais = await boletosLocaisVencidos(db, hoje, clientePorId, vendaPorId);
    const vistos = new Set<string>();
    for (const a of atrasados) for (const k of chavesDedup(a)) vistos.add(k);
    for (const l of locais) {
      if (chavesDedup(l).some((k) => vistos.has(k))) continue;
      atrasados.push(l);
      for (const k of chavesDedup(l)) vistos.add(k);
    }
    atrasados.sort((a, b) => (b.vencimento < a.vencimento ? 1 : b.vencimento > a.vencimento ? -1 : 0));
  } catch {
    // cruzamento local indisponivel — a lista do Inter segue sozinha
  }

  const payload = {
    ok: true,
    interConfigurado: true,
    fonte: 'INTER',
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
