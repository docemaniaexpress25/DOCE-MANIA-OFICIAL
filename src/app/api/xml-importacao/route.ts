import { NextRequest, NextResponse } from 'next/server';
import { devBridge, getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { isAdminSession } from '@/lib/session';
import { parseXmlNfe } from '@/lib/xmlCompra';

/**
 * IMPORTACAO DE XML DE COMPRA (Bloco 95) — origem da aba "XML → Produtos".
 *
 * POST /api/xml-importacao  { arquivos: [{ nome, conteudo }] }   [ADMIN]
 *   Parseia cada XML de NF-e de compra, deduplica pela chave de acesso e
 *   grava em xml_importacoes (cabecalho) + xml_itens (fila de produtos).
 *   Somente ADMIN. NAO toca em products — a sincronizacao (vincular/criar)
 *   e manual, na fila, exatamente como o dono pediu.
 *
 * GET /api/xml-importacao                                       [ADMIN]
 *   Lista as importacoes + estatisticas da migracao do cadastro
 *   fiscal (itens pendentes/vinculados/criados/ignorados e cobertura
 *   de NCM/EAN dos produtos ativos).
 *
 * Tabelas (sql/bloco95_xml_produtos.sql):
 *   xml_importacoes (chave UNIQUE, xml_text TEXT)
 *   xml_itens (importacao_id, c_prod/c_ean/x_prod/ncm/cfop/unidade/
 *              quantidade/valor_unitario, produto_id, status)
 */

const BAD = (status: number, erro: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, erro, ...extra }, { status });

/** Sonda: tabelas do bloco 95 existem no Supabase? (padrao serverSchema) */
let probeCache: { ok: boolean; at: number } | null = null;
async function hasXmlTables(): Promise<boolean> {
  const now = Date.now();
  if (probeCache && now - probeCache.at < 30_000) return probeCache.ok;
  try {
    const { error } = await getServiceClient().from('xml_importacoes').select('id').limit(1);
    const ok = !error;
    probeCache = { ok, at: now };
    return ok;
  } catch {
    return probeCache?.ok ?? false;
  }
}

export async function GET(request: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return BAD(503, 'Indisponivel no preview local.');
  }
  if (!isAdminSession(request)) {
    return BAD(401, 'Sessao invalida.');
  }
  if (!(await hasXmlTables())) {
    return BAD(503, 'Banco desatualizado: rode sql/bloco95_xml_produtos.sql no Supabase (tabelas xml_importacoes/xml_itens).');
  }

  try {
    const supabase = getServiceClient();

    // ATENCAO: qtd_pendentes NAO e coluna do banco (o SQL do bloco 95 nao a
    // cria) — a contagem por importacao e calculada em memoria abaixo via
    // pendentesPorImp (xml_itens). Pedia-la no select quebrava o GET inteiro
    // com "Could not find the 'qtd_pendentes' column" mesmo com o SQL aplicado.
    const { data: importacoes, error: eImp } = await supabase
      .from('xml_importacoes')
      .select('id, chave, origem, emit_cnpj, emit_nome, numero, serie, data_emissao, valor_total, criado_em, qtd_itens')
      .order('criado_em', { ascending: false })
      .limit(200);
    if (eImp) return BAD(500, `Falha lendo importacoes: ${eImp.message}`);

    const { data: contagens, error: eCnt } = await supabase
      .from('xml_itens')
 .select('status, importacao_id');
    if (eCnt) return BAD(500, `Falha lendo itens: ${eCnt.message}`);

    const stats = { PENDENTE: 0, VINCULADO: 0, CRIADO: 0, IGNORADO: 0 };
    const pendentesPorImp = new Map<string, number>();
    for (const row of contagens || []) {
      const rec = row as Record<string, unknown>;
      const s = String(rec.status || 'PENDENTE') as keyof typeof stats;
      if (s in stats) stats[s]++;
      const impId = String(rec.importacao_id || '');
      if (impId && s === 'PENDENTE') {
        pendentesPorImp.set(impId, (pendentesPorImp.get(impId) || 0) + 1);
      }
    }

    // Cobertura fiscal do catalogo (progresso da migracao do dono)
    const { data: prods, error: eProds } = await supabase
      .from('products')
      .select('id, nome, ncm, ean');
    let catalogo = { total: 0, comNcm: 0, comEan: 0 };
    if (!eProds && prods) {
      catalogo = {
        total: prods.length,
        comNcm: prods.filter((p: Record<string, unknown>) => String(p.ncm || '').trim()).length,
        comEan: prods.filter((p: Record<string, unknown>) => String(p.ean || '').trim()).length,
      };
    }

    return NextResponse.json({
      ok: true,
      importacoes: (importacoes || []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        chave: String(r.chave || ''),
        origem: String(r.origem || 'UPLOAD'),
        emitCnpj: String(r.emit_cnpj || ''),
        emitNome: String(r.emit_nome || ''),
        numero: String(r.numero || ''),
        serie: String(r.serie || ''),
        dataEmissao: r.data_emissao ? String(r.data_emissao) : '',
        valorTotal: Number(r.valor_total) || 0,
        criadoEm: String(r.criado_em || ''),
        qtdItens: Number(r.qtd_itens) || 0,
        qtdPendentes: pendentesPorImp.get(String(r.id)) || 0,
      })),
      stats,
      catalogo,
    });
  } catch (e) {
    return BAD(500, `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface ArquivoXml {
  nome?: string;
  conteudo?: string;
}

export async function POST(request: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return BAD(503, 'Indisponivel no preview local.');
  }
  if (!isAdminSession(request)) {
    return BAD(401, 'Sessao invalida.');
  }
  if (!(await hasXmlTables())) {
    return BAD(503, 'Banco desatualizado: rode sql/bloco95_xml_produtos.sql no Supabase (tabelas xml_importacoes/xml_itens).');
  }

  let body: { arquivos?: ArquivoXml[]; origem?: string } = {};
  try {
    body = await request.json();
  } catch {
    return BAD(400, 'Corpo JSON invalido.');
  }

  const arquivos = Array.isArray(body.arquivos) ? body.arquivos.slice(0, 60) : [];
  if (arquivos.length === 0) {
    return BAD(400, 'Nenhum arquivo recebido (envie { arquivos: [{ nome, conteudo }] }).');
  }
  const origem = body.origem === 'SPEDY_INBOUND' ? 'SPEDY_INBOUND' : 'UPLOAD';

  try {
    const supabase = getServiceClient();

    // 1) Chaves ja importadas (dedupe barato, 1 query)
    const { data: existentes } = await supabase
      .from('xml_importacoes')
      .select('chave');
    const chavesExistentes = new Set((existentes || []).map((r: Record<string, unknown>) => String(r.chave)));

    const resumo = {
      recebidos: arquivos.length,
      importadas: 0,
      duplicadas: 0,
      erros: [] as { nome: string; motivo: string }[],
      itens: 0,
      notas: [] as { emitNome: string; numero: string; chave: string; itens: number; valor: number }[],
    };

    for (const arq of arquivos) {
      const nome = String(arq.nome || 'arquivo.xml');
      const parse = parseXmlNfe(String(arq.conteudo || ''));
      if (!parse.ok || !parse.nota) {
        resumo.erros.push({ nome, motivo: parse.erro || 'XML nao parseado.' });
        continue;
      }
      const nota = parse.nota;
      if (chavesExistentes.has(nota.chave)) {
        resumo.duplicadas++;
        continue;
      }
      chavesExistentes.add(nota.chave);

      // 2) Cabecalho da importacao (xml_text = backup integral da nota)
      const { data: impRow, error: eImp } = await supabase
        .from('xml_importacoes')
        .insert({
          chave: nota.chave,
          origem,
          emit_cnpj: nota.emitCnpj,
          emit_nome: nota.emitNome,
          emit_ie: nota.emitIe,
          numero: nota.numero,
          serie: nota.serie,
          data_emissao: nota.dataEmissao || null,
          valor_total: nota.valorTotal,
          qtd_itens: nota.itens.length,
          xml_text: String(arq.conteudo || ''),
        })
        .select('id')
        .single();
      if (eImp || !impRow) {
        resumo.erros.push({ nome, motivo: `Falha gravando importacao: ${eImp?.message || 'sem retorno'}` });
        continue;
      }

      // 3) Itens -> fila fiscal (staging)
      const linhas = nota.itens.map((it) => ({
        importacao_id: (impRow as Record<string, unknown>).id,
        c_prod: it.cProd,
        c_ean: it.cEAN,
        x_prod: it.xProd,
        ncm: it.ncm,
        cfop: it.cfop,
        unidade: it.uCom,
        quantidade: it.qCom,
        valor_unitario: it.vUnCom,
        valor_total: it.vProd,
        cst_icms: it.cstIcms,
        csosn_icms: it.csosnIcms,
        status: 'PENDENTE',
      }));
      if (linhas.length > 0) {
        const { error: eItens } = await supabase.from('xml_itens').insert(linhas);
        if (eItens) {
          resumo.erros.push({ nome, motivo: `Itens nao gravados: ${eItens.message}` });
          continue;
        }
      }

      resumo.importadas++;
      resumo.itens += linhas.length;
      resumo.notas.push({
        emitNome: nota.emitNome || 'Emitente sem nome',
        numero: nota.numero,
        chave: nota.chave,
        itens: linhas.length,
        valor: nota.valorTotal,
      });
    }

    return NextResponse.json({ ok: true, resumo });
  } catch (e) {
    return BAD(500, `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`);
  }
}
