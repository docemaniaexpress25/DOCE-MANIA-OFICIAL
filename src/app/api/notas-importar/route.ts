import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasNotaColumns } from '@/lib/serverSchema';
import {
  presencaArquivos,
  coletarArquivosNota,
  listarRefsFocus,
  listarBackupsFocus,
  importarDoBackupFocus,
  listarMetasAvulsas,
  importarAvulsa,
  excluirAvulsa,
  docDaChave,
  invalidaPresenca,
  reconstituirOrfas,
} from '@/lib/focusArquivos';
import { FocusDoc, isFocusConfigured, garantirHooksFocus } from '@/lib/focusNfe';
import { importarLoteXml, XmlLoteArquivo } from '@/lib/xmlNotas';

/**
 * BLOCO 141 — IMPORTADOR DE ARQUIVOS FISCAIS DA FOCUS (regra do dono):
 * "quero que acesse o portal da focus e me traga o pdf e xml das notas
 * atraves da api! salve dentro do nosso sistema. ja bati varias notas e
 * quero ter o controle disso, hj ta tudo no site da focus!"
 *
 * POST /api/notas-importar  (sessao ADMIN — portal de notas)
 *   { acao: 'IMPORTAR' }              -> processa UM lote (6 notas) das vendas
 *                                        com nota autorizada/cancelada sem
 *                                        arquivo local; o portal repete ate done.
 *   { acao: 'AVULSAS' }               -> FONTE OFICIAL (BLOCO 142): BACKUPS
 *                                        mensais da Focus (/v2/backups/
 *                                        {cnpj}.json -> ZIPs S3 de XMLs de
 *                                        TODAS as notas do mes — app + PAINEL);
 *                                        cada chave nova importa completa (ate
 *                                        8/chamada). Fallback: varredura legada.
 *                                        BLOCO 154: recupera tambem as NOTAS
 *                                        ORFAS (venda excluida, PDF/XML que
 *                                        ficaram no nosso storage) reimportando
 *                                        pela Focus com o status real.
 *   { acao: 'ATUALIZAR_AVULSA', ref } -> re-consulta 1 avulsa e atualiza
 *                                        metadados + arquivos.
 *   { acao: 'EXCLUIR_AVULSA', ref }   -> apaga metadados + arquivos da avulsa.
 *   { acao: 'XML_LOTE', arquivos: [
 *        { nome, base64 }, ... ] }   -> BLOCO 143: importa XMLs de notas de
 *                                        SAIDA emitidas em sistemas de
 *                                        terceiros (parse + DANFE gerado +
 *                                        arquivamento no bucket). Idempotente.
 *
 * Cada nota custa ate 4 reqs na Focus (consulta + DANFE + XML + pdf legado
 * NFC-e) — lotes curtos respeitam o rate limit (100 req/min). Tudo idempotente
 * (upsert): rodar de novo nunca duplica nem corrompe.
 */

const BAD = (status: number, erro: string) => NextResponse.json({ ok: false, erro }, { status });
const LOTE = 6;        // notas de venda por chamada IMPORTAR
const LOTE_AVULSAS = 8;
const TETO_MS = 40_000; // guarda-chuva de duracao do lote (Vercel)

interface VendaNota {
  id: string;
  nota_ref: string | null;
  nota_tipo: string | null;
  nota_numero: string | null;
  client_id: string | null;
}

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponivel.');
  }
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Entre com o PIN novamente.');
  if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin pode importar arquivos.');

  const body = await req.json().catch(() => ({}));
  const acao = String(body.acao || '');

  // ---------------- IMPORTAR (lote das notas do app) ----------------
  if (acao === 'IMPORTAR') {
    if (!(await hasNotaColumns())) return BAD(503, 'Schema antigo — rode o SQL do Bloco 10 (docs/NOTAS-FISCAIS.md).');
    const db = getServiceClient();

    // Todas as vendas com nota AUTORIZADA ou CANCELADA (so elas tem arquivo)
    const vendas: VendaNota[] = [];
    for (let range = 0; range < 5000; range += 1000) {
      const { data, error } = await db
        .from('sales')
        .select('id, nota_ref, nota_tipo, nota_numero, client_id')
        .in('nota_status', ['AUTORIZADA', 'CANCELADA'])
        .not('nota_ref', 'is', null)
        .order('data_venda', { ascending: false })
        .range(range, range + 999);
      if (error || !data) break;
      vendas.push(...((data as unknown) as VendaNota[]));
      if (data.length < 1000) break;
    }

    const presenca = await presencaArquivos();
    const precisa = vendas.filter(v => {
      const ref = String(v.nota_ref || '');
      if (!ref) return false;
      const doc = String(v.nota_tipo || '').toUpperCase() === 'NFCE' ? 'NFCE' : 'NFE';
      const p = presenca.get(`${doc}/${ref}`);
      return !p || !p.xml || !p.pdf;
    });

    if (precisa.length === 0) {
      return NextResponse.json({
        ok: true, done: true, lote: 0, faltando: 0, feitos: 0, pulados: 0, semArquivo: 0, erros: [],
        msg: 'Tudo arquivado — nenhum PDF/XML pendente.',
      });
    }

    const inicio = Date.now();
    const lote = precisa.slice(0, LOTE);
    const erros: { ref: string; erro: string }[] = [];
    let feitos = 0, pulados = 0, semArquivo = 0, comFalha = 0;

    for (const v of lote) {
      if (Date.now() - inicio > TETO_MS) { pulados++; continue; }
      const ref = String(v.nota_ref || '');
      let doc: FocusDoc = String(v.nota_tipo || '').toUpperCase() === 'NFCE' ? 'nfce' : 'nfe';
      let coleta = await coletarArquivosNota(doc, ref);
      // tipo ausente/duvidoso: tenta o outro modelo antes de desistir
      if (!coleta.ok && /nao_encontrada|não encontrada|not found/i.test(coleta.motivo || '')) {
        doc = doc === 'nfe' ? 'nfce' : 'nfe';
        coleta = await coletarArquivosNota(doc, ref);
        if (coleta.ok) {
          await db.from('sales').update({ nota_tipo: doc === 'nfce' ? 'NFCE' : 'NFE' }).eq('id', v.id);
        }
      }
      if (!coleta.ok) { comFalha++; erros.push({ ref, erro: coleta.motivo || 'erro desconhecido' }); continue; }
      if (coleta.semArquivo) { semArquivo++; continue; }
      feitos++;
      // Espelha as URLs oficiais da Focus na venda (fallback do portal)
      const patch: Record<string, unknown> = {};
      if (coleta.pdfUrl) patch.nota_pdf_url = coleta.pdfUrl;
      if (coleta.xmlUrl) patch.nota_xml_url = coleta.xmlUrl;
      if (Object.keys(patch).length > 0) {
        try { await db.from('sales').update(patch).eq('id', v.id); } catch { /* best-effort */ }
      }
    }
    invalidaPresenca();

    const faltando = precisa.length - feitos - semArquivo - comFalha;
    return NextResponse.json({
      ok: true,
      done: Math.max(0, faltando) === 0,
      lote: lote.length,
      faltando: Math.max(0, faltando),
      total: precisa.length,
      feitos,
      pulados,
      semArquivo,
      comFalha,
      erros: erros.slice(0, 8),
    });
  }

  // ---------------- AVULSAS (emitidas fora do app — painel da Focus) ----------------
  if (acao === 'AVULSAS') {
    const inicio = Date.now();
    const db = getServiceClient();

    // ---------------- BLOCO 147: AUTO-REPARO DOS GATILHOS ----------------
    // O buraco provado ("7 no painel, 5 no nosso"): gatilho `nfce` ausente na
    // Focus + backup mensal parcial (sabado/dia 1o). Notas novas ficavam
    // invisiveis ate o proximo ZIP. Aqui consertamos o pipeline ANTES de
    // varrer: garante nfe + nfce + nfce_contingencia apontando pro webhook.
    let reparo: { criados: string[]; falhas: string[] } = { criados: [], falhas: [] };
    if (isFocusConfigured()) {
      const origin2 = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
      const g = await garantirHooksFocus(`${origin2}/api/focus/webhook`);
      reparo = { criados: g.criados, falhas: g.falhas };
    }

    // refs que o app ja conhece (qualquer status)
    const conhecidas = new Set<string>();
    for (let range = 0; range < 5000; range += 1000) {
      const { data, error } = await db
        .from('sales')
        .select('nota_ref')
        .not('nota_ref', 'is', null)
        .range(range, range + 999);
      if (error || !data) break;
      for (const r of (data as unknown) as { nota_ref: string }[]) conhecidas.add(String(r.nota_ref || ''));
      if ((data as unknown[]).length < 1000) break;
    }
    // avulsas ja importadas
    const metas = await listarMetasAvulsas();
    const jaImportadas = new Set(metas.map(m => m.ref));

    // ---------------- FONTE OFICIAL (BLOCO 142): BACKUPS MENSais ----------------
    // GET /v2/backups/{cnpj}.json -> ZIPs S3 com os XMLs de TODAS as notas do
    // mes (NFe + NFCe, app + PAINEL). Comprovado real (HTTP 200). Cada chave
    // desconhecida vira avulsa importada completa (DANFE + XML + metadados).
    const backup = await importarDoBackupFocus(LOTE_AVULSAS);
    // ---------------- BLOCO 154: RECONSTITUICAO DE ORFAS ----------------
    // Nota de venda EXCLUIDA pelo admin: os arquivos PDF/XML ficaram no nosso
    // storage, mas a linha sales sumiu — a nota some do portal. Aqui ela volta:
    // achamos a ref nos arquivos do bucket e reimportamos pela Focus (status
    // real, DANFE/XML clicaveis). Roda em TODOS os caminhos de resposta.
    const orfas = await reconstituirOrfas(6).catch(() => null);
    const orfasNovas = Number(orfas?.reconstituidas) || 0;
    const orfasMsg = orfasNovas > 0
      ? ` ${orfasNovas} nota(s) RECUPERADA(S) de venda excluida (arquivos nossos + Focus).`
      : '';
    if (backup.suportado) {
      const msg = backup.motivo === 'SEM_BACKUPS'
        ? 'Focus sem backups mensais disponiveis ainda (geram depois das primeiras notas do mes).'
        : backup.novas > 0
          ? `${backup.novas} nota(s) trazida(s) do backup mensal ${backup.mes || ''} da Focus (app + painel).`
          : backup.restantes > 0
            ? `Backup ${backup.mes || ''}: ainda faltam ${backup.restantes} nota(s) — toque de novo.`
            : `Conferido: todas as notas do backup mensal da Focus (${backup.mesesComBackup} mes(es), ${backup.chavesNoBackup} XMLs) ja estao no sistema.`;
      // BLOCO 147: avisa quando o reparo criou gatilhos (o dono entende por que
      // notas novas nao chegavam) e como trazer as que ficaram de fora.
      const dicaReparo = reparo.criados.length > 0
        ? ` Gatilho(s) ${reparo.criados.join(', ')} instalado(s) na Focus agora — notas novas chegam em tempo real.`
        : '';
      const dicaParcial = backup.novas === 0 && backup.restantes === 0
        ? ' O backup oficial e parcial (sabados): notas emitidas apos o ultimo ZIP chegam em tempo real pelo webhook ou cole a ref/chave do painel.'
        : '';
      return NextResponse.json({
        ok: true, suportado: true, fonte: 'backups', fim: backup.fim && (orfas?.restantes || 0) === 0,
        conhecidas: conhecidas.size, novas: backup.novas + orfasNovas, puladas: backup.puladas,
        erros: backup.erros, totalNaFocus: backup.chavesNoBackup,
        restantes: Math.max(0, backup.restantes) + Math.max(0, orfas?.restantes || 0),
        reconstituidas: orfasNovas, mes: backup.mes || null, mesesComBackup: backup.mesesComBackup,
        danfesGravados: backup.danfesGravados,
        hooksReparados: reparo.criados, hooksFalhas: reparo.falhas,
        msg: `${msg}${orfasMsg}${dicaReparo}${dicaParcial}`,
      });
    }

    // ---------------- FALLBACK: varredura de refs (legado) ----------------
    const lista = await listarRefsFocus();
    if (!lista.suportado) {
      return NextResponse.json({
        ok: true, suportado: false, fim: true, conhecidas: conhecidas.size, novas: orfasNovas, puladas: 0, erros: [],
        reconstituidas: orfasNovas,
        motivo: lista.motivo || 'listagem indisponivel',
        msg: `Notas do app conferidas.${orfasMsg} A listagem por CNPJ nao respondeu nesta conta (${lista.motivo || '?'}). Para uma nota especifica do painel da Focus, use o importador manual (ref ou chave de acesso).`,
      });
    }

    const totalNaFocus = lista.notas.length;

    const candidatos = lista.notas
      .map((n) => ({
        ref: String(n.ref || n.referencia || '').trim(),
        status: String(n.status || '').toLowerCase(),
        chave: String(n.chave_nfe || n.chave || ''),
      }))
      .filter(n => n.ref && !conhecidas.has(n.ref) && !jaImportadas.has(n.ref))
      .filter(n => n.status === 'autorizado' || n.status === 'cancelado');

    if (candidatos.length === 0) {
      return NextResponse.json({
        ok: true, suportado: true, fim: true, conhecidas: conhecidas.size, novas: orfasNovas, puladas: 0, erros: [],
        reconstituidas: orfasNovas,
        totalNaFocus, listadas: { NFE: lista.docs.NFE, NFCE: lista.docs.NFCE }, cnpj: lista.cnpj,
        msg: orfasNovas > 0 ? `${orfasNovas} nota(s) recuperada(s) de venda excluida.` : 'Conferido: todas as notas da Focus ja estao no sistema.',
      });
    }

    const erros: { ref: string; erro: string }[] = [];
    let novas = 0, puladas = 0;
    for (const c of candidatos.slice(0, LOTE_AVULSAS)) {
      if (Date.now() - inicio > TETO_MS) { puladas++; continue; }
      const docHint = docDaChave(c.chave);
      const r = await importarAvulsa(c.ref, docHint);
      if (r.ok) novas++;
      else erros.push({ ref: c.ref, erro: r.motivo || 'erro' });
    }
    invalidaPresenca();
    const fim = novas + puladas + erros.length >= candidatos.length;
    return NextResponse.json({
      ok: true, suportado: true, fim, conhecidas: conhecidas.size, novas: novas + orfasNovas, puladas, erros: erros.slice(0, 8),
      reconstituidas: orfasNovas,
      totalNaFocus, listadas: { NFE: lista.docs.NFE, NFCE: lista.docs.NFCE }, cnpj: lista.cnpj,
      restantes: Math.max(0, candidatos.length - novas - puladas - erros.length),
    });
  }

  // ---------------- ATUALIZAR_AVULSA ----------------
  if (acao === 'ATUALIZAR_AVULSA') {
    const ref = String(body.ref || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 120);
    if (!ref) return BAD(400, 'Parametro ausente (ref).');
    const r = await importarAvulsa(ref);
    invalidaPresenca();
    if (!r.ok) return BAD(502, `Falha ao atualizar na Focus: ${r.motivo || 'erro'}`);
    return NextResponse.json({ ok: true, meta: r.meta, msg: 'Avulsa re-consultada na SEFAZ e arquivada.' });
  }

  // ---------------- EXCLUIR_AVULSA ----------------
  if (acao === 'EXCLUIR_AVULSA') {
    const ref = String(body.ref || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 120);
    if (!ref) return BAD(400, 'Parametro ausente (ref).');
    await excluirAvulsa(ref);
    return NextResponse.json({ ok: true, msg: 'Avulsa apagada do sistema (a nota continua na Focus/SEFAZ).' });
  }

  // ---------------- XML_LOTE (BLOCO 143 — notas de saida de terceiros) ----------------
  if (acao === 'XML_LOTE') {
    const lista = Array.isArray(body.arquivos) ? (body.arquivos as XmlLoteArquivo[]) : [];
    if (lista.length === 0) return BAD(422, 'Nenhum XML recebido.');
    if (lista.length > 50) return BAD(413, 'Lote grande demais (max. 50 XMLs por chamada) — o portal envia em pedacos.');
    const resumo = await importarLoteXml(lista);
    return NextResponse.json({
      ok: true,
      ...resumo,
      msg: `${resumo.importados} nota(s) importada(s), ${resumo.cancelamentos} cancelamento(s), ${resumo.duplicados} duplicada(s), ${resumo.entradas} entrada(s), ${resumo.ilegiveis} ilegivel(is).`,
    });
  }

  // ---------------- IMPORTAR_POR_REF (colar ref/chave do painel da Focus) ----------------
  // A API v2 da Focus NAO tem listagem de notas (provado no DIAG — 404 em
  // todas as variantes). Para trazer notas emitidas FORA do app, o admin
  // copia do painel a REF ou a CHAVE de acesso (44 digitos) de cada nota e
  // cola aqui (aceita varias, separadas por linha/espaco/virgula).
  if (acao === 'IMPORTAR_POR_REF') {
    const texto = String(body.texto || '').slice(0, 4000);
    const tokens = [...new Set(
      texto
        .split(/[\s,;]+/)
        .map(t => t.trim())
        .filter(t => t.length >= 4)
    )].slice(0, 20);
    if (tokens.length === 0) return BAD(422, 'Cole pelo menos uma referencia ou chave de acesso (44 digitos).');

    const metas = await listarMetasAvulsas();
    const jaImportadas = new Set(metas.map(m => m.ref));
    const chavesJa = new Set(metas.map(m => m.chave));

    const resultados: { token: string; ok: boolean; ja?: boolean; erro?: string }[] = [];
    let feitos = 0, ja = 0;
    for (const tk of tokens) {
      const ehChave = /^\d{44}$/.test(tk);
      if (ehChave && chavesJa.has(tk)) { ja++; resultados.push({ token: tk, ok: true, ja: true }); continue; }
      if (!ehChave && jaImportadas.has(tk)) { ja++; resultados.push({ token: tk, ok: true, ja: true }); continue; }
      const docHint = ehChave ? docDaChave(tk) : undefined;
      const r = await importarAvulsa(tk, docHint);
      if (r.ok) { feitos++; resultados.push({ token: tk, ok: true }); }
      else resultados.push({ token: tk, ok: false, erro: r.motivo || 'erro' });
    }
    invalidaPresenca();
    return NextResponse.json({
      ok: true,
      feitos,
      ja,
      falhas: resultados.filter(r => !r.ok).length,
      resultados,
      msg: `${feitos} nota(s) importada(s)${ja ? `, ${ja} ja estavam` : ''}${resultados.some(r => !r.ok) ? ' — veja as que falharam' : ''}.`,
    });
  }

  // ---------------- DIAGNOSTICO (varre variantes de listagem da Focus) ----------------
  if (acao === 'DIAG') {
    const { getFocusConfig } = await import('@/lib/focusNfe');
    const { baseUrl, token, ambiente, cnpj } = getFocusConfig();
    if (!token) return BAD(503, 'Focus nao configurada.');
    const auth = 'Basic ' + Buffer.from(`${token}:`).toString('base64');
    // consulta por CHAVE fake (44 digitos) — prova se GET /v2/{doc}/{chave} existe
    const fake = '41190612345678000123550010000000221923094166';
    // BLOCO 142: as variantes OFICIAIS de listagem sao /v2/nfes?cnpj= e
    // /v2/nfces?cnpj= (o DIAG antigo so testava .json/v1 — todas 404).
    const cnpjDiag = (cnpj || '').replace(/\D/g, '').slice(0, 14);
    const q = cnpjDiag ? `cnpj=${cnpjDiag}&` : '';
    const variantes = [
      `/v2/backups/${cnpjDiag || 'CNPJ'}.json`, // BLOCO 142 — a OFICIAL que funciona (HTTP 200)
      `/v2/nfes?${q}offset=0&limit=1`,
      `/v2/nfces?${q}offset=0&limit=1`,
      '/v2/nfes.json?offset=0',
      '/v2/nfes?offset=0',
      '/v1/nfes.json?token=QUERY',
      `/v2/nfe/${fake}`,
      `/v2/nfce/${fake}`,
    ];
    const resultados: Record<string, string> = {};
    for (const v of variantes) {
      const url = v.replace('token=QUERY', `token=${encodeURIComponent(token)}`);
      try {
        const res = await fetch(`${baseUrl}${url}`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
        const body = await res.text();
        resultados[v] = `HTTP ${res.status} :: ${body.slice(0, 160).replace(/\s+/g, ' ')}`;
      } catch (e) {
        resultados[v] = `ERRO ${(e as Error).message}`;
      }
    }
    return NextResponse.json({
      ok: true, ambiente, baseUrl, cnpjUsado: cnpjDiag || '(vazio)', resultados,
      // BLOCO 142: os backups mensais reais da conta (fonte oficial)
      backups: await (async () => {
        const b = await listarBackupsFocus(cnpjDiag);
        return b.ok ? b.backups : { motivo: b.motivo };
      })(),
    });
  }

  return BAD(400, `Acao desconhecida: ${acao}`);
}
