"use client";

/**
 * PEDIDO ONLINE DOCE MANIA — /pedido/[codigo]
 * CATÁLOGO DE ATACADO — igual ao site de pedidos doce-mania
 * (github.com/albeneiredipo/site-doce-mania-pedidos), agora DENTRO do sistema:
 *
 * - 1 card por produto (família) com FOTO grande e variantes dentro;
 * - Foto: products.imagem (Bloco 15) > foto do catálogo antigo (pedidoFotos.ts) > placeholder;
 * - Venda por CAIXA: produto com unidades_por_caixa = N soma de N em N
 *   ("3 cx (36 un)") e o pedido cai no sistema já em UNIDADES prontas p/ separar;
 * - Pedido mínimo de atacado (MIN_PEDIDO) — igual ao site antigo (R$ 200);
 * - Checkout com RECIBO estilo cupom + forma de pagamento (Pix/Dinheiro);
 * - AO ENVIAR: o pedido nasce como PRÉ-VENDA na FILA do sistema (separação),
 *   com preço/estoque SEMPRE do banco — NÃO vai para WhatsApp como o site antigo.
 *
 * O código na URL é o portal_code aleatório do cliente (mesmo link do portal).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  agruparCatalogo,
  rotuloItem,
  type FamiliaCatalogo,
  type ProdutoCatalogo,
} from "@/lib/pedidoGrupos";
import { fotoFamilia } from "@/lib/pedidoFotos";

interface Categoria { id: string; name: string; }
interface ClienteInfo { nomeCompleto: string; bairro: string; endereco: string; }

/** Pedido mínimo de atacado (igual ao site antigo). Fácil de mexer. */
const MIN_PEDIDO = 200;
/** Cor do site antigo (verde Doce Mania) */
const PRIMARY = "#13ec5b";
const PRIMARY_DARK = "#0fb847";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Foto da família: cadastrada (Bloco 15) > catálogo antigo > null (placeholder) */
const fotoDe = (f: FamiliaCatalogo, produtoImagem: Map<string, string | null>): string | null => {
  for (const v of f.variantes) {
    const img = produtoImagem.get(v.produtoId);
    if (img) return img;
  }
  return fotoFamilia(f.nome);
};

export default function PedidoOnlinePage() {
  const params = useParams<{ codigo: string }>();
  const codigo = String(params?.codigo || "");

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [client, setClient] = useState<ClienteInfo | null>(null);
  const [produtos, setProdutos] = useState<ProdutoCatalogo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [bloqueado, setBloqueado] = useState(false);
  const [saldoDevedor, setSaldoDevedor] = useState(0);

  const [carrinho, setCarrinho] = useState<Record<string, number>>({});
  const [busca, setBusca] = useState("");
  const [catSel, setCatSel] = useState<string>("TODAS");
  const [forma, setForma] = useState<"PIX" | "DINHEIRO">("DINHEIRO");
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState("");
  const [resultado, setResultado] = useState<{ pedidoId: string; total: number } | null>(null);
  const [checkoutVisivel, setCheckoutVisivel] = useState(false);
  const checkoutRef = useRef<HTMLDivElement | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");
    try {
      const res = await fetch(`/api/cliente/${encodeURIComponent(codigo)}/catalogo`);
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setErro(String(d?.error || "Nao foi possivel abrir o catalogo."));
        return;
      }
      setClient(d.client);
      setProdutos(d.produtos || []);
      setCategorias(d.categorias || []);
      setBloqueado(!!d.bloqueado);
      setSaldoDevedor(Number(d.saldoDevedor || 0));
    } catch {
      setErro("Sem conexao. Verifique a internet e tente de novo.");
    } finally {
      setLoading(false);
    }
  }, [codigo]);

  useEffect(() => { if (codigo) carregar(); }, [codigo, carregar]);

  // Carrinho persiste no aparelho (igual ao site antigo), por cliente
  const CART_KEY = `dm_portal_cart_${codigo}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CART_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, number>;
        if (parsed && typeof parsed === "object") setCarrinho(parsed);
      }
    } catch { /* ignora */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(carrinho)); } catch { /* ignora */ }
  }, [carrinho, CART_KEY]);

  const familias = useMemo(() => agruparCatalogo(produtos), [produtos]);
  const prodMap = useMemo(() => Object.fromEntries(produtos.map(p => [p.id, p])), [produtos]);
  const produtoImagem = useMemo(
    () => new Map(produtos.map(p => [p.id, (p as any).imagem as string | null])),
    [produtos]
  );

  const itensCarrinho = useMemo(
    () => Object.entries(carrinho)
      .map(([id, q]) => ({ produto: prodMap[id], q }))
      .filter((x): x is { produto: ProdutoCatalogo; q: number } => !!x.produto && x.q > 0),
    [carrinho, prodMap]
  );
  const totalCarrinho = itensCarrinho.reduce((a, i) => a + i.produto.preco * i.q, 0);
  const qtdItens = itensCarrinho.reduce((a, i) => a + i.q, 0);
  const isMinOk = totalCarrinho >= MIN_PEDIDO;

  const familiasFiltradas = useMemo(() => {
    const q = semAcento(busca.trim().toLowerCase());
    if (!q && catSel === "TODAS") return familias;
    return familias.filter(f => {
      if (catSel !== "TODAS" && f.categoryId !== catSel) return false;
      if (!q) return true;
      if (semAcento(f.nome.toLowerCase()).includes(q)) return true;
      return f.variantes.some(v => v.rotulo && semAcento(v.rotulo.toLowerCase()).includes(q));
    });
  }, [familias, busca, catSel]);

  /** Quantidade (em UN) de toda a familia no carrinho */
  const qtdFamilia = useCallback((f: FamiliaCatalogo) =>
    f.variantes.reduce((a, v) => a + (carrinho[v.produtoId] || 0), 0), [carrinho]);

  /** Soma/diminui em passos de CAIXA quando o produto e vendido por caixa (igual site antigo) */
  const addQty = (p: ProdutoCatalogo, upb: number) => {
    const passo = Math.max(1, upb);
    setCarrinho(prev => {
      const atual = prev[p.id] || 0;
      const nova = Math.min(p.estoque, Math.min(atual + passo, Math.floor(atual + passo)));
      const q = Math.min(nova, Math.max(0, Math.min(p.estoque, atual + passo)));
      const copy = { ...prev };
      if (q <= 0) delete copy[p.id]; else copy[p.id] = q;
      return copy;
    });
  };
  const subQty = (p: ProdutoCatalogo, upb: number) => {
    const passo = Math.max(1, upb);
    setCarrinho(prev => {
      const atual = prev[p.id] || 0;
      const q = Math.max(0, atual - passo);
      const copy = { ...prev };
      if (q <= 0) delete copy[p.id]; else copy[p.id] = q;
      return copy;
    });
  };

  // Botao flutuante some quando o checkout esta na tela
  useEffect(() => {
    if (!checkoutRef.current) { setCheckoutVisivel(false); return; }
    const obsv = new IntersectionObserver(
      (entries) => setCheckoutVisivel(!!entries[0]?.isIntersecting),
      { threshold: 0.05 }
    );
    obsv.observe(checkoutRef.current);
    return () => obsv.disconnect();
  }, [itensCarrinho.length, resultado]);

  const irParaCheckout = () => {
    if (!checkoutVisivel) checkoutRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const enviarPedido = async () => {
    if (enviando || itensCarrinho.length === 0) return;
    if (!isMinOk) return;
    setEnviando(true);
    setErroEnvio("");
    try {
      const res = await fetch(`/api/cliente/${encodeURIComponent(codigo)}/pedido`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: itensCarrinho.map(i => ({ produtoId: i.produto.id, quantidade: i.q })),
          observacoes: obs,
          formaPagamento: forma,
        }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setResultado({ pedidoId: String(d.pedidoId || "").slice(0, 8).toUpperCase(), total: Number(d.total || totalCarrinho) });
        setCarrinho({});
        setObs("");
      } else {
        setErroEnvio(String(d?.error || "Nao foi possivel enviar o pedido."));
      }
    } catch {
      setErroEnvio("Sem conexao. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  const novoPedido = () => {
    setResultado(null);
    setErroEnvio("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** Rótulo do item no recibo: "2 cx (24 un)" ou "24 un" — igual ao site antigo */
  const rotuloQtd = (q: number, upb: number) =>
    upb > 1 ? `${q / upb}cx (${q}un)` : `${q}un`;

  // ---------- Estados de tela ----------
  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-full border-4 border-[#13ec5b] border-t-transparent animate-spin mb-4"></div>
        <p className="font-black text-xs uppercase tracking-widest text-[#0fb847] animate-pulse">Iniciando App...</p>
      </div>
    );
  }

  if (erro || !client) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
        <h1 className="font-black text-gray-900 text-lg mb-1">Ops!</h1>
        <p className="text-xs text-neutral-500 font-semibold mb-6">{erro || "Link invalido."}</p>
        <button onClick={carregar} className="bg-[#13ec5b] text-black font-black text-[10px] uppercase tracking-widest px-6 py-3.5 rounded-full shadow-lg shadow-[#13ec5b]/30 active:scale-95 transition-transform">
          Tentar de novo
        </button>
      </div>
    );
  }

  if (bloqueado) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
        <h1 className="font-black text-gray-900 text-lg mb-1">Pedido online bloqueado</h1>
        <p className="text-xs text-neutral-500 font-semibold mb-2">
          Ola, {client.nomeCompleto}! Existe um saldo de <b className="text-gray-900">{fmt(saldoDevedor)}</b> em aberto.
        </p>
        <p className="text-[11px] text-neutral-400 font-semibold mb-6 max-w-xs">Quite pelo portal do cliente ou fale com o nosso vendedor para liberar seu pedido online.</p>
        <a href={`/cliente/${encodeURIComponent(codigo)}`} className="bg-[#13ec5b] text-black font-black text-[10px] uppercase tracking-widest px-6 py-3.5 rounded-full shadow-lg shadow-[#13ec5b]/30 active:scale-95 transition-transform">
          Ir para o portal
        </a>
      </div>
    );
  }

  const primeiraSigla = client.nomeCompleto.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase();

  return (
    <div className="min-h-screen bg-white text-neutral-900 flex flex-col">
      {/* ===== HEADER (igual site antigo) ===== */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-neutral-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 shrink-0 bg-[#13ec5b] rounded-2xl flex items-center justify-center shadow-sm">
            {/* A logo.png do site antigo nao esta mais acessivel — marca em texto */}
            <span className="font-black text-black text-[11px] leading-none tracking-tighter text-center">DOCE<br/>MANIA</span>
          </div>
          <div className="flex flex-col min-w-0">
            <h1 className="font-black text-sm uppercase tracking-tight">Doce Mania Atacado</h1>
            <span className="text-[7px] font-bold text-neutral-400 uppercase tracking-widest -mt-0.5 truncate">Distribuidora em Caxias do Sul - RS</span>
          </div>
        </div>
        <a href={`/cliente/${encodeURIComponent(codigo)}`} aria-label="Voltar para o portal do cliente"
          className="w-10 h-10 flex items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 transition-colors shrink-0">
          <i className="fa-solid fa-user text-lg"></i>
        </a>
      </header>

      <main className="flex-1 w-full max-md:max-w-md mx-auto flex flex-col pb-24">
        {/* ===== HERO SEO (igual site antigo) ===== */}
        <section className="mb-4 px-4 pt-4 text-center">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0fb847]">
            🔥 Fornecedor de Salgadinhos Elma Chips em Caxias do Sul 🔥
          </h2>
          <p className="text-[9px] font-bold text-neutral-400 uppercase tracking-[0.2em] mt-1.5 leading-relaxed">
            Preços exclusivos de Atacado para mercados e revendedores.<br/>
            Pedido mínimo para entrega: R$ 200,00.
          </p>
        </section>

        {/* ===== BUSCA + CATEGORIAS ===== */}
        <div className="px-4">
          <div className="relative mb-3">
            <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-neutral-300 text-sm"></i>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto..." aria-label="Buscar produto"
              className="w-full pl-11 pr-4 py-3 bg-neutral-50 border border-neutral-100 rounded-2xl text-sm font-bold text-neutral-900 placeholder:text-neutral-300 outline-none focus:border-[#13ec5b] transition-colors" />
          </div>
          {categorias.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar">
              {[{ id: "TODAS", name: "Todas" }, ...categorias].map(c => (
                <button key={c.id} onClick={() => setCatSel(c.id)}
                  className={`shrink-0 px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${catSel === c.id ? "bg-[#13ec5b] text-black shadow-lg shadow-[#13ec5b]/20" : "bg-neutral-100 opacity-60"}`}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {familiasFiltradas.length === 0 && (
          <div className="mx-4 bg-neutral-50 border border-neutral-100 rounded-[2rem] p-8 text-center">
            <p className="text-[11px] font-black text-neutral-400 uppercase tracking-widest">Nada encontrado{busca ? ` para "${busca}"` : ""}</p>
          </div>
        )}

        {/* ===== CATALOGO — 1 card por produto com foto grande + variantes ===== */}
        <div className="grid grid-cols-1 gap-8 px-4 pt-2">
          {familiasFiltradas.map(f => {
            const noCarrinho = qtdFamilia(f);
            const foto = fotoDe(f, produtoImagem);
            const catNome = categorias.find(c => c.id === f.categoryId)?.name || "";
            return (
              <article key={f.key} className="bg-white rounded-[2.5rem] border border-neutral-100 shadow-sm overflow-hidden">
                {/* FOTO grande (igual site antigo) */}
                <div className="w-full min-h-[320px] bg-neutral-50 flex items-center justify-center p-4">
                  {foto ? (
                    <img src={foto} alt={f.nome} loading="lazy"
                      className="max-w-full max-h-[400px] w-auto h-auto object-contain rounded-2xl"
                      onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.parentElement?.classList.add("after:content-['Foto_indisponivel']"); }} />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-16">
                      <i className="fa-solid fa-cookie-bite text-neutral-200 text-6xl"></i>
                      <span className="text-[9px] font-black text-neutral-300 uppercase tracking-widest">{f.nome}</span>
                    </div>
                  )}
                </div>

                <div className="p-6">
                  <div className="flex justify-between items-start gap-2 mb-0.5">
                    <h3 className="font-black text-xl leading-tight">{f.nome}</h3>
                    {noCarrinho > 0 && (
                      <span className="shrink-0 mt-1 bg-[#13ec5b]/20 text-[#0fb847] text-[8px] font-black uppercase px-2 py-1 rounded-full">
                        {noCarrinho} no carrinho
                      </span>
                    )}
                  </div>
                  {catNome && <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-[0.2em] mb-6">{catNome}</p>}

                  <div className="space-y-3">
                    {f.variantes.map(v => {
                      const p = prodMap[v.produtoId];
                      const q = carrinho[v.produtoId] || 0;
                      const upb = Math.max(1, Math.floor(Number((p as any)?.unidadesPorCaixa ?? 1)) || 1);
                      const isPack = upb > 1;
                      const boxes = Math.floor(q / upb);
                      return (
                        <div key={v.produtoId} className="flex items-center justify-between gap-2 p-4 bg-neutral-50 rounded-2xl border border-neutral-100">
                          <div className="flex flex-col min-w-0">
                            <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest flex items-center gap-1 flex-wrap">
                              {v.rotulo || "Unidade"}
                              {isPack && <span className="bg-[#13ec5b]/20 text-[#0fb847] text-[7px] px-1.5 py-0.5 rounded-md">Caixa {upb}un</span>}
                            </span>
                            <span className="font-black text-lg text-[#0fb847]">R$ {v.preco.toFixed(2)}</span>
                            {v.obs && (
                              <span className="mt-1 text-[10px] font-bold text-[#0fb847] bg-[#13ec5b]/10 border border-[#13ec5b]/30 rounded-xl px-2.5 py-1.5 leading-snug flex items-start gap-1.5">
                                <i className="fa-solid fa-circle-info mt-[2px] text-[9px] shrink-0"></i>
                                <span className="min-w-0">{v.obs}</span>
                              </span>
                            )}
                            {v.estoque <= 12 && <span className="text-[8px] font-bold text-neutral-400 uppercase">Só {v.estoque} em estoque</span>}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {q > 0 ? (
                              <div className="flex items-center gap-3 bg-white rounded-full p-1.5 shadow-sm border border-neutral-100">
                                <button onClick={() => subQty(p, upb)} aria-label="Diminuir"
                                  className="w-9 h-9 flex items-center justify-center text-neutral-400 hover:text-red-500 transition-colors active:scale-90">
                                  <i className="fa-solid fa-minus text-lg"></i>
                                </button>
                                <div className="flex flex-col items-center min-w-[3rem]">
                                  <span className="text-sm font-black">{isPack ? `${boxes} cx` : q}</span>
                                  {isPack && <span className="text-[8px] font-bold text-neutral-400">{q} un</span>}
                                </div>
                                <button onClick={() => addQty(p, upb)} disabled={q >= v.estoque} aria-label="Aumentar"
                                  className="w-9 h-9 bg-[#13ec5b] rounded-full flex items-center justify-center text-black active:scale-90 transition-transform disabled:bg-neutral-200 disabled:text-neutral-400">
                                  <i className="fa-solid fa-plus text-lg"></i>
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => addQty(p, upb)} disabled={v.estoque <= 0}
                                className="bg-neutral-100 px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest text-[#0fb847] active:scale-95 transition-all shadow-sm flex flex-col items-center min-w-[120px] disabled:opacity-40">
                                <span>ADICIONAR {isPack ? "CAIXA" : ""}</span>
                                {isPack && <span className="text-[7px] opacity-60 mt-0.5">({upb} UNIDADES)</span>}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* ===== CHECKOUT — recibo cupom + pagamento (igual site antigo) ===== */}
        {itensCarrinho.length > 0 && (
          <div ref={checkoutRef} className="mt-16 px-4 space-y-6 pb-10 scroll-mt-20">
            {/* RECIBO estilo cupom fiscal */}
            <div className="p-8 bg-white text-black font-mono text-[11px] rounded-3xl border-t-[12px] border-[#13ec5b] shadow-2xl">
              <h3 className="text-center font-black text-sm uppercase mb-6 tracking-tighter">DOCE MANIA - ATACADO</h3>
              <div className="space-y-1 mb-6 border-b border-dashed pb-4">
                <p>CLIENTE: <span className="font-black">{client.nomeCompleto.toUpperCase()}</span></p>
                <p>PAGAMENTO: <span className="font-black">{forma}</span></p>
              </div>
              <div className="border-b border-dashed mb-6 pb-4 space-y-2">
                {itensCarrinho.map(({ produto: p, q }) => {
                  const rot = rotuloItem(familias, p.id);
                  const upb = Math.max(1, Math.floor(Number((p as any)?.unidadesPorCaixa ?? 1)) || 1);
                  return (
                    <div key={p.id} className="flex justify-between gap-4">
                      <span className="flex-1">{rotuloQtd(q, upb)} {rot.familia.toUpperCase()}{rot.variante ? ` (${rot.variante.toUpperCase()})` : ""}</span>
                      <span className="font-black">R$ {(p.preco * q).toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between font-black text-lg pt-2 mb-4">
                <span>TOTAL</span>
                <span>R$ {totalCarrinho.toFixed(2)}</span>
              </div>
              <div className="text-center mt-6 pt-4 border-t border-dashed opacity-40">
                <p className="text-[8px] uppercase font-bold tracking-widest">Aviso: Preços especiais de atacado.</p>
                <p className="text-[8px] uppercase font-bold tracking-widest">Pedido sujeito a disponibilidade.</p>
              </div>
            </div>

            {/* FORM do checkout */}
            <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] border border-neutral-100 shadow-sm space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 ml-1">Cliente identificado</label>
                <div className="w-full bg-neutral-50 p-4 rounded-2xl border-2 border-transparent flex items-center gap-3">
                  <span className="w-9 h-9 shrink-0 rounded-full bg-[#13ec5b]/20 text-[#0fb847] flex items-center justify-center font-black text-[11px]">{primeiraSigla || "?"}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-black truncate">{client.nomeCompleto}</p>
                    <p className="text-[9px] font-bold text-neutral-400 truncate">{client.endereco}{client.bairro ? ` — ${client.bairro}` : ""}</p>
                  </div>
                </div>
                <p className="text-[9px] font-bold text-neutral-400 ml-1 italic">Seu pedido já chega identificado no sistema.</p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 ml-1">Forma de Pagamento</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["DINHEIRO", "PIX"] as const).map(m => (
                    <button key={m} onClick={() => setForma(m)}
                      className={`py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${forma === m ? "bg-black text-white" : "bg-neutral-100 opacity-60"}`}>
                      {m === "DINHEIRO" ? "Dinheiro" : "Pix"}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] font-bold text-neutral-400 ml-1">Combinamos na entrega — isso só ajuda a equipe a se preparar.</p>
              </div>

              <div className="space-y-2">
                <label htmlFor="obs-pedido" className="text-[10px] font-black uppercase tracking-widest text-neutral-400 ml-1">Alguma observação? (opcional)</label>
                <textarea id="obs-pedido" value={obs} onChange={e => setObs(e.target.value)} rows={3} maxLength={500}
                  placeholder="Ex.: entregar pela manhã, trocar X por Y..."
                  className="w-full p-4 bg-neutral-50 border border-neutral-100 rounded-2xl text-sm font-bold text-neutral-900 placeholder:text-neutral-300 outline-none focus:border-[#13ec5b] resize-none" />
              </div>

              {erroEnvio && (
                <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-black text-red-500 uppercase tracking-widest"><i className="fa-solid fa-circle-exclamation mr-1"></i>{erroEnvio}</p>
                </div>
              )}

              <div className="space-y-3">
                <button onClick={enviarPedido} disabled={enviando || !isMinOk}
                  className={`w-full py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.2em] shadow-2xl transition-all active:scale-95 ${enviando || !isMinOk ? "bg-neutral-200 text-neutral-400 cursor-not-allowed shadow-none" : "bg-[#13ec5b] text-black shadow-[#13ec5b]/40"}`}>
                  {enviando ? "PROCESSANDO..." : !isMinOk ? `FALTAM R$ ${(MIN_PEDIDO - totalCarrinho).toFixed(2)} PARA O MÍNIMO` : "ENVIAR PEDIDO DE ATACADO"}
                </button>
                <div className="text-center px-4 space-y-2">
                  {!isMinOk && (
                    <p className="text-[9px] font-black text-red-500 uppercase tracking-widest animate-pulse">
                      Atingir R$ 200,00 libera os preços de atacado
                    </p>
                  )}
                  <p className="text-[9px] font-black text-neutral-400 uppercase tracking-widest leading-relaxed">
                    * Preços especiais de revenda válidos para<br/>pedidos acima de R$ 200,00.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ===== BARRA FLUTUANTE — ir para o pedido ===== */}
      {itensCarrinho.length > 0 && !resultado && !checkoutVisivel && (
        <div className="fixed bottom-4 inset-x-0 z-40 px-4 pointer-events-none">
          <button onClick={irParaCheckout}
            className="pointer-events-auto mx-auto flex max-w-md w-full items-center justify-between gap-3 bg-neutral-900 text-white rounded-2xl px-5 py-3.5 shadow-2xl active:scale-[0.98] transition-transform">
            <span className="flex items-center gap-2.5 min-w-0">
              <span className="relative shrink-0 w-9 h-9 bg-[#13ec5b] text-black rounded-xl flex items-center justify-center">
                <i className="fa-solid fa-basket-shopping text-sm"></i>
                <span className="absolute -top-1.5 -right-1.5 bg-white text-black text-[8px] font-black w-4.5 h-4.5 min-w-[18px] min-h-[18px] rounded-full flex items-center justify-center border-2 border-neutral-900">{qtdItens}</span>
              </span>
              <span className="text-left min-w-0">
                <span className="block text-[8px] font-bold uppercase tracking-widest text-white/50">Seu pedido</span>
                <span className="block text-sm font-black leading-tight">{fmt(totalCarrinho)}</span>
              </span>
            </span>
            <span className="shrink-0 text-[10px] font-black uppercase tracking-widest bg-[#13ec5b] text-black px-4 py-2.5 rounded-xl">
              Finalizar
            </span>
          </button>
        </div>
      )}

      {/* ===== TELA DE SUCESSO ===== */}
      {resultado && (
        <div className="fixed inset-0 z-[100] bg-white/97 backdrop-blur-sm overflow-y-auto">
          <div className="min-h-full max-w-md mx-auto flex flex-col items-center justify-center px-6 py-10 text-center">
            <div className="w-16 h-16 bg-[#13ec5b] rounded-full flex items-center justify-center mb-4 shadow-xl shadow-[#13ec5b]/40">
              <i className="fa-solid fa-check text-black text-2xl"></i>
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight">Pedido enviado!</h2>
            <p className="text-xs text-neutral-500 font-semibold mt-1 mb-6 max-w-xs">
              Já está no sistema, {client.nomeCompleto.split(" ")[0]}. Nossa equipe vai separar tudo e combinar a entrega com você.
            </p>
            {/* Recibo final */}
            <div className="w-full p-8 bg-white text-black font-mono text-[11px] rounded-3xl border-t-[12px] border-[#13ec5b] shadow-2xl mb-6 text-left">
              <h3 className="text-center font-black text-sm uppercase mb-6 tracking-tighter">DOCE MANIA - ATACADO</h3>
              <div className="space-y-1 mb-6 border-b border-dashed pb-4">
                <p>CLIENTE: <span className="font-black">{client.nomeCompleto.toUpperCase()}</span></p>
                <p>PEDIDO: <span className="font-black">#{resultado.pedidoId || "OK"}</span></p>
              </div>
              <div className="flex justify-between font-black text-lg pt-2">
                <span>TOTAL</span>
                <span>R$ {resultado.total.toFixed(2)}</span>
              </div>
              <div className="text-center mt-6 pt-4 border-t border-dashed opacity-40">
                <p className="text-[8px] uppercase font-bold tracking-widest">Aviso: Preços especiais de atacado.</p>
                <p className="text-[8px] uppercase font-bold tracking-widest">Pedido sujeito a disponibilidade.</p>
              </div>
            </div>
            <button onClick={novoPedido} className="bg-[#13ec5b] text-black font-black text-[10px] uppercase tracking-widest px-8 py-4 rounded-full shadow-xl shadow-[#13ec5b]/30 active:scale-95 transition-transform">
              Fazer outro pedido
            </button>
          </div>
        </div>
      )}

      {/* ===== FOOTER SEO (igual site antigo) ===== */}
      <footer className="px-6 py-12 mt-12 bg-neutral-50 border-t border-neutral-100">
        <div className="max-w-2xl mx-auto space-y-10">
          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-[#0fb847] mb-4">
              Líder em Distribuição de Salgadinhos Atacado em Caxias do Sul
            </h2>
            <p className="text-[11px] leading-relaxed text-neutral-500 font-medium">
              A <strong>Doce Mania Atacado</strong> é a referência nº 1 e <strong>fornecedor premium de salgadinhos</strong>, doces e guloseimas em <strong>Caxias do Sul</strong>.
              Somos especialistas em <strong>Elma Chips no atacado</strong>, <strong>Toddynho</strong>, <strong>Pererekas</strong> e snacks de alta rotatividade.
              Se você busca <strong>comprar barato</strong> direto da distribuidora para seu mercado ou revenda, garantimos o melhor <strong>preço baixo</strong> e <strong>promoção</strong> constante.
            </p>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest">Atendimento e Contato</h3>
              <p className="text-[10px] text-neutral-500 font-medium leading-relaxed">
                <strong>Telefone/WhatsApp:</strong> <a href="tel:+5554991107242" className="text-[#0fb847] hover:underline">(54) 99110-7242</a><br/>
                <strong>Localização:</strong> Caxias do Sul - RS<br/>
                <strong>Especialidade:</strong> Distribuição de Elma Chips e Salgadinhos no Atacado.
              </p>
              <div className="flex gap-4">
                <a href="https://wa.me/5554991107242" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest bg-emerald-500 text-white px-3 py-1 rounded-full">
                  <i className="fa-solid fa-comment text-[12px]"></i> WhatsApp
                </a>
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest">Dúvidas Frequentes (FAQ)</h3>
              <div className="space-y-3">
                <div>
                  <h4 className="text-[9px] font-black text-neutral-400 uppercase">Quais marcas vocês trabalham no atacado?</h4>
                  <p className="text-[10px] text-neutral-500 font-medium">Somos o principal fornecedor de Elma Chips, Pererekas, Toddynho e guloseimas em Caxias do Sul.</p>
                </div>
                <div>
                  <h4 className="text-[9px] font-black text-neutral-400 uppercase">Qual o benefício de comprar na Doce Mania?</h4>
                  <p className="text-[10px] text-neutral-500 font-medium">Garantimos o menor preço de revenda e promoções exclusivas para parceiros de longo prazo.</p>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white/50 p-4 rounded-xl border border-neutral-100">
            <h3 className="text-[9px] font-black uppercase tracking-widest text-neutral-400 mb-2">Termos Mais Pesquisados - Atacado Premium</h3>
            <p className="text-[8px] text-neutral-400 leading-relaxed font-bold uppercase tracking-wider">
              Salgadinho em Caxias do Sul • Elma Chips no Atacado • Fornecedor de Salgadinhos • Comprar Elma Chips Barato • Toddynho em Atacado • Pererekas Salgadinhos • Fornecedor de Snacks • Distribuidora Líder Serra Gaúcha • Preço de Fábrica Salgadinhos • Promoção Elma Chips Caxias
            </p>
          </section>

          <div className="pt-8 border-t border-dashed border-neutral-200 text-center space-y-2">
            <p className="text-[9px] font-black text-[#0fb847] uppercase tracking-widest">
              DOCE MANIA - LÍDER EM ATACADO DE SNACKS
            </p>
            <p className="text-[7px] font-bold text-neutral-400 uppercase tracking-[0.3em]">
              CNPJ: 63.730.443/0001-77 • Caxias do Sul - RS • © 2026
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
