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
 * Catalogo AGRUPADO por familia, igual ao catalogo antigo que o cliente
 * ja conhecia: um card por produto ("Kero Coco") com as variantes dentro
 * (200 ml, 330 ml, 1 Litro) — montado na hora pelo nome do estoque
 * (src/lib/pedidoGrupos.ts). Visual limpo e direto: texto e valores,
 * sem fotos e sem coloracao por categoria.
 *
 * O codigo na URL e o portal_code aleatorio do cliente (mesmo link do
 * portal do cliente) — nada de senha, identificado pelo link.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  agruparCatalogo,
  rotuloItem,
  type FamiliaCatalogo,
  type ProdutoCatalogo,
} from "@/lib/pedidoGrupos";

interface Categoria { id: string; name: string; }
interface ClienteInfo { nomeCompleto: string; bairro: string; endereco: string; }

type Etapa = "LOJA" | "CART" | "CONFIRM" | "OK";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

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

  const familias = useMemo(() => agruparCatalogo(produtos), [produtos]);

  const prodMap = useMemo(() => Object.fromEntries(produtos.map(p => [p.id, p])), [produtos]);
  const itensCarrinho = useMemo(
    () => Object.entries(carrinho)
      .map(([id, q]) => ({ produto: prodMap[id], q }))
      .filter((x): x is { produto: ProdutoCatalogo; q: number } => !!x.produto && x.q > 0),
    [carrinho, prodMap]
  );
  const totalCarrinho = itensCarrinho.reduce((a, i) => a + i.produto.preco * i.q, 0);
  const qtdItens = itensCarrinho.reduce((a, i) => a + i.q, 0);

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

  const qtdFamilia = useCallback((f: FamiliaCatalogo) =>
    f.variantes.reduce((a, v) => a + (carrinho[v.produtoId] || 0), 0), [carrinho]);

  const setQty = (p: ProdutoCatalogo, q: number) => {
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
      <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 rounded-full border-[3px] border-gray-200 border-t-gray-800 animate-spin"></div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Abrindo catalogo...</p>
      </div>
    );
  }

  if (erro || !client) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center px-6 text-center">
        <h1 className="font-bold text-gray-800 text-lg mb-1">Ops!</h1>
        <p className="text-xs text-gray-500 font-semibold mb-6">{erro || "Link invalido."}</p>
        <button onClick={carregar} className="bg-gray-900 text-white font-bold text-xs px-6 py-3.5 rounded-xl active:scale-95 transition-transform">
          Tentar de novo
        </button>
      </div>
    );
  }

  if (bloqueado) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center px-6 text-center">
        <h1 className="font-bold text-gray-800 text-lg mb-1">Pedido online bloqueado</h1>
        <p className="text-xs text-gray-500 font-semibold mb-2">
          Ola, {client.nomeCompleto}! Existe um saldo de <b className="text-gray-900">{fmt(saldoDevedor)}</b> em aberto.
        </p>
        <p className="text-[11px] text-gray-400 font-semibold mb-6 max-w-xs">Quite pelo portal do cliente ou fale com o nosso vendedor para liberar seu pedido online.</p>
        <a href={`/cliente/${encodeURIComponent(codigo)}`} className="bg-gray-900 text-white font-bold text-xs px-6 py-3.5 rounded-xl active:scale-95 transition-transform">
          Ir para o portal
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
    <div className="min-h-screen bg-[#fafafa] flex flex-col">
      {/* HEADER */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="max-w-md mx-auto px-4 pt-3 pb-2.5">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-gray-400">Doce Mania · Pedido online</p>
              <h1 className="font-bold text-[15px] leading-tight text-gray-900 truncate">{client.nomeCompleto}</h1>
            </div>
            {etapa === "LOJA" && qtdItens > 0 && (
              <button onClick={() => setEtapa("CART")} aria-label="Abrir carrinho"
                className="relative shrink-0 bg-gray-900 text-white font-bold text-[10px] uppercase px-3.5 py-2.5 rounded-xl active:scale-95 transition-transform">
                <i className="fa-solid fa-basket-shopping"></i>
                <span className="absolute -top-1.5 -right-1.5 bg-orange-500 text-white text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">{qtdItens}</span>
              </button>
            )}
          </div>
          {passoAtual > 0 && (
            <div className="flex items-center gap-1.5 mt-3">
              {passos.map(p => (
                <div key={p.n} className="flex-1 flex items-center gap-1.5">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${passoAtual >= p.n ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-400"}`}>{p.n}</div>
                  <span className={`text-[8px] font-bold uppercase tracking-wider ${passoAtual >= p.n ? "text-gray-900" : "text-gray-300"}`}>{p.label}</span>
                  {p.n < 3 && <div className={`flex-1 h-px ${passoAtual > p.n ? "bg-gray-900" : "bg-gray-200"}`}></div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-md mx-auto px-4 py-4 pb-32">
        {/* ---------- PASSO 1: CATALOGO ---------- */}
        {etapa === "LOJA" && (
          <div className="space-y-3">
            <div className="relative">
              <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 text-sm"></i>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto..." aria-label="Buscar produto"
                className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 placeholder:text-gray-300 outline-none focus:border-gray-400 transition-colors" />
            </div>

            {categorias.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
                {[{ id: "TODAS", name: "Todos" }, ...categorias].map(c => (
                  <button key={c.id} onClick={() => setCatSel(c.id)}
                    className={`px-3.5 py-2 rounded-full text-[10px] font-bold whitespace-nowrap transition-colors ${catSel === c.id ? "bg-gray-900 text-white" : "bg-white text-gray-500 border border-gray-200"}`}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {familiasFiltradas.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
                <p className="text-[11px] font-bold text-gray-400">Nada encontrado{busca ? ` para "${busca}"` : ""}</p>
              </div>
            )}

            {/* FAMILIAS — um card por produto, variantes dentro */}
            <div className="space-y-2">
              {familiasFiltradas.map(f => {
                const noCarrinho = qtdFamilia(f);
                return (
                  <div key={f.key} className="bg-white border border-gray-200 rounded-2xl px-4 pb-1">
                    <div className="flex items-center justify-between gap-2 pt-3.5 pb-1">
                      <h3 className="text-[13px] font-bold text-gray-900 leading-tight">{f.nome}</h3>
                      {noCarrinho > 0 && (
                        <span className="shrink-0 text-[9px] font-bold uppercase text-white bg-gray-900 rounded-full px-2 py-0.5">
                          {noCarrinho} no carrinho
                        </span>
                      )}
                    </div>
                    <div className="divide-y divide-gray-100">
                      {f.variantes.map(v => {
                        const q = carrinho[v.produtoId] || 0;
                        return (
                          <div key={v.produtoId} className="flex items-center gap-2.5 py-2.5">
                            {v.rotulo && (
                              <span className="shrink-0 min-w-[62px] text-center text-[10px] font-bold uppercase text-gray-500 bg-gray-100 rounded-lg px-2 py-1.5">
                                {v.rotulo}
                              </span>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-bold text-gray-900 leading-none">{fmt(v.preco)}</p>
                              {v.estoque <= 12 && (
                                <p className="text-[9px] font-semibold text-gray-400 mt-1">Só {v.estoque} em estoque</p>
                              )}
                            </div>
                            {q === 0 ? (
                              <button onClick={() => setQty(prodMap[v.produtoId], 1)} disabled={v.estoque <= 0}
                                aria-label={`Adicionar ${f.nome}${v.rotulo ? ` ${v.rotulo}` : ""}`}
                                className="shrink-0 w-10 h-10 bg-gray-900 text-white rounded-xl active:scale-90 transition-transform disabled:bg-gray-100 disabled:text-gray-300">
                                <i className="fa-solid fa-plus text-[11px]"></i>
                              </button>
                            ) : (
                              <div className="shrink-0 flex items-center bg-gray-100 rounded-xl p-1">
                                <button onClick={() => setQty(prodMap[v.produtoId], q - 1)} aria-label="Diminuir"
                                  className="w-8 h-8 bg-white rounded-lg shadow-sm text-gray-600 active:scale-90 transition-transform">
                                  <i className="fa-solid fa-minus text-[10px]"></i>
                                </button>
                                <span className="w-8 text-center text-[13px] font-bold text-gray-900">{q}</span>
                                <button onClick={() => setQty(prodMap[v.produtoId], q + 1)} disabled={q >= v.estoque} aria-label="Aumentar"
                                  className="w-8 h-8 bg-gray-900 rounded-lg text-white active:scale-90 transition-transform disabled:bg-gray-200 disabled:text-gray-400">
                                  <i className="fa-solid fa-plus text-[10px]"></i>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
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
              <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
                <p className="text-[11px] font-bold text-gray-400 mb-4">Seu carrinho esta vazio</p>
                <button onClick={() => setEtapa("LOJA")} className="bg-gray-900 text-white font-bold text-xs px-6 py-3 rounded-xl active:scale-95 transition-transform">Ver catalogo</button>
              </div>
            ) : (
              <>
                <div className="bg-white border border-gray-200 rounded-2xl px-4 divide-y divide-gray-100">
                  {itensCarrinho.map(({ produto: p, q }) => {
                    const rot = rotuloItem(familias, p.id);
                    return (
                      <div key={p.id} className="py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-[12px] font-bold text-gray-900 leading-tight">{rot.familia}</h3>
                          <p className="text-[10px] font-semibold text-gray-400">{rot.variante ? `${rot.variante} · ` : ""}{fmt(p.preco)} cada</p>
                        </div>
                        <div className="shrink-0 flex items-center bg-gray-100 rounded-xl p-1">
                          <button onClick={() => setQty(p, q - 1)} aria-label="Diminuir"
                            className="w-8 h-8 bg-white rounded-lg shadow-sm text-gray-600 active:scale-90 transition-transform">
                            <i className="fa-solid fa-minus text-[10px]"></i>
                          </button>
                          <span className="w-8 text-center text-[13px] font-bold text-gray-900">{q}</span>
                          <button onClick={() => setQty(p, q + 1)} disabled={q >= p.estoque} aria-label="Aumentar"
                            className="w-8 h-8 bg-gray-900 rounded-lg text-white active:scale-90 transition-transform disabled:bg-gray-200 disabled:text-gray-400">
                            <i className="fa-solid fa-plus text-[10px]"></i>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setEtapa("LOJA")} className="w-full py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  Continuar comprando
                </button>
              </>
            )}
          </div>
        )}

        {/* ---------- PASSO 3: CONFIRMAR ---------- */}
        {etapa === "CONFIRM" && (
          <div className="space-y-3">
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Pedido de</p>
              <p className="text-sm font-bold text-gray-900">{client.nomeCompleto}</p>
              <p className="text-[10px] text-gray-400 font-semibold mt-0.5">{client.endereco}{client.bairro ? ` — ${client.bairro}` : ""}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2.5">Itens ({qtdItens})</p>
              <div className="space-y-2">
                {itensCarrinho.map(({ produto: p, q }) => {
                  const rot = rotuloItem(familias, p.id);
                  return (
                    <div key={p.id} className="flex justify-between items-baseline text-[12px]">
                      <span className="text-gray-600 font-semibold">{q}x {rot.familia}{rot.variante ? ` · ${rot.variante}` : ""}</span>
                      <span className="text-gray-900 font-bold">{fmt(p.preco * q)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-dashed border-gray-200 mt-3 pt-3 flex justify-between items-center">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Total</span>
                <span className="text-lg font-bold text-gray-900">{fmt(totalCarrinho)}</span>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <label htmlFor="obs-pedido" className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Alguma observacao? (opcional)</label>
              <textarea id="obs-pedido" value={obs} onChange={e => setObs(e.target.value)} rows={3} maxLength={500}
                placeholder="Ex.: entregar pela manha, trocar X por Y..."
                className="w-full mt-2 p-3 bg-gray-50 border border-gray-200 rounded-xl text-[12px] font-semibold text-gray-900 placeholder:text-gray-300 outline-none focus:border-gray-400 resize-none" />
            </div>
            {erroEnvio && (
              <div className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">
                <p className="text-[10px] font-bold text-rose-600 uppercase"><i className="fa-solid fa-circle-exclamation mr-1"></i>{erroEnvio}</p>
              </div>
            )}
            <button onClick={() => setEtapa("CART")} className="w-full py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              Voltar ao carrinho
            </button>
          </div>
        )}

        {/* ---------- PASSO 4: SUCESSO ---------- */}
        {etapa === "OK" && resultado && (
          <div className="flex flex-col items-center text-center py-10">
            <div className="w-16 h-16 bg-orange-500 rounded-full flex items-center justify-center mb-4">
              <i className="fa-solid fa-check text-white text-2xl"></i>
            </div>
            <h2 className="text-lg font-bold text-gray-900">Pedido enviado!</h2>
            <p className="text-xs text-gray-500 font-semibold mt-1 mb-5 max-w-xs">
              Ja esta no nosso sistema, {client.nomeCompleto.split(" ")[0]}. Nossa equipe vai separar tudo e combinar a entrega com voce.
            </p>
            <div className="bg-white border border-gray-200 rounded-2xl p-5 w-full mb-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Numero do pedido</p>
              <p className="text-sm font-bold text-gray-900 tracking-widest mt-0.5">#{resultado.pedidoId || "OK"}</p>
              <div className="border-t border-dashed border-gray-200 my-3"></div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Total</span>
                <span className="text-lg font-bold text-gray-900">{fmt(resultado.total)}</span>
              </div>
            </div>
            <button onClick={novoPedido} className="bg-gray-900 text-white font-bold text-xs px-6 py-3.5 rounded-xl active:scale-95 transition-transform">
              Fazer outro pedido
            </button>
          </div>
        )}
      </main>

      {/* BARRA FIXA — total + avancar (loja/carrinho/confirmar) */}
      {etapa !== "OK" && itensCarrinho.length > 0 && (
        <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur border-t border-gray-200 px-4 py-3">
          <div className="max-w-md mx-auto flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[8px] font-bold uppercase tracking-widest text-gray-400">{qtdItens} item(s)</p>
              <p className="text-lg font-bold text-gray-900 leading-none mt-0.5">{fmt(totalCarrinho)}</p>
            </div>
            {etapa === "LOJA" && (
              <button onClick={() => setEtapa("CART")} className="bg-orange-500 text-white font-bold text-[11px] uppercase px-6 py-3.5 rounded-xl active:scale-95 transition-transform">
                Ver carrinho<i className="fa-solid fa-arrow-right ml-1.5"></i>
              </button>
            )}
            {etapa === "CART" && (
              <button onClick={() => setEtapa("CONFIRM")} className="bg-orange-500 text-white font-bold text-[11px] uppercase px-6 py-3.5 rounded-xl active:scale-95 transition-transform">
                Continuar<i className="fa-solid fa-arrow-right ml-1.5"></i>
              </button>
            )}
            {etapa === "CONFIRM" && (
              <button onClick={enviarPedido} disabled={enviando} className="bg-orange-500 text-white font-bold text-[11px] uppercase px-6 py-3.5 rounded-xl active:scale-95 transition-transform disabled:bg-gray-300">
                {enviando ? <><i className="fa-solid fa-spinner fa-spin mr-1.5"></i>Enviando...</> : <><i className="fa-solid fa-paper-plane mr-1.5"></i>Enviar pedido</>}
              </button>
            )}
          </div>
        </div>
      )}

      {etapa !== "OK" && (
        <footer className="mt-auto bg-gray-900 text-center py-3">
          <p className="text-[8px] font-bold uppercase text-white/30 tracking-[0.2em]">Doce Mania — pedido direto pelo sistema</p>
        </footer>
      )}
    </div>
  );
}
