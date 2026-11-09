import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { isAdminSession } from '@/lib/session';
import {
  getSpedyConfig,
  isSpedyConfigured,
  listarEmpresasSpedy,
  listarCertificadosSpedy,
  enviarCertificadoSpedy,
  sincronizarInboundSpedy,
  listarInboundSpedy,
  baixarXmlInboundSpedy,
} from '@/lib/spedy';
import { parseXmlNfe } from '@/lib/xmlCompra';

/**
 * STATUS + PONTE SPEDY (Bloco 95) — a aba Fiscal do admin usa esta rota para
 * VER e PILOTAR a integracao. Nada aqui e chamado pelo fluxo de venda:
 * vendedores em rota continuam exatamente como sempre (pedido do dono).
 *
 * GET  /api/spedy                                                     [ADMIN]
 *   Estado da integracao: env vars configuradas, ambiente, empresa,
 *   certificado A1 (validade!), e um teste de conexao leve quando a
 *   API key existe. Sem key = responde "preparado, aguardando chave"
 *   com o checklist de go-live (nao tenta rede).
 *
 * POST /api/spedy                                                     [ADMIN]
 *   { acao: 'TESTAR' }            — deep test: empresas + certificado + inbound
 *   { acao: 'SINCRONIZAR' }        — pede a Spedy para buscar na SEFAZ (429 = Retry-After)
 *   { acao: 'IMPORTAR_INBOUND' }   — puxa notas recebidas COMPLETAS, baixa os
 *                                    XML e joga na MESMA fila da aba (xml_itens)
 *   { acao: 'ENVIAR_CERTIFICADO', arquivoBase64, senha, nomeArquivo? }
 *                                  — upload do A1 .pfx para a Spedy (a conta
 *                                    passa a assinar por nos; o app nao guarda
 *                                    o arquivo nem a senha).
 */

const BAD = (status: number, erro: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, erro, ...extra }, { status });

function certificadoAtivo(certs: Record<string, unknown>[]): Record<string, unknown> | null {
  const ativos = certs.filter((c) => c.isActive === true || c.isActive === 'true');
  if (ativos.length > 0) return ativos[0];
  return certs.length > 0 ? certs.sort((a, b) => String(b.expirationAt || '').localeCompare(String(a.expirationAt || '')))[0] : null;
}

function diasPara(vencimento?: string): number | null {
  if (!vencimento) return null;
  const d = new Date(vencimento);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

async function estadoConexao(profundo: boolean) {
  const cfg = getSpedyConfig();
  const base: Record<string, unknown> = {
    configurado: isSpedyConfigured(),
    ambiente: cfg.ambiente,
    baseUrl: cfg.baseUrl,
    backofficeUrl: cfg.backofficeUrl,
    empresaId: cfg.empresaId,
  };
  if (!isSpedyConfigured()) {
    return { ...base, conectado: false, mensagem: 'Preparado para a Spedy — aguardando SPEDY_API_KEY (crie a conta sandbox gratis, plano Desenvolvedor).' };
  }
  if (!profundo) return { ...base, conectado: null, mensagem: 'API key configurada (teste de conexao no botao TESTAR).' };

  const rEmp = await listarEmpresasSpedy();
  if (!rEmp.ok) {
    return { ...base, conectado: false, erro: String((rEmp.data as Record<string, unknown>)?.erro || `HTTP ${rEmp.status}`) };
  }
  const raw = rEmp.data as Record<string, unknown>;
  const empresas = (Array.isArray(raw.data) ? raw.data : Array.isArray(rEmp.data) ? rEmp.data : []) as Record<string, unknown>[];

  let certificado: Record<string, unknown> | null = null;
  if (cfg.empresaId) {
    const rCert = await listarCertificadosSpedy(cfg.empresaId);
    if (rCert.ok) {
      const rawC = rCert.data as Record<string, unknown>;
      const certs = (Array.isArray(rawC.data) ? rawC.data : Array.isArray(rCert.data) ? rCert.data : []) as Record<string, unknown>[];
      certificado = certificadoAtivo(certs);
    }
  }

  // Inbound (notas recebidas) — 403 = plano sem o recurso
  let inbound: Record<string, unknown> = { habilitado: null };
  const rInb = await listarInboundSpedy({ limit: 1 });
  if (rInb.ok) inbound = { habilitado: true };
  else if (rInb.status === 403) inbound = { habilitado: false, motivo: 'Plano sem o recurso inbound_invoices (fale com a Spedy).' };
  else if (rInb.status === 429) inbound = { habilitado: true, rateLimit: true };

  return {
    ...base,
    conectado: true,
    empresas: empresas.map((e) => ({
      id: String(e.id || ''),
      nome: String(e.name || e.tradeName || ''),
      cnpj: String(e.federalTaxNumber || ''),
    })),
    certificado: certificado
      ? {
        subject: String(certificado.subject || ''),
        issuer: String(certificado.issuer || ''),
        expirationAt: certificado.expirationAt ? String(certificado.expirationAt) : '',
        diasParaVencer: diasPara(certificado.expirationAt ? String(certificado.expirationAt) : undefined),
        isActive: certificado.isActive === true || certificado.isActive === 'true',
      }
      : null,
    inbound,
  };
}

export async function GET(request: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return BAD(503, 'Indisponivel no preview local.');
  }
  if (!isAdminSession(request)) {
    return BAD(401, 'Sessao invalida.');
  }
  try {
    const estado = await estadoConexao(false);
    return NextResponse.json({ ok: true, estado });
  } catch (e) {
    return BAD(500, `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function POST(request: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return BAD(503, 'Indisponivel no preview local.');
  }
  if (!isAdminSession(request)) {
    return BAD(401, 'Sessao invalida.');
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return BAD(400, 'Corpo JSON invalido.');
  }
  const acao = String(body.acao || '').toUpperCase();

  try {
    if (acao === 'TESTAR') {
      const estado = await estadoConexao(true);
      return NextResponse.json({ ok: true, estado });
    }

    if (acao === 'SINCRONIZAR') {
      if (!isSpedyConfigured()) return BAD(400, 'SPEDY_API_KEY nao configurada.');
      const r = await sincronizarInboundSpedy();
      if (r.status === 429) {
        return NextResponse.json({
          ok: true,
          sincronizado: false,
          rateLimit: true,
          retryAfterSeconds: r.retryAfterSeconds ?? 60,
          mensagem: `A SEFAZ limita as consultas por CNPJ — tente de novo em ${r.retryAfterSeconds ?? 60}s (nao fique repetindo: bloqueia o CNPJ).`,
        });
      }
      if (!r.ok) return BAD(502, `Spedy recusou: HTTP ${r.status} — ${String((r.data as Record<string, unknown>)?.erro || '')}`.trim());
      return NextResponse.json({ ok: true, sincronizado: true, mensagem: 'Busca solicitada — as notas chegam pelo webhook/lista em instantes.' });
    }

    if (acao === 'IMPORTAR_INBOUND') {
      if (!isSpedyConfigured()) return BAD(400, 'SPEDY_API_KEY nao configurada.');
      // 1) Lista notas recebidas (primeiras paginas)
      const coletadas: Record<string, unknown>[] = [];
      let cursor: string | undefined;
      for (let pagina = 0; pagina < 5; pagina++) {
        const r = await listarInboundSpedy({ cursor, limit: 50 });
        if (!r.ok) {
          if (r.status === 403) return BAD(400, 'Plano sem o recurso de notas recebidas (inbound_invoices).');
          return BAD(502, `Falha listando notas recebidas: HTTP ${r.status}`);
        }
        const raw = r.data as Record<string, unknown>;
        const lote = (Array.isArray(raw.data) ? raw.data : Array.isArray(r.data) ? r.data : []) as Record<string, unknown>[];
        coletadas.push(...lote);
        const next = raw.nextCursor ? String(raw.nextCursor) : undefined;
        if (!next) break;
        cursor = next;
      }
      // 2) Dedupe contra o que ja esta no banco
      const supabase = getServiceClient();
      const { data: existentes } = await supabase.from('xml_importacoes').select('chave');
      const chavesExistentes = new Set((existentes || []).map((r: Record<string, unknown>) => String(r.chave)));

      const resumo = { completas: 0, resumos: 0, importadas: 0, duplicadas: 0, erros: [] as string[], itens: 0 };
      for (const nota of coletadas) {
        resumo.completas++;
        const chave = String(nota.accessKey || '').replace(/\D/g, '');
        const completa = nota.isComplete === true || nota.isComplete === 'true';
        if (!completa) { resumo.resumos++; continue; } // precisa manifestar antes
        if (!chave || chavesExistentes.has(chave)) { resumo.duplicadas++; continue; }
        const id = String(nota.id || '');
        const dl = await baixarXmlInboundSpedy(id);
        if (!dl.ok || !dl.buffer) {
          resumo.erros.push(`${chave.slice(-8)}: ${dl.erro || 'sem XML'}`);
          continue;
        }
        const xmlTexto = dl.buffer.toString('utf-8');
        const parse = parseXmlNfe(xmlTexto);
        if (!parse.ok || !parse.nota) {
          resumo.erros.push(`${chave.slice(-8)}: ${parse.erro}`);
          continue;
        }
        // Mesma gravacao do upload manual
        const { data: impRow, error: eImp } = await supabase
          .from('xml_importacoes')
          .insert({
            chave: parse.nota.chave,
            origem: 'SPEDY_INBOUND',
            emit_cnpj: parse.nota.emitCnpj,
            emit_nome: parse.nota.emitNome,
            emit_ie: parse.nota.emitIe,
            numero: parse.nota.numero,
            serie: parse.nota.serie,
            data_emissao: parse.nota.dataEmissao || null,
            valor_total: parse.nota.valorTotal,
            qtd_itens: parse.nota.itens.length,
            xml_text: xmlTexto,
          })
          .select('id')
          .single();
        if (eImp || !impRow) {
          resumo.erros.push(`${chave.slice(-8)}: gravacao falhou (${eImp?.message || 'sem id'})`);
          continue;
        }
        const linhas = parse.nota.itens.map((it) => ({
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
            resumo.erros.push(`${chave.slice(-8)}: itens falhou (${eItens.message})`);
            continue;
          }
        }
        chavesExistentes.add(parse.nota.chave);
        resumo.importadas++;
        resumo.itens += linhas.length;
      }
      return NextResponse.json({
        ok: true,
        resumo: {
          ...resumo,
          mensagem: resumo.resumos > 0
            ? `${resumo.resumos} nota(s) ainda como RESUMO — manifeste na Spedy para liberar o XML completo.`
            : undefined,
        },
      });
    }

    if (acao === 'ENVIAR_CERTIFICADO') {
      if (!isSpedyConfigured()) return BAD(400, 'SPEDY_API_KEY nao configurada.');
      const arquivoBase64 = String(body.arquivoBase64 || '');
      const senha = String(body.senha || '');
      if (!arquivoBase64 || !senha) return BAD(400, 'arquivoBase64 e senha obrigatorios.');
      const r = await enviarCertificadoSpedy({
        arquivoBase64,
        senha,
        nomeArquivo: body.nomeArquivo ? String(body.nomeArquivo) : undefined,
      });
      if (!r.ok) {
        return BAD(502, `Spedy recusou o certificado: HTTP ${r.status} — ${String((r.data as Record<string, unknown>)?.erro || (r.data as Record<string, unknown>)?.message || '')}`.trim());
      }
      const cert = (r.data || {}) as Record<string, unknown>;
      return NextResponse.json({
        ok: true,
        certificado: {
          subject: String(cert.subject || ''),
          expirationAt: cert.expirationAt ? String(cert.expirationAt) : '',
          diasParaVencer: diasPara(cert.expirationAt ? String(cert.expirationAt) : undefined),
          isActive: cert.isActive === true || cert.isActive === 'true',
        },
        mensagem: 'Certificado A1 enviado — a Spedy agora assina as notas por voce.',
      });
    }

    return BAD(400, `Acao desconhecida: ${acao}`);
  } catch (e) {
    return BAD(500, `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`);
  }
}
