"use client";

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';

interface SaleItem { produto_id: string; quantidade: number; preco_venda: number; }
interface Sale {
  id: string; valor_total: number; valor_pago: number; metodo_pagamento: string;
  status_pagamento: string; data_venda: string; data_vencimento: string | null;
  sale_items: SaleItem[];
}
interface Sugestao { produto_id: string; nome: string; popularidade: number; clientesQueCompram: number; preco: number; }
interface Destaque { produto_id: string; nome: string; }
interface Stats {
  totalComprado: number; totalPago: number; clienteDesde: string;
  frequenciaDias: number; totalCompras: number;
  produtoFavorito: string; produtoFavoritoQtd: number;
}
interface Comprovante {
  id: string; sale_id: string; valor: number; txid: string | null;
  status: 'PENDENTE' | 'CONFIRMADO' | 'REJEITADO';
  observacao: string | null; review_note: string | null;
  created_at: string; reviewed_at: string | null;
}
interface ApiResponse {
  client: { id: string; nome_fantasia: string; endereco: string; bairro: string; portal_code?: string };
  sales: Sale[]; products: Record<string, string>; stats: Stats; sugestoes: Sugestao[]; destaques?: Destaque[];
  comprovantes?: Comprovante[];
  error?: string;
}
interface PixData {
  payload: string; valor: number; txid: string;
  chave: string; chaveFormatada: string; nome: string; cidade: string;
  qrDataUrl: string; cliente: string; saleId: string;
}

function formatDate(d: string) { return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function formatCurrency(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function getPaymentLabel(m: string) { return { DINHEIRO: 'Dinheiro', PIX: 'PIX', A_PRAZO: 'A Prazo' }[m] || m; }

/** Comprime a foto do comprovante no proprio aparelho antes de enviar */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1280;
        let { width, height } = img;
        if (width > max || height > max) {
          const ratio = Math.min(max / width, max / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas indisponivel')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => reject(new Error('Imagem invalida'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

/** Copia com fallback para WebView/APK antigos (sem Clipboard API) */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function ClienteDashboard() {
  const params = useParams();
  const codigo = params.codigo as string;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [tab, setTab] = useState<'todas' | 'pendentes'>('todas');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Pagamento Pix
  const [pixSale, setPixSale] = useState<Sale | null>(null);
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [pixLoading, setPixLoading] = useState(false);
  const [pixError, setPixError] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [compError, setCompError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!codigo) return;
    fetch(`/api/cliente/${codigo}`)
      .then(r => r.json())
      .then((d: ApiResponse) => { if (d.error) { setError(d.error); return; } setData(d); })
      .catch(() => setError('Erro ao carregar.'))
      .finally(() => setLoading(false));
  }, [codigo, refreshKey]);

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ---- Fluxo Pix ----
  async function abrirPix(sale: Sale) {
    setPixSale(sale);
    setPixData(null);
    setPixError('');
    setCopiado(false);
    setEnviado(false);
    setCompError('');
    setPixLoading(true);
    try {
      const res = await fetch(`/api/cliente/${codigo}/pix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId: sale.id }),
      });
      const d = await res.json();
      if (!res.ok) { setPixError(d.error || 'Erro ao gerar o Pix.'); return; }
      setPixData(d);
    } catch {
      setPixError('Erro ao gerar o Pix. Verifique a conexão.');
    } finally {
      setPixLoading(false);
    }
  }

  function fecharPix() {
    setPixSale(null);
    setPixData(null);
    setPixError('');
    setEnviado(false);
    setCompError('');
  }

  async function copiarCodigo() {
    if (!pixData) return;
    const ok = await copyText(pixData.payload);
    setCopiado(ok);
    if (ok) setTimeout(() => setCopiado(false), 2500);
  }

  function escolherArquivo() {
    fileInputRef.current?.click();
  }

  async function onArquivoSelecionado(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !pixData) return;
    setEnviando(true);
    setCompError('');
    try {
      const foto = await compressImage(file);
      const res = await fetch(`/api/cliente/${codigo}/comprovante`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId: pixData.saleId, valor: pixData.valor, foto }),
      });
      const d = await res.json();
      if (!res.ok) { setCompError(d.error || 'Erro ao enviar comprovante.'); return; }
      setEnviado(true);
      setRefreshKey(k => k + 1); // recarrega status dos comprovantes
    } catch {
      setCompError('Erro ao processar a imagem. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  if (loading) return (<div className="min-h-screen bg-gray-100 flex items-center justify-center"><div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div></div>);

  if (error || !data) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-6">
      <div className="text-center bg-white rounded-2xl p-8 shadow-sm border border-gray-100 max-w-sm">
        <div className="w-14 h-14 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4"><i className="fa-solid fa-link-slash text-rose-400 text-xl"></i></div>
        <p className="text-sm font-bold text-gray-700">Link invalido</p>
        <p className="text-xs text-gray-400 mt-1">Este link nao esta associado a nenhum cliente.</p>
      </div>
    </div>
  );

  const { client, sales, products, stats, sugestoes, destaques = [], comprovantes = [] } = data;
  // Link do catalogo de pedidos ja identificando o cliente
  const pedidoUrl = `https://pedidos-doce-mania.netlify.app/?cliente=${encodeURIComponent((client.nome_fantasia || '').trim())}&cod=${encodeURIComponent(client.portal_code || codigo)}`;
  const saldoDevedor = stats.totalComprado - stats.totalPago;
  // Pedidos online so para quem esta em dia (tolerancia de centavos)
  const temDebito = saldoDevedor > 0.005;
  // Destaques comerciais (os "mais comprados / nao pode ficar sem");
  // fallback para as sugestoes personalizadas se o cadastro mudar de nome.
  const ofertas = destaques.length > 0
    ? destaques.map(d => ({ id: d.produto_id, nome: d.nome }))
    : sugestoes.map(s => ({ id: s.produto_id, nome: s.nome }));
  const vendasPendentes = sales.filter(s => s.status_pagamento === 'PENDENTE');
  const saldoPendente = vendasPendentes.reduce((a, s) => a + (Number(s.valor_total) - Number(s.valor_pago)), 0);
  const listSales = tab === 'pendentes' ? vendasPendentes : sales;
  const compPendentes = comprovantes.filter(c => c.status === 'PENDENTE').length;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header personalizado */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white px-5 pt-14 pb-24 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2"></div>
        <div className="max-w-md mx-auto relative z-10">
          <p className="text-[10px] font-bold text-blue-200/70 uppercase tracking-[0.2em] mb-3">Extrato do Cliente</p>
          <h1 className="text-2xl font-black uppercase tracking-tight leading-tight">{client.nome_fantasia}</h1>
          {client.endereco && (
            <p className="text-[11px] text-blue-200/60 mt-2 font-medium">
              <i className="fa-solid fa-location-dot mr-1 text-[9px]"></i>{client.endereco}{client.bairro ? ` - ${client.bairro}` : ''}
            </p>
          )}
        </div>
      </div>

      {/* KPIs flutuante */}
      <div className="max-w-md mx-auto px-4 -mt-16 relative z-20">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-5 grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Comprado</p>
            <p className="text-[15px] font-black text-blue-600 mt-0.5">{formatCurrency(stats.totalComprado)}</p>
          </div>
          <div className="text-center border-x border-gray-100">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Pago</p>
            <p className="text-[15px] font-black text-emerald-600 mt-0.5">{formatCurrency(stats.totalPago)}</p>
          </div>
          <div className="text-center">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Devedor</p>
            <p className={`text-[15px] font-black mt-0.5 ${saldoDevedor > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{formatCurrency(saldoDevedor)}</p>
          </div>
        </div>
      </div>

      {/* Perfil personalizado */}
      <div className="max-w-md mx-auto px-4 mt-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <p className="text-[9px] font-black uppercase text-gray-400 tracking-wider mb-3">
            <i className="fa-solid fa-fingerprint mr-1 text-blue-400"></i>Seu Perfil
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                <i className="fa-solid fa-calendar-check text-blue-500 text-[10px]"></i>
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-400">Cliente desde</p>
                <p className="text-[11px] font-black text-gray-700 capitalize">{stats.clienteDesde}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
                <i className="fa-solid fa-repeat text-indigo-500 text-[10px]"></i>
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-400">Frequencia</p>
                <p className="text-[11px] font-black text-gray-700">{stats.frequenciaDias > 0 ? `A cada ${stats.frequenciaDias} dias` : `${stats.totalCompras} compra(s)`}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center shrink-0">
                <i className="fa-solid fa-star text-emerald-500 text-[10px]"></i>
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-400">Favorito</p>
                <p className="text-[11px] font-black text-gray-700 truncate max-w-[120px]">{stats.produtoFavorito}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-purple-50 rounded-xl flex items-center justify-center shrink-0">
                <i className="fa-solid fa-bag-shopping text-purple-500 text-[10px]"></i>
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-400">Total pedidos</p>
                <p className="text-[11px] font-black text-gray-700">{stats.totalCompras} compra(s)</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fazer pedido no catalogo online (identificado) — so para quem nao deve */}
      <div className="max-w-md mx-auto px-4 mt-4">
        {!temDebito ? (
          <a href={pedidoUrl} target="_blank" rel="noopener noreferrer" className="block bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl px-4 py-3.5 shadow-lg active:scale-[0.98] transition-transform">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-white/15 rounded-xl flex items-center justify-center shrink-0">
                <i className="fa-solid fa-cart-shopping text-white text-sm"></i>
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[11px] font-black text-white uppercase">Faca seu pedido online</p>
                <p className="text-[9px] text-blue-100/80 font-semibold">Monte seu carrinho no catalogo — cai direto no nosso WhatsApp</p>
              </div>
              <i className="fa-solid fa-arrow-right text-white/70 text-xs shrink-0"></i>
            </div>
          </a>
        ) : (
          <div className="bg-white border border-dashed border-gray-200 rounded-2xl px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
                <i className="fa-solid fa-lock text-gray-400 text-sm"></i>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-black text-gray-500 uppercase">Pedido online bloqueado</p>
                <p className="text-[9px] text-gray-400 font-semibold">Quite seu debito de {formatCurrency(saldoDevedor)} para liberar o pedido pelo catalogo</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pendente — com botao de pagar via Pix */}
      {vendasPendentes.length > 0 && (
        <div className="max-w-md mx-auto px-4 mt-4">
          <div className="bg-gradient-to-r from-rose-50 to-orange-50 rounded-2xl px-4 py-3 border border-rose-100 flex items-center gap-3">
            <div className="w-9 h-9 bg-rose-100 rounded-xl flex items-center justify-center shrink-0">
              <i className="fa-solid fa-triangle-exclamation text-rose-500 text-sm"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-rose-600 uppercase">Voce tem pendencias</p>
              <p className="text-sm font-black text-rose-800">{formatCurrency(saldoPendente)}</p>
            </div>
            <span className="text-[9px] font-bold text-rose-500 bg-rose-100 px-2.5 py-1 rounded-lg">{vendasPendentes.length}</span>
          </div>
          <button
            onClick={() => vendasPendentes.length === 1 ? abrirPix(vendasPendentes[0]) : setTab('pendentes')}
            className="w-full mt-2 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            <i className="fa-brands fa-pix text-base"></i>
            Pagar com Pix
          </button>
        </div>
      )}

      {/* Meus comprovantes enviados */}
      {comprovantes.length > 0 && (
        <div className="max-w-md mx-auto px-4 mt-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-teal-50 rounded-xl flex items-center justify-center">
                  <i className="fa-solid fa-paper-plane text-teal-500 text-[11px]"></i>
                </div>
                <p className="text-[10px] font-black text-gray-700">Meus comprovantes</p>
              </div>
              {compPendentes > 0 && (
                <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100">{compPendentes} em analise</span>
              )}
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {comprovantes.slice(0, 8).map(c => (
                <div key={c.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.status === 'CONFIRMADO' ? 'bg-emerald-400' : c.status === 'REJEITADO' ? 'bg-rose-400' : 'bg-amber-400 animate-pulse'}`}></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black text-gray-700">{formatCurrency(Number(c.valor))}</p>
                    <p className="text-[9px] text-gray-400 font-semibold">{formatDate(c.created_at)}{c.review_note ? ` — ${c.review_note}` : ''}</p>
                  </div>
                  <span className={`text-[8px] font-black uppercase px-2 py-1 rounded-lg shrink-0 ${c.status === 'CONFIRMADO' ? 'bg-emerald-100 text-emerald-700' : c.status === 'REJEITADO' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                    {c.status === 'CONFIRMADO' ? 'Confirmado' : c.status === 'REJEITADO' ? 'Recusado' : 'Em analise'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Destaques — os mais comprados, nao pode ficar sem */}
      {ofertas.length > 0 && (
        <div className="max-w-md mx-auto px-4 mt-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-orange-50 rounded-xl flex items-center justify-center">
                <i className="fa-solid fa-fire text-orange-500 text-xs"></i>
              </div>
              <div>
                <p className="text-[10px] font-black text-gray-700">Os mais comprados</p>
                <p className="text-[9px] text-gray-400 font-semibold">O que não pode faltar no seu estoque</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ofertas.slice(0, 8).map((p, i) => (
                <div key={p.id || i} className="bg-orange-50/60 border border-orange-100 rounded-xl px-3 py-2.5 flex items-start gap-2">
                  <span className="w-4 h-4 bg-orange-500 text-white rounded-md text-[8px] font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  <p className="text-[11px] font-bold text-gray-700 capitalize leading-tight">{p.nome}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabs + Lista */}
      <div className="max-w-md mx-auto px-4 mt-5">
        <div className="flex bg-white p-1 rounded-xl shadow-sm border border-gray-100 mb-4">
          <button onClick={() => setTab('todas')} className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${tab === 'todas' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400'}`}>
            Todas ({sales.length})
          </button>
          <button onClick={() => setTab('pendentes')} className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${tab === 'pendentes' ? 'bg-rose-500 text-white shadow-sm' : 'text-gray-400'}`}>
            Pendentes ({vendasPendentes.length})
          </button>
        </div>

        <div className="space-y-2 pb-10">
          {listSales.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
              <i className="fa-solid fa-receipt text-gray-200 text-4xl mb-3 block"></i>
              <p className="text-xs text-gray-400 font-semibold">Nenhuma compra encontrada</p>
            </div>
          ) : listSales.map(sale => {
            const isPending = sale.status_pagamento === 'PENDENTE';
            const restante = Number(sale.valor_total) - Number(sale.valor_pago);
            const isOpen = expanded.has(sale.id);

            return (
              <div key={sale.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden transition-all">
                {/* Linha resumida - SEMPRE VISIVEL */}
                <button onClick={() => toggle(sale.id)} className="w-full px-4 py-3.5 flex items-center justify-between text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isPending ? 'bg-rose-400' : 'bg-emerald-400'}`}></div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black uppercase ${isPending ? 'text-rose-600' : 'text-emerald-600'}`}>{isPending ? 'Devendo' : 'Pago'}</span>
                        <span className="text-[10px] text-gray-400 font-semibold">{formatDate(sale.data_venda)}</span>
                      </div>
                      <p className="text-[9px] text-gray-400 font-medium mt-0.5">{getPaymentLabel(sale.metodo_pagamento)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="text-sm font-black text-gray-800">{formatCurrency(Number(sale.valor_total))}</span>
                    <i className={`fa-solid fa-chevron-down text-[9px] text-gray-300 transition-transform ${isOpen ? 'rotate-180' : ''}`}></i>
                  </div>
                </button>

                {/* Detalhes - CUPOM EXPANDIDO */}
                {isOpen && (
                  <div>
                    <div className="border-t border-gray-100 mx-4"></div>
                    <div className="px-4 py-3">
                      <div className="border-l-2 border-dashed border-gray-200 pl-3 space-y-1.5">
                        {(sale.sale_items || []).map((item, idx) => (
                          <div key={idx} className="flex items-baseline justify-between text-[11px]">
                            <span className="text-gray-700 font-medium capitalize">{products[item.produto_id] || 'Produto'}</span>
                            <span className="text-gray-400 font-bold tabular-nums ml-3 shrink-0">{item.quantidade} un</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-dashed border-gray-200 mx-4"></div>
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Total</span>
                      <span className="text-base font-black text-gray-800">{formatCurrency(Number(sale.valor_total))}</span>
                    </div>
                    {isPending && restante > 0 && (
                      <>
                        <div className="bg-rose-50 px-4 py-2 border-t border-rose-100 flex items-center justify-between">
                          <span className="text-[9px] font-bold text-rose-500">Falta pagar</span>
                          <span className="text-[11px] font-black text-rose-600">{formatCurrency(restante)}</span>
                        </div>
                        <div className="px-4 py-3 border-t border-rose-100 bg-white">
                          <button
                            onClick={(e) => { e.stopPropagation(); abrirPix(sale); }}
                            className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider shadow-md active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                          >
                            <i className="fa-brands fa-pix text-sm"></i>Pagar com Pix
                          </button>
                        </div>
                      </>
                    )}
                    {isPending && sale.data_vencimento && (
                      <div className="bg-amber-50 px-4 py-2 border-t border-amber-100">
                        <p className="text-[9px] font-bold text-amber-600 text-center uppercase">
                          <i className="fa-solid fa-calendar-day mr-1"></i>Vence em {formatDate(sale.data_vencimento)}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-center pb-6">
        <p className="text-[9px] text-gray-300 font-semibold tracking-widest uppercase">Doce Mania Distribuidora</p>
      </div>

      {/* ===== MODAL PIX ===== */}
      {pixSale && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={fecharPix}>
          <div
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-300"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-5 py-4 flex items-center justify-between rounded-t-3xl">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-100/80">Pagamento</p>
                <h3 className="text-base font-black uppercase flex items-center gap-2"><i className="fa-brands fa-pix"></i>Pix — Doce Mania</h3>
              </div>
              <button onClick={fecharPix} className="w-9 h-9 bg-white/15 rounded-xl flex items-center justify-center active:scale-90">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {enviado ? (
              /* Sucesso */
              <div className="p-8 text-center">
                <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-5">
                  <i className="fa-solid fa-check text-emerald-500 text-3xl"></i>
                </div>
                <h4 className="text-base font-black text-gray-800 uppercase">Comprovante enviado!</h4>
                <p className="text-xs text-gray-400 font-semibold mt-2 leading-relaxed">
                  Recebemos seu comprovante de {formatCurrency(pixData?.valor || 0)}.<br />
                  A confirmacao e feita pela nossa equipe — em<br />poucos minutos sua divida sera atualizada aqui.
                </p>
                <button onClick={fecharPix} className="w-full mt-6 py-3.5 bg-gray-800 text-white rounded-2xl text-xs font-black uppercase tracking-wider active:scale-[0.98] transition-transform">
                  Voltar ao extrato
                </button>
              </div>
            ) : pixLoading ? (
              /* Carregando QR */
              <div className="p-10 text-center">
                <div className="w-10 h-10 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin mx-auto"></div>
                <p className="text-[10px] font-bold text-gray-400 uppercase mt-4">Gerando seu Pix...</p>
              </div>
            ) : pixError ? (
              /* Erro */
              <div className="p-8 text-center">
                <div className="w-14 h-14 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="fa-solid fa-triangle-exclamation text-rose-400 text-xl"></i>
                </div>
                <p className="text-xs font-bold text-gray-700">{pixError}</p>
                <button onClick={fecharPix} className="w-full mt-5 py-3 bg-gray-100 text-gray-600 rounded-2xl text-[11px] font-black uppercase">Fechar</button>
              </div>
            ) : pixData ? (
              <div className="p-5">
                {/* Valor */}
                <div className="text-center mb-4">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Valor da divida</p>
                  <p className="text-3xl font-black text-gray-800 mt-1">{formatCurrency(pixData.valor)}</p>
                  <p className="text-[9px] text-gray-400 font-semibold mt-1">Venda de {formatDate(pixSale.data_venda)} • ID {pixData.txid}</p>
                </div>

                {/* QR Code */}
                <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 flex flex-col items-center">
                  <img src={pixData.qrDataUrl} alt="QR Code Pix" className="w-52 h-52 object-contain bg-white rounded-xl border border-gray-100 shadow-inner" />
                  <p className="text-[8px] font-bold text-gray-400 uppercase mt-3 text-center leading-relaxed">
                    Abra o app do seu banco &gt; Pix &gt; Escanear QR Code
                  </p>
                </div>

                {/* Copia e cola */}
                <div className="mt-3">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-2">Ou use o Pix Copia e Cola</p>
                  <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                    <p className="text-[9px] font-mono text-gray-500 break-all leading-relaxed max-h-16 overflow-hidden">{pixData.payload}</p>
                  </div>
                  <button
                    onClick={copiarCodigo}
                    className={`w-full mt-2 py-3 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${copiado ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-800 text-white'}`}
                  >
                    <i className={`fa-solid ${copiado ? 'fa-check' : 'fa-copy'}`}></i>
                    {copiado ? 'Codigo copiado!' : 'Copiar codigo Pix'}
                  </button>
                </div>

                {/* Recebedor */}
                <div className="mt-3 bg-blue-50/50 border border-blue-100 rounded-xl p-3 grid grid-cols-2 gap-2 text-center">
                  <div>
                    <p className="text-[8px] font-black text-gray-400 uppercase">Recebedor</p>
                    <p className="text-[10px] font-black text-gray-700 mt-0.5">{pixData.nome}</p>
                  </div>
                  <div>
                    <p className="text-[8px] font-black text-gray-400 uppercase">Chave (CPF)</p>
                    <p className="text-[10px] font-black text-gray-700 mt-0.5">{pixData.chaveFormatada}</p>
                  </div>
                </div>

                {/* Anexar comprovante */}
                <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider text-center mb-3">
                    <i className="fa-solid fa-circle-info mr-1 text-blue-400"></i>Ja pagou? Envie o print do comprovante
                  </p>
                  {compError && (
                    <div className="mb-3 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-[10px] font-bold text-rose-600">{compError}</p>
                    </div>
                  )}
                  <button
                    onClick={escolherArquivo}
                    disabled={enviando}
                    className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {enviando ? (
                      <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>Enviando...</>
                    ) : (
                      <><i className="fa-solid fa-paperclip"></i>Anexar comprovante</>
                    )}
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onArquivoSelecionado} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
