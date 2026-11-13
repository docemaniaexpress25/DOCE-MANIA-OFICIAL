"use client";
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { User, Product, MelhoriasFlags, MELHORIAS_DEFAULT } from '@/lib/types';
import { authHeaders } from '@/services/userService';
import Cupom from '@/components/doce/Cupom';
import EditorPedido from '@/components/doce/EditorPedido';
import TrocasBox from '@/components/doce/TrocasBox';
// BLOCO 109: fiscal na fila de entregas — o ADMIN emite a nota com 1 clique
// direto no card (regra do dono: na pre-venda quem emite e o admin), imprime
// o DANFE simplificado na termica 80mm ou abre o PDF A4 (DANFE oficial Focus).
import { notaService } from '@/services/notaService';
import { danfeMiniTexto } from '@/lib/danfeTexto';
import { bluetoothPrinter } from '@/services/bluetoothPrinterService';
// BLOCO 111: impressão térmica USB do PC — canal BT x USB persistente por dispositivo
import { imprimirViaUsb, lerCanalImpressao, dispositivoIOS } from '@/lib/usbPrint';
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
 * Quem entrega: o ENTREGADOR (e o admin) — e, desde o Bloco 98, o PROPRIO
 * vendedor pode entregar a venda DELE pelo menu Entregas (nesse caso ganha
 * a comissão de PRONTA ENTREGA). Venda alheia: vendedor não entrega.
 * BLOCO 99 (regra do dono): venda CARREGADA e ALOCADA a um entregador fica
 * EXCLUSIVA dele — nem o vendedor que vendeu entrega por conta propria; so
 * volta a poder se o ADMIN DESALOCAR (quem define e o admin, botao no sheet
 * de carga). Cada entregador tem o SEU caixa: Dinheiro / Pix / A receber.
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
  // BLOCO 96: entregador ATRIBUIDO a venda (escolhido no check de carga) —
  // cada entregador tem o SEU caixa e ve so a propria carga
  entregadorId?: string | null;
  entregadorNome?: string | null;
  // BLOCO 119.2 (fix do entregador): VERDADE DO SERVIDOR — esta carga pode ser
  // recebida por mim? O servidor resolve o uuid do login fixo ENTREGADOR
  // (sessao id "ENTREGADOR" e nunca-uuid) e compara com sales.entregador_id.
  // undefined = admin (pode receber tudo) / legado (fallback no cliente).
  minhaCarga?: boolean;
  // BLOCO 98: valor das trocas em R$ PRECO DE CUSTO (entrega devolve produtos que fechem esse valor)
  trocasValor?: number | null;
  // BLOCO 109: situacao fiscal da venda (badge NF + emitir 1 clique no card)
  notaStatus?: string | null;
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
  // BLOCO 99: com o A RECEBER (saldo a prazo/parcial das entregas dele)
  // BLOCO 100: qtdEntregas do ENTREGADOR logado (o caixa e DELE)
  caixa?: { dinheiroHoje: number; pixHoje: number; aReceber?: number; desde?: string | null; qtdEntregas?: number };
  meuFechamento?: { id: string; valor_dinheiro: number; valor_pix: number; qtd_entregas: number; confirmado: boolean; obs: string | null } | null;
  fechamentosHoje?: any[];
  conferencia?: { porEntregador: { entregadorId: string; nome: string; dinheiro: number; pix: number; qtdEntregas: number; vendas: { saleId: string; cliente: string; valorTotal: number; valorPago: number; recebimento: string }[] }[] };
  // BLOCO 96/97: entregadores ativos (seletor da carga — agora sao os
  // VENDEDORES nomeados, sem criar usuario de entregador) + CAIXA SEPARADO
  entregadores?: { id: string; nome: string; perfil?: string }[];
  caixasPorEntregador?: CaixaEnt[];
  migracaoPendente?: boolean;
  error?: string;
}

// BLOCO 96: caixa EM ABERTO de um entregador (desde o fechamento DELE)
// BLOCO 99: com A RECEBER (o que o cliente ainda deve das entregas dele)
interface CaixaEnt {
  entregadorId: string;
  nome: string;
  dinheiro: number;
  pix: number;
  aReceber: number;
  desde: string | null;
  qtdEntregas: number;
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

// ============================================================================
// BLOCO 109 (regra do dono): FISCAL DO ADMIN NA FILA DE ENTREGAS
// "o vendedor so define a venda e o que vai ser vendido... quem gera a nota
// com 1 clique e o admin na fila de entregas" + "liberdade de imprimir NF-e
// NFC em 80mm ou A4". Acoes por card, SEM abrir outra tela:
//   [Emitir NF]  1 clique -> /api/notas (CNPJ do cliente -> NF-e 55; sem doc
//                -> NFC-e 65 de consumidor)
//   EMITINDO  -> badge ambar + [Consultar] (sincroniza com a SEFAZ)
//   AUTORIZADA -> badge verde + [80mm] (DANFE simplificado na termica)
//                + [PDF A4] (DANFE oficial da Focus em nova aba)
//   REJEITADA -> badge vermelho + [Tentar de novo] (reemissao -r2/-r3)
// VENDEDOR/ENTREGADOR: nada fiscal aqui (so o admin mexe na nota da pre-venda).
// ============================================================================
interface NotaLocal { status: string; numero?: string; pdfUrl?: string; chave?: string; erro?: string }
const AcaoFiscalAdmin: React.FC<{ p: FilaItem; showToast: (m: string, t?: 'success' | 'error') => void }> = ({ p, showToast }) => {
  const [nota, setNota] = useState<NotaLocal>({ status: (p.notaStatus || 'NAO_EMITIDA').toUpperCase() });
  const [busy, setBusy] = useState(false);

  const emitir = async () => {
    if (busy) return;
    setBusy(true);
    const r = await notaService.emitir(p.saleId);
    setBusy(false);
    if (r.nota) setNota({ status: r.nota.status, numero: r.nota.numero, pdfUrl: r.nota.pdfUrl, chave: r.nota.chave, erro: r.nota.erro });
    if (r.nota?.status === 'AUTORIZADA') showToast(`NF autorizada! ${r.nota.numero || ''}`, 'success');
    else if (r.nota?.status === 'REJEITADA') showToast(r.nota.erro || 'Nota rejeitada pela SEFAZ', 'error');
    else if (r.erro && !r.nota) showToast(r.erro, 'error');
    else if (r.nota?.status === 'EMITINDO') showToast('Nota na SEFAZ — consulte em alguns segundos.', 'success');
  };

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    const r = await notaService.consultar(p.saleId);
    setBusy(false);
    if (r.nota) setNota({ status: r.nota.status, numero: r.nota.numero, pdfUrl: r.nota.pdfUrl, chave: r.nota.chave, erro: r.nota.erro });
    if (r.nota?.status === 'AUTORIZADA') showToast('Nota autorizada!', 'success');
    else if (r.erro && !r.nota) showToast(r.erro, 'error');
    else showToast('Sem novidade na SEFAZ.', 'success');
  };

  // DANFE 80mm: consulta a nota (chave/emitente) e imprime o simplificado
  // na termica — mesmo layout do botao do Cupom (Bloco 82).
  const imprimir80 = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let d: NotaLocal & { serie?: string; protocolo?: string; dataAutorizacao?: string; qrCode?: string; emitente?: any } = { ...nota };
      if (!d.chave) {
        const r = await notaService.consultar(p.saleId);
        if (r.ok && r.nota) {
          d = { ...d, ...r.nota };
          setNota({ status: r.nota.status, numero: r.nota.numero, pdfUrl: r.nota.pdfUrl, chave: r.nota.chave, erro: r.nota.erro });
        }
      }
      if (!d.chave) { showToast('Nota sem chave de acesso — consulte a SEFAZ e tente de novo.', 'error'); setBusy(false); return; }
      const texto = danfeMiniTexto({
        chave: d.chave,
        numero: d.numero || '',
        serie: d.serie || '',
        protocolo: d.protocolo || '',
        dataAutorizacao: d.dataAutorizacao || '',
        emitente: d.emitente,
        qrCode: d.qrCode || '',
        dataVenda: p.dataVenda,
        cliente: { nome: p.cliente.nome, doc: p.cliente.cnpj || '' },
        itens: p.itens.map(i => ({ descricao: i.nome, quantidade: i.quantidade, valorUnitario: i.precoVenda })),
        valorTotal: p.valorTotal,
        metodoPagamento: p.metodoPagamento || undefined,
        detalhePagamento: p.detalhePagamento || undefined,
        statusPagamento: p.statusPagamento,
        dataVencimento: p.dataVencimento || undefined,
        entregaStatus: p.entregaStatus,
        tipoVenda: 'PRE_VENDA',
      });
      showToast('Enviando DANFE à impressora...', 'success');
      // BLOCO 111: canal USB do PC — DANFE sai pela janela de impressão
      if (lerCanalImpressao() === 'USB') {
        imprimirViaUsb(texto, '80MM', (m) => {
          showToast(`Erro na impressão do DANFE: ${m}`, 'error');
        });
        showToast('DANFE na janela de impressão — escolha a térmica USB do PC.', 'success');
        setBusy(false);
        return;
      }
      const ok = await bluetoothPrinter.print(texto, '80MM', { skipConfirm: true });
      if (ok) showToast('DANFE enviado à impressora!', 'success');
      else showToast('Impressão não realizada — conecte a impressora.', 'error');
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg === 'BLUETOOTH_NAO_SUPORTADO') showToast('Bluetooth não disponível neste aparelho (use o Chrome do Android).', 'error');
      else showToast(`Erro na impressão do DANFE: ${msg}`, 'error');
    }
    setBusy(false);
  };

  const abrirPdf = async () => {
    if (busy) return;
    if (nota.pdfUrl) { window.open(nota.pdfUrl, '_blank', 'noopener'); return; }
    setBusy(true);
    const r = await notaService.consultar(p.saleId);
    setBusy(false);
    if (r.nota) setNota({ status: r.nota.status, numero: r.nota.numero, pdfUrl: r.nota.pdfUrl, chave: r.nota.chave, erro: r.nota.erro });
    if (r.nota?.pdfUrl) window.open(r.nota.pdfUrl, '_blank', 'noopener');
    else showToast('PDF do DANFE ainda não disponível na SEFAZ.', 'error');
  };

  const st = nota.status;
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-50" data-bloco="109-fiscal">
      {st === 'AUTORIZADA' && (
        <>
          <span className="text-[8px] font-black uppercase px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 shrink-0" title="Nota autorizada na SEFAZ"><i className="fa-solid fa-circle-check mr-1"></i>NF {nota.numero || 'OK'}</span>
          <button onClick={imprimir80} disabled={busy} title="DANFE simplificado na térmica 80mm"
            className="flex-1 min-w-[64px] py-2.5 rounded-xl bg-blue-50 text-blue-600 text-[9px] font-black uppercase text-center active:scale-95 transition-transform disabled:opacity-60">
            <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-print'} mr-1`}></i>80mm
          </button>
          <button onClick={abrirPdf} disabled={busy} title="DANFE oficial (PDF A4) da Focus — nova aba"
            className="flex-1 min-w-[64px] py-2.5 rounded-xl bg-rose-50 text-rose-600 text-[9px] font-black uppercase text-center active:scale-95 transition-transform disabled:opacity-60">
            <i className="fa-solid fa-file-pdf mr-1"></i>A4/PDF
          </button>
        </>
      )}
      {st === 'EMITINDO' && (
        <>
          <span className="text-[8px] font-black uppercase px-2 py-1 rounded-md bg-amber-50 text-amber-700 shrink-0"><i className="fa-solid fa-hourglass-half mr-1"></i>Processando na SEFAZ</span>
          <button onClick={consultar} disabled={busy} className="flex-1 min-w-[64px] py-2.5 rounded-xl bg-amber-500 text-white text-[9px] font-black uppercase text-center active:scale-95 transition-transform disabled:opacity-60">
            <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'} mr-1`}></i>Consultar
          </button>
        </>
      )}
      {st === 'REJEITADA' && (
        <>
          <span className="text-[8px] font-black uppercase px-2 py-1 rounded-md bg-rose-100 text-rose-700 shrink-0" title={nota.erro || 'Rejeitada'}><i className="fa-solid fa-circle-xmark mr-1"></i>Rejeitada</span>
          <button onClick={emitir} disabled={busy} className="flex-1 min-w-[64px] py-2.5 rounded-xl bg-slate-800 text-white text-[9px] font-black uppercase text-center active:scale-95 transition-transform disabled:opacity-60">
            <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-file-invoice-dollar'} mr-1`}></i>Tentar de novo
          </button>
        </>
      )}
      {(st === 'NAO_EMITIDA' || st === 'CANCELADA' || !st) && (
        <button onClick={emitir} disabled={busy} title="Emite agora: cliente com CNPJ -> NF-e; sem documento -> NFC-e de consumidor"
          className="flex-1 min-w-[96px] py-2.5 rounded-xl bg-slate-100 text-slate-700 text-[9px] font-black uppercase text-center active:scale-95 transition-transform disabled:opacity-60 hover:bg-slate-200">
          <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-file-invoice-dollar'} mr-1`}></i>Emitir NF
        </button>
      )}
    </div>
  );
};

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
  const [sheetTrocas, setSheetTrocas] = useState<{ p: FilaItem; texto: string; valor: string } | null>(null);
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
  // BLOCO 96 (regra do dono): FILTRO POR VENDEDOR acima da fila — clicou no
  // vendedor, aparecem so as entregas dele (pronta entrega e pre-venda).
  const [filtroVendedor, setFiltroVendedor] = useState<string>('TODOS');
  // BLOCO 119 (regra do dono — CONFERENCIA DE ENTREGAS E VALORES): a fila
  // inteira aparece para vendedor/entregador, mas o RECEBIMENTO e so de quem
  // tem a CARGA NO SEU NOME (check de carga feito pelo secretario/admin).
  // O toggle "SÓ MINHA CARGA" esconde as entregas dos outros (default: TODAS,
  // para a conferencia pedir por ele).
  // BLOCO 96 (regra do dono): check de carga com ESCOLHA DO ENTREGADOR — antes
  // de o entregador carregar, seleciona quem e o entregador daquela venda/cliente.
  const [sheetCarga, setSheetCarga] = useState<FilaItem | null>(null);
  const [cargaEntId, setCargaEntId] = useState('');
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

  const podeEntregar = modo === 'ENTREGADOR' || modo === 'ADMIN' || modo === 'VENDEDOR'; // Bloco 98: o vendedor entrega a PROPIA venda (fila dele = vendas dele)
  const podePrioridade = modo === 'ENTREGADOR' || modo === 'ADMIN';

  // ===== BLOCO 96: filtro por vendedor (chips acima da fila — modo ADMIN) =====
  const vendedorDe = (p: FilaItem) => p.vendedorId || 'SEM_VEND';
  // ===== BLOCO 119: MINHA CARGA — a entrega pertence a mim quando:
  // - foi CARREGADA no meu nome (check de carga = entregador_id == eu), ou
  // - e venda minha e ninguem mais foi atribuido (carga propria do vendedor).
  // BLOCO 119.2 (fix do entregador): a verdade vem do SERVIDOR (p.minhaCarga) —
  // o login fixo ENTREGADOR tem id "ENTREGADOR" (string) e a carga gravada e
  // UUID; comparar aqui no cliente NUNCA bate e o botao de receber somia.
  // Fallback client-side so para resposta antiga em cache/legado.
  const ehMinhaCarga = (p: FilaItem): boolean =>
    p.minhaCarga !== undefined
      ? p.minhaCarga
      : (!!p.entregadorId ? p.entregadorId === user.id : p.vendedorId === user.id);
  // BLOCO 119: quem pode RECEBER (aparece o botao ENTREGUE): admin sempre;
  // vendedor/entregador so a carga no nome DELE. As outras: visiveis para
  // conferencia, SEM chance de receber (banner com o dono do dinheiro).
  const podeReceberEntrega = (p: FilaItem): boolean =>
    modo === 'ADMIN' || (podeEntregar && ehMinhaCarga(p));
  // ===== BLOCO 119: toggle "SÓ MINHA CARGA" (vendedor/entregador)
  const [soMinhaCarga, setSoMinhaCarga] = useState(false);
  // ===== BLOCO 119.1 (pedido do dono): as DUAS LISTAS da fila, JÁ SEPARADAS —
  // SUAS entregas (carregadas NO SEU NOME pelo admin/secretario no check de
  // carga — ou venda própria sua) e as DOS OUTROS (somente conferência,
  // agrupadas por dono da carga: "Carga de X"). O RECEBIMENTO das outras
  // fica bloqueado no card E no servidor (403 com o nome do dono).
  const minhasNaFila = useMemo(() =>
    (data?.fila || []).filter(p => ehMinhaCarga(p)),
  [data, user.id]);
  const outrasNaFila = useMemo(() =>
    (data?.fila || []).filter(p => !ehMinhaCarga(p)),
  [data, user.id]);
  const outrosAgrupados = useMemo(() => {
    const map = new Map<string, { key: string; nome: string; itens: FilaItem[]; total: number }>();
    for (const p of outrasNaFila) {
      const key = p.entregadorId ? `E:${p.entregadorId}` : `V:${p.vendedorId || 'SEM_VEND'}`;
      const g = map.get(key) || { key, nome: p.entregadorId ? (p.entregadorNome || 'entregador') : (p.vendedorNome || 'vendedor'), itens: [] as FilaItem[], total: 0 };
      g.itens.push(p);
      g.total = Math.round((g.total + p.valorTotal) * 100) / 100;
      map.set(key, g);
    }
    return [...map.values()];
  }, [outrasNaFila]);
  const vendedoresDaFila = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; count: number }>();
    for (const p of (data?.fila || [])) {
      const id = vendedorDe(p);
      const g = map.get(id) || { id, nome: p.vendedorNome || 'Sem vendedor', count: 0 };
      g.count += 1;
      map.set(id, g);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.nome.localeCompare(b.nome));
  }, [data]);
  const nomeFiltroAtivo = filtroVendedor === 'TODOS' ? '' : (vendedoresDaFila.find(v => v.id === filtroVendedor)?.nome || '');
  // BLOCO 119: filtro base — TODAS (conferencia) ou SÓ MINHA CARGA (trabalho do dia)
  const filtroMinhaCarga = (lista: FilaItem[]): FilaItem[] =>
    soMinhaCarga ? lista.filter(ehMinhaCarga) : lista;
  const filaVisivel = useMemo(() => {
    const f = data?.fila || [];
    if (filtroVendedor === 'TODOS') return filtroMinhaCarga(f);
    return f.filter(p => vendedorDe(p) === filtroVendedor);
  }, [data, filtroVendedor, soMinhaCarga]);
  const falhadosVisivel = useMemo(() => {
    const f = data?.falhados || [];
    if (filtroVendedor === 'TODOS') return filtroMinhaCarga(f);
    return f.filter(p => vendedorDe(p) === filtroVendedor);
  }, [data, filtroVendedor, soMinhaCarga]);
  const entreguesVisivel = useMemo(() => {
    const f = data?.entreguesHoje || [];
    if (filtroVendedor === 'TODOS') return filtroMinhaCarga(f);
    return f.filter(p => vendedorDe(p) === filtroVendedor);
  }, [data, filtroVendedor, soMinhaCarga]);

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
  // BLOCO 61/96: lista ordenada usa a fila FILTRADA pelo vendedor (o kanban,
  // a impressao e a gravacao da ordem seguem sempre a mesma lista).
  const listaOrdenada = useMemo(() => {
    const f = filaVisivel;
    const temManual = f.some(p => typeof p.ordemEntrega === 'number' && p.ordemEntrega > 0);
    if (temManual) return [...f].sort(compararOrdemEntrega);
    return [...f.filter(p => p.prioridade === 1), ...f.filter(p => p.prioridade === 2), ...f.filter(p => p.prioridade === 0 || p.prioridade == null)];
  }, [filaVisivel]);
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
    // BLOCO 109: situacao fiscal real da venda — o Cupom abre com o status
    // certo da nota (AUTORIZADA/REJEITADA/...) sem precisar consultar antes.
    notaStatus: p.notaStatus || undefined,
    tipoVenda: 'PRE_VENDA',
    entregaStatus: p.entregaStatus,
    statusPagamento: p.statusPagamento,
    itens: p.itens.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade, precoVenda: i.precoVenda })),
    dataVencimento: p.dataVencimento ? new Date(p.dataVencimento) : undefined,
    trocas: p.trocas || undefined,
    trocasValor: p.trocasValor ?? undefined,
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
    // BLOCO 120 (iPhone): print() depois de setTimeout perde o gesto e o iOS
    // IGNORA a chamada (folha nunca abre). No iPhone a folha fica na tela com
    // o botao "IMPRIMIR AGORA" — toque direto = gesto garantido. Nos outros
    // aparelhos mantem a impressao automatica de sempre.
    if (dispositivoIOS()) return;
    setTimeout(() => { window.print(); setMostrarLista(false); }, 150);
  }

  // BLOCO 33: caixa e fechado pelo ADMIN — abre o sheet pre-preenchido com o
  // dinheiro estimado do entregador selecionado. BLOCO 96: com o caixa
  // SEPARADO por entregador, o pre-preenchimento usa o caixa EM ABERTO DELE.
  function abrirCaixaAdmin() {
    const caixas = data?.caixasPorEntregador || [];
    if (caixas.length > 0) {
      abrirCaixaEntregador(caixas[0]);
      return;
    }
    const grupos = data?.conferencia?.porEntregador || [];
    if (grupos.length === 0) { showToast('Nenhuma entrega hoje — nada para fechar no caixa.', 'error'); return; }
    const primeiro = grupos[0];
    setCaixaEntId(primeiro.entregadorId);
    setCaixaDinheiro(primeiro.dinheiro ? String(Number(primeiro.dinheiro).toFixed(2)) : '');
    setSheetCaixa(true);
  }

  // BLOCO 96: abre o fechamento do caixa DE UM entregador especifico, ja
  // pre-preenchido com o dinheiro em especie EM ABERTO DELE (desde o fechamento dele).
  function abrirCaixaEntregador(g: CaixaEnt) {
    setCaixaEntId(g.entregadorId);
    setCaixaDinheiro(g.dinheiro ? String(Number(g.dinheiro).toFixed(2)) : '');
    setSheetCaixa(true);
  }

  function trocarEntCaixa(id: string) {
    setCaixaEntId(id);
    const g = (data?.caixasPorEntregador || []).find(x => x.entregadorId === id);
    if (g) { setCaixaDinheiro(g.dinheiro ? String(Number(g.dinheiro).toFixed(2)) : ''); return; }
    const gc = (data?.conferencia?.porEntregador || []).find((x: any) => x.entregadorId === id);
    setCaixaDinheiro(gc && gc.dinheiro ? String(Number(gc.dinheiro).toFixed(2)) : '');
  }

  async function fecharCaixa() {
    const v = parseFloat(caixaDinheiro) || 0;
    if (v < 0) { showToast('Valor invalido.', 'error'); return; }
    // BLOCO 96: pix e qtd de entregas do CAIXA DO ENTREGADOR selecionado
    const gSel = (data?.caixasPorEntregador || []).find(x => x.entregadorId === caixaEntId);
    const pixAberto = gSel ? gSel.pix : (data?.caixa?.pixHoje || 0);
    const qtdSel = gSel ? gSel.qtdEntregas : (data?.resumo?.entreguesHoje || 0);
    const nomeSel = gSel?.nome || 'Entregador';
    const ok = await acao({ acao: 'FECHAR_CAIXA', entregadorId: caixaEntId, valorDinheiro: v, valorPix: pixAberto, qtdEntregas: qtdSel, obs: caixaObs }, `Caixa de ${nomeSel} fechado — a conta DELE recomeca!`);
    if (ok) { setSheetCaixa(false); setCaixaDinheiro(''); setCaixaObs(''); setCaixaEntId(''); }
  }

  // ===== BLOCO 96 (regra do dono): CARGA COM ENTREGADOR — o admin clica em
  // Carregar, escolhe QUEM e o entregador daquela venda/cliente e confirma.
  // Ja carregado: o mesmo sheet troca o entregador ou remove do veiculo.
  function abrirSheetCarga(p: FilaItem) {
    setCargaEntId(p.entregadorId || '');
    setSheetCarga(p);
  }

  async function confirmarCarga() {
    const p = sheetCarga;
    if (!p) return;
    const entregadores = data?.entregadores || [];
    if (entregadores.length > 0 && !cargaEntId) {
      showToast('Selecione quem CARREGOU esta entrega antes de carregar.', 'error');
      return;
    }
    const entNome = entregadores.find(e => e.id === cargaEntId)?.nome || p.entregadorNome || null;
    // otimista: o badge e o contador "No veiculo" atualizam na hora
    setData(d => d ? {
      ...d,
      fila: d.fila.map(f => f.saleId === p.saleId ? {
        ...f,
        carregadoEm: new Date().toISOString(),
        ...(cargaEntId ? { entregadorId: cargaEntId, entregadorNome: entNome } : {}),
      } : f),
    } : d);
    const ok = await acao({ acao: 'CHECK_CARGA', saleId: p.saleId, carregado: true, entregadorId: cargaEntId || undefined },
      cargaEntId ? `Carregado — entregador: ${entNome}!` : 'Pedido CARREGADO no veiculo!', false, true);
    if (!ok) load(true); else setSheetCarga(null);
  }

  async function descarregar() {
    const p = sheetCarga;
    if (!p) return;
    setData(d => d ? {
      ...d,
      fila: d.fila.map(f => f.saleId === p.saleId ? { ...f, carregadoEm: null } : f),
    } : d);
    const ok = await acao({ acao: 'CHECK_CARGA', saleId: p.saleId, carregado: false }, 'Check de carga removido!', false, true);
    if (!ok) load(true); else setSheetCarga(null);
  }

  // BLOCO 99 (regra do dono): QUEM DEFINE E O ADMIN — desaloca a venda do
  // entregador (limpa entregador + check de carga). A venda volta a poder ser
  // entregue pelo PROPRIO vendedor (comissao de pronta entrega) ou realocada.
  async function desalocarEntrega() {
    const p = sheetCarga;
    if (!p) return;
    setData(d => d ? {
      ...d,
      fila: d.fila.map(f => f.saleId === p.saleId ? { ...f, carregadoEm: null, entregadorId: null, entregadorNome: null } : f),
    } : d);
    const ok = await acao({ acao: 'DESALOCAR_ENTREGA', saleId: p.saleId }, 'Entrega DESALOCADA — o vendedor pode entregar a propria venda de novo.', false, true);
    if (!ok) load(true); else setSheetCarga(null);
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

  // BLOCO 96: listas respeitam o FILTRO POR VENDEDOR (chips acima da fila)
  const fila = filaVisivel;
  const p1 = fila.filter(p => p.prioridade === 1);
  const p2 = fila.filter(p => p.prioridade === 2);
  const normais = fila.filter(p => p.prioridade === 0 || p.prioridade == null);
  // BLOCO 119.1: SUAS entregas na ORDEM DA ROTA (ordem manual do admin quando
  // houver; senão P1 → P2 → mais antigo) — é o conteúdo do bloco "SUAS".
  const minhasVisiveis = listaOrdenada.filter(ehMinhaCarga);
  const totalMinhasNaFila = Math.round(minhasNaFila.reduce((a, p) => a + p.valorTotal, 0) * 100) / 100;
  const totalOutrasNaFila = Math.round(outrasNaFila.reduce((a, p) => a + p.valorTotal, 0) * 100) / 100;
  const falhados = falhadosVisivel;
  const entreguesHoje = entreguesVisivel;
  // A PRAZO entregue hoje e ainda sem pagamento: o entregador NAO cobra —
  // o vendedor recebe na proxima visita (regra do dono). Mostrado so para
  // o entregador/admin nao contar esse dinheiro no acerto.
  const prazoEntregueHoje = entreguesHoje
    .filter((p: FilaItem) => p.condicao === 'APRAZO' && p.valorPago < p.valorTotal)
    .reduce((a: number, p: FilaItem) => Math.round((a + (p.valorTotal - p.valorPago)) * 100) / 100, 0);
  const resumo = data.resumo;
  // BLOCO 99: as TRES contas do caixa — dinheiro, pix e A RECEBER (a prazo/parcial)
  const caixaEst = data.caixa || { dinheiroHoje: 0, pixHoje: 0, aReceber: 0 };
  const aReceberEst = caixaEst.aReceber ?? 0;
  const desdeCaixa = caixaEst.desde ? new Date(caixaEst.desde) : null;
  const desdeCaixaOk = desdeCaixa && !isNaN(desdeCaixa.getTime());
  // BLOCO 96: caixa do ENTREGADOR selecionado no sheet (fallback: global) —
  // cada entregador tem o SEU caixa, o pre-preenchimento segue o DELE.
  const caixaSel = (data?.caixasPorEntregador || []).find(x => x.entregadorId === caixaEntId);
  const dinEmAbertoSel = caixaSel ? caixaSel.dinheiro : caixaEst.dinheiroHoje;
  const pixEmAbertoSel = caixaSel ? caixaSel.pix : caixaEst.pixHoje;
  const aReceberSel = caixaSel ? caixaSel.aReceber : aReceberEst;
  const desdeSel = caixaSel?.desde || caixaEst.desde;
  const desdeSelDate = desdeSel ? new Date(desdeSel) : null;
  const desdeSelOk = desdeSelDate && !isNaN(desdeSelDate.getTime());
  // BLOCO 96: lista do sheet de caixa — prefere o caixa POR ENTREGADOR;
  // fallback: grupos da conferencia de hoje (modo antigo).
  const listaCaixaSheet: any[] = (data?.caixasPorEntregador?.length ?? 0) > 0
    ? (data?.caixasPorEntregador as any[])
    : (data?.conferencia?.porEntregador || []);
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
                {/* BLOCO 96/97/100: entregador da venda = vendedor nominado —
                    escolhido no check de carga; no admin o badge e CLICAVEL
                    para trocar quem carregou aquela entrega. O dono pediu o
                    texto EXPLICITO: "Carregado por {nome}". */}
                {p.entregadorId && pend && (
                  modo === 'ADMIN' ? (
                    <button onClick={() => abrirSheetCarga(p)} disabled={!!busy}
                      title="Trocar quem carregou esta entrega"
                      className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 shrink-0 active:scale-95 transition-transform disabled:opacity-60">
                      <i className="fa-solid fa-motorcycle mr-0.5"></i>Carregado por {p.entregadorNome || 'entregador'}
                    </button>
                  ) : (
                    <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 shrink-0"><i className="fa-solid fa-motorcycle mr-0.5"></i>Carregado por {p.entregadorNome || 'entregador'}</span>
                  )
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
                <TrocasBox trocas={p.trocas} valor={p.trocasValor} className="mt-1" />
              )}
              {melhorias.trocaSeparacao && modo === 'ADMIN' && pend && (
                <button onClick={() => setSheetTrocas({ p, texto: p.trocas || '', valor: p.trocasValor ? String(p.trocasValor) : '' })} disabled={!!busy}
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
            {/* BLOCO 96: check de carga COM ESCOLHA DO ENTREGADOR — o botao abre
                o sheet onde o admin seleciona quem e o entregador da venda. Ja
                carregado: o mesmo sheet troca o entregador ou remove do veiculo. */}
            {modo === 'ADMIN' && pend && (
              <button onClick={() => abrirSheetCarga(p)} disabled={!!busy}
                title={p.carregadoEm ? 'Já carregado — clique para trocar o entregador ou remover do veículo' : 'Marcar como carregado no veículo (escolhe o entregador)'}
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

          {/* BLOCO 109 (regra do dono): fiscal SOMENTE do admin na fila — emitir
              NF-e/NFC-e com 1 clique, DANFE 80mm ou PDF A4. Vendedor/entregador
              nao ve (na pre-venda quem emite a nota e o admin). */}
          {modo === 'ADMIN' && p.saleId && (
            <AcaoFiscalAdmin p={p} showToast={showToast} />
          )}

          {/* entregador/admin: entrega e falha com botoes grandes */}
          {podeEntregar && pend && (
            !podeReceberEntrega(p) ? (
              /* BLOCO 119 (regra do dono — CONFERENCIA DE ENTREGAS E VALORES):
                 a entrega aparece para conferencia, mas o RECEBIMENTO e de quem
                 tem a CARGA NO SEU NOME. Sem atribuicao: so o vendedor dono.
                 Atribuida no check de carga: so o atribuido. ADMIN decide tudo. */
              <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                {p.entregadorId ? (
                  <>
                    <p className="text-[9px] font-black text-slate-700 uppercase leading-snug">
                      <i className="fa-solid fa-truck-fast mr-1 text-teal-600"></i>Carga de {p.entregadorNome || 'outro entregador'} — recebimento DELE
                    </p>
                    <p className="text-[8px] font-semibold text-slate-500 mt-0.5 leading-snug">Foi carregada no nome dele pelo admin/secretário. Só conferência aqui — o dinheiro é do responsável.</p>
                  </>
                ) : (
                  <>
                    <p className="text-[9px] font-black text-slate-700 uppercase leading-snug">
                      <i className="fa-solid fa-user mr-1 text-teal-600"></i>Carga do vendedor {p.vendedorNome || '—'} — recebimento DELE
                    </p>
                    <p className="text-[8px] font-semibold text-slate-500 mt-0.5 leading-snug">
                      {/* BLOCO 120.1 (regra do dono): para o VENDEDOR logado, a venda
                          propria SEM check de carga NAO e recebivel — precisa do
                          carregamento no nome dele pelo admin/secretario. */}
                      {modo === 'VENDEDOR' && p.vendedorId === user.id
                        ? 'Sua venda ainda NÃO foi carregada no seu nome — o admin/secretário faz o check de carga. Só conferência aqui.'
                        : 'Sem entregador atribuído: quem recebe é o vendedor — e só com o check de carga no nome dele.'}
                    </p>
                  </>
                )}
              </div>
            ) : (
              /* Pode receber: carga CARREGADA NO NOME DELE pelo admin/secretario
                 (check de carga) — botões ENTREGUE/FALHOU. BLOCO 120.1: venda
                 propria sem carregamento NAO entra mais aqui (so conferencia). */
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
            )
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
                {modo === 'ADMIN' ? 'Continua — entra pedido, sai entregue' : modo === 'ENTREGADOR' ? 'Você vê TODAS SEPARADAS — recebe SÓ a carga carregada NO SEU NOME' : 'Você vê TODAS SEPARADAS — recebe SÓ o que o admin/secretário carregou NO SEU NOME'}
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
          <div className="bg-gray-50 rounded-xl p-2"><p className="text-[8px] font-black text-gray-400 uppercase">Na fila</p><p className="text-[13px] font-black text-gray-800">{resumo?.naFila ?? fila.length}</p></div>
          <div className="bg-amber-50 rounded-xl p-2"><p className="text-[8px] font-black text-amber-500 uppercase">Atrasados</p><p className="text-[13px] font-black text-amber-700">{resumo?.atrasados ?? 0}</p></div>
          <div className="bg-rose-50 rounded-xl p-2"><p className="text-[8px] font-black text-rose-400 uppercase">Falhas</p><p className="text-[13px] font-black text-rose-600">{falhados.length}</p></div>
          <div className="bg-emerald-50 rounded-xl p-2"><p className="text-[8px] font-black text-emerald-500 uppercase">Entregues</p><p className="text-[13px] font-black text-emerald-700">{resumo?.entreguesHoje ?? entreguesHoje.length}</p></div>
        </div>
        <div className="flex gap-2 mt-2 text-[9px] font-bold flex-wrap">
          <span className="text-gray-600"><i className="fa-solid fa-wallet mr-1"></i>Fila: {fmt(resumo?.valorFila ?? 0)}</span>
          <span className="text-emerald-600"><i className="fa-solid fa-circle-check mr-1"></i>Entregue hoje: {fmt(resumo?.valorEntregueHoje ?? 0)}</span>
          {/* BLOCO 58: quantos pedidos da fila já estão no veiculo (check do admin) */}
          {modo !== 'VENDEDOR' && (
            <span className="text-slate-700"><i className="fa-solid fa-truck-fast mr-1"></i>No veículo: {carregadosCount}/{fila.length}</span>
          )}
          {/* BLOCO 119.1: conferência rápida — quanto da fila é CARGA NO SEU NOME */}
          {modo !== 'ADMIN' && podeEntregar && (
            <span className="text-emerald-700"><i className="fa-solid fa-user-check mr-1"></i>Sua carga: {minhasNaFila.length} · {fmt(totalMinhasNaFila)}</span>
          )}
        </div>

        {/* BLOCO 119.1 (regra do dono): DUAS ABAS CLARAS — "SUAS ENTREGAS"
            mostra APENAS o que foi carregado NO SEU NOME pelo admin/secretario
            (ou venda própria); "TODAS" mostra a fila inteira SEPARADA — as
            entregas dos outros ficam visíveis para conferência, porém SEM
            receber (sem botões + servidor recusa com 403). */}
        {modo !== 'ADMIN' && podeEntregar && (
          <div className="mt-2 print:hidden">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSoMinhaCarga(true)}
                className={`py-2.5 rounded-xl text-[9px] font-black uppercase tracking-wide transition-all active:scale-95 border ${soMinhaCarga ? 'bg-emerald-600 text-white border-emerald-600 shadow' : 'bg-white text-gray-500 border-gray-200'}`}
              >
                <i className="fa-solid fa-user-check mr-1.5"></i>Suas entregas ({minhasNaFila.length})
              </button>
              <button
                onClick={() => setSoMinhaCarga(false)}
                className={`py-2.5 rounded-xl text-[9px] font-black uppercase tracking-wide transition-all active:scale-95 border ${!soMinhaCarga ? 'bg-gray-800 text-white border-gray-800 shadow' : 'bg-white text-gray-500 border-gray-200'}`}
              >
                <i className="fa-solid fa-layer-group mr-1.5"></i>Todas ({(data?.fila || []).length})
              </button>
            </div>
            <p className="text-[8px] font-bold text-slate-400 uppercase mt-1.5 leading-snug">
              {soMinhaCarga
                ? 'Mostrando APENAS o que foi carregado NO SEU NOME (check de carga do admin/secretário).'
                : 'Fila inteira SEPARADA — as suas têm botão de receber; as dos outros são só conferência.'}
            </p>
          </div>
        )}

        {/* CAIXA DO DIA (entregador e admin) */}
        {modo !== 'VENDEDOR' && modo !== 'ADMIN' && (
          /* BLOCO 100 (regra do dono): SEU CAIXA — card novo do ENTREGADOR
              logado. O dinheiro em espécie é o HEROI (é o que ele entrega na
              mão), Pix e A receber no quadrado, com contagem de entregas e
              as notas de "não cobrar" e "só o admin zera". */
          <div className="mt-3 rounded-2xl border-2 border-emerald-100 bg-gradient-to-b from-emerald-50/70 to-white p-3.5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-emerald-700 uppercase tracking-wide"><i className="fa-solid fa-motorcycle mr-1"></i>Seu caixa</p>
                <p className="text-[8px] font-bold text-slate-400 uppercase leading-snug">
                  {desdeCaixaOk
                    ? <>em aberto desde {desdeCaixa!.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às {desdeCaixa!.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>
                    : 'sem fechamento anterior'}
                </p>
              </div>
              {typeof caixaEst.qtdEntregas === 'number' && (
                <span className="text-[8px] font-black uppercase px-2 py-1 rounded-lg bg-white border border-emerald-200 text-emerald-600 shrink-0">
                  <i className="fa-solid fa-box mr-0.5"></i>{caixaEst.qtdEntregas} entrega(s)
                </span>
              )}
            </div>

            {/* DINHEIRO — o valor em espécie na mão dele (hero) */}
            <div className="mt-2.5 bg-white rounded-xl border border-emerald-200 p-3 flex items-center gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow">
                <i className="fa-solid fa-money-bill-wave"></i>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[8px] font-black text-emerald-500 uppercase leading-none">Dinheiro em espécie (na sua mão)</p>
                <p className="text-[22px] font-black text-emerald-700 leading-tight mt-0.5">{fmt(caixaEst.dinheiroHoje)}</p>
              </div>
            </div>

            {/* PIX + A RECEBER — as outras duas contas, cada uma na sua casa */}
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="bg-white rounded-xl border border-teal-100 p-2.5 text-center shadow-sm">
                <p className="text-[8px] font-black text-teal-500 uppercase leading-none"><i className="fa-brands fa-pix mr-0.5"></i>Pix recebido</p>
                <p className="text-[15px] font-black text-teal-700 mt-1">{fmt(caixaEst.pixHoje)}</p>
                <p className="text-[8px] font-bold text-teal-400 uppercase mt-0.5">não vai em espécie</p>
              </div>
              <div className="bg-white rounded-xl border border-amber-100 p-2.5 text-center shadow-sm">
                <p className="text-[8px] font-black text-amber-500 uppercase leading-none"><i className="fa-solid fa-hand-holding-dollar mr-0.5"></i>A receber</p>
                <p className="text-[15px] font-black text-amber-700 mt-1">{fmt(aReceberEst)}</p>
                <p className="text-[8px] font-bold text-amber-400 uppercase mt-0.5">cliente ainda deve</p>
              </div>
            </div>

            {/* TOTAL do caixa (dinheiro + pix) — o que ele bate com o sistema */}
            <div className="mt-2 flex items-center justify-between bg-slate-800 text-white rounded-xl px-3 py-2 shadow-sm">
              <p className="text-[8px] font-black uppercase leading-snug">Total do caixa<br /><span className="text-[8px] font-bold text-white/50">dinheiro + pix</span></p>
              <p className="text-[15px] font-black">{fmt(caixaEst.dinheiroHoje + caixaEst.pixHoje)}</p>
            </div>

            {prazoEntregueHoje > 0 && (
              <p className="text-[8px] font-black text-orange-500 uppercase mt-2"><i className="fa-solid fa-hand-holding-dollar mr-1"></i>A prazo entregue hoje (NAO cobrar): {fmt(prazoEntregueHoje)}</p>
            )}
            <p className="text-[8px] font-semibold text-slate-400 mt-2 leading-snug">
              <i className="fa-solid fa-user-shield mr-1"></i>O caixa só zera quando o ADMIN fecha — cada entregador tem o caixa DELE.
            </p>
          </div>
        )}

        {modo === 'ADMIN' && (
          <div className="mt-3 bg-slate-50 border border-slate-100 rounded-2xl p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[8px] font-black text-slate-400 uppercase">Caixa em aberto (estimado)</p>
                <p className="text-[8px] font-bold text-slate-400 uppercase">
                  {desdeCaixaOk
                    ? <>desde {desdeCaixa!.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} {desdeCaixa!.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>
                    : 'sem fechamento anterior'}
                </p>
                {/* BLOCO 99 (regra do dono): as TRES contas CLARAS — Dinheiro,
                    Pix e A Receber, cada uma na sua caixinha */}
                <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                  <div className="bg-emerald-50 rounded-xl px-2 py-1.5 text-center">
                    <p className="text-[8px] font-black text-emerald-500 uppercase leading-none"><i className="fa-solid fa-money-bill-wave mr-0.5"></i>Dinheiro</p>
                    <p className="text-[12px] font-black text-emerald-700 mt-0.5">{fmt(caixaEst.dinheiroHoje)}</p>
                  </div>
                  <div className="bg-teal-50 rounded-xl px-2 py-1.5 text-center">
                    <p className="text-[8px] font-black text-teal-500 uppercase leading-none"><i className="fa-brands fa-pix mr-0.5"></i>Pix</p>
                    <p className="text-[12px] font-black text-teal-700 mt-0.5">{fmt(caixaEst.pixHoje)}</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl px-2 py-1.5 text-center">
                    <p className="text-[8px] font-black text-amber-500 uppercase leading-none"><i className="fa-solid fa-hand-holding-dollar mr-0.5"></i>A receber</p>
                    <p className="text-[12px] font-black text-amber-700 mt-0.5">{fmt(aReceberEst)}</p>
                  </div>
                </div>
                {prazoEntregueHoje > 0 && (
                  <p className="text-[8px] font-black text-orange-500 uppercase mt-1.5"><i className="fa-solid fa-hand-holding-dollar mr-1"></i>A prazo entregue hoje (NAO cobrar): {fmt(prazoEntregueHoje)}</p>
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
                </div>
              ) : (
                <p className="text-[8px] font-bold text-slate-400 uppercase text-right leading-snug max-w-[130px]">
                  <i className="fa-solid fa-user-shield mr-1"></i>O caixa só zera quando o admin fecha
                </p>
              )}
            </div>

            {/* BLOCO 96: fechamentos de hoje com o NOME do entregador (cada um
                tem o seu caixa) — linha inteira embaixo, sem espremer o resumo */}
            {modo === 'ADMIN' && (data.fechamentosHoje || []).length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                {(data.fechamentosHoje || []).map((f: any) => (
                  <div key={f.id} className="flex items-center gap-2 justify-between bg-white rounded-lg border border-slate-100 px-2.5 py-1.5">
                    <span className="text-[9px] font-black text-slate-600 truncate"><i className="fa-solid fa-motorcycle text-slate-300 mr-1"></i>{f.entregadorNome || 'Entregador'}</span>
                    <span className="text-[9px] font-black text-slate-600 shrink-0">Dinheiro: {fmt(Number(f.valor_dinheiro))}</span>
                    {f.confirmado ? (
                      <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">Confirmado</span>
                    ) : (
                      <button onClick={() => acao({ acao: 'CONFIRMAR_CAIXA', caixaId: f.id }, 'Recebimento do dinheiro confirmado!')}
                        className="text-[8px] font-black uppercase px-2 py-1 rounded bg-emerald-600 text-white active:scale-95 shrink-0">
                        Confirmar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* BLOCO 96 (regra do dono): CAIXA SEPARADO POR ENTREGADOR — cada
                entregador tem o SEU caixa em aberto (desde o fechamento DELE)
                e o admin fecha um por um, pre-preenchido com o dinheiro DELE. */}
            {modo === 'ADMIN' && (data.caixasPorEntregador?.length ?? 0) > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-200 space-y-1.5">
                <p className="text-[9px] font-black text-slate-500 uppercase"><i className="fa-solid fa-motorcycle mr-1"></i>Caixa por entregador (em aberto)</p>
                {(data.caixasPorEntregador || []).map(g => (
                  <div key={g.entregadorId} className={`bg-white rounded-xl border p-2.5 ${g.entregadorId === 'SEM_ENTREGADOR' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-slate-700 uppercase truncate"><i className="fa-solid fa-motorcycle text-emerald-500 mr-1"></i>{g.nome || 'Entregador'}</p>
                        <p className="text-[8px] font-bold text-slate-400 uppercase">
                          {g.desde ? `caixa aberto desde ${new Date(g.desde).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${new Date(g.desde).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'sem fechamento anterior'} · {g.qtdEntregas} entrega(s)
                        </p>
                      </div>
                      <button onClick={() => abrirCaixaEntregador(g)} disabled={!!busy}
                        className="px-3 py-2 rounded-xl bg-slate-800 text-white text-[8px] font-black uppercase shrink-0 active:scale-95 disabled:opacity-60">
                        <i className="fa-solid fa-cash-register mr-1"></i>Fechar caixa
                      </button>
                    </div>
                    {/* BLOCO 99: as TRES contas CLARAS do caixa DELE — dinheiro,
                        pix e a receber (o cliente ainda deve) */}
                    <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                      <div className="bg-emerald-50 rounded-lg px-1.5 py-1 text-center">
                        <p className="text-[8px] font-black text-emerald-500 uppercase leading-none"><i className="fa-solid fa-money-bill-wave mr-0.5"></i>Dinheiro</p>
                        <p className="text-[11px] font-black text-emerald-700 mt-0.5">{fmt(g.dinheiro)}</p>
                      </div>
                      <div className="bg-teal-50 rounded-lg px-1.5 py-1 text-center">
                        <p className="text-[8px] font-black text-teal-500 uppercase leading-none"><i className="fa-brands fa-pix mr-0.5"></i>Pix</p>
                        <p className="text-[11px] font-black text-teal-700 mt-0.5">{fmt(g.pix)}</p>
                      </div>
                      <div className="bg-amber-50 rounded-lg px-1.5 py-1 text-center">
                        <p className="text-[8px] font-black text-amber-500 uppercase leading-none"><i className="fa-solid fa-hand-holding-dollar mr-0.5"></i>A receber</p>
                        <p className="text-[11px] font-black text-amber-700 mt-0.5">{fmt(g.aReceber || 0)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

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
                              <p className="text-[8px] font-black text-emerald-500 uppercase">Sistema: dinheiro</p>
                              <p className="text-[13px] font-black text-emerald-700">{fmt(g.dinheiro)}</p>
                            </div>
                            <div className="bg-teal-50 rounded-lg p-2 text-center">
                              <p className="text-[8px] font-black text-teal-500 uppercase">Sistema: pix</p>
                              <p className="text-[13px] font-black text-teal-700">{fmt(g.pix)}</p>
                            </div>
                          </div>
                          {fech ? (
                            <div className="mt-2 bg-slate-50 rounded-lg p-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[8px] font-black text-slate-500 uppercase leading-snug">Caixa fechado:<br />{fmt(Number(fech.valor_dinheiro))} din · {fmt(Number(fech.valor_pix))} pix</p>
                                {fech.confirmado ? (
                                  <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">Confirmado</span>
                                ) : (
                                  <button onClick={() => acao({ acao: 'CONFIRMAR_CAIXA', caixaId: fech.id }, 'Recebimento do dinheiro confirmado!')}
                                    className="text-[8px] font-black uppercase px-2 py-1.5 rounded bg-emerald-600 text-white active:scale-95 shrink-0">Confirmar</button>
                                )}
                              </div>
                              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${bate(dinDiff) ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                  <i className={`fa-solid ${bate(dinDiff) ? 'fa-check' : 'fa-triangle-exclamation'} mr-0.5`}></i>Dinheiro: {bate(dinDiff) ? 'bateu' : `dif. R$ ${Math.abs(dinDiff!).toFixed(2)}`}
                                </span>
                                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${bate(pixDiff) ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
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
                                    <p className="text-[8px] font-bold text-slate-400 uppercase">{v.recebimento}</p>
                                  </div>
                                  <div className="text-right shrink-0 ml-2">
                                    <p className="text-[9px] font-black text-slate-700">{fmt(v.valorPago)}</p>
                                    <p className="text-[8px] font-bold text-slate-400">de {fmt(v.valorTotal)}</p>
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

      {/* ===== BLOCO 96: FILTRO POR VENDEDOR (acima da fila — regra do dono:
          clicou em cima do vendedor, aparecem so as entregas DELE) ===== */}
      {modo === 'ADMIN' && vendedoresDaFila.length > 0 && (
        <div className="print:hidden">
          <div className="overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-1.5 min-w-max">
              <button
                onClick={() => setFiltroVendedor('TODOS')}
                className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase border-2 transition-colors shrink-0 ${filtroVendedor === 'TODOS' ? 'bg-gray-800 border-gray-800 text-white shadow' : 'bg-white border-gray-200 text-gray-500'}`}>
                <i className="fa-solid fa-users mr-1"></i>Todos ({(data?.fila || []).length})
              </button>
              {vendedoresDaFila.map(v => (
                <button
                  key={v.id}
                  onClick={() => setFiltroVendedor(cur => cur === v.id ? 'TODOS' : v.id)}
                  className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase border-2 transition-colors shrink-0 ${filtroVendedor === v.id ? 'bg-amber-500 border-amber-500 text-white shadow' : 'bg-white border-gray-200 text-gray-500'}`}>
                  <i className="fa-solid fa-user-tag mr-1"></i>{v.nome} ({v.count})
                </button>
              ))}
            </div>
          </div>
          {filtroVendedor !== 'TODOS' && (
            <p className="text-[9px] font-black text-amber-600 uppercase px-1 mt-1.5">
              <i className="fa-solid fa-filter mr-1"></i>Mostrando as entregas de {nomeFiltroAtivo} — {fila.length} na fila ({fmt(fila.reduce((a, p) => a + p.valorTotal, 0))})
            </p>
          )}
        </div>
      )}

      {/* ===== FILA PENDENTE — BLOCO 61: kanban de arrastar-e-soltar ===== */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}>
        <SortableContext items={listaOrdenada.map(p => p.saleId)} strategy={verticalListSortingStrategy}>
          {modo !== 'ADMIN' && podeEntregar && !soMinhaCarga ? (
            /* ===== BLOCO 119.1 (regra do dono): FILA DO VENDEDOR/ENTREGADOR
               SEPARADA em dois blocos — SUAS ENTREGAS (carregadas NO SEU NOME
               pelo admin/secretario, com botao ENTREGUE/FALHOU) e DEMAIS
               ENTREGAS (so conferencia, AGRUPADAS por dono da carga, SEM
               receber). A aba "SUAS ENTREGAS" acima mostra APENAS o primeiro
               bloco. A ordem dentro de cada bloco segue a rota (manual do
               admin quando houver; senao P1 -> P2 -> mais antigo). ===== */
            <>
              <div className="space-y-3">
                <div className={`rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 shadow-sm ${minhasNaFila.length > 0 ? 'bg-emerald-600' : 'bg-gray-100'}`}>
                  <p className={`text-[10px] font-black uppercase leading-tight ${minhasNaFila.length > 0 ? 'text-white' : 'text-gray-400'}`}>
                    <i className="fa-solid fa-user-check mr-1.5"></i>Suas entregas — carregadas no seu nome
                  </p>
                  {minhasNaFila.length > 0 && (
                    <p className="text-[10px] font-black text-emerald-100 shrink-0">{minhasNaFila.length} · {fmt(totalMinhasNaFila)}</p>
                  )}
                </div>
                {minhasNaFila.length === 0 && (
                  <p className="text-[9px] font-bold text-slate-400 uppercase px-1 bg-slate-50 rounded-lg py-2.5 text-center leading-snug">
                    Nenhuma entrega carregada para você ainda — o admin/secretário carrega no check de carga.
                  </p>
                )}
                {minhasVisiveis.map(p => <SortableCard key={p.saleId} p={p} acento={p.prioridade === 1 ? 'p1' : p.prioridade === 2 ? 'p2' : 'normal'} posicao={listaOrdenada.findIndex(x => x.saleId === p.saleId) + 1} draggable={false} />)}
              </div>
              {outrasNaFila.length > 0 && (
                <div className="space-y-2.5">
                  <div className="rounded-xl bg-slate-200 px-3 py-2.5 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black text-slate-600 uppercase leading-tight">
                      <i className="fa-solid fa-eye mr-1.5"></i>Demais entregas — só conferência
                    </p>
                    <p className="text-[10px] font-black text-slate-500 shrink-0">{outrasNaFila.length} · {fmt(totalOutrasNaFila)}</p>
                  </div>
                  <p className="text-[8px] font-bold text-slate-400 uppercase px-1 leading-snug">
                    O recebimento é de quem tem a carga no nome — estas você NÃO entrega (o sistema bloqueia).
                  </p>
                  {outrosAgrupados.map(g => (
                    <div key={g.key} className="space-y-2.5">
                      <p className="text-[9px] font-black text-slate-500 uppercase px-2 py-1.5 bg-white border border-slate-100 rounded-lg">
                        <i className="fa-solid fa-truck-fast mr-1 text-teal-600"></i>Carga de {g.nome} — {g.itens.length} entrega(s) · {fmt(g.total)}
                      </p>
                      {[...g.itens].sort((a, b) => listaOrdenada.findIndex(x => x.saleId === a.saleId) - listaOrdenada.findIndex(x => x.saleId === b.saleId)).map(p => (
                        <SortableCard key={p.saleId} p={p} acento={p.prioridade === 1 ? 'p1' : p.prioridade === 2 ? 'p2' : 'normal'} posicao={listaOrdenada.findIndex(x => x.saleId === p.saleId) + 1} draggable={false} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : ordemManualAtiva ? (
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
              <TrocasBox trocas={sp.trocas} valor={sp.trocasValor} className="mt-2" />
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
                        {m === 'DINHEIRO' ? 'Dinheiro' : m === 'PIX' ? 'Pix' : 'Misto'}
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
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300 max-h-[92vh] overflow-y-auto overscroll-contain" onClick={e => e.stopPropagation()}>
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
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300 max-h-[92vh] overflow-y-auto overscroll-contain" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center"><i className="fa-solid fa-right-left text-orange-500 mr-1"></i>Trocas do pedido</h3>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-1 capitalize">{sheetTrocas.p.cliente.nome}</p>
            <p className="text-[9px] text-gray-400 font-bold text-center mt-0.5">Ajuste o que sai no cupom — 1 item por linha. As trocas nem sempre voltam pelo mesmo produto: anote o VALOR em PREÇO DE CUSTO.</p>
            <textarea
              value={sheetTrocas.texto}
              onChange={e => setSheetTrocas({ ...sheetTrocas, texto: e.target.value })}
              rows={3} maxLength={500}
              placeholder={'1 Lays sour cream 62g\n2 Toddynho 200ml'}
              className="w-full mt-3 p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-orange-100 resize-none leading-relaxed"
            />
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[8px] font-black text-gray-400 uppercase shrink-0">Valor (custo)</span>
              <input
                type="text" inputMode="decimal"
                value={sheetTrocas.valor}
                onChange={e => setSheetTrocas({ ...sheetTrocas, valor: e.target.value })}
                placeholder="R$ 0,00"
                className="flex-1 bg-gray-50 border border-gray-100 rounded-xl text-sm font-black text-orange-600 px-3 py-2.5 text-right outline-none focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <p className="text-[8px] font-semibold text-gray-400 mt-1.5 leading-snug">Na entrega levamos produtos que fechem esse valor de custo.</p>
            <button
              onClick={async () => { const t = sheetTrocas; setSheetTrocas(null); const tv = parseFloat(t.valor.replace(',', '.')) || 0; await acao({ acao: 'EDITAR_TROCAS', saleId: t.p.saleId, trocas: t.texto, trocasValor: tv > 0 ? tv : undefined }, 'Trocas atualizadas! O cupom sai corrigido.'); }}
              disabled={!!busy}
              className="w-full mt-3 py-4 bg-orange-500 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              <i className="fa-solid fa-check mr-1"></i>Salvar trocas
            </button>
            <button onClick={() => setSheetTrocas(null)} className="w-full mt-2 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== BLOCO 96: SHEET DE CARGA — escolhe QUEM e o ENTREGADOR da
          venda antes de o entregador carregar (multiplas opcoes). Ja
          carregado: troca o entregador ou remove do veiculo. ===== */}
      {sheetCarga && modo === 'ADMIN' && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetCarga(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300 max-h-[92vh] overflow-y-auto overscroll-contain" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center">
              <i className="fa-solid fa-truck-fast text-emerald-600 mr-1"></i>
              {sheetCarga.carregadoEm ? 'Trocar entregador da carga' : 'Carregar no veículo'}
            </h3>
            <p className="text-[11px] font-bold text-gray-600 capitalize text-center mt-1">{sheetCarga.cliente.nome} · {fmt(sheetCarga.valorTotal)}</p>
            <p className="text-[9px] font-black text-gray-400 uppercase text-center mt-3 leading-snug">Quem CARREGOU esta entrega? <span className="text-gray-300">(entregador da venda)</span></p>
            {(data?.entregadores || []).length > 0 ? (
              <div className="mt-2 space-y-2">
                {/* BLOCO 98 (regra do dono): o ENTREGADOR 1 (quem loga como entregador)
                    e a opcao PRINCIPAL — botao GIGANTE no topo; os vendedores que
                    eventualmente levam a entrega ficam em chips menores abaixo. */}
                {(data?.entregadores || []).filter(e => e.perfil === 'ENTREGADOR_FIXO').map(e => (
                  <button key={e.id} onClick={() => setCargaEntId(e.id)}
                    className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-wide border-2 transition-colors flex items-center justify-center gap-2 ${cargaEntId === e.id ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                    <i className="fa-solid fa-motorcycle text-sm"></i>{e.nome}
                    <span className={`text-[8px] px-1.5 py-0.5 rounded-md font-black ${cargaEntId === e.id ? 'bg-white/20' : 'bg-white'}`}>PRINCIPAL</span>
                  </button>
                ))}
                {(data?.entregadores || []).filter(e => e.perfil !== 'ENTREGADOR_FIXO').length > 0 && (
                  <p className="text-[8px] font-black text-gray-300 uppercase tracking-widest pt-1">Ou um vendedor leva:</p>
                )}
                <div className="flex gap-1.5 flex-wrap">
                  {(data?.entregadores || []).filter(e => e.perfil !== 'ENTREGADOR_FIXO').map(e => (
                    <button key={e.id} onClick={() => setCargaEntId(e.id)}
                      className={`px-3 py-2.5 rounded-xl text-[10px] font-black uppercase border-2 transition-colors ${cargaEntId === e.id ? 'bg-emerald-600 border-emerald-600 text-white shadow' : 'bg-white border-gray-200 text-gray-500'}`}>
                      <i className="fa-solid fa-user mr-1"></i>{e.nome}
                      <span className="ml-1 text-[8px] font-black opacity-60">VENDEDOR</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-2">
                <p className="text-[9px] font-black text-amber-700 uppercase"><i className="fa-solid fa-triangle-exclamation mr-1"></i>Nenhum vendedor ativo</p>
                <p className="text-[9px] font-semibold text-amber-600 mt-0.5 leading-snug">O entregador é escolhido entre os VENDEDORES — cadastre/ative um vendedor no menu Usuários (não precisa criar usuário entregador). Pode carregar sem entregador (modo antigo).</p>
              </div>
            )}
            {cargaEntId && (
              <p className="text-[9px] font-black text-emerald-600 uppercase text-center mt-2">
                <i className="fa-solid fa-circle-check mr-1"></i>Entregador: {(data?.entregadores || []).find(e => e.id === cargaEntId)?.nome || 'Entregador'} — essa entrega alimenta o caixa DELE
              </p>
            )}
            <button onClick={confirmarCarga} disabled={!!busy}
              className={`w-full mt-4 py-4 rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50 ${cargaEntId || (data?.entregadores || []).length === 0 ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'}`}>
              <i className="fa-solid fa-truck-fast mr-1"></i>{sheetCarga.carregadoEm ? 'Salvar entregador' : 'Confirmar carga no veículo'}
            </button>
            {sheetCarga.carregadoEm && (
              <button onClick={descarregar} disabled={!!busy}
                className="w-full mt-2 py-3.5 rounded-2xl bg-rose-50 text-rose-600 text-[10px] font-black uppercase active:scale-95 disabled:opacity-60">
                <i className="fa-solid fa-truck-ramp-box mr-1"></i>Remover do veículo
              </button>
            )}
            {/* BLOCO 99 (regra do dono): QUEM DEFINE E O ADMIN — desaloca a
                venda do entregador; o vendedor volta a poder entregar a própria */}
            {sheetCarga.entregadorId && (
              <button onClick={desalocarEntrega} disabled={!!busy}
                className="w-full mt-2 py-3.5 rounded-2xl bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-black uppercase active:scale-95 disabled:opacity-60">
                <i className="fa-solid fa-link-slash mr-1"></i>Desalocar entrega (deixa sem entregador)
              </button>
            )}
            <button onClick={() => setSheetCarga(null)} className="w-full mt-2 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== SHEET: FECHAR CAIXA (BLOCO 33 — SOMENTE O ADMIN) ===== */}
      {sheetCaixa && modo === 'ADMIN' && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetCaixa(false)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300 max-h-[92vh] overflow-y-auto overscroll-contain" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center"><i className="fa-solid fa-cash-register text-emerald-600 mr-1"></i>Fechamento de caixa</h3>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-1">Conte o dinheiro em especie e feche — a conta recomeca do zero</p>
            {listaCaixaSheet.length > 1 && (
              <div className="mt-3">
                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Entregador do caixa (cada um tem o seu)</label>
                <div className="flex gap-1.5 flex-wrap mt-1">
                  {listaCaixaSheet.map((g: any) => (
                    <button key={g.entregadorId} onClick={() => trocarEntCaixa(g.entregadorId)}
                      className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase border-2 transition-colors ${caixaEntId === g.entregadorId ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-100 text-gray-500'}`}>
                      {g.nome || 'Entregador'} ({g.qtdEntregas})
                    </button>
                  ))}
                </div>
              </div>
            )}
            {listaCaixaSheet.length === 1 && (
              <p className="text-[9px] font-black text-emerald-600 uppercase text-center mt-2">
                <i className="fa-solid fa-motorcycle mr-1"></i>{listaCaixaSheet[0].nome || 'Entregador'}
              </p>
            )}
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center mt-4">
              <p className="text-[9px] font-black text-emerald-500 uppercase">Dinheiro em espécie em aberto (estimado)</p>
              <p className="text-[8px] font-bold text-emerald-400 uppercase">{desdeSelOk ? `desde ${desdeSelDate!.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${desdeSelDate!.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'sem fechamento anterior'}</p>
              <p className="text-2xl font-black text-emerald-700">{fmt(dinEmAbertoSel)}</p>
              {/* BLOCO 99: as tres contas na cara no fechamento */}
              <div className="grid grid-cols-2 gap-1.5 mt-2">
                <div className="bg-white/70 rounded-xl px-2 py-1.5">
                  <p className="text-[8px] font-black text-teal-500 uppercase"><i className="fa-brands fa-pix mr-0.5"></i>Pix em aberto</p>
                  <p className="text-[13px] font-black text-teal-700">{fmt(pixEmAbertoSel)}</p>
                </div>
                <div className="bg-white/70 rounded-xl px-2 py-1.5">
                  <p className="text-[8px] font-black text-amber-500 uppercase"><i className="fa-solid fa-hand-holding-dollar mr-0.5"></i>A receber</p>
                  <p className="text-[13px] font-black text-amber-700">{fmt(aReceberSel || 0)}</p>
                </div>
              </div>
              <p className="text-[8px] font-bold text-gray-400 uppercase mt-1">Pix nao vem em especie · A receber = a prazo/parcial que o cliente ainda deve</p>
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
          // BLOCO 109: so o ADMIN abre o cupom da fila com o PASSO 2 fiscal
          // (emitir nota, DANFE 80mm/A4, boleto, Pix) — emissao posterior.
          allowNota={modo === 'ADMIN'}
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
                  {/* BLOCO 96: com caixa separado por entregador, a lista imprime QUEM entrega */}
                  {listaImprimir.some(p => p.entregadorId) && <th className="text-left py-1 w-24">Entregador</th>}
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
                    {listaImprimir.some(x => x.entregadorId) && <td className="py-1.5 text-gray-600 uppercase text-[9px] font-black">{p.entregadorNome || '—'}</td>}
                    <td className="py-1.5 text-right font-bold">{fmt(p.valorTotal)}</td>
                    <td className="py-1.5 text-center uppercase text-[9px] font-black">{p.formaPgto}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[9px] text-gray-400 text-center mt-4">{ordemManualAtiva ? 'Ordem definida pelo admin (arrastar-e-soltar na fila).' : 'Regra: P1 primeiro, depois P2, depois mais antigo.'} Assinatura do entregador: ____________________</p>
          </div>
          <div className="max-w-xl mx-auto mt-4 print:hidden">
            {/* BLOCO 120 (iPhone): botao com GESTO DIRETO — o auto-print de 150ms
                e ignorado pelo iOS, entao aqui o dono manda imprimir por toque. */}
            {dispositivoIOS() && (
              <button onClick={() => window.print()} className="w-full bg-emerald-600 text-white font-black py-3 rounded-2xl uppercase text-[10px] mb-2">Imprimir agora</button>
            )}
            <button onClick={() => setMostrarLista(false)} className="w-full bg-slate-800 text-white font-black py-3 rounded-2xl uppercase text-[10px]">Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilaEntregas;
