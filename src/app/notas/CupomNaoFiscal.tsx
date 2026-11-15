"use client";

/**
 * BLOCO 146 — CUPOM NÃO FISCAL do portal ("ver o que foi pedido" em IMAGEM).
 *
 * O dono pediu: "botão ver o que foi pedido poderia emular o cupom não fiscal
 * com itens em lista formato imagem, isso facilitaria a visualização".
 *
 * O modal desenha o cupom em um <canvas> 80mm (576px @203dpi, mesmo formato da
 * térmica do app — BLOCO 139) e mostra como IMAGEM: papel emulado, itens em
 * lista monoespaçada, total, pagamento e dados do documento. De quebra:
 *  - BAIXAR a imagem (PNG) para anexar no WhatsApp manualmente;
 *  - COMPARTILHAR a imagem (Web Share API com arquivo, quando o navegador
 *    suporta) — celular joga direto no WhatsApp;
 *  - COMPARTILHAR DOCUMENTOS (DANFE/XML) por WhatsApp com LINK ASSINADO
 *    gerado pelo servidor (/api/notas-admin?acao=links → /api/notas-compartilhar).
 */

import { useMemo, useRef, useState } from 'react';

export interface CupomNota {
  id: string;
  numero: string;
  tipo: string;
  modoNota: string;
  chave: string;
  ref: string;
  valor: number;
  valorPago: number;
  metodo: string;
  detalhe: string;
  statusPagamento: string;
  dataVenda: string;
  emitidaEm: string | null;
  cliente: string;
  clienteDoc: string;
  vendedor: string;
  boletoStatus?: string;
  boletoVencimento?: string;
  avulsa?: boolean;
  origem?: string;
}

export interface CupomItem { produto: string; quantidade: number; preco: number; }

export interface CupomCliente {
  nome_fantasia?: string; nome?: string; cnpj?: string; razao_social?: string;
  telefone?: string; email?: string;
  endereco?: string; bairro?: string; endereco_numero?: string;
  endereco_municipio?: string; endereco_uf?: string;
}

interface Props {
  nota: CupomNota;
  itens: CupomItem[];
  cliente: CupomCliente | null;
  /** rotuloTipo já resolvido pelo pai (NF-e / NFC-e). */
  rotulo: string;
  /** links de download já autenticados (montados pelo pai via linkArquivo). */
  urlPdf: string;
  urlXml: string;
  /** abre o fluxo "compartilhar documentos por WhatsApp" do pai (com os links assinados). */
  onCompartilharDocumentos: () => void;
  showToast: (msg: string, ok?: boolean) => void;
  onFechar: () => void;
}

const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);

const fmtData = (iso: string | null) => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch { return '—'; }
};

/** 5499999999 -> 5554999999999 (padrão da fila de entregas: DDD sem o 55). */
export function foneWhatsApp(telefone: string | undefined): string {
  const d = String(telefone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) return `55${d}`;
  return d;
}

// ---------------------------------------------------------------------------
// Canvas: desenha o cupom 80mm (mesmo espírito do BLOCO 139 do app)
// ---------------------------------------------------------------------------
interface Linha { t: string; align?: 'l' | 'c' | 'r'; bold?: boolean; size?: number; cor?: string; gap?: number; }
interface Regra { gap?: number; dupla?: boolean; }

function desenharCupomCanvas(o: {
  tituloLoja: string;
  rotulo: string;
  numero: string;
  dataBatida: string;
  dataVenda: string;
  cliente: string;
  clienteDoc: string;
  vendedor: string;
  chave: string;
  avulsa?: boolean;
  itens: CupomItem[];
  total: number;
  metodo: string;
  detalhe: string;
  statusPagamento: string;
  valorPago: number;
  boletoTexto?: string;
}): { url: string; largura: number; altura: number } {
  const L = 576; // 80mm @203dpi
  const FS = 15;
  const LH = 22;
  const PAD = 22;
  const linhas: Linha[] = [];
  const separadores: number[] = []; // índices de linha ANTES dos quais entra régua

  linhas.push({ t: o.tituloLoja, bold: true, size: 26, align: 'c' });
  linhas.push({ t: 'CUPOM NÃO FISCAL', bold: true, size: 16, align: 'c', cor: '#555' });
  linhas.push({ t: '(emulação — não é documento fiscal)', size: 12, align: 'c', cor: '#888' });
  separadores.push(linhas.length);
  linhas.push({ t: `Documento: ${o.rotulo}${o.numero ? ` nº ${o.numero}` : ''}`, bold: true });
  if (o.avulsa) linhas.push({ t: `Origem: ${o.origem === 'XML' ? 'importada por XML' : 'importada da Focus'}`, size: 13, cor: '#555' });
  linhas.push({ t: `Emissão: ${o.dataBatida}`, size: 14 });
  linhas.push({ t: `Pedido: ${o.dataVenda}`, size: 14 });
  if (o.vendedor && o.vendedor !== '—') linhas.push({ t: `Vendedor: ${o.vendedor}`, size: 14 });
  separadores.push(linhas.length);
  linhas.push({ t: 'CLIENTE', bold: true, size: 13, cor: '#555' });
  linhas.push({ t: o.cliente || 'CONSUMIDOR NAO IDENTIFICADO' });
  if (o.clienteDoc) linhas.push({ t: `DOC: ${o.clienteDoc}`, size: 13, cor: '#555' });
  if (o.chave) separadores.push(linhas.length);
  if (o.chave) linhas.push({ t: `Chave de acesso: ${o.chave}`, size: 11, cor: '#555' });
  separadores.push(linhas.length);
  linhas.push({ t: 'ITENS', bold: true, size: 13, cor: '#555' });

  // itens: nome truncado à esquerda, valor à direita; segunda linha com @unitário
  const W = L - PAD * 2;
  const ctxM = document.createElement('canvas').getContext('2d');
  const medir = (txt: string, size: number, bold: boolean): number => {
    if (!ctxM) return txt.length * 8;
    ctxM.font = `${bold ? 'bold ' : ''}${size}px "Courier New", monospace`;
    return ctxM.measureText(txt).width;
  };
  const truncar = (txt: string, size: number, bold: boolean, max: number): string => {
    if (medir(txt, size, bold) <= max) return txt;
    let t = txt;
    while (t.length > 1 && medir(`${t}…`, size, bold) > max) t = t.slice(0, -1);
    return `${t}…`;
  };

  if (o.itens.length === 0) {
    linhas.push({ t: '(sem itens gravados no pedido)', size: 13, cor: '#888' });
  }
  for (const it of o.itens) {
    const sub = it.quantidade * it.preco;
    const esq = `${it.quantidade}x ${it.produto}`;
    const esqMax = W - medir(fmtBRL(sub), FS, true) - 10;
    linhas.push({ t: `${truncar(esq, FS, false, esqMax)}`, align: 'l' });
    linhas.push({ t: fmtBRL(sub), align: 'r', bold: true });
    linhas.push({ t: `@ ${fmtBRL(it.preco)} un.`, size: 12, cor: '#777', align: 'l' });
  }

  separadores.push(linhas.length);
  linhas.push({ t: 'TOTAL', bold: true, size: 17 });
  linhas.push({ t: fmtBRL(o.total), bold: true, size: 22, align: 'r' });
  separadores.push(linhas.length);
  linhas.push({ t: 'PAGAMENTO', bold: true, size: 13, cor: '#555' });
  linhas.push({ t: `Forma: ${(o.metodo || '—').replace('_', ' ')}` });
  if (o.boletoTexto) linhas.push({ t: o.boletoTexto, size: 13, cor: '#555' });
  linhas.push({ t: `Situação: ${o.statusPagamento === 'PAGO' ? 'PAGO' : 'EM ABERTO'}` });
  linhas.push({ t: `Pago registrado: ${fmtBRL(o.valorPago)}`, size: 13, cor: '#555' });
  if (o.detalhe) {
    linhas.push({ t: 'Observação:', size: 13, cor: '#555' });
    // quebra a observação em linhas de ~64 caracteres
    const palavras = String(o.detalhe).split(/\s+/);
    let atual = '';
    for (const p of palavras) {
      if ((atual + ' ' + p).trim().length > 62) { linhas.push({ t: atual.trim(), size: 12, cor: '#777' }); atual = p; }
      else atual = `${atual} ${p}`.trim();
    }
    if (atual) linhas.push({ t: atual, size: 12, cor: '#777' });
  }
  separadores.push(linhas.length);
  linhas.push({ t: 'DOCUMENTO FISCAL: DANFE (PDF) e XML no portal', size: 12, align: 'c', cor: '#555' });
  linhas.push({ t: 'DOCE MANIA — obrigado pela compra!', bold: true, size: 14, align: 'c' });

  // altura
  let h = PAD * 2;
  for (let i = 0; i < linhas.length; i++) {
    const ln = linhas[i];
    h += (ln.size || FS) * 1.35 + (ln.gap || 0);
    if (separadores.includes(i)) h += 18;
  }
  h += 10;

  const canvas = document.createElement('canvas');
  canvas.width = L;
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { url: '', largura: L, altura: 0 };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, L, canvas.height);

  // bordas serrilhadas do papel térmico
  ctx.fillStyle = '#e5e7eb';
  for (let x = 0; x < L; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + 7, 8); ctx.lineTo(x + 14, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, canvas.height); ctx.lineTo(x + 7, canvas.height - 8); ctx.lineTo(x + 14, canvas.height); ctx.closePath(); ctx.fill();
  }

  let y = PAD + 10;
  for (let i = 0; i < linhas.length; i++) {
    const ln = linhas[i];
    if (separadores.includes(i)) {
      y += 6;
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(L - PAD, y);
      ctx.stroke();
      ctx.setLineDash([]);
      y += 14;
    }
    const size = ln.size || FS;
    ctx.font = `${ln.bold ? 'bold ' : ''}${size}px "Courier New", monospace`;
    ctx.fillStyle = ln.cor || '#111827';
    const w = ctx.measureText(ln.t).width;
    let x = PAD;
    if (ln.align === 'c') x = (L - w) / 2;
    if (ln.align === 'r') x = L - PAD - w;
    ctx.fillText(ln.t, x, y + size);
    y += size * 1.35 + (ln.gap || 0);
  }

  return { url: canvas.toDataURL('image/png'), largura: L, altura: canvas.height };
}

export default function CupomNaoFiscal({ nota, itens, cliente, rotulo, urlPdf, urlXml, onCompartilharDocumentos, showToast, onFechar }: Props) {
  const [baixando, setBaixando] = useState(false);
  const imgWrap = useRef<HTMLDivElement | null>(null);

  const boletoTexto = nota.boletoStatus
    ? `Boleto Inter: ${String(nota.boletoStatus).replace(/_/g, ' ').toLowerCase()}${nota.boletoVencimento ? ` · venc. ${nota.boletoVencimento.slice(8, 10)}/${nota.boletoVencimento.slice(5, 7)}/${nota.boletoVencimento.slice(0, 4)}` : ''}`
    : undefined;

  const cupom = useMemo(() => {
    try {
      return desenharCupomCanvas({
        tituloLoja: 'DOCE MANIA',
        rotulo,
        numero: nota.numero,
        dataBatida: fmtData(nota.emitidaEm || nota.dataVenda),
        dataVenda: fmtData(nota.dataVenda),
        cliente: nota.cliente,
        clienteDoc: nota.clienteDoc,
        vendedor: nota.vendedor,
        chave: nota.chave,
        avulsa: nota.avulsa,
        origem: nota.origem,
        itens,
        total: nota.valor,
        metodo: nota.metodo,
        detalhe: nota.detalhe,
        statusPagamento: nota.statusPagamento,
        valorPago: nota.valorPago,
        boletoTexto,
      });
    } catch {
      return { url: '', largura: 0, altura: 0 };
    }
  }, [nota, itens, rotulo, boletoTexto]);

  const baixarImagem = async () => {
    if (!cupom.url) return;
    setBaixando(true);
    try {
      const bin = atob(cupom.url.split(',')[1] || '');
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([u8], { type: 'image/png' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `cupom-nao-fiscal-${rotulo.replace('-', '').toLowerCase()}${nota.numero || nota.id.slice(0, 8)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      showToast('Imagem do cupom baixada — anexe no WhatsApp.');
    } catch {
      showToast('Falha ao gerar a imagem do cupom.', false);
    } finally { setBaixando(false); }
  };

  const compartilharImagem = async () => {
    if (!cupom.url) return;
    try {
      const bin = atob(cupom.url.split(',')[1] || '');
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const file = new File([u8], 'cupom-nao-fiscal.png', { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await navigator.share({ title: 'Cupom não fiscal — Doce Mania', files: [file] });
        return;
      }
      showToast('Este navegador não abre o compartilhamento com imagem — baixei o PNG para você anexar.', true);
      await baixarImagem();
    } catch (e: unknown) {
      if ((e as DOMException)?.name === 'AbortError') return;
      showToast('Não foi possível compartilhar a imagem — use BAIXAR IMAGEM.', false);
    }
  };

  const tel = foneWhatsApp(cliente?.telefone);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={onFechar} role="dialog" aria-modal="true" aria-label="Cupom não fiscal">
      <div className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-y-auto max-h-[92dvh]" onClick={e => e.stopPropagation()}>
        {/* cabeçalho */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-5 sticky top-0 z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-blue-200">Cupom não fiscal — o que foi pedido</p>
              <p className="text-lg font-black mt-0.5 truncate">{nota.cliente}</p>
              <p className="text-[10px] font-bold text-blue-200 mt-0.5">{rotulo}{nota.numero ? ` nº ${nota.numero}` : ''} · {fmtBRL(nota.valor)}</p>
            </div>
            <button onClick={onFechar} className="w-9 h-9 rounded-xl bg-white/15 text-white flex items-center justify-center active:scale-90 shrink-0" aria-label="Fechar cupom">
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* ==== IMAGEM DO CUPOM (emulação do papel 80mm) ==== */}
          <div ref={imgWrap} className="bg-gray-100 rounded-2xl border border-gray-200 p-3">
            <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 text-center"><i className="fa-solid fa-receipt mr-1"></i>como sairia no papel — itens em lista</p>
            {cupom.url ? (
              <img src={cupom.url} alt={`Cupom não fiscal emulado de ${nota.cliente} com ${itens.length} item(ns)`} className="w-full rounded-lg border border-gray-200 shadow-sm bg-white" />
            ) : (
              <p className="text-[10px] font-bold text-gray-400 text-center py-6">Não foi possível desenhar o cupom neste navegador.</p>
            )}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={() => void baixarImagem()} disabled={baixando || !cupom.url} className="bg-blue-600 disabled:opacity-60 text-white rounded-xl py-2.5 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform">
                <i className="fa-solid fa-download mr-1"></i>Baixar imagem
              </button>
              <button onClick={() => void compartilharImagem()} disabled={!cupom.url} className="bg-emerald-600 disabled:opacity-60 text-white rounded-xl py-2.5 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform">
                <i className="fa-solid fa-share-nodes mr-1"></i>Compartilhar
              </button>
            </div>
          </div>

          {/* ==== WhatsApp: documentos + contato ==== */}
          <div className="bg-emerald-50/70 border border-emerald-100 rounded-2xl p-4">
            <p className="text-[9px] font-black uppercase text-emerald-600 tracking-wider mb-2"><i className="fa-brands fa-whatsapp mr-1"></i>Compartilhar com o cliente</p>
            <div className="space-y-2">
              <button
                onClick={onCompartilharDocumentos}
                className="w-full bg-emerald-600 text-white rounded-xl py-3 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"
              >
                <i className="fa-solid fa-file-pdf mr-1.5"></i>Enviar DANFE + XML por WhatsApp
              </button>
              {tel && (
                <a
                  href={`https://wa.me/${tel}`}
                  target="_blank" rel="noopener noreferrer"
                  className="block w-full text-center bg-white border border-emerald-200 text-emerald-700 rounded-xl py-3 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"
                >
                  <i className="fa-brands fa-whatsapp mr-1.5"></i>Abrir conversa ({cliente?.telefone})
                </a>
              )}
            </div>
          </div>

          {/* ==== Cliente ==== */}
          {cliente && (
            <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-4">
              <p className="text-[9px] font-black uppercase text-blue-500 tracking-wider mb-2"><i className="fa-solid fa-user mr-1"></i>Cliente</p>
              <div className="grid grid-cols-1 gap-1 text-[10px] font-bold text-gray-600">
                <p>{cliente.razao_social || cliente.nome_fantasia || cliente.nome || '—'}</p>
                {cliente.cnpj && <p className="text-gray-400">DOC: {cliente.cnpj}</p>}
                {(cliente.endereco || cliente.bairro || cliente.endereco_municipio) && (
                  <p className="text-gray-400">{[cliente.endereco, cliente.endereco_numero].filter(Boolean).join(', ')}{cliente.bairro ? ` - ${cliente.bairro}` : ''}{cliente.endereco_municipio ? ` - ${cliente.endereco_municipio}/${cliente.endereco_uf || ''}` : ''}</p>
                )}
                {cliente.email && <p className="text-gray-400"><i className="fa-solid fa-envelope text-[8px] mr-1"></i>{cliente.email}</p>}
                {cliente.telefone && <p className="text-gray-400"><i className="fa-solid fa-phone text-[8px] mr-1"></i>{cliente.telefone}</p>}
              </div>
            </div>
          )}

          {/* ==== Documento fiscal ==== */}
          <div className="bg-gray-50 rounded-2xl p-4">
            <p className="text-[9px] font-black uppercase text-gray-400 tracking-wider mb-2"><i className="fa-solid fa-receipt mr-1"></i>Documento fiscal</p>
            {nota.chave && <p className="text-[9px] font-bold text-gray-500 break-all leading-snug">Chave: {nota.chave}</p>}
            <p className="text-[9px] font-bold text-gray-400 mt-1">Emissão: {fmtData(nota.emitidaEm || nota.dataVenda)} · Venda: {fmtData(nota.dataVenda)}</p>
            {nota.ref && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                <a href={urlPdf} target="_blank" rel="noopener noreferrer" className="text-center bg-rose-600 text-white rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"><i className="fa-solid fa-file-pdf mr-1"></i>DANFE</a>
                <a href={urlXml} target="_blank" rel="noopener noreferrer" className="text-center bg-gray-800 text-white rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"><i className="fa-solid fa-code mr-1"></i>XML</a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
