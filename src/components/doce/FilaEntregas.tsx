"use client";
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { User, Product, MelhoriasFlags, MELHORIAS_DEFAULT } from '@/lib/types';
import { authHeaders } from '@/services/userService';
import Cupom from '@/components/doce/Cupom';
import EditorPedido from '@/components/doce/EditorPedido';
// BLOCO 61: arrastar-e-soltar estilo kanban para ordenar a rota (dnd-kit).
// Funciona com mouse, TOQUE (celular do admin) e teclado (espaco pega, setas
// movem, espaco solta) — substitui as setas de cima/baixo do Bloco 31.
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, MeasuringStrategy, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * BLOCO 13 — FILA CONTINUA DE ENTREGA (estilo "fila viva").
 *
 * Nao existe mais "finalizar dia / gerar rota": todo pedido de pre-venda
 * entra na fila na hora que o vendedor registra. A ordem e:
 *   1. PRIORIDADE 1 (vermelho, sempre no topo)
 *   2. PRIORIDADE 2 (ambar)
 *   3. Demais — mais antigo primeiro (o card mostra "esperando Xd")
 *
 * Quem entrega: SOMENTE o ENTREGADOR (e o admin). O vendedor acompanha
 * (modo VENDEDOR: leitura) — regra do dono: vendedor nao entrega.
 *
 * Aceite do recebimento:
 *   DINHEIRO -> valor recebido + troco calculado (suporta parcial)
 *   PIX      -> confirmacao manual + foto do comprovante obrigatoria
 *   BOLETO   -> foto do boleto obrigatoria
 *   + alternativas: ja pagou / nao cobrou
 *
 * Ainda: lista imprimivel (ordem de entrega), fechamento de caixa do
 * entregador com confirmacao do admin, e pedido falhado nunca some
 * (fica vermelho ate ser reaberto ou excluido pelo admin).
 */

interface FilaItem {
  saleId: string;
  numero: string;
  dataVenda: string;
  entregaStatus: string;
  valorTotal: number;
  valorPago: number;
  statusPagamento: string;
  formaPgto: string;
  condicao: string;
  // BLOCO 40: dados REAIS da venda para o cupom (tipo do documento NF-e/NFC-e,
  // CPF, forma de pagamento e prazo) — antes o cupom reconstruia o detalhe e
  // a escolha "COM NOTA" da rota 2 se perdia (saiava sempre CUPOM).
  detalhePagamento?: string | null;
  metodoPagamento?: string | null;
  modoNota?: string | null;
  trocas: string | null;
  prioridade: number;
  // BLOCO 31: posicao da rota definida pelo admin (arrastar-e-soltar — undefined = sem ordem manual)
  ordemEntrega?: number;
  separado: boolean;
  temFoto: boolean;
  dataVencimento: string | null;
  // BLOCO 58: check de carga — timestamp de quando o pedido foi carregado no
  // veiculo (null/undefined = ainda nao carregado). Quem marca e o ADMIN.
  carregadoEm?: string | null;
  vendedorId: string;
  vendedorNome: string;
  // BLOCO 64: numero/sala do endereco — impressao da ordem mostra "Rua X, 123"
  cliente: { id: string; nome: string; endereco: string; numero?: string | null; bairro: string; telefone: string; cnpj?: string | null; email?: string | null; lat: number | null; lng: number | null };
  itens: { nome: string; produtoId: string; quantidade: number; precoVenda: number }[];
}

interface ApiResp {
  hoje: string;
  fila: FilaItem[];
  falhados: FilaItem[];
  entreguesHoje: FilaItem[];
  resumo?: { naFila: number; valorFila: number; atrasados: number; separados: number; entreguesHoje: number; valorEntregueHoje: number; falhados: number };
  // BLOCO 58 (regra do dono): o caixa NAO zera por dia — e o valor EM ABERTO
  // desde o ULTIMO fechamento de caixa do admin (desde = quando comeca a conta).
  caixa?: { dinheiroHoje: number; pixHoje: number; desde?: string | null };
  meuFechamento?: { id: string; valor_dinheiro: number; valor_pix: number; qtd_entregas: number; confirmado: boolean; obs: string | null } | null;
  fechamentosHoje?: any[];
  conferencia?: { porEntregador: { entregadorId: string; nome: string; dinheiro: number; pix: number; qtdEntregas: number; vendas: { saleId: string; cliente: string; valorTotal: number; valorPago: number; recebimento: string }[] }[] };
  migracaoPendente?: boolean;
  error?: string;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const PGTO_META: Record<string, { label: string; icon: string; chip: string }> = {
  DINHEIRO: { label: 'Dinheiro', icon: 'fa-solid fa-money-bill-wave', chip: 'bg-emerald-50 text-emerald-700' },
  PIX: { label: 'Pix', icon: 'fa-brands fa-pix', chip: 'bg-teal-50 text-teal-700' },
  BOLETO: { label: 'Boleto', icon: 'fa-solid fa-barcode', chip: 'bg-amber-50 text-amber-700' },
  CHEQUE: { label: 'Cheque', icon: 'fa-solid fa-money-check', chip: 'bg-violet-50 text-violet-700' },
  // BLOCO 27 (ROTA 2): pedido pago na visita pelo vendedor — entrega sem cobranca
  PAGO_VISITA: { label: 'Já pago na visita', icon: 'fa-solid fa-circle-check', chip: 'bg-emerald-100 text-emerald-800' },
};
const pgtoMeta = (m: string) => PGTO_META[m] || PGTO_META.DINHEIRO;

const MOTIVOS_FALHA = ['Cliente ausente', 'Recusou o pedido', 'Endereco errado', 'Loja fechada', 'Outro motivo'];

/** Dias esperando na fila (fracionado em dias; 0 = hoje) */
function diasEsperando(dataVenda: string): number {
  return Math.floor((Date.now() - new Date(dataVenda).getTime()) / (24 * 3600 * 1000));
}

function idadeLabel(dataVenda: string): { txt: string; cls: string } {
  const d = diasEsperando(dataVenda);
  if (d <= 0) return { txt: 'hoje', cls: 'bg-gray-100 text-gray-500' };
  if (d === 1) return { txt: 'esperando 1 dia', cls: 'bg-amber-100 text-amber-700' };
  return { txt: `esperando ${d} dias`, cls: 'bg-rose-100 text-rose-700' };
}

function pegaGps(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return resolve(null);
    const t = setTimeout(() => resolve(null), 6000);
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(t); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { clearTimeout(t); resolve(null); },
      { enableHighAccuracy: true, timeout: 5500, maximumAge: 15000 }
    );
  });
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas'));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('img'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('reader'));
    reader.readAsDataURL(file);
  });
}

function mapaUrl(p: FilaItem): string {
  if (p.cliente.lat != null && p.cliente.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${p.cliente.lat},${p.cliente.lng}`;
  }
  // BLOCO 64: numero/sala entra na busca do mapa (Rua X, 123 Bairro)
  const end = [p.cliente.endereco || '', p.cliente.numero || '', p.cliente.bairro || ''].filter(s => !!String(s).trim()).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(end || p.cliente.nome)}`;
}

function zapUrl(p: FilaItem): string | null {
  const digits = (p.cliente.telefone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const msg = encodeURIComponent(`Ola! Aqui e da Doce Mania 🙂 Seu pedido de ${p.valorTotal.toFixed(2).replace('.', ',')} ja esta a caminho!`);
  return `https://wa.me/${digits.length <= 11 ? '55' + digits : digits}?text=${msg}`;
}

// BLOCO 59 (velocidade): comparador unico da ordem de entrega — ordem manual
// do admin (1..N) primeiro; sem ordem vai pro fim por antiguidade. MESMA
// regra do servidor (GET /api/pre-venda). Usado pela fila na tela, pela
// impressao e pela gravacao das setas — as tres seguem sempre a mesma lista.
function compararOrdemEntrega(a: FilaItem, b: FilaItem): number {
  const oa = typeof a.ordemEntrega === 'number' && a.ordemEntrega > 0 ? a.ordemEntrega : 1e9;
  const ob = typeof b.ordemEntrega === 'number' && b.ordemEntrega > 0 ? b.ordemEntrega : 1e9;
  if (oa !== ob) return oa - ob;
  return new Date(a.dataVenda).getTime() - new Date(b.dataVenda).getTime();
}

export const FilaEntregas: React.FC<{ user: User; showToast: (m: string, t?: 'success' | 'error') => void; modo: 'ENTREGADOR' | 'ADMIN' | 'VENDEDOR'; melhorias?: MelhoriasFlags }> = ({ user, showToast, modo, melhorias: melhoriasProp }) => {
  // BLOCO 14: interruptores (admin liga/desliga em Configuracoes)
  const melhorias = melhoriasProp || MELHORIAS_DEFAULT;
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetEntregue, setSheetEntregue] = useState<FilaItem | null>(null);
  const [sheetFalhou, setSheetFalhou] = useState<FilaItem | null>(null);
  const [motivoOutro, setMotivoOutro] = useState('');
  const [motivoSel, setMotivoSel] = useState<string>(MOTIVOS_FALHA[0]);
  const [valorRecebido, setValorRecebido] = useState('');
  const [valorPix, setValorPix] = useState('');
  // PAGAMENTO NA ENTREGA: o cliente pode mudar a forma na hora (combinou
  // dinheiro, quer metade/metade). O entregador escolhe como recebeu AGORA.
  const [pgtoAgora, setPgtoAgora] = useState<'DINHEIRO' | 'PIX' | 'MISTO'>('DINHEIRO');
  const [valorDinMisto, setValorDinMisto] = useState('');
  const [valorPixMisto, setValorPixMisto] = useState('');
  // QR Code do Pix na entrega (estilo portal do cliente)
  const [qrPix, setQrPix] = useState<{ img: string; payload: string; valor: number } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrErro, setQrErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  // CONFERENCIA do dia (admin): o que o sistema registrou vs o que o entregador trouxe
  const [verConferencia, setVerConferencia] = useState(false);
  const [confDetalhe, setConfDetalhe] = useState<string | null>(null);
  const [fotoBoleto, setFotoBoleto] = useState<string | null>(null);
  const [fotoPix, setFotoPix] = useState<string | null>(null);
  // BLOCO 14: foto opcional da entrega concluída + edição de trocas pelo admin
  const [fotoEntrega, setFotoEntrega] = useState<string | null>(null);
  const [sheetTrocas, setSheetTrocas] = useState<{ p: FilaItem; texto: string } | null>(null);
  const [cupom, setCupom] = useState<FilaItem | null>(null);
  const [verEntregues, setVerEntregues] = useState(false);
  const [sheetCaixa, setSheetCaixa] = useState(false);
  const [caixaDinheiro, setCaixaDinheiro] = useState('');
  const [caixaObs, setCaixaObs] = useState('');
  // BLOCO 60 (regra do dono): a confirmacao de entrega mostra o GIF "NAO FECHE
  // A TELA" na tela inteira. Estado proprio (o `busy` guarda o saleId na
  // entrega, nao serve para o overlay).
  const [confirmandoEntrega, setConfirmandoEntrega] = useState(false);
  // BLOCO 33: quem fecha o caixa e o ADMIN (regra do dono). O admin escolhe
  // o entregador alvo quando ha mais de um com entregas no dia.
  const [caixaEntId, setCaixaEntId] = useState('');
  const [mostrarLista, setMostrarLista] = useState(false);
  // BLOCO 31: edicao do pedido pelo admin (antes da entrega) + busy por sale
  const [editPedido, setEditPedido] = useState<FilaItem | null>(null);
  const mounted = useRef(true);
  // BLOCO 59 (ordem de entrega rapida): estado da gravacao das setas.
  // - dataRef: ultima fila conhecida (a gravacao debounced le daqui, fora do render)
  // - ordemSalvaRef: o que JA esta gravado no servidor (base do delta — manda
  //   so os pares que mudaram, economiza payload e egress)
  const dataRef = useRef<ApiResp | null>(null);
  const ordemSalvaRef = useRef<Map<string, number>>(new Map());
  const ordemTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gravandoOrdemRef = useRef(false);
  const ordemRegravarRef = useRef(false);
  useEffect(() => { dataRef.current = data; }, [data]);
  // BLOCO 61: sensores do arrastar-e-soltar. Distancia de 8px antes de ativar
  // para NAO roubar o toque do scroll nem o clique dos botoes do card.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const podeEntregar = modo === 'ENTREGADOR' || modo === 'ADMIN';
  const podePrioridade = modo === 'ENTREGADOR' || modo === 'ADMIN';

  const load = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const url = modo === 'VENDEDOR' ? '/api/pre-venda?fila=1' : '/api/pre-venda?fila=1&caixa=1';
      const res = await fetch(url, { headers: authHeaders() });
      const d: ApiResp = await res.json();
      if (!mounted.current) return;
      if (!res.ok) { if (!silencioso) showToast(d.error || 'Erro ao carregar a fila.', 'error'); }
      else {
        setData(d);
        // BLOCO 59: sincroniza o "ja gravado no servidor" — base do delta das
        // setas (so regravamos o par cuja ordem realmente mudou).
        ordemSalvaRef.current = new Map((d.fila || []).map((p: FilaItem) => [p.saleId, typeof p.ordemEntrega === 'number' && p.ordemEntrega > 0 ? p.ordemEntrega : 0]));
      }
    } catch {
      if (mounted.current && !silencioso) showToast('Sem conexao. Tente novamente.', 'error');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [showToast, modo]);

  // BLOCO 32 (velocidade + egress): o efeito de montagem/polling NAO pode
  // depender do `load` — a identidade do showToast muda a cada toast (toda
  // acao dispara toast), o load era recriado e o useEffect RE-RODAVA,
  // recarregando a fila INTEIRA (4 SELECTs) a cada clique de seta/acao.
  // Com a ref, o efeito roda 1x e o polling usa a funcao mais recente.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    mounted.current = true;
    const t0 = setTimeout(() => loadRef.current(), 0);
    // EGRESS: 45s → 120s + pula quando o app esta em background
    const t = setInterval(() => { if (typeof document !== 'undefined' && !document.hidden) loadRef.current(true); }, 120_000);
    const onFocus = () => loadRef.current(true);
    window.addEventListener('focus', onFocus);
    return () => { mounted.current = false; clearTimeout(t0); clearInterval(t); if (ordemTimerRef.current) clearTimeout(ordemTimerRef.current); window.removeEventListener('focus', onFocus); };
  }, []);

  // BLOCO 32 (velocidade): recarregar=false para acoes que a tela ja reflete
  // (ordem das setas) — evita recarregar a fila INTEIRA (4 SELECTs no Supabase)
  // a cada clique: menos espera e menos egress. Se falhar, o chamador recarrega.
  // semGps=true: acao administrativa (setas) nao precisa esperar o GPS (ate 6s).
  async function acao(body: any, okMsg: string, recarregar = true, semGps = false) {
    setBusy(body.saleId || body.acao);
    try {
      const gps = semGps ? null : await pegaGps();
      const res = await fetch('/api/pre-venda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ...body, lat: gps?.lat, lng: gps?.lng }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        showToast(d.error || 'Nao foi possivel concluir.', 'error');
        return false;
      }
      showToast(okMsg, 'success');
      if (recarregar) await load(true);
      return true;
    } catch {
      showToast('Sem conexao. Tente novamente.', 'error');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function confirmarEntrega(p: FilaItem, pagamento: string, extra: Record<string, any> = {}) {
    setConfirmandoEntrega(true);
    try {
      const ok = await acao({ acao: 'ENTREGUE', saleId: p.saleId, pagamento, ...extra },
        pagamento === 'BOLETO' ? 'Entrega confirmada — boleto com foto!' :
        pagamento === 'DINHEIRO' ? 'Entrega confirmada — dinheiro!' :
        pagamento === 'PIX' ? 'Entrega confirmada — Pix com comprovante!' :
        pagamento === 'JA_PAGO' ? 'Entrega confirmada — ja pago!' :
        'Entrega confirmada — a receber!');
      if (ok) {
        setSheetEntregue(null);
        setValorRecebido('');
        setValorPix('');
        setValorDinMisto('');
        setValorPixMisto('');
        setQrPix(null);
        setQrErro('');
        setCopiado(false);
        setPgtoAgora('DINHEIRO');
        setFotoBoleto(null);
        setFotoPix(null);
        setFotoEntrega(null);
      }
    } finally {
      setConfirmandoEntrega(false);
    }
  }

  /** Abre o sheet de entrega zerando o recebimento (a forma combinada vira o padrao) */
  function abrirSheetEntrega(p: FilaItem) {
    setValorRecebido('');
    setValorPix('');
    setFotoBoleto(null);
    setFotoPix(null);
    setFotoEntrega(null);
    const m = PGTO_META[p.formaPgto] ? p.formaPgto : 'DINHEIRO';
    setPgtoAgora(m === 'PIX' ? 'PIX' : 'DINHEIRO');
    setValorDinMisto('');
    setValorPixMisto('');
    setQrPix(null);
    setQrErro('');
    setCopiado(false);
    setSheetEntregue(p);
  }

  /** QR Code do Pix com o valor exato para o cliente escanear (estilo portal) */
  async function gerarQrPix(valor: number) {
    if (!sheetEntregue || qrLoading) return;
    setQrLoading(true);
    setQrErro('');
    setQrPix(null);
    try {
      const res = await fetch('/api/pre-venda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'PIX_QRCODE', saleId: sheetEntregue.saleId, valor }),
      });
      const d = await res.json();
      if (res.ok && d?.ok) setQrPix({ img: d.qrDataUrl, payload: String(d.payload || ''), valor: Number(d.valor || valor) });
      else showToast(d?.error || 'Nao foi possivel gerar o QR Code.', 'error');
    } catch {
      showToast('Sem conexao. Tente novamente.', 'error');
    } finally {
      setQrLoading(false);
    }
  }

  /** Bloco do QR Code do Pix mostrado na entrega (cliente escaneia e paga) */
  const qrBloco = (valor: number) => (
    <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3">
      {!qrPix ? (
        <button onClick={() => gerarQrPix(valor)} disabled={qrLoading}
          className="w-full py-3 rounded-xl bg-teal-600 text-white text-[10px] font-black uppercase active:scale-95 transition-transform disabled:opacity-60">
          <i className="fa-solid fa-qrcode mr-1"></i>{qrLoading ? 'Gerando QR Code...' : `Mostrar QR Code do Pix (${fmt(valor)})`}
        </button>
      ) : (
        <div className="text-center">
          <img src={qrPix.img} alt="QR Code Pix" className="w-44 h-44 mx-auto rounded-xl border border-gray-200 bg-white" />
          <p className="text-[9px] font-black text-gray-500 uppercase mt-2">Cliente escaneia e paga {fmt(qrPix.valor)}</p>
          <button
            onClick={async () => {
              try { await navigator.clipboard.writeText(qrPix.payload); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
              catch { showToast('Nao foi possivel copiar. Use a camera do banco direto.', 'error'); }
            }}
            className="w-full mt-2 py-2.5 rounded-xl bg-gray-800 text-white text-[9px] font-black uppercase active:scale-95 transition-transform">
            <i className={`fa-solid ${copiado ? 'fa-check' : 'fa-copy'} mr-1`}></i>{copiado ? 'Codigo copiado!' : 'Copiar codigo Pix (copia e cola)'}
          </button>
        </div>
      )}
      {qrErro && <p className="text-[9px] font-black text-rose-500 uppercase text-center mt-1.5">{qrErro}</p>}
    </div>
  );

  async function setPrioridade(p: FilaItem, prioridade: number) {
    const novo = p.prioridade === prioridade ? 0 : prioridade;
    // BLOCO 59: otimista + sem GPS + sem recarregar a fila. Antes esperava o
    // GPS (ate 6s) e recarregava a fila INTEIRA (4 SELECTs) — lento demais.
    // A tela reordena na hora (P1 sobe pro topo); se falhar, reverte.
    setData(d => d ? { ...d, fila: d.fila.map(f => f.saleId === p.saleId ? { ...f, prioridade: novo } : f) } : d);
    const ok = await acao({ acao: 'PRIORIDADE', saleId: p.saleId, prioridade: novo },
      novo === 1 ? 'Prioridade 1 definida — vai para o topo!' : novo === 2 ? 'Prioridade 2 definida.' : 'Prioridade normal.',
      false, true);
    if (!ok) load(true);
  }

  // BLOCO 31/59/61: define a ordem da rota a partir da lista visual (cards
  // arrastados kanban), GRAVA a ordem e muda a impressao. FIX (Bloco 59):
  // quando a ordem manual esta ativa a lista ANTES usava a fila na ordem bruta
  // do banco — o update otimista so trocava o NUMERO de ordem e o array
  // continuava na mesma posicao, entao o card NAO andava na tela (so aparecia
  // depois do F5). Agora a lista ordena por ordemEntrega: o card anda NA HORA
  // e a impressao segue a mesma lista.
  function aplicarOrdem(nova: FilaItem[]) {
    const ordens = nova.map((p, i) => ({ saleId: p.saleId, ordem: i + 1 }));
    // atualizacao otimista da tela — o card move NA HORA, sem esperar rede
    setData(d => d ? { ...d, fila: d.fila.map(f => { const o = ordens.find(x => x.saleId === f.saleId); return o ? { ...f, ordemEntrega: o.ordem } : f; }) } : d);
    // BLOCO 59: gravacao DEBOUNCED (350ms) — arrastos seguidos acumulam e saem
    // em UM request. Nunca trava esperando rede/GPS.
    agendarGravacaoOrdem();
  }

  // BLOCO 61: soltou o card — reordena a lista (kanban) e grava o delta.
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = listaOrdenada.findIndex(p => p.saleId === active.id);
    const to = listaOrdenada.findIndex(p => p.saleId === over.id);
    if (from < 0 || to < 0) return;
    aplicarOrdem(arrayMove(listaOrdenada, from, to));
  }
  const listaOrdenada = useMemo(() => {
    if (!data) return [];
    const f = data.fila || [];
    const temManual = f.some(p => typeof p.ordemEntrega === 'number' && p.ordemEntrega > 0);
    if (temManual) return [...f].sort(compararOrdemEntrega);
    return [...f.filter(p => p.prioridade === 1), ...f.filter(p => p.prioridade === 2), ...f.filter(p => p.prioridade === 0 || p.prioridade == null)];
  }, [data]);
  const ordemManualAtiva = (data?.fila || []).some(p => typeof p.ordemEntrega === 'number' && p.ordemEntrega > 0);
  // BLOCO 64: a impressao da ordem de entrega sai APENAS com os pedidos que o
  // admin ja marcou como carregados no veiculo — na MESMA ordem da fila.
  const listaImprimir = useMemo(() => listaOrdenada.filter(p => p.carregadoEm), [listaOrdenada]);
  const totalImprimir = listaImprimir.reduce((a, p) => Math.round((a + p.valorTotal) * 100) / 100, 0);

  function agendarGravacaoOrdem() {
    if (ordemTimerRef.current) clearTimeout(ordemTimerRef.current);
    ordemTimerRef.current = setTimeout(() => { void gravarOrdemAgora(); }, 350);
  }

  // BLOCO 59: grava a ordem 1..N do estado atual mandando so o DELTA (pares
  // cuja ordem difere do que ja esta no servidor — 1-2 updates por clique).
  // Sem GPS (acao administrativa) e sem recarregar a fila (a tela ja esta
  // certa — economiza egress). Se falhar, recarrega e reverte.
  async function gravarOrdemAgora() {
    if (gravandoOrdemRef.current) { ordemRegravarRef.current = true; return; }
    gravandoOrdemRef.current = true;
    try {
      const filaAtual = dataRef.current?.fila || [];
      const ordens = [...filaAtual].sort(compararOrdemEntrega).map((p, i) => ({ saleId: p.saleId, ordem: i + 1 }));
      const delta = ordens.filter(o => (ordemSalvaRef.current.get(o.saleId) ?? 0) !== o.ordem);
      if (delta.length === 0) return;
      const res = await fetch('/api/pre-venda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'ORDEM_ENTREGA', ordens: delta }),
      });
      const d = await res.json();
      if (!mounted.current) return;
      if (!res.ok || !d.ok) {
        showToast(d.error || 'Nao foi possivel gravar a ordem.', 'error');
        await load(true); // reverte buscando a ordem real do banco
        return;
      }
      for (const o of delta) ordemSalvaRef.current.set(o.saleId, o.ordem);
      showToast('Ordem da rota atualizada — grava no sistema e na impressão!', 'success');
    } catch {
      if (mounted.current) {
        showToast('Sem conexao. Tente novamente.', 'error');
        await load(true);
      }
    } finally {
      gravandoOrdemRef.current = false;
      // clicou de novo enquanto gravava: regrava o delta que ficou pendente
      if (mounted.current && ordemRegravarRef.current) {
        ordemRegravarRef.current = false;
        agendarGravacaoOrdem();
      }
    }
  }

  // products fake a partir dos itens (o Cupom so precisa de id->nome)
  const productsOf = (p: FilaItem): Product[] => p.itens.map(i => ({ id: i.produtoId, nome: i.nome, precoCusto: 0, precoVenda: i.precoVenda, precoMinimo: 0, comissaoPercentual: 0, estoquePrincipal: 0, ativo: true }));
  const saleOf = (p: FilaItem): any => ({
    id: p.saleId,
    data: new Date(p.dataVenda),
    valorTotal: p.valorTotal,
    valorPago: p.valorPago,
    // BLOCO 40 (regra do dono): o cupom precisa dos dados REAIS da venda —
    // detalhe gravado pelo pedido (com "COM NOTA: NF-e/NFC-e"), modo do
    // atendimento, metodo real e status da entrega. O formato antigo
    // reconstruia "cobrar X na entrega" sem a nota e o cupom saia sempre
    // CUPOM, com pagamento errado (A_PRAZO hardcode virava BOLETO).
    metodoPagamento: p.metodoPagamento || 'A_PRAZO',
    detalhePagamento: p.detalhePagamento || `PRE-VENDA — cobrar ${p.formaPgto} na entrega (${p.condicao === 'APRAZO' ? 'A PRAZO' : 'A VISTA'})`,
    modoNota: p.modoNota || undefined,
    tipoVenda: 'PRE_VENDA',
    entregaStatus: p.entregaStatus,
    statusPagamento: p.statusPagamento,
    itens: p.itens.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade, precoVenda: i.precoVenda })),
    dataVencimento: p.dataVencimento ? new Date(p.dataVencimento) : undefined,
    trocas: p.trocas || undefined,
  });
  const clientOf = (p: FilaItem): any => ({
    id: p.cliente.id,
    nomeFantasia: p.cliente.nome,
    telefone: p.cliente.telefone || '',
    endereco: p.cliente.endereco || '',
    bairro: p.cliente.bairro || '',
    // BLOCO 40: CNPJ do cliente — rodape do cupom NF-e ("NF-e: <cnpj>")
    cnpj: p.cliente.cnpj || '',
    // BLOCO 46: e-mail do cliente — rodape do cupom (envio do XML)
    email: p.cliente.email || '',
  });

  /** Lista imprimivel (ordem de entrega) — imprime via navegador.
   * BLOCO 64: sai SOMENTE quem o admin ja marcou como CARREGADO no veiculo.
   * Nenhum carregado = folha vazia na mão do entregador — avisa e nao imprime. */
  function imprimirLista() {
    if (!data) return;
    const prontos = listaOrdenada.filter(p => p.carregadoEm);
    if (prontos.length === 0) { showToast('Nenhum pedido carregado ainda — marque os pedidos no veículo antes de imprimir.', 'error'); return; }
    setMostrarLista(true);
    setTimeout(() => { window.print(); setMostrarLista(false); }, 150);
  }

  // BLOCO 33: caixa e fechado pelo ADMIN — abre o sheet pre-preenchido com o
  // dinheiro estimado do entregador selecionado (grupos da conferencia).
  function abrirCaixaAdmin() {
    const grupos = data?.conferencia?.porEntregador || [];
    if (grupos.length === 0) { showToast('Nenhuma entrega hoje — nada para fechar no caixa.', 'error'); return; }
    const primeiro = grupos[0];
    setCaixaEntId(primeiro.entregadorId);
    setCaixaDinheiro(primeiro.dinheiro ? String(Number(primeiro.dinheiro).toFixed(2)) : '');
    setSheetCaixa(true);
  }

  function trocarEntCaixa(id: string) {
    setCaixaEntId(id);
    const g = (data?.conferencia?.porEntregador || []).find((x: any) => x.entregadorId === id);
    setCaixaDinheiro(g && g.dinheiro ? String(Number(g.dinheiro).toFixed(2)) : '');
  }

  async function fecharCaixa() {
    const v = parseFloat(caixaDinheiro) || 0;
    if (v < 0) { showToast('Valor invalido.', 'error'); return; }
    const ok = await acao({ acao: 'FECHAR_CAIXA', entregadorId: caixaEntId, valorDinheiro: v, valorPix: data?.caixa?.pixHoje || 0, qtdEntregas: data?.resumo?.entreguesHoje || 0, obs: caixaObs }, 'Caixa fechado — a partir de agora a conta recomeca!');
    if (ok) { setSheetCaixa(false); setCaixaDinheiro(''); setCaixaObs(''); setCaixaEntId(''); }
  }

  // BLOCO 58: check de carga do admin — atualiza a tela NA HORA (otimista,
  // sem recarregar a fila inteira: economiza egress) e reverte se falhar.
  async function toggleCarga(p: FilaItem) {
    const novo = !p.carregadoEm;
    setData(d => d ? {
      ...d,
      fila: d.fila.map(f => f.saleId === p.saleId ? { ...f, carregadoEm: novo ? new Date().toISOString() : null } : f),
    } : d);
    const ok = await acao({ acao: 'CHECK_CARGA', saleId: p.saleId, carregado: novo },
      novo ? 'Pedido CARREGADO no veiculo!' : 'Check de carga removido!', false, true);
    if (!ok) load(true);
  }

  if (loading && !data) {
    return <div className="py-14 flex justify-center"><div className="w-9 h-9 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin" /></div>;
  }
  // BLOCO 61: card ordenavel (kanban). O handle de arrasto é o proprio badge
  // da posicao (o antigo "#"). Fora do admin o card nao arrasta (so leitura).
  const SortableCard = ({ p, acento, posicao, draggable }: { p: FilaItem; acento: 'p1' | 'p2' | 'normal'; posicao?: number; draggable: boolean }) => {
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: p.saleId, disabled: !draggable });
    return (
      <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`relative ${isDragging ? 'z-50' : ''}`}>
        <Card p={p} acento={acento} posicao={posicao} dragging={isDragging}
          handleProps={draggable ? { ref: setActivatorNodeRef, ...attributes, ...listeners } : undefined} />
      </div>
    );
  };

  if (!data) return null;

  if (data.migracaoPendente) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
        <i className="fa-solid fa-database text-amber-500"></i>
        <p className="text-[10px] font-black text-amber-700 uppercase leading-snug">
          Pre-venda em preparacao: aguarde o admin rodar o SQL do sistema.
        </p>
      </div>
    );
  }

  const fila = data.fila || [];
  const p1 = fila.filter(p => p.prioridade === 1);
  const p2 = fila.filter(p => p.prioridade === 2);
  const normais = fila.filter(p => p.prioridade === 0 || p.prioridade == null);
  const falhados = data.falhados || [];
  const entreguesHoje = data.entreguesHoje || [];
  // A PRAZO entregue hoje e ainda sem pagamento: o entregador NAO cobra —
  // o vendedor recebe na proxima visita (regra do dono). Mostrado so para
  // o entregador/admin nao contar esse dinheiro no acerto.
  const prazoEntregueHoje = entreguesHoje
    .filter((p: FilaItem) => p.condicao === 'APRAZO' && p.valorPago < p.valorTotal)
    .reduce((a: number, p: FilaItem) => Math.round((a + (p.valorTotal - p.valorPago)) * 100) / 100, 0);
  const resumo = data.resumo;
  const caixaEst = data.caixa || { dinheiroHoje: 0, pixHoje: 0 };
  const desdeCaixa = caixaEst.desde ? new Date(caixaEst.desde) : null;
  const desdeCaixaOk = desdeCaixa && !isNaN(desdeCaixa.getTime());
  // BLOCO 58: contagem da carga — quantos pedidos da fila ja estao no veiculo
  const carregadosCount = fila.filter(p => p.carregadoEm).length;

  const sp = sheetEntregue;
  const spMetodo = sp ? (PGTO_META[sp.formaPgto] ? sp.formaPgto : 'DINHEIRO') : 'DINHEIRO';
  // BLOCO 27: cliente ja pagou na visita (wizard ROTA 2) — só confirma a entrega
  const spPagoVisita = sp ? sp.formaPgto === 'PAGO_VISITA' : false;
  const restante = sp ? Math.max(0, sp.valorTotal - sp.valorPago) : 0;
  const rec = parseFloat(valorRecebido) || 0;
  const troco = sp && rec > restante ? rec - restante : 0;
  const falta = sp && rec > 0 && rec < restante ? restante - rec : 0;
  // MISTO: metade em dinheiro, metade no Pix (o cliente decide na hora)
  const dinMisto = parseFloat(valorDinMisto) || 0;
  const pixMisto = parseFloat(valorPixMisto) || 0;
  const somaMisto = Math.round((dinMisto + pixMisto) * 100) / 100;

  // BLOCO 61: Card recebe a POSICAO da entrega (entra no lugar do antigo "#")
  // e o handle de arrasto quando o admin pode reordenar.
  const Card = ({ p, acento, posicao, dragging, handleProps }: { p: FilaItem; acento: 'p1' | 'p2' | 'normal' | 'falha' | 'ok'; posicao?: number; dragging?: boolean; handleProps?: Record<string, any> }) => {
    const { ref: handleRef, ...handleAttrs } = handleProps || {};
    const pend = p.entregaStatus === 'PENDENTE' || p.entregaStatus === 'EM_ROTA';
    const idade = idadeLabel(p.dataVenda);
    const zap = zapUrl(p);
    const pg = pgtoMeta(p.formaPgto);
    const borda = acento === 'p1' ? 'border-rose-300 ring-2 ring-rose-100' : acento === 'p2' ? 'border-amber-300' : acento === 'falha' ? 'border-rose-200' : acento === 'ok' ? 'border-emerald-200' : 'border-gray-100';
    return (
      <div className={`rounded-2xl shadow-sm border overflow-hidden bg-white ${borda} ${p.separado && pend ? 'opacity-70 bg-gray-100' : ''} print:break-inside-avoid`}>
        <div className="p-4">
          <div className="flex items-start gap-2">
            {/* BLOCO 61: prioridade / POSICAO na rota (era "#") — e o handle do
                arrastar-e-soltar quando o admin pode reordenar */}
            <div
              ref={handleRef}
              {...handleAttrs}
              title={handleProps ? 'Arraste para mudar a posição na rota' : undefined}
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-[11px] ${acento === 'p1' ? 'bg-rose-600 text-white animate-pulse' : acento === 'p2' ? 'bg-amber-500 text-white' : acento === 'falha' ? 'bg-rose-500 text-white' : acento === 'ok' ? 'bg-emerald-500 text-white' : 'bg-gray-800 text-white'} ${handleProps ? 'cursor-grab active:cursor-grabbing touch-none select-none' : ''} ${dragging ? 'opacity-60' : ''}`}>
              {acento === 'p1' ? 'P1' : acento === 'p2' ? 'P2' : acento === 'falha' ? <i className="fa-solid fa-xmark"></i> : acento === 'ok' ? <i className="fa-solid fa-check"></i> : (posicao ?? '#')}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-[13px] font-black text-gray-800 truncate capitalize">{p.cliente.nome}</p>
                {melhorias.bairroCard && p.cliente.bairro && (
                  <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-600 shrink-0"><i className="fa-solid fa-city mr-0.5"></i>{p.cliente.bairro}</span>
                )}
                {p.separado && pend && (
                  <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md bg-gray-300 text-gray-600"><i className="fa-solid fa-boxes-stacked mr-0.5"></i>Separado</span>
                )}
                {/* BLOCO 58: pedido carregado no veiculo (check do admin) */}
                {p.carregadoEm && pend && (
                  <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md bg-emerald-600 text-white shrink-0"><i className="fa-solid fa-truck-fast mr-0.5"></i>No veículo</span>
                )}
                {pend && <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md shrink-0 ${idade.cls}`}><i className="fa-regular fa-clock mr-0.5"></i>{idade.txt}</span>}
                <span className="text-[8px] font-bold text-gray-300 uppercase shrink-0">{p.numero}</span>
              </div>
              <p className="text-[9px] text-gray-400 font-semibold mt-0.5 truncate">
                <i className="fa-solid fa-location-dot mr-1"></i>{p.cliente.endereco || 'Sem endereco'}{p.cliente.numero ? `, ${p.cliente.numero}` : ''}{p.cliente.bairro ? ` — ${p.cliente.bairro}` : ''}
              </p>
              {p.trocas && (
                <p className="text-[9px] font-black text-orange-600 mt-1 bg-orange-50 rounded-lg px-2 py-1 leading-snug">
                  <i className="fa-solid fa-right-left mr-1"></i>Trocas: {p.trocas}
                </p>
              )}
              {melhorias.trocaSeparacao && modo === 'ADMIN' && pend && (
                <button onClick={() => setSheetTrocas({ p, texto: p.trocas || '' })} disabled={!!busy}
                  className="text-[8px] font-black text-orange-500 uppercase mt-1 active:scale-95 transition-transform">
                  <i className="fa-solid fa-pencil mr-1"></i>{p.trocas ? 'Editar trocas' : 'Anotar troca da separação'}
                </button>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[13px] font-black text-gray-800">{fmt(p.valorTotal)}</span>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase ${pg.chip}`}><i className={`${pg.icon} mr-1`}></i>{pg.label}</span>
                {p.condicao === 'APRAZO' && <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-600 uppercase">A prazo</span>}
                {p.valorPago > 0 && p.valorPago < p.valorTotal && (
                  <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 uppercase">Falta {fmt(p.valorTotal - p.valorPago)}</span>
                )}
              </div>
            </div>
          </div>

          {/* acoes */}
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-50">
            <a href={mapaUrl(p)} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[58px] py-2.5 rounded-xl bg-blue-50 text-blue-600 text-[9px] font-black uppercase text-center active:scale-95 transition-transform">
              <i className="fa-solid fa-diamond-turn-right mr-1"></i>Mapa
            </a>
            {melhorias.whatsapp && zap && (
              <a href={zap} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[58px] py-2.5 rounded-xl bg-green-50 text-green-600 text-[9px] font-black uppercase text-center active:scale-95 transition-transform">
                <i className="fa-brands fa-whatsapp mr-1"></i>Zap
              </a>
            )}
            <button onClick={() => setCupom(p)} className="flex-1 min-w-[58px] py-2.5 rounded-xl bg-amber-50 text-amber-700 text-[9px] font-black uppercase text-center active:scale-95 transition-transform">
              <i className="fa-solid fa-receipt mr-1"></i>Cupom
            </button>
            {podePrioridade && pend && (
              <>
                <button onClick={() => setPrioridade(p, 1)} disabled={!!busy}
                  className={`flex-1 min-w-[58px] py-2.5 rounded-xl text-[9px] font-black uppercase active:scale-95 transition-transform disabled:opacity-60 ${p.prioridade === 1 ? 'bg-rose-600 text-white shadow' : 'bg-rose-50 text-rose-600'}`}>
                  P1
                </button>
                <button onClick={() => setPrioridade(p, 2)} disabled={!!busy}
                  className={`flex-1 min-w-[58px] py-2.5 rounded-xl text-[9px] font-black uppercase active:scale-95 transition-transform disabled:opacity-60 ${p.prioridade === 2 ? 'bg-amber-500 text-white shadow' : 'bg-amber-50 text-amber-600'}`}>
                  P2
                </button>
              </>
            )}
            {/* BLOCO 61: as setas do Bloco 31 viraram arrastar-e-soltar — o
                admin pega o card pelo numero e solta na posicao desejada. */}
            {/* BLOCO 58: check de carga — o admin marca o pedido que entrou no
                veiculo; a fila mistura carregados e nao carregados e o contador
                do resumo mostra quantos estao no veiculo. */}
            {modo === 'ADMIN' && pend && (
              <button onClick={() => toggleCarga(p)} disabled={!!busy}
                title={p.carregadoEm ? 'Já carregado — clique para remover o check' : 'Marcar como carregado no veículo'}
                className={`flex-1 min-w-[58px] py-2.5 rounded-xl text-[9px] font-black uppercase active:scale-95 transition-transform disabled:opacity-60 ${p.carregadoEm ? 'bg-emerald-600 text-white shadow' : 'bg-slate-100 text-slate-500'}`}>
                <i className={`fa-solid ${p.carregadoEm ? 'fa-clipboard-check' : 'fa-truck-fast'} mr-1`}></i>{p.carregadoEm ? 'Carregado' : 'Carregar'}
              </button>
            )}
            {/* BLOCO 31: editar o pedido antes da entrega (admin) */}
            {modo === 'ADMIN' && pend && (
              <button onClick={() => setEditPedido(p)} disabled={!!busy}
                className="flex-1 min-w-[58px] py-2.5 rounded-xl bg-violet-50 text-violet-600 text-[9px] font-black uppercase active:scale-95 transition-transform disabled:opacity-60">
                <i className="fa-solid fa-pen-to-square mr-1"></i>Editar
              </button>
            )}
          </div>

          {/* entregador/admin: entrega e falha com botoes grandes */}
          {podeEntregar && pend && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => abrirSheetEntrega(p)}
                disabled={!!busy}
                className="flex-[1.6] py-4 rounded-2xl bg-emerald-600 text-white text-[11px] font-black uppercase shadow-md active:scale-95 transition-transform disabled:opacity-60"
              >
                <i className="fa-solid fa-check mr-1"></i>Entregue
              </button>
              <button
                onClick={() => { setMotivoSel(MOTIVOS_FALHA[0]); setMotivoOutro(''); setSheetFalhou(p); }}
                disabled={!!busy}
                className="flex-1 py-4 rounded-2xl bg-rose-50 text-rose-600 text-[11px] font-black uppercase active:scale-95 transition-transform disabled:opacity-60"
              >
                <i className="fa-solid fa-xmark mr-1"></i>Falhou
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* ===== RESUMO DA FILA ===== */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 print:hidden">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center">
              <i className="fa-solid fa-layer-group text-emerald-500 text-xs"></i>
            </div>
            <div>
              <p className="text-[10px] font-black text-gray-700 uppercase leading-none">Fila de entregas</p>
              <p className="text-[8px] font-bold text-gray-400 uppercase mt-0.5">
                {modo === 'VENDEDOR' ? 'Seus pedidos — o entregador entrega' : 'Continua — entra pedido, sai entregue'}
              </p>
            </div>
          </div>
          <div className="flex gap-1.5">
            {modo !== 'VENDEDOR' && (
              <button onClick={imprimirLista} className="w-8 h-8 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center active:scale-90" title="Imprimir lista de entregas">
                <i className="fa-solid fa-print text-[11px]"></i>
              </button>
            )}
            <button onClick={() => load()} className="w-8 h-8 rounded-lg bg-gray-50 text-gray-400 flex items-center justify-center active:scale-90">
              <i className={`fa-solid fa-rotate text-[11px] ${busy ? 'animate-spin' : ''}`}></i>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5 text-center">
          <div className="bg-gray-50 rounded-xl p-2"><p className="text-[7px] font-black text-gray-400 uppercase">Na fila</p><p className="text-[13px] font-black text-gray-800">{resumo?.naFila ?? fila.length}</p></div>
          <div className="bg-amber-50 rounded-xl p-2"><p className="text-[7px] font-black text-amber-500 uppercase">Atrasados</p><p className="text-[13px] font-black text-amber-700">{resumo?.atrasados ?? 0}</p></div>
          <div className="bg-rose-50 rounded-xl p-2"><p className="text-[7px] font-black text-rose-400 uppercase">Falhas</p><p className="text-[13px] font-black text-rose-600">{falhados.length}</p></div>
          <div className="bg-emerald-50 rounded-xl p-2"><p className="text-[7px] font-black text-emerald-500 uppercase">Entregues</p><p className="text-[13px] font-black text-emerald-700">{resumo?.entreguesHoje ?? entreguesHoje.length}</p></div>
        </div>
        <div className="flex gap-2 mt-2 text-[9px] font-bold flex-wrap">
          <span className="text-gray-600"><i className="fa-solid fa-wallet mr-1"></i>Fila: {fmt(resumo?.valorFila ?? 0)}</span>
          <span className="text-emerald-600"><i className="fa-solid fa-circle-check mr-1"></i>Entregue hoje: {fmt(resumo?.valorEntregueHoje ?? 0)}</span>
          {/* BLOCO 58: quantos pedidos da fila já estão no veiculo (check do admin) */}
          {modo !== 'VENDEDOR' && (
            <span className="text-slate-700"><i className="fa-solid fa-truck-fast mr-1"></i>No veículo: {carregadosCount}/{fila.length}</span>
          )}
        </div>

        {/* CAIXA DO DIA (entregador e admin) */}
        {modo !== 'VENDEDOR' && (
          <div className="mt-3 bg-slate-50 border border-slate-100 rounded-2xl p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[8px] font-black text-slate-400 uppercase">Caixa em aberto (estimado)</p>
                <p className="text-[8px] font-bold text-slate-400 uppercase">
                  {desdeCaixaOk
                    ? <>desde {desdeCaixa!.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} {desdeCaixa!.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>
                    : 'sem fechamento anterior'}
                </p>
                <p className="text-[11px] font-black text-slate-700">
                  <i className="fa-solid fa-money-bill-wave text-emerald-500 mr-1"></i>{fmt(caixaEst.dinheiroHoje)}
                  <span className="mx-2 text-slate-300">·</span>
                  <i className="fa-brands fa-pix text-teal-500 mr-1"></i>{fmt(caixaEst.pixHoje)}
                </p>
                {prazoEntregueHoje > 0 && (
                  <p className="text-[8px] font-black text-orange-500 uppercase mt-1"><i className="fa-solid fa-hand-holding-dollar mr-1"></i>A prazo entregue hoje (NAO cobrar): {fmt(prazoEntregueHoje)}</p>
                )}
              </div>
              {/* BLOCO 33: SOMENTE O ADMIN fecha o caixa (regra do dono). O
                  entregador so ve o estimado — sem botao de fechar. */}
              {modo === 'ADMIN' ? (
                <div className="text-right shrink-0">
                  <button onClick={abrirCaixaAdmin} disabled={!!busy}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 text-white text-[9px] font-black uppercase active:scale-95 shadow disabled:opacity-60">
                    <i className="fa-solid fa-cash-register mr-1"></i>{(data.fechamentosHoje || []).length > 0 ? 'Corrigir' : 'Fechar caixa'}
                  </button>
                  {(data.fechamentosHoje || []).length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {(data.fechamentosHoje || []).map((f: any) => (
                        <div key={f.id} className="flex items-center gap-2 justify-end">
                          <span className="text-[9px] font-black text-slate-600">Dinheiro: {fmt(Number(f.valor_dinheiro))}</span>
                          {f.confirmado ? (
                            <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Confirmado</span>
                          ) : (
                            <button onClick={() => acao({ acao: 'CONFIRMAR_CAIXA', caixaId: f.id }, 'Recebimento do dinheiro confirmado!')}
                              className="text-[8px] font-black uppercase px-2 py-1 rounded bg-emerald-600 text-white active:scale-95">
                              Confirmar
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[8px] font-bold text-slate-400 uppercase text-right leading-snug max-w-[130px]">
                  <i className="fa-solid fa-user-shield mr-1"></i>O caixa só zera quando o admin fecha
                </p>
              )}
            </div>

            {/* CONFERENCIA DO DIA (admin): o que o sistema registrou vs o que
                foi fechado no caixa — entrega por entrega, para bater o dinheiro */}
            {modo === 'ADMIN' && data.conferencia && data.conferencia.porEntregador.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-200">
                <button onClick={() => setVerConferencia(v => !v)} className="w-full flex items-center justify-between">
                  <p className="text-[9px] font-black text-slate-500 uppercase"><i className="fa-solid fa-clipboard-check mr-1"></i>Conferencia das entregas de hoje ({data.conferencia.porEntregador.reduce((a: number, g: any) => a + g.qtdEntregas, 0)})</p>
                  <i className={`fa-solid ${verConferencia ? 'fa-chevron-up' : 'fa-chevron-down'} text-slate-300 text-xs`}></i>
                </button>
                {verConferencia && (
                  <div className="mt-2 space-y-2">
                    {data.conferencia.porEntregador.map((g: any) => {
                      const fech = (data.fechamentosHoje || []).find((f: any) => f.entregador_id === g.entregadorId);
                      const dinDiff = fech ? Math.round((Number(fech.valor_dinheiro) - g.dinheiro) * 100) / 100 : null;
                      const pixDiff = fech ? Math.round((Number(fech.valor_pix) - g.pix) * 100) / 100 : null;
                      const bate = (d: number | null) => d !== null && Math.abs(d) < 0.005;
                      const aberto = confDetalhe === g.entregadorId;
                      return (
                        <div key={g.entregadorId} className="bg-white rounded-xl border border-slate-200 p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black text-slate-700 uppercase">{g.nome || 'Entregador'}</p>
                            <span className="text-[9px] font-bold text-slate-400">{g.qtdEntregas} entrega(s)</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div className="bg-emerald-50 rounded-lg p-2 text-center">
                              <p className="text-[7px] font-black text-emerald-500 uppercase">Sistema: dinheiro</p>
                              <p className="text-[13px] font-black text-emerald-700">{fmt(g.dinheiro)}</p>
                            </div>
                            <div className="bg-teal-50 rounded-lg p-2 text-center">
                              <p className="text-[7px] font-black text-teal-500 uppercase">Sistema: pix</p>
                              <p className="text-[13px] font-black text-teal-700">{fmt(g.pix)}</p>
                            </div>
                          </div>
                          {fech ? (
                            <div className="mt-2 bg-slate-50 rounded-lg p-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[8px] font-black text-slate-500 uppercase leading-snug">Caixa fechado:<br />{fmt(Number(fech.valor_dinheiro))} din · {fmt(Number(fech.valor_pix))} pix</p>
                                {fech.confirmado ? (
                                  <span className="text-[7px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">Confirmado</span>
                                ) : (
                                  <button onClick={() => acao({ acao: 'CONFIRMAR_CAIXA', caixaId: fech.id }, 'Recebimento do dinheiro confirmado!')}
                                    className="text-[8px] font-black uppercase px-2 py-1.5 rounded bg-emerald-600 text-white active:scale-95 shrink-0">Confirmar</button>
                                )}
                              </div>
                              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                                <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded ${bate(dinDiff) ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                  <i className={`fa-solid ${bate(dinDiff) ? 'fa-check' : 'fa-triangle-exclamation'} mr-0.5`}></i>Dinheiro: {bate(dinDiff) ? 'bateu' : `dif. R$ ${Math.abs(dinDiff!).toFixed(2)}`}
                                </span>
                                <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded ${bate(pixDiff) ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                  <i className={`fa-solid ${bate(pixDiff) ? 'fa-check' : 'fa-triangle-exclamation'} mr-0.5`}></i>Pix: {bate(pixDiff) ? 'bateu' : `dif. R$ ${Math.abs(pixDiff!).toFixed(2)}`}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <p className="text-[8px] font-black text-amber-500 uppercase mt-2"><i className="fa-solid fa-hourglass-half mr-1"></i>Caixa nao fechado — use o botao Fechar caixa</p>
                          )}
                          <button onClick={() => setConfDetalhe(aberto ? null : g.entregadorId)} className="w-full mt-2 py-1.5 text-[8px] font-black text-slate-400 uppercase">
                            <i className={`fa-solid ${aberto ? 'fa-chevron-up' : 'fa-chevron-down'} mr-1`}></i>Bater com as entregas ({g.vendas.length})
                          </button>
                          {aberto && (
                            <div className="mt-1 space-y-1">
                              {g.vendas.map((v: any) => (
                                <div key={v.saleId} className="flex items-center justify-between bg-slate-50 rounded-lg px-2.5 py-1.5">
                                  <div className="min-w-0">
                                    <p className="text-[9px] font-black text-slate-600 capitalize truncate">{v.cliente}</p>
                                    <p className="text-[7px] font-bold text-slate-400 uppercase">{v.recebimento}</p>
                                  </div>
                                  <div className="text-right shrink-0 ml-2">
                                    <p className="text-[9px] font-black text-slate-700">{fmt(v.valorPago)}</p>
                                    <p className="text-[7px] font-bold text-slate-400">de {fmt(v.valorTotal)}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {(data.fechamentosHoje || []).filter((f: any) => !data.conferencia!.porEntregador.some((g: any) => g.entregadorId === f.entregador_id)).map((f: any) => (
                      <p key={f.id} className="text-[8px] font-black text-amber-500 uppercase bg-amber-50 rounded-lg px-2.5 py-2">
                        <i className="fa-solid fa-triangle-exclamation mr-1"></i>Fechamento informado (dinheiro {fmt(Number(f.valor_dinheiro))} · pix {fmt(Number(f.valor_pix))}) sem entregas registradas hoje
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== FILA PENDENTE — BLOCO 61: kanban de arrastar-e-soltar ===== */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}>
        <SortableContext items={listaOrdenada.map(p => p.saleId)} strategy={verticalListSortingStrategy}>
          {ordemManualAtiva ? (
            /* ===== BLOCO 31/61: ordem manual — UMA lista unica (a impressao segue esta ordem) ===== */
            <div className="space-y-3">
              <p className="text-[10px] font-black text-slate-700 uppercase px-1 flex items-center gap-1.5">
                <i className="fa-solid fa-hand-pointer"></i>Ordem da rota — arraste pelo número para ordenar
              </p>
              {listaOrdenada.map((p, i) => (
                <SortableCard key={p.saleId} p={p} acento={p.prioridade === 1 ? 'p1' : p.prioridade === 2 ? 'p2' : 'normal'} posicao={i + 1} draggable={modo === 'ADMIN'} />
              ))}
            </div>
          ) : (
            <>
            {modo === 'ADMIN' && fila.length > 1 && (
              <p className="text-[9px] font-bold text-slate-400 uppercase px-1 flex items-center gap-1.5 print:hidden">
                <i className="fa-solid fa-hand-pointer"></i>Dica: arraste um card pelo número para definir a ordem da rota (vale para a impressão).
              </p>
            )}
            {p1.length > 0 && (
            <div className="space-y-3">
              <p className="text-[10px] font-black text-rose-600 uppercase px-1 flex items-center gap-1.5">
                <i className="fa-solid fa-triangle-exclamation"></i>Prioridade 1 — entregar primeiro
              </p>
              {p1.map(p => <SortableCard key={p.saleId} p={p} acento="p1" posicao={listaOrdenada.findIndex(x => x.saleId === p.saleId) + 1} draggable={modo === 'ADMIN'} />)}
            </div>
          )}

          {/* ===== P2 ===== */}
          {p2.length > 0 && (
            <div className="space-y-3">
              <p className="text-[10px] font-black text-amber-600 uppercase px-1 flex items-center gap-1.5">
                <i className="fa-solid fa-bolt"></i>Prioridade 2
              </p>
              {p2.map(p => <SortableCard key={p.saleId} p={p} acento="p2" posicao={listaOrdenada.findIndex(x => x.saleId === p.saleId) + 1} draggable={modo === 'ADMIN'} />)}
            </div>
          )}

          {/* ===== FILA NORMAL (mais antigo primeiro) ===== */}
          {normais.length > 0 && (
            <div className="space-y-3">
              {fila.length > 0 && <p className="text-[10px] font-black text-gray-500 uppercase px-1">Fila — mais antigo primeiro</p>}
              {normais.map(p => <SortableCard key={p.saleId} p={p} acento="normal" posicao={listaOrdenada.findIndex(x => x.saleId === p.saleId) + 1} draggable={modo === 'ADMIN'} />)}
            </div>
          )}
            </>
          )}
        </SortableContext>
      </DndContext>

      {fila.length === 0 && (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-100 print:hidden">
          <i className="fa-solid fa-box-open text-gray-200 text-4xl mb-3 block"></i>
          <p className="text-xs font-black text-gray-700">Fila vazia — tudo entregue!</p>
          <p className="text-[10px] text-gray-400 font-semibold mt-1">Novos pedidos aparecem aqui automaticamente.</p>
        </div>
      )}

      {/* ===== FALHADOS (nunca somem) ===== */}
      {falhados.length > 0 && (
        <div className="space-y-3 print:hidden">
          <p className="text-[10px] font-black text-rose-600 uppercase px-1 flex items-center gap-1.5">
            <i className="fa-solid fa-circle-exclamation"></i>Nao entregues — pendencia aberta
          </p>
          {falhados.map(p => (
            <div key={p.saleId}>
              <Card p={p} acento="falha" />
              <div className="flex gap-2 mt-1.5">
                <button onClick={() => acao({ acao: 'REABRIR', saleId: p.saleId }, 'Pedido voltou para a fila!')} disabled={!!busy}
                  className="flex-1 py-3 rounded-xl bg-gray-800 text-white text-[9px] font-black uppercase active:scale-95 disabled:opacity-60">
                  <i className="fa-solid fa-rotate-left mr-1"></i>Devolver para a fila
                </button>
                {modo === 'ADMIN' && (
                  <button onClick={() => { if (window.confirm(`Cancelar o pedido de ${p.cliente.nome}?\nO pedido sera excluido definitivamente.`)) acao({ acao: 'EXCLUIR_VENDA', saleId: p.saleId }, 'Pedido cancelado.'); }} disabled={!!busy}
                    className="flex-1 py-3 rounded-xl bg-white border border-rose-100 text-rose-500 text-[9px] font-black uppercase active:scale-95 disabled:opacity-60">
                    <i className="fa-solid fa-ban mr-1"></i>Cancelar pedido
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== ENTREGUES HOJE (resumo recolhivel) ===== */}
      {entreguesHoje.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-hidden print:hidden">
          <button onClick={() => setVerEntregues(v => !v)} className="w-full p-4 flex items-center justify-between">
            <p className="text-[10px] font-black text-emerald-700 uppercase"><i className="fa-solid fa-circle-check mr-1.5"></i>Entregues hoje ({entreguesHoje.length})</p>
            <i className={`fa-solid ${verEntregues ? 'fa-chevron-up' : 'fa-chevron-down'} text-gray-300 text-xs`}></i>
          </button>
          {verEntregues && (
            <div className="px-4 pb-4 space-y-2">
              {entreguesHoje.map(p => (
                <div key={p.saleId} className="flex items-center justify-between bg-emerald-50/60 rounded-xl px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black text-gray-700 capitalize truncate">{p.cliente.nome}</p>
                    <p className="text-[8px] font-bold text-gray-400 uppercase">{p.vendedorNome ? `Vendedor: ${p.vendedorNome}` : ''}{p.formaPgto ? ` · ${pgtoMeta(p.formaPgto).label}` : ''}</p>
                  </div>
                  <span className="text-[10px] font-black text-emerald-700 shrink-0 ml-2">{fmt(p.valorTotal)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== SHEET: CONFIRMAR ENTREGA / RECEBIMENTO ===== */}
      {sp && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetEntregue(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center">Aceite da entrega</h3>
            <p className="text-[11px] font-bold text-gray-600 capitalize text-center mt-1">{sp.cliente.nome} · {sp.numero}</p>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-0.5">
              Cliente combinou pagar com <span className="text-gray-700 font-black uppercase">{pgtoMeta(spMetodo).label}</span>
              {sp.condicao === 'APRAZO' ? ' (a prazo)' : ' (à vista)'}
            </p>
            {sp.trocas && (
              <p className="text-[9px] font-black text-orange-600 text-center bg-orange-50 rounded-xl px-3 py-2 mt-2">
                <i className="fa-solid fa-right-left mr-1"></i>Trocas: {sp.trocas}
              </p>
            )}

            {/* --- BLOCO 27: PAGO NA VISITA — só confirma a entrega --- */}
            {spPagoVisita && (
              <div className="mt-4 space-y-3 animate-in fade-in duration-300">
                <div className="bg-emerald-50 rounded-2xl p-4 text-center border border-emerald-100">
                  <i className="fa-solid fa-circle-check text-emerald-500 text-2xl"></i>
                  <p className="text-[10px] font-black text-emerald-700 uppercase mt-1">Cliente já pagou na visita</p>
                  <p className="text-[9px] text-emerald-600/80 font-semibold mt-0.5">O vendedor recebeu direto do cliente — aqui é SÓ ENTREGAR, nada a cobrar.</p>
                </div>
                <button
                  onClick={() => confirmarEntrega(sp, 'JA_PAGO', { foto: fotoEntrega || undefined })}
                  disabled={!!busy}
                  className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
                >
                  <i className="fa-solid fa-check mr-1"></i>Confirmar entrega (já pago)
                </button>
              </div>
            )}

            {/* --- A PRAZO: sem cobranca — vendedor recebe na proxima visita --- */}
            {sp.condicao === 'APRAZO' && !spPagoVisita && (
              <div className="mt-4 space-y-3 animate-in fade-in duration-300">
                <div className="bg-orange-50 rounded-2xl p-4 text-center border border-orange-100">
                  <i className="fa-solid fa-handshake-angle text-orange-500 text-2xl"></i>
                  <p className="text-[10px] font-black text-orange-700 uppercase mt-1">Venda a prazo — NAO cobrar agora</p>
                  <p className="text-[9px] text-orange-600/90 font-semibold mt-0.5 leading-snug">O VENDEDOR recebe na proxima visita. Entregue, anexe a foto e confirme.</p>
                </div>
                <label className="block cursor-pointer">
                  <input
                    type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try { setFotoEntrega(await compressImage(f)); }
                      catch { showToast('Nao foi possivel processar a foto.', 'error'); }
                    }}
                  />
                  <div className="py-3.5 rounded-2xl bg-orange-500 text-white text-[10px] font-black uppercase text-center shadow-md active:scale-95 transition-transform">
                    <i className="fa-solid fa-camera mr-1"></i>{fotoEntrega ? 'Trocar foto' : 'Tirar foto da entrega (obrigatoria)'}
                  </div>
                </label>
                {fotoEntrega && (
                  <div className="relative rounded-2xl overflow-hidden border border-gray-100 animate-in zoom-in-95">
                    <img src={fotoEntrega} alt="Foto da entrega a prazo" className="w-full max-h-56 object-cover" />
                    <span className="absolute top-2 right-2 bg-emerald-500 text-white text-[8px] font-black uppercase px-2 py-1 rounded-md">Foto anexada</span>
                  </div>
                )}
                <button
                  onClick={() => confirmarEntrega(sp, sp.formaPgto === 'BOLETO' ? 'BOLETO' : 'NAO_PAGO', { foto: fotoEntrega })}
                  disabled={!!busy || !fotoEntrega}
                  className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  <i className="fa-solid fa-check mr-1"></i>Entregue (sem cobranca)
                </button>
              </div>
            )}

            {/* --- A VISTA: como o cliente esta pagando AGORA (pode mudar na hora — ex.: metade dinheiro, metade Pix) --- */}
            {sp.condicao !== 'APRAZO' && (spMetodo === 'DINHEIRO' || spMetodo === 'PIX') && !spPagoVisita && (
              <div className="mt-4 space-y-3 animate-in fade-in duration-300">
                <div>
                  <p className="text-[9px] font-black text-gray-400 uppercase text-center mb-2">Como o cliente esta pagando agora?</p>
                  <div className="flex gap-1.5">
                    {(['DINHEIRO', 'PIX', 'MISTO'] as const).map(m => (
                      <button key={m} onClick={() => { setPgtoAgora(m); setQrPix(null); setQrErro(''); }}
                        className={`flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${pgtoAgora === m ? 'bg-gray-800 text-white shadow-md' : 'bg-gray-50 text-gray-400'}`}>
                        {m === 'DINHEIRO' ? 'Dinheiro' : m === 'PIX' ? 'Pix' : 'Misto (2 formas)'}
                      </button>
                    ))}
                  </div>
                </div>
                {pgtoAgora === 'DINHEIRO' && (<>
                <div className="bg-gray-50 rounded-2xl p-4 text-center border border-gray-100">
                  <p className="text-[9px] font-black text-gray-400 uppercase">Valor a receber</p>
                  <p className="text-2xl font-black text-gray-800">{fmt(restante)}</p>
                </div>
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Dinheiro recebido R$ (vazio = total)</label>
                  <input
                    type="number" inputMode="decimal"
                    value={valorRecebido}
                    onChange={e => setValorRecebido(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-xl font-black text-center outline-none focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
                {troco > 0 && (
                  <div className="bg-emerald-50 p-3.5 rounded-2xl border border-emerald-100 text-center animate-in zoom-in-95">
                    <p className="text-[9px] font-black text-emerald-600 uppercase">Troco a devolver</p>
                    <p className="text-xl font-black text-emerald-700">{fmt(troco)}</p>
                  </div>
                )}
                {falta > 0 && (
                  <p className="text-[9px] font-black text-amber-600 text-center uppercase">Faltam {fmt(falta)} — registrar parcial?</p>
                )}
                {/* BLOCO 14: foto opcional da entrega concluída (interruptor do admin) */}
                {melhorias.fotoEntrega && (
                  <div className="space-y-2">
                    <label className="block cursor-pointer">
                      <input
                        type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={async e => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          try { setFotoEntrega(await compressImage(f)); }
                          catch { showToast('Nao foi possivel processar a foto.', 'error'); }
                        }}
                      />
                      <div className="py-3 rounded-2xl bg-gray-50 border border-gray-100 text-gray-500 text-[9px] font-black uppercase text-center active:scale-95 transition-transform">
                        <i className="fa-solid fa-camera mr-1"></i>{fotoEntrega ? 'Trocar foto da entrega' : 'Foto da entrega (opcional)'}
                      </div>
                    </label>
                    {fotoEntrega && (
                      <div className="relative rounded-2xl overflow-hidden border border-gray-100 animate-in zoom-in-95">
                        <img src={fotoEntrega} alt="Foto da entrega" className="w-full max-h-48 object-cover" />
                        <span className="absolute top-2 right-2 bg-emerald-500 text-white text-[8px] font-black uppercase px-2 py-1 rounded-md">Entrega registrada em foto</span>
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => {
                    if (falta > 0) {
                      if (window.confirm(`Registrar pagamento PARCIAL?\n\nRecebeu ${fmt(rec)} de ${fmt(restante)}.\nO restante (${fmt(falta)}) continua em aberto no sistema.`)) {
                        confirmarEntrega(sp, 'DINHEIRO', { valorRecebido: rec, foto: fotoEntrega || undefined });
                      }
                      return;
                    }
                    confirmarEntrega(sp, 'DINHEIRO', { valorRecebido: rec > 0 ? rec : undefined, foto: fotoEntrega || undefined });
                  }}
                  disabled={!!busy}
                  className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
                >
                  <i className="fa-solid fa-check mr-1"></i>
                  {falta > 0 ? `Registrar parcial — recebi ${fmt(rec)}` : `Confirmei que recebi ${fmt(restante)}`}
                </button>
                </>)}

                {pgtoAgora === 'PIX' && (<>
                <div className="bg-teal-50 rounded-2xl p-4 text-center border border-teal-100">
                  <i className="fa-brands fa-pix text-teal-600 text-2xl"></i>
                  <p className="text-[9px] font-black text-teal-700 uppercase mt-1">Pagamento via Pix</p>
                  <p className="text-2xl font-black text-teal-800">{fmt(restante)}</p>
                </div>
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor recebido no Pix (vazio = total)</label>
                  <input
                    type="number" inputMode="decimal"
                    value={valorPix}
                    onChange={e => setValorPix(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-xl font-black text-center outline-none focus:ring-2 focus:ring-teal-100"
                  />
                </div>
                {/* QR CODE DO PIX: cliente escaneia e paga o valor exato (estilo portal) */}
                {qrBloco(parseFloat(valorPix) > 0 ? parseFloat(valorPix) : restante)}
                <label className="block cursor-pointer">
                  <input
                    type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try { setFotoPix(await compressImage(f)); }
                      catch { showToast('Nao foi possivel processar a foto.', 'error'); }
                    }}
                  />
                  <div className="py-3.5 rounded-2xl bg-teal-500 text-white text-[10px] font-black uppercase text-center shadow-md active:scale-95 transition-transform">
                    <i className="fa-solid fa-camera mr-1"></i>{fotoPix ? 'Trocar comprovante' : 'Foto do comprovante Pix (obrigatoria)'}
                  </div>
                </label>
                {fotoPix && (
                  <div className="relative rounded-2xl overflow-hidden border border-gray-100 animate-in zoom-in-95">
                    <img src={fotoPix} alt="Comprovante Pix" className="w-full max-h-56 object-cover" />
                    <span className="absolute top-2 right-2 bg-emerald-500 text-white text-[8px] font-black uppercase px-2 py-1 rounded-md">Comprovante anexado</span>
                  </div>
                )}
                <button
                  onClick={() => {
                    const pv = parseFloat(valorPix) || 0;
                    if (pv > 0 && pv < restante) {
                      if (!window.confirm(`Registrar pagamento PARCIAL?\n\nRecebeu ${fmt(pv)} de ${fmt(restante)}.\nO restante (${fmt(restante - pv)}) continua em aberto.`)) return;
                    }
                    confirmarEntrega(sp, 'PIX', { foto: fotoPix, valorRecebido: pv > 0 ? pv : undefined });
                  }}
                  disabled={!!busy || !fotoPix}
                  className="w-full py-4 bg-teal-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  <i className="fa-solid fa-check mr-1"></i>Recebi — confirmo o Pix
                </button>
                </>)}

                {/* MISTO: duas formas na mesma entrega (ex.: metade dinheiro, metade Pix) */}
                {pgtoAgora === 'MISTO' && (<>
                  <div className="bg-blue-50 rounded-2xl p-4 text-center border border-blue-100">
                    <i className="fa-solid fa-layer-group text-blue-600 text-2xl"></i>
                    <p className="text-[9px] font-black text-blue-700 uppercase mt-1">Pagamento misto — duas formas</p>
                    <p className="text-[10px] font-bold text-blue-600/80">Ex.: metade em dinheiro, metade no Pix</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Dinheiro R$</label>
                      <input type="number" inputMode="decimal" value={valorDinMisto} onChange={e => setValorDinMisto(e.target.value)} placeholder="0.00"
                        className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-lg font-black text-center outline-none focus:ring-2 focus:ring-emerald-100" />
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Pix R$</label>
                      <input type="number" inputMode="decimal" value={valorPixMisto} onChange={e => setValorPixMisto(e.target.value)} placeholder="0.00"
                        className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-lg font-black text-center outline-none focus:ring-2 focus:ring-teal-100" />
                    </div>
                  </div>
                  {somaMisto > 0 && (
                    <div className={`rounded-2xl p-3 border text-center ${somaMisto > restante + 0.005 ? 'bg-rose-50 border-rose-100' : 'bg-gray-50 border-gray-100'}`}>
                      <p className="text-[9px] font-black text-gray-400 uppercase">Total recebendo agora</p>
                      <p className={`text-xl font-black ${somaMisto > restante + 0.005 ? 'text-rose-600' : 'text-gray-800'}`}>{fmt(somaMisto)}</p>
                      {somaMisto <= restante + 0.005 && restante - somaMisto > 0.005 && (
                        <p className="text-[9px] font-black text-amber-600 uppercase mt-0.5">Faltam {fmt(restante - somaMisto)} — continua em aberto (parcial)</p>
                      )}
                    </div>
                  )}
                  {pixMisto > 0 && qrBloco(pixMisto)}
                  <label className="block cursor-pointer">
                    <input
                      type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={async e => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try { setFotoPix(await compressImage(f)); }
                        catch { showToast('Nao foi possivel processar a foto.', 'error'); }
                      }}
                    />
                    <div className="py-3.5 rounded-2xl bg-teal-500 text-white text-[10px] font-black uppercase text-center shadow-md active:scale-95 transition-transform">
                      <i className="fa-solid fa-camera mr-1"></i>{fotoPix ? 'Trocar comprovante' : 'Foto do comprovante Pix (obrigatoria)'}
                    </div>
                  </label>
                  {fotoPix && (
                    <div className="relative rounded-2xl overflow-hidden border border-gray-100 animate-in zoom-in-95">
                      <img src={fotoPix} alt="Comprovante Pix" className="w-full max-h-56 object-cover" />
                      <span className="absolute top-2 right-2 bg-emerald-500 text-white text-[8px] font-black uppercase px-2 py-1 rounded-md">Comprovante anexado</span>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      if (somaMisto <= 0) { showToast('Informe o valor em dinheiro e/ou Pix.', 'error'); return; }
                      if (somaMisto > restante + 0.005) { showToast('A soma passou do valor do pedido.', 'error'); return; }
                      if (pixMisto > 0 && !fotoPix) { showToast('Foto do comprovante Pix obrigatoria.', 'error'); return; }
                      const faltaM = Math.round((restante - somaMisto) * 100) / 100;
                      if (faltaM > 0.005) {
                        if (!window.confirm(`Registrar pagamento PARCIAL?\n\nRecebeu ${fmt(somaMisto)} (dinheiro ${fmt(dinMisto)} + pix ${fmt(pixMisto)}) de ${fmt(restante)}.\nO restante (${fmt(faltaM)}) continua em aberto no sistema.`)) return;
                      }
                      confirmarEntrega(sp, 'MISTO', { valorDinheiro: dinMisto, valorPix: pixMisto, foto: fotoPix || undefined });
                    }}
                    disabled={!!busy}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
                  >
                    <i className="fa-solid fa-check mr-1"></i>
                    {somaMisto > 0 && restante - somaMisto > 0.005 ? `Registrar parcial — recebi ${fmt(somaMisto)}` : `Confirmei — dinheiro ${fmt(dinMisto)} + pix ${fmt(pixMisto)}`}
                  </button>
                </>)}
              </div>
            )}

            {/* --- BOLETO: foto obrigatoria (a prazo usa o painel laranja) --- */}
            {sp.condicao !== 'APRAZO' && spMetodo === 'BOLETO' && !spPagoVisita && (
              <div className="mt-4 space-y-3 animate-in fade-in duration-300">
                <div className="bg-amber-50 rounded-2xl p-4 text-center border border-amber-100">
                  <i className="fa-solid fa-barcode text-amber-600 text-2xl"></i>
                  <p className="text-[9px] font-black text-amber-700 uppercase mt-1">Foto do boleto entregue obrigatoria</p>
                  <p className="text-[9px] text-amber-600/80 font-semibold">O valor entra como pendente ate compensar</p>
                </div>
                <label className="block cursor-pointer">
                  <input
                    type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try { setFotoBoleto(await compressImage(f)); }
                      catch { showToast('Nao foi possivel processar a foto.', 'error'); }
                    }}
                  />
                  <div className="py-3.5 rounded-2xl bg-amber-500 text-white text-[10px] font-black uppercase text-center shadow-md active:scale-95 transition-transform">
                    <i className="fa-solid fa-camera mr-1"></i>{fotoBoleto ? 'Trocar foto' : 'Tirar foto do boleto'}
                  </div>
                </label>
                {fotoBoleto && (
                  <div className="relative rounded-2xl overflow-hidden border border-gray-100 animate-in zoom-in-95">
                    <img src={fotoBoleto} alt="Foto do boleto entregue" className="w-full max-h-56 object-cover" />
                    <span className="absolute top-2 right-2 bg-emerald-500 text-white text-[8px] font-black uppercase px-2 py-1 rounded-md">Foto anexada</span>
                  </div>
                )}
                <button
                  onClick={() => fotoBoleto && confirmarEntrega(sp, 'BOLETO', { foto: fotoBoleto })}
                  disabled={!!busy || !fotoBoleto}
                  className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  <i className="fa-solid fa-check mr-1"></i>Confirmar entrega do boleto
                </button>
              </div>
            )}

            {/* --- alternativas (so a vista) --- */}
            {sp.condicao !== 'APRAZO' && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-[8px] font-black text-gray-300 uppercase text-center mb-2">Pagou de outra forma?</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => confirmarEntrega(sp, 'JA_PAGO', { foto: fotoEntrega || undefined })}
                  className="py-3 rounded-xl bg-blue-50 text-blue-600 text-[9px] font-black uppercase active:scale-95 transition-transform">
                  <i className="fa-solid fa-circle-check mr-1"></i>Ja pagou
                </button>
                <button onClick={() => confirmarEntrega(sp, 'NAO_PAGO', { foto: fotoEntrega || undefined })}
                  className="py-3 rounded-xl bg-amber-50 text-amber-600 text-[9px] font-black uppercase active:scale-95 transition-transform">
                  <i className="fa-solid fa-hand-holding-dollar mr-1"></i>Nao cobrou
                </button>
              </div>
              {melhorias.fotoEntrega && spMetodo !== 'DINHEIRO' && (
                <label className="block cursor-pointer mt-2">
                  <input
                    type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try { setFotoEntrega(await compressImage(f)); }
                      catch { showToast('Nao foi possivel processar a foto.', 'error'); }
                    }}
                  />
                  <div className="py-2.5 rounded-xl bg-gray-50 border border-gray-100 text-gray-400 text-[8px] font-black uppercase text-center active:scale-95 transition-transform">
                    <i className="fa-solid fa-camera mr-1"></i>{fotoEntrega ? 'Foto da entrega anexada ✓' : 'Foto da entrega (opcional)'}
                  </div>
                </label>
              )}
            </div>
            )}

            <button onClick={() => setSheetEntregue(null)} className="w-full mt-3 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest print:hidden">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== SHEET: NAO ENTREGUE ===== */}
      {sheetFalhou && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetFalhou(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center">Nao entregue</h3>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-1 capitalize">{sheetFalhou.cliente.nome}</p>
            <p className="text-[9px] text-gray-400 font-bold text-center mt-0.5 uppercase">O pedido fica como pendencia ate ser resolvido</p>
            <div className="space-y-2 mt-5">
              {MOTIVOS_FALHA.map(m => (
                <button key={m} onClick={() => setMotivoSel(m)}
                  className={`w-full py-3.5 px-4 rounded-xl text-left text-[11px] font-bold transition-all ${motivoSel === m ? 'bg-rose-600 text-white shadow-md' : 'bg-gray-50 text-gray-600'}`}>
                  {m === 'Outro motivo' ? '• Outro motivo' : `• ${m}`}
                </button>
              ))}
              {motivoSel === 'Outro motivo' && (
                <input value={motivoOutro} onChange={e => setMotivoOutro(e.target.value)} placeholder="Descreva o motivo..."
                  className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-rose-100" />
              )}
            </div>
            <button
              onClick={() => {
                const p = sheetFalhou;
                const motivo = motivoSel === 'Outro motivo' ? (motivoOutro.trim() || 'Outro motivo') : motivoSel;
                setSheetFalhou(null);
                acao({ acao: 'FALHOU', saleId: p.saleId, motivo }, 'Registrado como nao entregue.');
              }}
              disabled={!!busy}
              className="w-full mt-4 py-4 bg-rose-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              Confirmar nao entrega
            </button>
            <button onClick={() => setSheetFalhou(null)} className="w-full mt-2 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== SHEET: FECHAR CAIXA ===== */}
      {/* ===== SHEET: EDITAR TROCAS (BLOCO 14 — admin ajusta o que sai no cupom) ===== */}
      {sheetTrocas && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetTrocas(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center"><i className="fa-solid fa-right-left text-orange-500 mr-1"></i>Trocas do pedido</h3>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-1 capitalize">{sheetTrocas.p.cliente.nome}</p>
            <p className="text-[9px] text-gray-400 font-bold text-center mt-0.5">Ajuste o que sai no cupom — ex.: item em falta trocado por outro do mesmo valor</p>
            <textarea
              value={sheetTrocas.texto}
              onChange={e => setSheetTrocas({ ...sheetTrocas, texto: e.target.value })}
              rows={3} maxLength={500}
              placeholder="Ex.: 1 Lays sour cream 62g"
              className="w-full mt-3 p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-orange-100 resize-none"
            />
            <button
              onClick={async () => { const t = sheetTrocas; setSheetTrocas(null); await acao({ acao: 'EDITAR_TROCAS', saleId: t.p.saleId, trocas: t.texto }, 'Trocas atualizadas! O cupom sai corrigido.'); }}
              disabled={!!busy}
              className="w-full mt-3 py-4 bg-orange-500 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              <i className="fa-solid fa-check mr-1"></i>Salvar trocas
            </button>
            <button onClick={() => setSheetTrocas(null)} className="w-full mt-2 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== SHEET: FECHAR CAIXA (BLOCO 33 — SOMENTE O ADMIN) ===== */}
      {sheetCaixa && modo === 'ADMIN' && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetCaixa(false)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center"><i className="fa-solid fa-cash-register text-emerald-600 mr-1"></i>Fechamento de caixa</h3>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-1">Conte o dinheiro em especie e feche — a conta recomeca do zero</p>
            {(data?.conferencia?.porEntregador || []).length > 1 && (
              <div className="mt-3">
                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Entregador do caixa</label>
                <div className="flex gap-1.5 flex-wrap mt-1">
                  {(data?.conferencia?.porEntregador || []).map((g: any) => (
                    <button key={g.entregadorId} onClick={() => trocarEntCaixa(g.entregadorId)}
                      className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase border-2 transition-colors ${caixaEntId === g.entregadorId ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-100 text-gray-500'}`}>
                      {g.nome || 'Entregador'} ({g.qtdEntregas})
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(data?.conferencia?.porEntregador || []).length === 1 && (
              <p className="text-[9px] font-black text-emerald-600 uppercase text-center mt-2">
                <i className="fa-solid fa-motorcycle mr-1"></i>{(data!.conferencia!.porEntregador[0] as any).nome || 'Entregador'}
              </p>
            )}
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center mt-4">
              <p className="text-[9px] font-black text-emerald-500 uppercase">Dinheiro em espécie em aberto (estimado)</p>
              <p className="text-[8px] font-bold text-emerald-400 uppercase">{desdeCaixaOk ? `desde ${desdeCaixa!.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${desdeCaixa!.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'sem fechamento anterior'}</p>
              <p className="text-2xl font-black text-emerald-700">{fmt(caixaEst.dinheiroHoje)}</p>
              <p className="text-[9px] font-bold text-teal-600 uppercase mt-1">Pix em aberto: {fmt(caixaEst.pixHoje)} (nao vem em especie)</p>
              {prazoEntregueHoje > 0 && (
                <p className="text-[9px] font-black text-orange-500 uppercase mt-2 leading-snug">A prazo entregue hoje: {fmt(prazoEntregueHoje)} — NAO entra aqui (vendedor recebe depois)</p>
              )}
            </div>
            <div className="mt-4">
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Dinheiro em especie R$</label>
              <input type="number" inputMode="decimal" value={caixaDinheiro} onChange={e => setCaixaDinheiro(e.target.value)} placeholder="0.00"
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-2xl font-black text-center outline-none focus:ring-2 focus:ring-emerald-100" />
            </div>
            <div className="mt-3">
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Observacao (opcional)</label>
              <input value={caixaObs} onChange={e => setCaixaObs(e.target.value)} placeholder="Ex.: faltou R$ 10 de troco"
                className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-bold outline-none" />
            </div>
            <button onClick={fecharCaixa} disabled={!!busy}
              className="w-full mt-4 py-4 bg-slate-800 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60">
              <i className="fa-solid fa-check mr-1"></i>Fechar caixa (a conta recomeca do zero)
            </button>
            <button onClick={() => setSheetCaixa(false)} className="w-full mt-2 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== BLOCO 60 (regra do dono): GIF de processamento enquanto a
          entrega esta sendo confirmada — a tela inteira mostra "NAO FECHE A
          TELA" (mesmo padrao do wizard do pedido). Evita o entregador sair
          ou clicar de novo achando que travou (o GPS pode esperar alguns
          segundos e a gravacao tbm). ===== */}
      {confirmandoEntrega && (
        <div className="fixed inset-0 z-[250] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 print:hidden" role="alert" aria-live="assertive">
          <div className="bg-white w-full max-w-xs rounded-3xl shadow-2xl p-8 text-center animate-in zoom-in-95 duration-200">
            <div className="relative w-24 h-24 mx-auto mb-5">
              <i className="fa-solid fa-spinner fa-spin text-[64px] text-emerald-500 leading-none"></i>
              <i className="fa-solid fa-truck-fast text-lg text-emerald-400 absolute inset-0 flex items-center justify-center animate-pulse"></i>
            </div>
            <h3 className="text-base font-black text-gray-800 uppercase tracking-widest animate-pulse">
              <i className="fa-solid fa-hand mr-1.5 text-emerald-600"></i>Não feche a tela
            </h3>
            <p className="text-[10px] font-bold text-gray-500 mt-2 leading-snug">Confirmando a entrega no sistema...</p>
            <p className="text-[9px] font-bold text-gray-400 mt-3 leading-snug">Pode demorar alguns segundos. Aguarde a confirmação — sair agora pode perder o registro.</p>
          </div>
        </div>
      )}

      {/* ===== MODAL: CUPOM IDENTICO ===== */}
      {cupom && (
        <Cupom
          sale={saleOf(cupom)}
          client={clientOf(cupom)}
          products={productsOf(cupom)}
          onClose={() => setCupom(null)}
          closeLabel="FECHAR"
          showToast={showToast}
        />
      )}

      {/* ===== BLOCO 31: MODAL EDITAR PEDIDO (admin, antes da entrega) ===== */}
      {editPedido && (
        <EditorPedido
          pedido={editPedido}
          onClose={() => setEditPedido(null)}
          onSalvo={(msg) => { setEditPedido(null); showToast(msg, 'success'); load(true); }}
          showToast={showToast}
        />
      )}

      {/* ===== LISTA IMPRIMIVEL (ordem de entrega) ===== */}
      {mostrarLista && data && (
        <div className="fixed inset-0 bg-white z-[400] p-8 overflow-auto print:static print:overflow-visible">
          <style>{`@media print { body * { visibility: hidden; } .lista-print, .lista-print * { visibility: visible; } .lista-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
          <div className="lista-print max-w-xl mx-auto">
            <h1 className="text-lg font-black text-center uppercase">Doce Mania — Ordem de Entrega</h1>
            <p className="text-[10px] text-center text-gray-500 mb-4">{new Date().toLocaleDateString('pt-BR')} {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {listaImprimir.length === 1 ? '1 pedido carregado' : `${listaImprimir.length} pedidos carregados`} · {fmt(totalImprimir)}</p>
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-b-2 border-black">
                  <th className="text-left py-1 w-8">#</th>
                  <th className="text-left py-1">Cliente</th>
                  <th className="text-left py-1">Endereço</th>
                  <th className="text-right py-1 w-20">Valor</th>
                  <th className="text-center py-1 w-16">Pgto</th>
                </tr>
              </thead>
              <tbody>
                {listaImprimir.map((p, i) => (
                  <tr key={p.saleId} className="border-b border-gray-300">
                    <td className="py-1.5 font-black">{i + 1}</td>
                    <td className="py-1.5 font-bold">{p.prioridade === 1 ? 'P1 ' : p.prioridade === 2 ? 'P2 ' : ''}{p.cliente.nome}</td>
                    {/* BLOCO 64: endereco completo — rua + numero/sala + bairro */}
                    <td className="py-1.5 text-gray-600">{p.cliente.endereco}{p.cliente.numero ? `, ${p.cliente.numero}` : ''}{p.cliente.bairro ? ` — ${p.cliente.bairro}` : ''}</td>
                    <td className="py-1.5 text-right font-bold">{fmt(p.valorTotal)}</td>
                    <td className="py-1.5 text-center uppercase text-[9px] font-black">{p.formaPgto}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[9px] text-gray-400 text-center mt-4">{ordemManualAtiva ? 'Ordem definida pelo admin (arrastar-e-soltar na fila).' : 'Regra: P1 primeiro, depois P2, depois mais antigo.'} Assinatura do entregador: ____________________</p>
          </div>
          <div className="max-w-xl mx-auto mt-4 print:hidden">
            <button onClick={() => setMostrarLista(false)} className="w-full bg-slate-800 text-white font-black py-3 rounded-2xl uppercase text-[10px]">Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilaEntregas;
