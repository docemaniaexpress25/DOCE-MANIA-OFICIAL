'use client';

/**
 * GESTAO DO CATALOGO DO PORTAL (Bloco 17)
 *
 * Aba do admin onde o dono gerencia EXATAMENTE o que o cliente ve no
 * portal (/pedido/[codigo]) — tudo LINKADO ao estoque central (uma
 * unica fonte de verdade: a tabela products):
 *
 *   - ORDEM: a lista segue a MESMA ORDEM DO PDV (app_settings.product_order).
 *     Mover uma familia aqui reordena PDV e portal juntos.
 *   - RENOMEAR: edita products.nome — muda no estoque, no PDV e no portal.
 *   - FOTO: envia do aparelho (comprime e sobe pro Storage) ou cola URL —
 *     grava em products.imagem (Bloco 15) e vale pro portal na hora.
 *   - CAIXA: unidades por caixa (atacado) — products.unidades_por_caixa.
 *   - OBS (Bloco 18): observacao escrita pelo dono que SO o cliente ve no
 *     portal — products.obs (nao aparece no PDV nem em mais nada).
 *
 * Familias = mesmo agrupamento do portal (pedidoGrupos.agruparCatalogo),
 * foto de familia = products.imagem da 1a variante que tiver > foto do
 * catalogo antigo (pedidoFotos) > placeholder.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Product } from '@/lib/types';
import { agruparCatalogo } from '@/lib/pedidoGrupos';
import { fotoFamilia } from '@/lib/pedidoFotos';
import { authHeaders } from '@/services/userService';

/** SQL dos Blocos 15+18 (mesmo conteudo dos arquivos sql/) — botao copiar */
const SQL_BLOCOS = `-- BLOCO 15 + 18 — Foto, caixa e OBSERVACAO do cliente no produto
-- Rodar no SQL Editor do Supabase. Idempotente (pode rodar 2x).
alter table products add column if not exists imagem             text;
alter table products add column if not exists unidades_por_caixa integer default 1;
alter table products add column if not exists obs                text;

-- Normaliza caixas invalidas (null/0/negativo = vende solto)
update products set unidades_por_caixa = 1
  where unidades_por_caixa is null or unidades_por_caixa < 1;`;

export interface GestaoCatalogoPortalProps {
  products: Product[];
  orderedProductIds: string[];
  setOrderedProductIds: (ids: string[]) => void;
  updateProduct: (id: string, data: Partial<Product>) => void | Promise<void>;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

/** Comprime a foto no aparelho antes de subir (barato e rapido no 4G) */
function comprimirImagem(file: File, maxLado = 640, qualidade = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * escala));
        canvas.height = Math.max(1, Math.round(img.height * escala));
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas')); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', qualidade));
      };
      img.onerror = () => reject(new Error('imagem invalida'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('arquivo invalido'));
    reader.readAsDataURL(file);
  });
}

export default function GestaoCatalogoPortal(props: GestaoCatalogoPortalProps) {
  const { products } = props;
  const [bloco15ok, setBloco15ok] = useState<boolean | null>(null);
  const [obsOk, setObsOk] = useState<boolean | null>(null);
  const [busca, setBusca] = useState('');
  const [expandida, setExpandida] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [urlFoto, setUrlFoto] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fotoAlvoRef = useRef<string | null>(null);

  // Status do Bloco 15 no Supabase. null = nao deu para verificar (nao mostra
  // banner). false SOMENTE quando o Supabase responder que as colunas faltam.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch('/api/admin/catalogo', { headers: authHeaders() });
        const json = await res.json().catch(() => null);
        if (vivo) setBloco15ok(res.ok && json?.ok === true ? json?.bloco15ok === true : null);
        if (vivo) setObsOk(res.ok && json?.ok === true ? json?.obsOk === true : null);
      } catch {
        if (vivo) setBloco15ok(null);
      }
    })();
    return () => { vivo = false; };
  }, []);

  // Familias na MESMA ORDEM DO PDV (products ja chega ordenado pelo doce-app)
  const familias = useMemo(
    () =>
      agruparCatalogo(
        products.map((p) => ({
          id: p.id,
          nome: p.nome,
          preco: Number(p.precoVenda || 0),
          estoque: Number(p.estoquePrincipal || 0),
          categoryId: p.categoryId || null,
        }))
      ),
    [products]
  );

  const porId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const fotoDaFamilia = (f: { nome: string; variantes: { produtoId: string }[] }): string | null => {
    for (const v of f.variantes) {
      const img = porId.get(v.produtoId)?.imagem;
      if (img) return img;
    }
    return fotoFamilia(f.nome);
  };

  const semFotoCount = useMemo(() => familias.filter((f) => !fotoDaFamilia(f)).length, [familias, porId]);

  const familiasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return familias;
    return familias.filter((f) => {
      if (f.nome.toLowerCase().includes(q)) return true;
      return f.variantes.some((v) => (porId.get(v.produtoId)?.nome || '').toLowerCase().includes(q));
    });
  }, [familias, busca, porId]);

  /** Reordena a familia inteira (todas as variantes juntas) no product_order */
  const moveFamilia = (key: string, dir: 'UP' | 'DOWN') => {
    const idx = familias.findIndex((f) => f.key === key);
    if (idx === -1) return;
    const alvo = dir === 'UP' ? idx - 1 : idx + 1;
    if (alvo < 0 || alvo >= familias.length) return;
    const blocos = familias.map((f) => f.variantes.map((v) => v.produtoId));
    [blocos[idx], blocos[alvo]] = [blocos[alvo], blocos[idx]];
    const todosIds = new Set(blocos.flat());
    const extras = props.orderedProductIds.filter((id) => !todosIds.has(id));
    props.setOrderedProductIds([...blocos.flat(), ...extras]);
    props.showToast('Ordem atualizada! PDV e portal juntos.');
  };

  const salvaNome = async (p: Product, valor: string) => {
    const novo = valor.trim();
    if (!novo || novo === p.nome) return;
    const key = `${p.id}:nome`;
    setSavingKey(key);
    try {
      await props.updateProduct(p.id, { nome: novo });
      props.showToast('Nome atualizado no estoque, PDV e portal!');
    } catch {
      props.showToast('Erro ao salvar o nome.', 'error');
    } finally {
      setSavingKey((k) => (k === key ? null : k));
    }
  };

  const salvaCaixa = async (p: Product, valor: string) => {
    const atual = p.unidadesPorCaixa && p.unidadesPorCaixa > 1 ? p.unidadesPorCaixa : 1;
    const n = Math.max(1, Math.floor(Number(valor) || 1));
    if (n === atual) return;
    const key = `${p.id}:caixa`;
    setSavingKey(key);
    try {
      await props.updateProduct(p.id, { unidadesPorCaixa: n });
      props.showToast(n > 1 ? `Caixa com ${n} unidades salva!` : 'Produto vendido solto.');
    } catch {
      props.showToast('Erro ao salvar a caixa.', 'error');
    } finally {
      setSavingKey((k) => (k === key ? null : k));
    }
  };

  /** Bloco 18: observacao SO para o cliente ver no portal (vazio = limpa) */
  const salvaObs = async (p: Product, valor: string) => {
    const novo = valor.trim().slice(0, 300);
    if (novo === (p.obs || '').trim()) return;
    const key = `${p.id}:obs`;
    setSavingKey(key);
    try {
      await props.updateProduct(p.id, { obs: novo || null } as Partial<Product>);
      props.showToast(novo ? 'Observação salva! O cliente já vê no portal.' : 'Observação removida.');
    } catch {
      props.showToast('Erro ao salvar a observação.', 'error');
    } finally {
      setSavingKey((k) => (k === key ? null : k));
    }
  };

  const aplicaFotoFamilia = async (famKey: string, url: string | null) => {
    const f = familias.find((x) => x.key === famKey);
    if (!f) return;
    const key = `familia:${famKey}:foto`;
    setSavingKey(key);
    try {
      for (const v of f.variantes) {
        await props.updateProduct(v.produtoId, { imagem: url || null } as Partial<Product>);
      }
      props.showToast(url ? `Foto aplicada em ${f.variantes.length} produto(s)!` : 'Foto removida!');
      setExpandida(null);
      setUrlFoto('');
    } catch {
      props.showToast('Erro ao salvar a foto.', 'error');
    } finally {
      setSavingKey((k) => (k === key ? null : k));
    }
  };

  const enviaFoto = async (famKey: string, file: File) => {
    const key = `familia:${famKey}:foto`;
    setSavingKey(key);
    try {
      const dataUrl = await comprimirImagem(file);
      const res = await fetch('/api/admin/catalogo/foto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ dataUrl }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok || !json?.url) throw new Error(json?.erro || 'Falha no upload');
      await aplicaFotoFamilia(famKey, String(json.url));
    } catch (e: any) {
      props.showToast(e?.message === 'Falha no upload' ? 'Falha ao enviar a foto.' : 'Não consegui ler a imagem.', 'error');
      setSavingKey((k) => (k === key ? null : k));
    }
  };

  const copiarSql = async () => {
    try {
      await navigator.clipboard.writeText(SQL_BLOCOS);
      props.showToast('SQL copiado! Cole no SQL Editor do Supabase e clique em RUN.');
    } catch {
      props.showToast('Não consegui copiar — selecione o SQL manualmente.', 'error');
    }
  };

  const fotosBloqueadas = bloco15ok === false;
  const obsBloqueada = obsOk === false;
  const faltando: string[] = [];
  if (fotosBloqueadas) faltando.push('foto e caixa');
  if (obsBloqueada) faltando.push('observação do cliente');
  const totalProdutos = products.length;

  return (
    <div className="space-y-4 pb-24">
      {/* CABECALHO */}
      <div className="px-2 pt-1">
        <h2 className="text-xl sm:text-2xl font-black text-gray-800 tracking-tight">Catálogo do Portal</h2>
        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">
          O cliente vê exatamente esta lista, nesta ordem — linkado ao estoque central
        </p>
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg border border-blue-100 uppercase tracking-tight">{familias.length} famílias</span>
          <span className="text-[9px] font-black text-gray-500 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 uppercase tracking-tight">{totalProdutos} produtos</span>
          <span className={`text-[9px] font-black px-2 py-1 rounded-lg border uppercase tracking-tight ${semFotoCount === 0 ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-amber-600 bg-amber-50 border-amber-200'}`}>
            {semFotoCount === 0 ? 'todas com foto' : `${semFotoCount} sem foto`}
          </span>
          <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100 uppercase tracking-tight"><i className="fa-solid fa-shuffle mr-1 text-[8px]"></i>ordem do PDV</span>
        </div>
      </div>

      {/* BANNER BLOCOS 15+18 */}
      {faltando.length > 0 && (
        <div className="mx-2 bg-amber-50 border border-amber-200 rounded-3xl p-4 space-y-2">
          <h3 className="font-black text-amber-800 uppercase text-[11px] tracking-wider"><i className="fa-solid fa-triangle-exclamation mr-1.5"></i>Ative: {faltando.join(' + ')} (1 SQL, 30 segundos)</h3>
          <p className="text-[11px] text-amber-700 font-semibold leading-snug">
            Renomear e reordenar já funcionam. Para {faltando.join(', ')} salvarem de verdade: no Supabase abra <b>SQL Editor → New query</b>, cole o SQL abaixo e clique em <b>RUN</b>.
          </p>
          <button onClick={copiarSql} className="w-full py-3 rounded-xl text-[10px] font-black uppercase bg-amber-500 text-white active:scale-95 shadow-sm flex items-center justify-center gap-2">
            <i className="fa-solid fa-copy"></i>Copiar SQL
          </button>
        </div>
      )}

      {/* BUSCA */}
      <div className="px-1 relative">
        <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 text-sm"></i>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar família ou produto..." aria-label="Buscar no catálogo"
          className="w-full pl-11 pr-4 py-3.5 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100" />
      </div>

      {/* LISTA DE FAMILIAS (ORDEM DO PDV) */}
      <div className="space-y-2 px-1">
        {familiasFiltradas.map((f, i) => {
          const foto = fotoDaFamilia(f);
          const aberta = expandida === f.key;
          const algumaCaixa = f.variantes.some((v) => (porId.get(v.produtoId)?.unidadesPorCaixa || 1) > 1);
          const algumaObs = f.variantes.some((v) => (porId.get(v.produtoId)?.obs || '').trim());
          const tudoInativo = f.variantes.every((v) => porId.get(v.produtoId)?.ativo === false);
          return (
            <div key={f.key} className={`bg-white rounded-3xl border shadow-sm overflow-hidden transition-all ${aberta ? 'border-blue-200' : 'border-gray-100'} ${tudoInativo ? 'opacity-60 grayscale' : ''}`}>
              {/* LINHA DA FAMILIA */}
              <div className="p-3 flex items-center gap-2.5">
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button onClick={() => moveFamilia(f.key, 'UP')} disabled={i === 0} aria-label={`Subir ${f.nome}`}
                    className="w-7 h-7 bg-gray-50 text-gray-400 rounded-lg flex items-center justify-center active:scale-90 border border-gray-100 disabled:opacity-30"><i className="fa-solid fa-chevron-up text-[9px]"></i></button>
                  <button onClick={() => moveFamilia(f.key, 'DOWN')} disabled={i === familiasFiltradas.length - 1} aria-label={`Descer ${f.nome}`}
                    className="w-7 h-7 bg-gray-50 text-gray-400 rounded-lg flex items-center justify-center active:scale-90 border border-gray-100 disabled:opacity-30"><i className="fa-solid fa-chevron-down text-[9px]"></i></button>
                </div>
                <div className="w-14 h-14 rounded-2xl overflow-hidden bg-gray-50 border border-gray-100 flex-shrink-0 flex items-center justify-center">
                  {foto ? <img src={foto} alt={`Foto ${f.nome}`} className="w-full h-full object-cover" loading="lazy" /> : <i className="fa-solid fa-image text-gray-200 text-xl"></i>}
                </div>
                <button onClick={() => { setExpandida(aberta ? null : f.key); setUrlFoto(''); }} className="flex-1 min-w-0 text-left cursor-pointer">
                  <h3 className="font-black text-gray-800 text-[13px] leading-tight uppercase truncate">{f.nome}</h3>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="text-[9px] font-black text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-lg border border-gray-100 uppercase">{f.variantes.length} {f.variantes.length === 1 ? 'tamanho' : 'tamanhos'}</span>
                    {!foto && <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-lg border border-amber-200 uppercase">sem foto</span>}
                    {algumaCaixa && <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-lg border border-emerald-100 uppercase"><i className="fa-solid fa-box mr-0.5 text-[7px]"></i>caixa</span>}
                    {algumaObs && <span className="text-[9px] font-black text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded-lg border border-violet-100 uppercase"><i className="fa-solid fa-comment-dots mr-0.5 text-[7px]"></i>obs</span>}
                    {tudoInativo && <span className="text-[9px] font-black text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded-lg border border-rose-100 uppercase">inativo</span>}
                  </div>
                </button>
                <button onClick={() => { setExpandida(aberta ? null : f.key); setUrlFoto(''); }} aria-label={`Editar ${f.nome}`}
                  className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 flex items-center justify-center active:scale-90 shadow-sm flex-shrink-0">
                  <i className={`fa-solid ${aberta ? 'fa-chevron-up' : 'fa-pencil-alt'} text-sm`}></i>
                </button>
              </div>

              {/* EXPANDIDO: FOTO DA FAMILIA + VARIANTES */}
              {aberta && (
                <div className="px-3 pb-3 space-y-2.5 border-t border-gray-50 pt-3">
                  {/* FOTO */}
                  <div className="bg-gray-50 rounded-2xl p-3 space-y-2 border border-gray-100">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Foto da família no portal</span>
                      {savingKey === `familia:${f.key}:foto` && <i className="fa-solid fa-circle-notch fa-spin text-blue-500 text-xs"></i>}
                    </div>
                    <div className="flex gap-2">
                      <button disabled={fotosBloqueadas || savingKey === `familia:${f.key}:foto`} onClick={() => { fotoAlvoRef.current = f.key; fileRef.current?.click(); }}
                        className="flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase bg-blue-50 text-blue-600 border border-blue-100 active:scale-95 disabled:opacity-40"><i className="fa-solid fa-camera mr-1"></i>Enviar foto</button>
                      <button disabled={fotosBloqueadas || savingKey === `familia:${f.key}:foto`} onClick={() => aplicaFotoFamilia(f.key, null)}
                        className="flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase bg-rose-50 text-rose-500 border border-rose-100 active:scale-95 disabled:opacity-40"><i className="fa-solid fa-trash-can mr-1"></i>Remover</button>
                    </div>
                    <div className="flex gap-2">
                      <input value={urlFoto} onChange={(e) => setUrlFoto(e.target.value)} placeholder="Ou cole o link da foto (URL)..." disabled={fotosBloqueadas}
                        className="flex-1 p-2.5 bg-white border border-gray-100 rounded-xl text-[11px] font-semibold outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50 min-w-0" />
                      <button disabled={fotosBloqueadas || !urlFoto.trim()} onClick={() => aplicaFotoFamilia(f.key, urlFoto.trim())}
                        className="px-4 py-2.5 rounded-xl text-[9px] font-black uppercase bg-emerald-600 text-white active:scale-95 disabled:opacity-40 flex-shrink-0">Aplicar</button>
                    </div>
                    <p className="text-[9px] text-gray-400 font-semibold leading-snug">A foto vale para todos os tamanhos da família. Dica: com o <b>EAN</b> cadastrado no produto, o sistema busca a foto sozinho.</p>
                  </div>

                  {/* VARIANTES */}
                  {f.variantes.map((v) => {
                    const p = porId.get(v.produtoId);
                    if (!p) return null;
                    const caixaAtual = p.unidadesPorCaixa && p.unidadesPorCaixa > 1 ? String(p.unidadesPorCaixa) : '';
                    return (
                      <div key={v.produtoId} className="bg-white rounded-2xl border border-gray-100 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-black text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-lg border border-gray-100 uppercase flex-shrink-0 min-w-[52px] text-center">{v.rotulo || 'único'}</span>
                          <span className="text-[10px] font-black text-emerald-600 flex-shrink-0">R$ {v.preco.toFixed(2)}</span>
                          <span className="text-[9px] font-bold text-gray-400 flex-shrink-0">{v.estoque} un</span>
                          {savingKey === `${p.id}:nome` && <i className="fa-solid fa-circle-notch fa-spin text-blue-500 text-[10px] ml-auto"></i>}
                        </div>
                        <div>
                          <label className="text-[8px] font-black text-gray-400 uppercase block mb-1">Nome (muda no estoque, PDV e portal)</label>
                          <input key={`${p.id}:${p.nome}`} defaultValue={p.nome} onBlur={(e) => salvaNome(p, e.target.value)}
                            className="w-full p-2.5 bg-gray-50 border border-gray-100 rounded-xl text-[12px] font-black uppercase outline-none focus:ring-2 focus:ring-blue-100" />
                        </div>
                        <div>
                          <label className="text-[8px] font-black text-gray-400 uppercase block mb-1">Unidades por caixa (vazio = solto)</label>
                          <input key={`${p.id}:cx:${caixaAtual}`} type="number" min={1} inputMode="numeric" defaultValue={caixaAtual} placeholder="solto" disabled={fotosBloqueadas}
                            onBlur={(e) => salvaCaixa(p, e.target.value)}
                            className="w-full p-2.5 bg-gray-50 border border-gray-100 rounded-xl text-[12px] font-black outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50" />
                        </div>
                        <div>
                          <label className="text-[8px] font-black text-violet-500 uppercase block mb-1">Obs. para o cliente — só aparece no portal</label>
                          <textarea key={`${p.id}:obs:${p.obs || ''}`} defaultValue={p.obs || ''} rows={2} maxLength={300}
                            placeholder="Ex.: promoção leve 3 pague 2, novo sabor, vencimento próximo..." disabled={obsBloqueada}
                            onBlur={(e) => salvaObs(p, e.target.value)}
                            className="w-full p-2.5 bg-gray-50 border border-gray-100 rounded-xl text-[12px] font-semibold outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50 resize-none" />
                          {obsBloqueada && <p className="text-[8px] text-amber-600 font-bold mt-1">Rode o SQL lá em cima para ativar a observação.</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {familiasFiltradas.length === 0 && (
          <div className="text-center py-10 text-gray-300">
            <i className="fa-solid fa-magnifying-glass text-3xl mb-2"></i>
            <p className="text-xs font-bold uppercase">Nada encontrado para "{busca}"</p>
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const alvo = fotoAlvoRef.current;
          e.target.value = '';
          if (file && alvo) enviaFoto(alvo, file);
        }} />
    </div>
  );
}
