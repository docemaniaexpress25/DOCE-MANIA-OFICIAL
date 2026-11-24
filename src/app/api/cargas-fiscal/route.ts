import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasCargasFiscalTable } from '@/lib/serverSchema';
import { lerErpConfig, lerEmitentePayload } from '@/lib/erpConfig';
import {
  getFocusConfig,
  isFocusConfigured,
  emitirNfe,
  interpretarResultado,
} from '@/lib/focusNfe';
import {
  validarNotaEspecial,
  montarNotaEspecial,
  NotaEspecialInput,
} from '@/lib/notaEspecial';
import {
  montarInputRemessaCarga,
  montarInputDevolucaoCarga,
  resumoDevolucao,
  totalItensCarga,
  EmitenteCargaFiscal,
  ItemCargaFiscal,
} from '@/lib/cargaFiscal';
import { importarAvulsa, invalidaPresenca } from '@/lib/focusArquivos';
import { hojeSp } from '@/lib/interBoleto';

/**
 * BLOCO 215 — CARGAS FISCAL: a carga do vendedor ganha DOCUMENTO FISCAL e a
 * devolução fica AUTOMÁTICA.
 *
 * Pedido do dono: "carregamos 50cxs para o vendedor vender a pronta entrega,
 * lá em carga será gerado um documento, por fim quando eu clicar em devolver
 * será feita a devolução tudo automaticamente... vendedor fica 1 semana fora".
 *
 * FLUXO FISCAL (o nome com 100% de certeza):
 *  - CARGA   -> NF-e 55 REMESSA PARA VENDA AMBULANTE, CFOP 5949, tPag 90
 *               (SEM PAGAMENTO), indPres 9, CSOSN 900. O vendedor anda com o
 *               DANFE dela + os DANFEs das vendas do dia (NF-e 5102 na hora).
 *               NÃO é "documento de transporte" (CT-e é só frete de terceiros).
 *  - RETORNO -> NF-e 55 DE ENTRADA própria: DEVOLUÇÃO DE REMESSA PARA VENDA
 *               AMBULANTE, CFOP 1949 (2949 fora), finalidade 4, SEM PAGAMENTO,
 *               REFERENCIANDO a chave da remessa (notas_referenciadas).
 *  - Fechamento: remessa (50 cx) − vendas 5102 = devolução (49 cx).
 *
 * GET  ?vendedorId=...  -> estado fiscal da carga: remessa(s) ativa(s), itens
 *                          na van, vendidos da jornada, proposta de devolução
 *                          (carregado×vendido×devolve) + status da Focus/emitente.
 *                          ADMIN vê qualquer vendedor; VENDEDOR só o próprio.
 * POST { acao: 'REMESSA', vendedorId, dias? }
 *       -> monta a remessa da carga ATUAL da van (snapshot de itens/valores),
 *          valida (motor 182), EMITE pela Focus quando configurada e guarda o
 *          snapshot em cargas_fiscal. Sem Focus: RASCUNHO + payload auditável
 *          (o dono emite pelo contador/Notas Especiais).
 * POST { acao: 'DEVOLUCAO', vendedorId, itensDevolucao?: [{produtoId, devolve}] }
 *       -> devolução AUTOMÁTICA: calcula remessa − vendas da jornada (editável
 *          item a item), emite a NF-e de entrada 1949 referenciando a(s)
 *          remessa(s), DEVOLVE O ESTOQUE (carga da van -> estoque_principal,
 *          mesma mecânica do Aplicar zerado — a venda já baixou a casa no ato)
 *          e marca as remessas como DEVOLVIDA. Rejeição da SEFAZ NÃO move
 *          estoque (corrige e tenta de novo). Sem remessa ativa: só mecânica.
 */

const BAD = (status: number, erro: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, erro, ...extra }, { status });

const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

interface CargasFiscalRow {
  id: string;
  vendedor_id: string;
  vendedor_nome: string;
  tipo: 'REMESSA' | 'DEVOLUCAO';
  status: string;
  itens: ItemCargaFiscal[];
  valor_total: number;
  focus_ref: string;
  payload: unknown;
  nota_numero: string;
  nota_serie: string;
  nota_chave: string;
  nota_protocolo: string;
  pdf_url: string;
  xml_url: string;
  erro: string;
  ref_remessa: string;
  chave_remessa: string;
  devolvida_em: string;
  data_autorizacao: string;
  criado_em: string;
}

/** Emitente do ERP completo o bastante para a NF-e (destinatário = própria). */
function emitenteIncompleto(e: EmitenteCargaFiscal): string[] {
  const faltando: string[] = [];
  if (soDigitos(e.cnpj).length !== 14) faltando.push('CNPJ');
  if (!e.nome) faltando.push('razão social');
  if (!e.logradouro) faltando.push('logradouro');
  if (!e.numero) faltando.push('número');
  if (!e.bairro) faltando.push('bairro');
  if (!e.municipio) faltando.push('município');
  if (!e.uf) faltando.push('UF');
  if (!soDigitos(e.cep)) faltando.push('CEP');
  return faltando;
}

async function cargaAtualDaVan(db: any, vendedorId: string): Promise<{ itens: ItemCargaFiscal[]; unidades: number }> {
  const [cg, prods] = await Promise.all([
    db.from('cargas').select('produto_id, quantidade').eq('vendedor_id', vendedorId),
    db.from('products').select('id, nome, codigo, ncm, ean, unidade, origem, preco_venda'),
  ]);
  const prodMap = new Map<string, Record<string, unknown>>((prods.data || []).map((p: Record<string, unknown>) => [String(p.id), p]));
  const itens: ItemCargaFiscal[] = [];
  for (const c of (cg.data || []) as Record<string, unknown>[]) {
    const q = Number(c.quantidade) || 0;
    if (q <= 0) continue;
    const p = prodMap.get(String(c.produto_id));
    if (!p) continue;
    itens.push({
      produtoId: String(c.produto_id),
      nome: String(p.nome || 'Produto'),
      codigo: String(p.codigo || ''),
      ncm: String(p.ncm || ''),
      ean: String(p.ean || ''),
      unidade: String(p.unidade || 'UN'),
      origem: String(p.origem ?? '0'),
      quantidade: q,
      valorUnitario: Number(p.preco_venda) || 0,
    });
  }
  return { itens, unidades: itens.reduce((a, i) => a + i.quantidade, 0) };
}

/** Remessas da jornada: ativas (não devolvidas), mais antiga primeiro. */
async function remessasAtivas(db: any, vendedorId: string): Promise<CargasFiscalRow[]> {
  const { data } = await db
    .from('cargas_fiscal')
    .select('*')
    .eq('vendedor_id', vendedorId)
    .eq('tipo', 'REMESSA')
    .in('status', ['AUTORIZADA', 'EMITINDO', 'RASCUNHO'])
    .is('devolvida_em', null)
    .order('criado_em', { ascending: true })
    .limit(50);
  return ((data || []) as unknown as CargasFiscalRow[]);
}

/** Vendidos por produto desde a remessa mais antiga (vendas do vendedor). */
async function vendidosDaJornada(db: any, vendedorId: string, desde: string): Promise<Map<string, number>> {
  const vendidos = new Map<string, number>();
  if (!desde) return vendidos;
  const { data: sales } = await db
    .from('sales')
    .select('id')
    .eq('vendedor_id', vendedorId)
    .gte('data_venda', String(desde).slice(0, 10))
    .limit(2000);
  const ids = ((sales || []) as Record<string, unknown>[]).map(s => String(s.id));
  if (ids.length === 0) return vendidos;
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    const { data: its } = await db.from('sale_items').select('produto_id, quantidade').in('sale_id', lote);
    for (const it of (its || []) as Record<string, unknown>[]) {
      const pid = String(it.produto_id || '');
      if (!pid) continue;
      vendidos.set(pid, (vendidos.get(pid) || 0) + (Number(it.quantidade) || 0));
    }
  }
  return vendidos;
}

/** Devolve o estoque da van para a casa (mesma mecânica do Aplicar zerado). */
async function devolverEstoqueMecanico(db: any, vendedorId: string): Promise<{ unidades: number; itens: number }> {
  const { data: carga } = await db.from('cargas').select('produto_id, quantidade').eq('vendedor_id', vendedorId);
  const rows = ((carga || []) as Record<string, unknown>[]).filter(r => (Number(r.quantidade) || 0) > 0);
  let unidades = 0;
  for (const r of rows) {
    const q = Number(r.quantidade) || 0;
    unidades += q;
    const pid = String(r.produto_id);
    const { data: p } = await db.from('products').select('estoque_principal').eq('id', pid).limit(1).maybeSingle();
    const atual = Number((p as Record<string, unknown> | null)?.estoque_principal ?? 0);
    const { error } = await db.from('products').update({ estoque_principal: atual + q }).eq('id', pid);
    if (error) throw new Error(`Falha devolvendo estoque (${pid}): ${error.message}`);
  }
  if (rows.length > 0) {
    const { error: delErr } = await db.from('cargas').delete().eq('vendedor_id', vendedorId);
    if (delErr) throw new Error(`Falha limpando a carga da van: ${delErr.message}`);
  }
  return { unidades, itens: rows.length };
}

export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponível.');
  }
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessão expirada. Entre novamente.');

  const url = new URL(req.url);
  const vendedorId = String(url.searchParams.get('vendedorId') || '').trim();
  const ehAdmin = session.perfil === 'ADMIN' || session.perfil === 'SECRETARIO';
  if (!ehAdmin && vendedorId && vendedorId !== String(session.sub)) {
    return BAD(403, 'Só o admin vê a carga fiscal de outro vendedor.');
  }

  const cfg = getFocusConfig();
  const erp = await lerErpConfig();
  const emitente: EmitenteCargaFiscal = {
    nome: erp.emitente.razao || erp.emitente.fantasia || '',
    cnpj: erp.emitente.cnpj,
    ie: erp.emitente.ie,
    logradouro: erp.emitente.logradouro,
    numero: erp.emitente.numero,
    bairro: erp.emitente.bairro,
    municipio: erp.emitente.municipio,
    uf: erp.emitente.uf,
    cep: erp.emitente.cep,
  };
  const base = {
    ok: true,
    focus: {
      configurado: isFocusConfigured(),
      ambiente: cfg.ambiente,
      ufEmitente: String(erp.emitente.uf || cfg.ufEmitente || 'RS').toUpperCase(),
      emitenteNome: String(emitente.nome || '').slice(0, 80),
      emitenteCnpj: String(emitente.cnpj || ''),
    },
    emitente,
    emitenteIncompleto: emitenteIncompleto(emitente),
  };

  if (!vendedorId) return NextResponse.json(base);
  const tabelaOk = await hasCargasFiscalTable();
  if (!tabelaOk) {
    return NextResponse.json({
      ...base,
      tabelaOk: false,
      aviso: 'SQL do Bloco 215 pendente (tabela cargas_fiscal) — rode sql/bloco215_cargas_fiscal.sql no Supabase.',
    });
  }

  const db = getServiceClient();
  const [van, remessas, devolucoes, uRes] = await Promise.all([
    cargaAtualDaVan(db, vendedorId),
    remessasAtivas(db, vendedorId),
    db.from('cargas_fiscal').select('*').eq('vendedor_id', vendedorId).eq('tipo', 'DEVOLUCAO').order('criado_em', { ascending: false }).limit(20),
    db.from('app_users').select('nome').eq('id', vendedorId).limit(1).maybeSingle(),
  ]);
  const vendedorNome = String((uRes.data as Record<string, unknown> | null)?.nome || '');

  const remessaBase = remessas[0]; // a mais antiga = início da jornada
  const vendidos = remessaBase ? await vendidosDaJornada(db, vendedorId, remessaBase.criado_em) : new Map<string, number>();
  const proposta = remessaBase
    ? resumoDevolucao({ remessa: remessaBase.itens as ItemCargaFiscal[], vendidos })
    : [];

  return NextResponse.json({
    ...base,
    tabelaOk: true,
    vendedorNome,
    itensVan: van.itens,
    unidadesVan: van.unidades,
    remessasJornada: remessas,
    // BLOCO 215: "ativa" para o painel = AUTORIZADA/EMITINDO; sem elas, o
    // RASCUNHO também entra (o dono vê o rascunho que ficou pendente).
    remessaAtiva: remessas.find(r => r.status === 'AUTORIZADA' || r.status === 'EMITINDO') || remessas[0] || null,
    propostaDevolucao: proposta,
    devolucoes: (devolucoes.data || []) as unknown as CargasFiscalRow[],
  });
}

function refIdempotente(prefixo: string, vendedorId: string, rejeitados: number): string {
  const data = hojeSp().replace(/-/g, '');
  const base = `${prefixo}-${vendedorId.slice(0, 8)}-${data}`;
  return rejeitados > 0 ? `${base}-r${rejeitados}` : base;
}

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponível.');
  }
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessão expirada. Entre novamente.');
  if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin emite a remessa e devolve a carga.');

  const body = await req.json().catch(() => null);
  if (!body) return BAD(400, 'Payload inválido.');
  const acao = String(body.acao || '').toUpperCase();
  const vendedorId = String(body.vendedorId || '');
  if (!vendedorId) return BAD(422, 'Vendedor não selecionado.');

  const tabelaOk = await hasCargasFiscalTable();
  if (!tabelaOk) return BAD(503, 'Banco desatualizado: rode sql/bloco215_cargas_fiscal.sql no Supabase.');

  const db = getServiceClient();
  const erp = await lerErpConfig();
  const emitente: EmitenteCargaFiscal = {
    nome: erp.emitente.razao || erp.emitente.fantasia || '',
    cnpj: erp.emitente.cnpj,
    ie: erp.emitente.ie,
    logradouro: erp.emitente.logradouro,
    numero: erp.emitente.numero,
    bairro: erp.emitente.bairro,
    municipio: erp.emitente.municipio,
    uf: erp.emitente.uf,
    cep: erp.emitente.cep,
  };
  const { data: uRes } = await db.from('app_users').select('nome').eq('id', vendedorId).limit(1).maybeSingle();
  const vendedorNome = String((uRes as Record<string, unknown> | null)?.nome || 'Vendedor');

  // ---------------------------------------------------------------------
  // REMESSA: carga atual da van -> NF-e 55 CFOP 5949 SEM PAGAMENTO
  // ---------------------------------------------------------------------
  if (acao === 'REMESSA') {
    const { itens, unidades } = await cargaAtualDaVan(db, vendedorId);
    if (itens.length === 0) return BAD(422, 'Carga vazia — carregue a van antes de gerar a remessa.');

    const incompleto = emitenteIncompleto(emitente);
    if (incompleto.length > 0) {
      return BAD(422, `Dados do emitente incompletos para a NF-e: falta ${incompleto.join(', ')}. Preencha em Configurações > ERP Fiscal (dados do emitente).`, { faltando: incompleto });
    }

    // Idempotência: 1 remessa por vendedor/dia (reemissão -r2, -r3... só
    // quando a anterior foi REJEITADA).
    const data = hojeSp().replace(/-/g, '');
    const refBase = `CARGA-${vendedorId.slice(0, 8)}-${data}`;
    const { data: existentes } = await db.from('cargas_fiscal').select('*').eq('vendedor_id', vendedorId).eq('tipo', 'REMESSA').like('focus_ref', `${refBase}%`);
    const vivas = ((existentes || []) as unknown as CargasFiscalRow[]).filter(r => ['AUTORIZADA', 'EMITINDO', 'RASCUNHO'].includes(r.status));
    if (vivas.length > 0) {
      return NextResponse.json({ ok: true, jaEmitida: true, remessa: vivas[0], aviso: 'Remessa da carga de hoje já existe — nada foi emitido de novo.' });
    }
    const rejeitados = ((existentes || []) as unknown as CargasFiscalRow[]).filter(r => r.status === 'REJEITADA').length;
    const ref = refIdempotente('CARGA', vendedorId, rejeitados);

    const dias = Math.max(1, Math.min(31, Math.round(Number(body.dias) || 7)));
    const input: NotaEspecialInput = montarInputRemessaCarga({ itens, emitente, vendedor: vendedorNome, dias });
    const ufEmit = String(erp.emitente.uf || 'RS').toUpperCase();
    const val = validarNotaEspecial(input, ufEmit);
    if (val.erros.length > 0) return BAD(422, val.erros[0], { erros: val.erros, avisos: val.avisos });
    const montada = montarNotaEspecial(input, { ufEmitente: ufEmit, emitentePayload: (await lerEmitentePayload()) as Partial<Record<string, unknown>>, agora: new Date() });

    const rowBase = {
      vendedor_id: vendedorId,
      vendedor_nome: vendedorNome,
      tipo: 'REMESSA',
      itens: itens as unknown as Record<string, unknown>[],
      valor_total: totalItensCarga(itens),
      payload: montada.payload as unknown as Record<string, unknown>,
    };

    if (!isFocusConfigured()) {
      const { data: row, error } = await db.from('cargas_fiscal').insert({ ...rowBase, status: 'RASCUNHO', focus_ref: ref }).select('*').maybeSingle();
      if (error) return BAD(500, 'Erro gravando o rascunho da remessa.', { detalhe: error.message });
      return NextResponse.json({
        ok: true,
        rascunho: true,
        remessa: row,
        avisos: val.avisos,
        aviso: 'Focus NFe não configurada — remessa gravada como RASCUNHO. Imprima o DOCUMENTO DE PORTE e emita pelo contador (ou ligue FOCUS_NFE_TOKEN).',
      });
    }

    const r = await emitirNfe('nfe', ref, montada.payload);
    if (!r.ok || !r.data || 'erro' in r.data) {
      const erroMsg = (r.data as { erro?: string })?.erro || `HTTP ${r.status}`;
      const { data: row } = await db.from('cargas_fiscal').insert({ ...rowBase, status: 'REJEITADA', focus_ref: ref, erro: erroMsg }).select('*').maybeSingle();
      return BAD(502, erroMsg, { remessa: row, avisos: val.avisos, ref });
    }
    const res = interpretarResultado(r.data as Record<string, unknown>);
    const status = res.autorizada ? 'AUTORIZADA' : res.processando ? 'EMITINDO' : 'REJEITADA';
    const { data: row, error } = await db.from('cargas_fiscal').insert({
      ...rowBase,
      status,
      focus_ref: ref,
      nota_numero: res.numero || '',
      nota_serie: res.serie || '',
      nota_chave: res.chave || '',
      nota_protocolo: res.protocolo || '',
      pdf_url: res.pdfUrl || '',
      xml_url: res.xmlUrl || '',
      erro: res.autorizada || res.processando ? '' : (res.motivo || 'Aguardando SEFAZ'),
      ...(res.autorizada ? { data_autorizacao: new Date().toISOString() } : {}),
    }).select('*').maybeSingle();
    if (error) return BAD(500, 'Nota enviada à SEFAZ, mas falhou gravando o registro local.', { detalhe: error.message, ref });
    if (res.autorizada) {
      after(async () => {
        try { await importarAvulsa(ref, 'NFE'); invalidaPresenca(); } catch (e) {
          console.warn('[cargas-fiscal] arquivamento da remessa falhou (importador cobre):', (e as Error).message);
        }
      });
    }
    return NextResponse.json({
      ok: res.autorizada || res.processando,
      remessa: row,
      avisos: val.avisos,
      cfopsAjustados: montada.cfopsAjustados,
      ...(res.autorizada || res.processando ? {} : { erro: res.motivo || 'Aguardando SEFAZ' }),
    });
  }

  // ---------------------------------------------------------------------
  // DEVOLUÇÃO: remessa − vendas da jornada -> NF-e de ENTRADA 1949 +
  // estoque volta para a casa (carga zerada) + remessas viram DEVOLVIDA.
  // ---------------------------------------------------------------------
  if (acao === 'DEVOLUCAO') {
    const remessas = await remessasAtivas(db, vendedorId);
    const van = await cargaAtualDaVan(db, vendedorId);
    if (van.itens.length === 0) return BAD(422, 'A carga da van já está vazia — nada para devolver.');

    // Sem remessa ativa: devolução SÓ mecânica (o dono não gerou documento).
    if (remessas.length === 0) {
      const mecanica = await devolverEstoqueMecanico(db, vendedorId);
      return NextResponse.json({
        ok: true,
        mecanica: true,
        semRemessa: true,
        mecanicaResumo: mecanica,
        aviso: 'Carga devolvida ao estoque SEM documento fiscal — não havia remessa ativa. Gere a remessa na próxima carga para fechar o ciclo fiscal.',
      });
    }

    const remessaBase = remessas[0];
    const vendidos = await vendidosDaJornada(db, vendedorId, remessaBase.criado_em);
    let proposta = resumoDevolucao({ remessa: remessaBase.itens as ItemCargaFiscal[], vendidos });

    // Override item a item (o dono ajusta quando a rota vendeu fora do app).
    const overrides = Array.isArray(body.itensDevolucao) ? body.itensDevolucao : [];
    if (overrides.length > 0) {
      const mapa = new Map<string, number>();
      for (const o of overrides as Record<string, unknown>[]) {
        const pid = String(o.produtoId || '');
        if (pid) mapa.set(pid, Math.max(0, Math.floor(Number(o.devolve) || 0)));
      }
      proposta = proposta.map(p => ({ ...p, devolve: Math.min(p.carregado, mapa.get(p.produtoId) ?? p.devolve) }));
    }

    const itensDevolucao: ItemCargaFiscal[] = proposta
      .filter(p => p.devolve > 0)
      .map(p => ({ produtoId: p.produtoId, nome: p.nome, quantidade: p.devolve, valorUnitario: p.valorUnitario }));

    const marcarRemessasDevolvidas = async (devRef: string) => {
      const ids = remessas.map(r => r.id);
      if (ids.length > 0) {
        await db.from('cargas_fiscal').update({ status: 'DEVOLVIDA', devolvida_em: new Date().toISOString(), ref_remessa: devRef }).in('id', ids);
      }
    };

    // Sem itens a devolver fiscalmente (vendeu tudo) — só a mecânica.
    if (itensDevolucao.length === 0) {
      const mecanica = await devolverEstoqueMecanico(db, vendedorId);
      await marcarRemessasDevolvidas('');
      return NextResponse.json({
        ok: true,
        mecanica: true,
        semItens: true,
        mecanicaResumo: mecanica,
        aviso: 'Toda a remessa foi vendida — nada entra em NF-e de devolução. Estoque devolvido e jornada encerrada.',
      });
    }

    const incompleto = emitenteIncompleto(emitente);
    if (incompleto.length > 0) {
      return BAD(422, `Dados do emitente incompletos para a NF-e de devolução: falta ${incompleto.join(', ')}. Preencha em Configurações > ERP Fiscal.`, { faltando: incompleto });
    }

    const rejeitadasHoje = await db.from('cargas_fiscal').select('id').eq('vendedor_id', vendedorId).eq('tipo', 'DEVOLUCAO').eq('status', 'REJEITADA');
    const ref = refIdempotente('DEV', vendedorId, ((rejeitadasHoje.data || []) as unknown[]).length);
    const input = montarInputDevolucaoCarga({
      itens: itensDevolucao,
      emitente,
      vendedor: vendedorNome,
      remessaNumero: remessaBase.nota_numero || remessaBase.focus_ref,
      remessaChave: remessaBase.nota_chave || remessaBase.chave_remessa || '',
    });
    const ufEmit = String(erp.emitente.uf || 'RS').toUpperCase();
    const val = validarNotaEspecial(input, ufEmit);
    if (val.erros.length > 0) return BAD(422, val.erros[0], { erros: val.erros, avisos: val.avisos });
    const montada = montarNotaEspecial(input, { ufEmitente: ufEmit, emitentePayload: (await lerEmitentePayload()) as Partial<Record<string, unknown>>, agora: new Date() });

    const rowBase = {
      vendedor_id: vendedorId,
      vendedor_nome: vendedorNome,
      tipo: 'DEVOLUCAO',
      itens: proposta as unknown as Record<string, unknown>[],
      valor_total: totalItensCarga(itensDevolucao),
      payload: montada.payload as unknown as Record<string, unknown>,
      ref_remessa: remessaBase.focus_ref || '',
      chave_remessa: remessaBase.nota_chave || remessaBase.chave_remessa || '',
    };

    const mecanicaEfinaliza = async () => {
      const mecanica = await devolverEstoqueMecanico(db, vendedorId);
      await marcarRemessasDevolvidas(ref);
      return mecanica;
    };

    if (!isFocusConfigured()) {
      const { data: row, error } = await db.from('cargas_fiscal').insert({ ...rowBase, status: 'RASCUNHO', focus_ref: ref }).select('*').maybeSingle();
      if (error) return BAD(500, 'Erro gravando o rascunho da devolução.', { detalhe: error.message });
      const mecanica = await mecanicaEfinaliza();
      return NextResponse.json({
        ok: true,
        rascunho: true,
        devolucao: row,
        mecanicaResumo: mecanica,
        avisos: val.avisos,
        aviso: 'Devolução gravada como RASCUNHO (Focus não configurada) — estoque devolvido e carga zerada. Emita a NF-e de entrada 1949 pelo contador.',
      });
    }

    const r = await emitirNfe('nfe', ref, montada.payload);
    if (!r.ok || !r.data || 'erro' in r.data) {
      const erroMsg = (r.data as { erro?: string })?.erro || `HTTP ${r.status}`;
      await db.from('cargas_fiscal').insert({ ...rowBase, status: 'REJEITADA', focus_ref: ref, erro: erroMsg });
      // ESTOQUE NÃO MEXE na rejeição — corrige e tenta de novo.
      return BAD(502, `Devolução REJEITADA pela SEFAZ (estoque da van NÃO foi tocado): ${erroMsg}`, { avisos: val.avisos, ref });
    }
    const res = interpretarResultado(r.data as Record<string, unknown>);
    const status = res.autorizada ? 'AUTORIZADA' : res.processando ? 'EMITINDO' : 'REJEITADA';
    const { data: row, error } = await db.from('cargas_fiscal').insert({
      ...rowBase,
      status,
      focus_ref: ref,
      nota_numero: res.numero || '',
      nota_serie: res.serie || '',
      nota_chave: res.chave || '',
      nota_protocolo: res.protocolo || '',
      pdf_url: res.pdfUrl || '',
      xml_url: res.xmlUrl || '',
      erro: res.autorizada || res.processando ? '' : (res.motivo || 'Aguardando SEFAZ'),
      ...(res.autorizada ? { data_autorizacao: new Date().toISOString() } : {}),
    }).select('*').maybeSingle();
    if (error) return BAD(500, 'NF-e enviada, mas falhou gravando o registro local.', { detalhe: error.message, ref });
    if (res.autorizada) {
      after(async () => {
        try { await importarAvulsa(ref, 'NFE'); invalidaPresenca(); } catch (e) {
          console.warn('[cargas-fiscal] arquivamento da devolução falhou (importador cobre):', (e as Error).message);
        }
      });
    }
    if (!res.autorizada && !res.processando) {
      return BAD(502, `Devolução REJEITADA pela SEFAZ (estoque da van NÃO foi tocado): ${res.motivo || 'Aguardando SEFAZ'}`, { devolucao: row, avisos: val.avisos });
    }
    const mecanica = await mecanicaEfinaliza();
    return NextResponse.json({ ok: true, devolucao: row, mecanicaResumo: mecanica, avisos: val.avisos });
  }

  return BAD(400, `Ação desconhecida: ${String(body.acao || '(vazio)')}. Use REMESSA ou DEVOLUCAO.`);
}
