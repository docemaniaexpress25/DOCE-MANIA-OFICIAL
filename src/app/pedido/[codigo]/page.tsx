"use client";

/**
 * PEDIDO ONLINE DOCE MANIA — /pedido/[codigo]
 * O cliente mesmo monta o pedido direto do ESTOQUE CENTRAL, com fluxo
 * de passo a passo:
 *   1. Catalogo (busca + categorias + quantidade)
 *   2. Carrinho (revisar e ajustar)
 *   3. Confirmar (resumo + observacoes) -> cai NA FILA do sistema
 *   4. Pronto (pedido gravado como pre-venda)
 *
 * O codigo na URL e o portal_code aleatorio do cliente (mesmo link do
 * portal do cliente) — nada de senha, identificado pelo link.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

interface Produto { id: string; nome: string; preco: number; estoque: number; categoryId: string | null; }
interface Categoria { id: string; name: string; }
interface ClienteInfo { nomeCompleto: string; bairro: string; endereco: string; }

type Etapa = "LOJA" | "CART" | "CONFIRM" | "OK";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Paleta por categoria (visual top sem depender de fotos no estoque)
const CORES = [
  "from-amber-400 to-orange-400",
  "from-emerald-400 to-teal-400",
  "from-rose-400 to-pink-400",
  "from-violet-400 to-purple-400",
  "from-cyan-400 to-sky-400",
  "from-lime-400 to-green-400",
];
const corDe = (id: string | null, idx: number) => CORES[(id ? idx : idx) % CORES.length];

export default function PedidoOnlinePage() {
  const params = useParams<{ codigo: string }>();
  const codigo = String(params?.codigo || "");

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [client, setClient] = useState<ClienteInfo | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [bloqueado, setBloqueado] = useState(false);
  const [saldoDevedor, setSaldoDevedor] = useState(0);

  const [etapa, setEtapa] = useState<Etapa>("LOJA");
  const [carrinho, setCarrinho] = useState<Record<string, number>>({});
  const [busca, setBusca] = useState("");
  const [catSel, setCatSel] = useState<string>("TODAS");
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState("");
  const [resultado, setResultado] = useState<{ pedidoId: string; total: number } | null>(null);

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

  const prodMap = useMemo(() => Object.fromEntries(produtos.map(p => [p.id, p])), [produtos]);
  const itensCarrinho = useMemo(
    () => Object.entries(carrinho)
      .map(([id, q]) => ({ produto: prodMap[id], q }))
      .filter((x): x is { produto: Produto; q: number } => !!x.produto && x.q > 0),
    [carrinho, prodMap]
  );
  const totalCarrinho = itensCarrinho.reduce((a, i) => a + i.produto.preco * i.q, 0);
  const qtdItens = itensCarrinho.reduce((a, i) => a + i.q, 0);

  const listaFiltrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter(p =>
      (catSel === "TODAS" || p.categoryId === catSel) &&
      (!q || p.nome.toLowerCase().includes(q))
    );
  }, [produtos, busca, catSel]);

  const setQty = (p: Produto, q: number) => {
    const nova = Math.max(0, Math.min(p.estoque, Math.floor(q)));
    setCarrinho(prev => {
      const copy = { ...prev };
      if (nova <= 0) delete copy[p.id]; else copy[p.id] = nova;
      return copy;
    });
  };

  const enviarPedido = async () => {
    if (enviando || itensCarrinho.length === 0) return;
    setEnviando(true);
    setErroEnvio("");
    try {
      const res = await fetch(`/api/cliente/${encodeURIComponent(codigo)}/pedido`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: itensCarrinho.map(i => ({ produtoId: i.produto.id, quantidade: i.q })),
          observacoes: obs,
        }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setResultado({ pedidoId: String(d.pedidoId || "").slice(0, 8).toUpperCase(), total: Number(d.total || totalCarrinho) });
        setEtapa("OK");
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
    setCarrinho({});
    setObs("");
    setResultado(null);
    setEtapa("LOJA");
  };

  // ---------- Estados de tela ----------
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center gap-4">
        <div className="w-14 h-14 rounded-full border-4 border-amber-200 border-t-amber-500 animate-spin"></div>
        <p className="text-[10px] font-black uppercase text-gray-400">Abrindo catalogo...</p>
      </div>
    );
  }

  if (erro || !client) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 bg-rose-50 rounded-3xl flex items-center justify-center mb-4">
          <i className="fa-solid fa-triangle-exclamation text-rose-400 text-2xl"></i>
        </div>
        <h1 className="font-black text-gray-800 uppercase mb-1">Ops!</h1>
        <p className="text-xs text-gray-500 font-semibold mb-6">{erro || "Link invalido."}</p>
        <button onClick={carregar} className="bg-gray-800 text-white font-black uppercase text-[10px] px-6 py-3.5 rounded-2xl active:scale-95 transition-transform">
          <i className="fa-solid fa-rotate-right mr-1.5"></i>Tentar de novo
        </button>
      </div>
    );
  }

  if (bloqueado) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 bg-amber-50 rounded-3xl flex items-center justify-center mb-4">
          <i className="fa-solid fa-lock text-amber-400 text-2xl"></i>
        </div>
        <h1 className="font-black text-gray-800 uppercase mb-1">Pedido online bloqueado</h1>
        <p className="text-xs text-gray-500 font-semibold mb-2">
          Olá, {client.nomeCompleto}! Existe um saldo de <b className="text-rose-500">{fmt(saldoDevedor)}</b> em aberto.
        </p>
        <p className="text-[11px] text-gray-400 font-semibold mb-6 max-w-xs">Quite pelo portal do cliente ou fale com o nosso vendedor para liberar seu pedido online.</p>
        <a href={`/cliente/${encodeURIComponent(codigo)}`} className="bg-gray-800 text-white font-black uppercase text-[10px] px-6 py-3.5 rounded-2xl active:scale-95 transition-transform">
          <i className="fa-solid fa-arrow-left mr-1.5"></i>Ir para o portal
        </a>
      </div>
    );
  }

  const passos = [
    { n: 1, label: "Catalogo" },
    { n: 2, label: "Carrinho" },
    { n: 3, label: "Enviar" },
  ];
  const passoAtual = etapa === "LOJA" ? 1 : etapa === "CART" ? 2 : etapa === "CONFIRM" ? 3 : 0;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* HEADER */}
      <header className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 pt-5 pb-4 rounded-b-[2rem] shadow-lg">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
              <i className="fa-solid fa-cart-shopping text-lg"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-black uppercase opacity-80 tracking-widest">Pedido online — Doce Mania</p>
              <h1 className="font-black text-[15px] leading-tight truncate">{client.nomeCompleto}</h1>
              {client.bairro && <p className="text-[9px] font-bold opacity-80">{client.bairro}</p>}
            </div>
            {qtdItens > 0 && etapa === "LOJA" && (
              <button onClick={() => setEtapa("CART")} className="relative bg-white text-amber-600 font-black text-[10px] uppercase px-4 py-2.5 rounded-2xl shadow active:scale-95 transition-transform whitespace-nowrap">
                <i className="fa-solid fa-basket-shopping mr-1"></i>Ver carrinho
                <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[9px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">{qtdItens}</span>
              </button>
            )}
          </div>
          {passoAtual > 0 && (
            <div className="flex items-center gap-1.5 mt-4">
              {passos.map(p => (
                <div key={p.n} className="flex-1 flex items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${passoAtual >= p.n ? "bg-white text-amber-600" : "bg-white/25 text-white/70"}`}>{p.n}</div>
                  <span className={`text-[8px] font-black uppercase tracking-wider ${passoAtual >= p.n ? "text-white" : "text-white/50"}`}>{p.label}</span>
                  {p.n < 3 && <div className={`flex-1 h-0.5 rounded ${passoAtual > p.n ? "bg-white" : "bg-white/25"}`}></div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-md w-full mx-auto px-4 py-4">
        {/* ---------- PASSO 1: CATALOGO ---------- */}
        {etapa === "LOJA" && (
          <div className="space-y-3">
            <div className="relative">
              <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 text-sm"></i>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto..."
                className="w-full pl-11 pr-4 py-3.5 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm font-bold outline-none focus:ring-2 focus:ring-amber-100" />
            </div>

            {categorias.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
                {[{ id: "TODAS", name: "Todos" }, ...categorias].map(c => (
                  <button key={c.id} onClick={() => setCatSel(c.id)}
                    className={`px-4 py-2 rounded-full text-[9px] font-black uppercase whitespace-nowrap transition-all ${catSel === c.id ? "bg-gray-800 text-white shadow-md" : "bg-white text-gray-400 border border-gray-100"}`}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {listaFiltrada.length === 0 && (
              <div className="bg-white rounded-3xl p-8 text-center border border-gray-100">
                <i className="fa-solid fa-box-open text-gray-200 text-3xl mb-2 block"></i>
                <p className="text-[10px] font-black uppercase text-gray-400">Nada encontrado{busca ? ` para "${busca}"` : ""}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {listaFiltrada.map((p, idx) => {
                const q = carrinho[p.id] || 0;
                return (
                  <div key={p.id} className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
                    <div className={`h-20 bg-gradient-to-br ${corDe(p.categoryId, idx)} relative flex items-center justify-center`}>
                      <i className="fa-solid fa-candy-cane text-white/60 text-2xl"></i>
                      {q > 0 && (
                        <span className="absolute top-2 right-2 bg-white text-gray-800 text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center shadow">{q}</span>
                      )}
                    </div>
                    <div className="p-3 flex flex-col flex-1">
                      <h3 className="text-[11px] font-black text-gray-800 leading-tight uppercase min-h-[28px]">{p.nome}</h3>
                      <p className="text-[13px] font-black text-emerald-600 mt-0.5">{fmt(p.preco)}</p>
                      <p className="text-[8px] font-bold text-gray-300 uppercase">Estoque: {p.estoque}</p>
                      <div className="mt-2">
                        {q === 0 ? (
                          <button onClick={() => setQty(p, 1)} disabled={p.estoque <= 0}
                            className="w-full py-2.5 bg-emerald-600 text-white rounded-xl text-[9px] font-black uppercase active:scale-95 transition-transform disabled:bg-gray-100 disabled:text-gray-300">
                            <i className="fa-solid fa-plus mr-1"></i>Adicionar
                          </button>
                        ) : (
                          <div className="flex items-center justify-between bg-gray-50 rounded-xl p-1">
                            <button onClick={() => setQty(p, q - 1)} className="w-8 h-8 bg-white rounded-lg shadow-sm text-gray-500 font-black active:scale-90 transition-transform"><i className="fa-solid fa-minus text-[10px]"></i></button>
                            <span className="text-[13px] font-black text-gray-800">{q}</span>
                            <button onClick={() => setQty(p, q + 1)} disabled={q >= p.estoque} className="w-8 h-8 bg-emerald-600 rounded-lg shadow-sm text-white font-black active:scale-90 transition-transform disabled:bg-gray-200"><i className="fa-solid fa-plus text-[10px]"></i></button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---------- PASSO 2: CARRINHO ---------- */}
        {etapa === "CART" && (
          <div className="space-y-3">
            {itensCarrinho.length === 0 ? (
              <div className="bg-white rounded-3xl p-8 text-center border border-gray-100">
                <i className="fa-solid fa-basket-shopping text-gray-200 text-3xl mb-2 block"></i>
                <p className="text-[10px] font-black uppercase text-gray-400 mb-4">Seu carrinho esta vazio</p>
                <button onClick={() => setEtapa("LOJA")} className="bg-gray-800 text-white font-black uppercase text-[10px] px-6 py-3 rounded-2xl active:scale-95 transition-transform">Ver catalogo</button>
              </div>
            ) : (
              <>
                {itensCarrinho.map(({ produto: p, q }) => (
                  <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[11px] font-black text-gray-800 uppercase leading-tight">{p.nome}</h3>
                      <p className="text-[9px] font-bold text-gray-400">{fmt(p.preco)} cada</p>
                      <p className="text-[11px] font-black text-gray-800 mt-0.5">{fmt(p.preco * q)}</p>
                    </div>
                    <div className="flex items-center justify-between bg-gray-50 rounded-xl p-1">
                      <button onClick={() => setQty(p, q - 1)} className="w-8 h-8 bg-white rounded-lg shadow-sm text-gray-500 font-black active:scale-90 transition-transform"><i className="fa-solid fa-minus text-[10px]"></i></button>
                      <span className="w-8 text-center text-[13px] font-black text-gray-800">{q}</span>
                      <button onClick={() => setQty(p, q + 1)} disabled={q >= p.estoque} className="w-8 h-8 bg-emerald-600 rounded-lg shadow-sm text-white font-black active:scale-90 transition-transform disabled:bg-gray-200"><i className="fa-solid fa-plus text-[10px]"></i></button>
                    </div>
                  </div>
                ))}
                <button onClick={() => setEtapa("LOJA")} className="w-full py-3 text-[10px] font-black text-gray-400 uppercase">
                  <i className="fa-solid fa-arrow-left mr-1"></i>Continuar comprando
                </button>
              </>
            )}
          </div>
        )}

        {/* ---------- PASSO 3: CONFIRMAR ---------- */}
        {etapa === "CONFIRM" && (
          <div className="space-y-3">
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
              <p className="text-[9px] font-black uppercase text-gray-400 mb-2">Pedido de</p>
              <p className="text-sm font-black text-gray-800">{client.nomeCompleto}</p>
              <p className="text-[10px] text-gray-400 font-bold">{client.endereco}{client.bairro ? ` — ${client.bairro}` : ""}</p>
            </div>
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
              <p className="text-[9px] font-black uppercase text-gray-400 mb-2">Itens ({qtdItens})</p>
              <div className="space-y-1.5">
                {itensCarrinho.map(({ produto: p, q }) => (
                  <div key={p.id} className="flex justify-between text-[11px] font-bold">
                    <span className="text-gray-600">{q}x {p.nome}</span>
                    <span className="text-gray-800">{fmt(p.preco * q)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-gray-100 mt-3 pt-3 flex justify-between items-center">
                <span className="text-[10px] font-black uppercase text-gray-400">Total</span>
                <span className="text-lg font-black text-emerald-600">{fmt(totalCarrinho)}</span>
              </div>
            </div>
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
              <label className="text-[9px] font-black uppercase text-gray-400">Alguma observacao? (opcional)</label>
              <textarea value={obs} onChange={e => setObs(e.target.value)} rows={3} maxLength={500}
                placeholder="Ex.: entregar pela manha, trocar X por Y..."
                className="w-full mt-1.5 p-3 bg-gray-50 border border-gray-100 rounded-2xl text-[12px] font-semibold outline-none focus:ring-2 focus:ring-amber-100 resize-none" />
            </div>
            {erroEnvio && (
              <div className="bg-rose-50 border border-rose-100 rounded-2xl px-4 py-3">
                <p className="text-[10px] font-black text-rose-600 uppercase"><i className="fa-solid fa-circle-exclamation mr-1"></i>{erroEnvio}</p>
              </div>
            )}
            <button onClick={() => setEtapa("CART")} className="w-full py-3 text-[10px] font-black text-gray-400 uppercase">
              <i className="fa-solid fa-arrow-left mr-1"></i>Voltar ao carrinho
            </button>
          </div>
        )}

        {/* ---------- PASSO 4: SUCESSO ---------- */}
        {etapa === "OK" && resultado && (
          <div className="flex flex-col items-center text-center py-8">
            <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-200 mb-4">
              <i className="fa-solid fa-check text-white text-3xl"></i>
            </div>
            <h2 className="text-xl font-black text-gray-800 uppercase">Pedido enviado!</h2>
            <p className="text-xs text-gray-500 font-semibold mt-1 mb-4 max-w-xs">
              Ja esta no nosso sistema, {client.nomeCompleto.split(" ")[0]}. Nossa equipe vai separar tudo e combinar a entrega com voce.
            </p>
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 w-full mb-5">
              <p className="text-[9px] font-black uppercase text-gray-400">Numero do pedido</p>
              <p className="text-sm font-black text-gray-800 tracking-widest">#{resultado.pedidoId || "OK"}</p>
              <div className="border-t border-dashed border-gray-100 my-3"></div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase text-gray-400">Total</span>
                <span className="text-xl font-black text-emerald-600">{fmt(resultado.total)}</span>
              </div>
            </div>
            <button onClick={novoPedido} className="bg-gray-800 text-white font-black uppercase text-[10px] px-6 py-3.5 rounded-2xl active:scale-95 transition-transform">
              <i className="fa-solid fa-plus mr-1.5"></i>Fazer outro pedido
            </button>
          </div>
        )}
      </main>

      {/* RODAPE FIXO — total + avancar (loja/carrinho/confirmar) */}
      {etapa !== "OK" && itensCarrinho.length > 0 && (
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
          <div className="max-w-md mx-auto flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[8px] font-black uppercase text-gray-400">{qtdItens} item(s)</p>
              <p className="text-lg font-black text-gray-800 leading-none">{fmt(totalCarrinho)}</p>
            </div>
            {etapa === "LOJA" && (
              <button onClick={() => setEtapa("CART")} className="bg-emerald-600 text-white font-black text-[10px] uppercase px-6 py-3.5 rounded-2xl shadow-lg active:scale-95 transition-transform">
                Ver carrinho<i className="fa-solid fa-arrow-right ml-1.5"></i>
              </button>
            )}
            {etapa === "CART" && (
              <button onClick={() => setEtapa("CONFIRM")} className="bg-emerald-600 text-white font-black text-[10px] uppercase px-6 py-3.5 rounded-2xl shadow-lg active:scale-95 transition-transform">
                Continuar<i className="fa-solid fa-arrow-right ml-1.5"></i>
              </button>
            )}
            {etapa === "CONFIRM" && (
              <button onClick={enviarPedido} disabled={enviando} className="bg-emerald-600 text-white font-black text-[10px] uppercase px-6 py-3.5 rounded-2xl shadow-lg active:scale-95 transition-transform disabled:bg-gray-300">
                {enviando ? <><i className="fa-solid fa-spinner fa-spin mr-1.5"></i>Enviando...</> : <><i className="fa-solid fa-paper-plane mr-1.5"></i>Enviar pedido</>}
              </button>
            )}
          </div>
        </div>
      )}

      {etapa !== "OK" && (
        <footer className="mt-auto bg-gray-800 text-center py-3">
          <p className="text-[8px] font-black uppercase text-white/40 tracking-widest">Doce Mania — pedido direto pelo sistema</p>
        </footer>
      )}
    </div>
  );
}
