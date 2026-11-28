'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { boletoService, BoletoInfo, BoletoParcelaInfo, BoletoConfigInfo, NotaDaVendaInfo } from '@/services/boletoService';
import { validaCpfCnpj } from '@/lib/validaDoc';
// BLOCO 177: MINI BOLETO imprime DIRETO (sem preview) nos DOIS canais:
// USB do PC e Bluetooth = MESMO papel HTML 80mm (miniBoleto80Html; no BT o
// HTML é rasterizado a 203dpi — BLOCO 185, igual ao USB). Fallback BT: texto
// 48 colunas (comprovanteBoletoTexto).
import { miniBoleto80Html, type MiniBoletoDados } from '@/lib/miniBoleto80Html';
import { comprovanteBoletoTexto } from '@/lib/danfeTexto';
import { imprimirHtmlViaBt } from '@/lib/impressaoHtml';
import { imprimirHtmlViaUsb, temBluetoothNavegador } from '@/lib/usbPrint';

/**
 * BLOCO 25 (ajuste "o dono nao achou o botao"): card do BOLETO BANCARIO INTER
 * (boleto + pix) extraido do Cupom para aparecer em DUAS telas:
 *  1. Modal "Venda Finalizada / Pedido Registrado!" do PDV — logo apos salvar
 *     a venda (era aqui que o dono procurava e nao achava);
 *  2. Cupom da venda salva (reaberto pelo historico / "Ver / Imprimir cupom").
 *
 * Comportamento identico ao original do Cupom: badge por situacao, form de
 * geracao (valor pre-preenchido com o saldo em aberto, vencimento +7d, campo
 * CPF/CNPJ do pagador quando o cliente nao tem documento no cadastro, checkbox
 * ATRELAR NF-e quando a nota esta AUTORIZADA), linha digitavel e PIX copia-e-
 * cola tocaveis, PDF (blob) e WhatsApp. Renderiza NULL quando o SQL do Bloco
 * 25 / credenciais do Inter nao estao configurados (API responde 503).
 *
 * BLOCO 152: mini boleto 80mm (canvas paisagem) EXCLUIDO pelo dono — o
 * boleto do app era o PDF ORIGINAL do Inter (botao PDF) enviado ao cliente.
 * O texto padrao do beneficiario e configurado no hub ERP Fiscal
 * (linha 2 da mensagem da cobranca) e sai no PDF do Inter.
 *
 * BLOCO 167 (pedido do dono): MINI BOLETO 80mm VOLTou — "busque um boleto no
 * sistema que está em a4 e transforme em um mini boleto completo e com layout
 * parecido com o da mini danfe". Novo gerador HTML miniBoleto80Html.ts (mesmo
 * padrão visual da mini DANFE: @page 70mm, mono, Code 128, QR do PIX).
 * O boleto OFICIAL segue sendo o PDF do Inter — o papel térmico é cópia de
 * conferência/trabalho (não fiscal).
 *
 * BLOCO 170 (pedido do dono): botão azul COMPROVANTE (80mm) REMOVIDO — ficou
 * apenas: Mini Boleto, PDF do Inter e Enviar (WhatsApp). O comprovante de
 * linha digitável da tela de entrega (EntregasView) continua intacto.
 *
 * BLOCO 177 (pedido do dono):
 *  - Mini Boleto imprime DIRETO SEM PREVIEW, com os DOIS canais ao alcance do
 *    toque: BLUETOOTH (mesmo caminho do cupom — a vendedora na rua imprime na
 *    térmica do aparelho) e USB DO PC. O modal de preview (MiniBoletoImpressao)
 *    foi removido.
 *  - Papel/comprovante MAIS COMPLETOS: beneficiário real (emitente do ERP),
 *    texto configurado no hub ERP Fiscal (Configurações → mensagem padrão do
 *    boleto) e a linha "ATRELADO A NF-e nº X" quando a venda tem NF-e (modelo
 *    55) autorizada — boleto NÃO atrela NFC-e.
 *  - Checkbox "Atrelar" só aparece quando a nota é NF-e (não mais NFC-e).
 *
 * BLOCO 199 — BOLETO DUPLICO (regra do dono, EXCLUSIVO rota 5 / Deivid):
 *  - Quando a venda tem PARCELAS (2 boletos que juntos fecham o valor — ex.:
 *    1º em 7 dias com parte do valor e o restante no 2º em 14 dias, ou
 *    dividido por 2), o card renderiza a LISTA dos dois boletos: um mini-card
 *    por boleto com SEU valor, SEU vencimento, SEU status, SEU PDF/WhatsApp/
 *    mini boleto e botão GERAR individual — mais o botão "Gerar os 2 boletos".
 *  - Baixa automática por parcela (webhook/cron): a venda fecha PAGO quando
 *    TODAS pagarem.
 *  - Sem parcelas: o card segue EXATAMENTE como antes (boleto único).
 *
 * BLOCO 200 — DIVISÃO CRIADA/EDITADA NA TELA DO CUPOM (regra do dono:
 * "isso deverá poder ser editado na tela de cupom onde aparece gerar boleto"):
 *  - Quando podeDividir (venda da ROTA 5) e NÃO existe boleto único ativo, o
 *    card mostra "Dividir em 2 boletos" ao lado do "Gerar Boleto": o form já
 *    nasce com o exemplo do dono (metade do valor, 1º em 7 dias e o 2º em 14
 *    dias) — com atalhos DIVIDIR POR 2 e 7D+14D e campos editáveis. O 2º
 *    boleto é SEMPRE o restante do saldo — a soma fecha EXATAMENTE a venda.
 *  - Com a divisão já gravada e NADA emitido no Inter, aparece "Editar
 *    divisão" (valores e vencimentos) — a API recria do zero enquanto nada
 *    saiu; depois de emitido, editar exige cancelar no Inter (Admin).
 */

interface BoletoCardProps {
  saleId: string;
  valorTotal: number;
  valorPago: number;
  notaStatus?: string;        // 'AUTORIZADA' habilita o "Atrelar NF-e"
  notaNumero?: number | string;
  /** BLOCO 177: tipo da nota ('NFE' | 'NFCE') — o atrelamento e a linha
   *  "ATRELADO A NF-e" só valem no modelo 55; NFC-e NUNCA atrela. */
  notaTipo?: string;
  clienteDoc?: string;        // CPF/CNPJ do cliente no cadastro
  clienteCep?: string;        // CEP do cliente no cadastro (Inter exige)
  clienteTelefone?: string;   // para o WhatsApp
  clienteNome?: string;       // BLOCO 82: pagador no comprovante 80mm
  showToast?: (msg: string, type?: 'success' | 'error') => void;
  /** BLOCO 67: abrir ja expandido (modal de venda finalizada). No cupom
   *  reaberto o padrao e DOBRADO — o card nao pode cobrir a tela. */
  abertoInicial?: boolean;
  /** BLOCO 123: reporta o status do boleto ao pai ('A_RECEBER', 'NAO_GERADO',
   *  'INDISPONIVEL'...) — gate fiscal da pronta entrega a prazo. */
  onStatusChange?: (status: string) => void;
  /** BLOCO 153: vencimento combinado na venda (YYYY-MM-DD) — o boleto do
   *  Inter nasce com o PRAZO negociado (fim do +7d fixo desalinhado). */
  vencimentoVenda?: string;
  /** BLOCO 200 (regra do dono): a venda pertence à ROTA 5 (David/Deivid)?
   *  Só então o card oferece DIVIDIR/EDITAR a divisão em 2 boletos — os
   *  pais (Cupom/PDV) casam pelo vendedorId da venda (à prova de renome). */
  podeDividir?: boolean;
}

interface InterStatus {
  configurado: boolean;
  ambiente: string;
}

const dataBR = (iso?: string) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

/** BLOCO 199: texto curto do status da parcela (badge individual). */
const badgeParcelaTxt = (p: BoletoParcelaInfo): string => {
  switch (p.status) {
    case 'A_RECEBER': return `A RECEBER — venc. ${dataBR(p.vencimento)}`;
    case 'RECEBIDO': case 'MARCADO_RECEBIDO': return 'PAGO';
    // BLOCO 225: o dono vê HÁ QUANTO tempo o Inter está processando —
    // “Gerando no Inter... (~12 min)” deixa claro se é normal ou travou.
    case 'EM_PROCESSAMENTO': return p.processandoMin != null ? `Gerando no Inter... (~${p.processandoMin} min)` : 'Gerando no Inter...';
    case 'ATRASADO': return `ATRASADO — venc. ${dataBR(p.vencimento)}`;
    case 'PROTESTO': return 'Em protesto';
    case 'CANCELADO': case 'EXPIRADO': return 'Cancelado';
    case 'FALHA_EMISSAO': return 'Falha — tente de novo';
    default: return 'Não gerado';
  }
};

const BoletoCard: React.FC<BoletoCardProps> = ({ saleId, valorTotal, valorPago, notaStatus, notaNumero, notaTipo, clienteDoc, clienteCep, clienteTelefone, clienteNome, showToast, abertoInicial, onStatusChange, vencimentoVenda, podeDividir }) => {
  const [boleto, setBoleto] = useState<BoletoInfo | null>(null);
  // BLOCO 199: parcelas do boleto duplo (vazio = fluxo de boleto único)
  const [parcelas, setParcelas] = useState<BoletoParcelaInfo[]>([]);
  const [indisponivel, setIndisponivel] = useState(false);
  const [inter, setInter] = useState<InterStatus | null>(null); // BLOCO 85: env do Inter visivel
  const [busy, setBusy] = useState(false);
  const [busyParcela, setBusyParcela] = useState<string>(''); // id da parcela em operação
  const [form, setForm] = useState(false);
  // BLOCO 67: card DOBRAVEL — a linha de status e sempre visivel (1 linha),
  // os botoes/form ficam atras do toque. Nao empurra mais o cupom pra fora.
  const [expandido, setExpandido] = useState<boolean>(!!abertoInicial);
  const [valor, setValor] = useState('');
  const [venc, setVenc] = useState('');
  // BLOCO 227: aviso do prazo da venda ja VENCIDO (sugestao de nova data)
  const [avisoPrazo, setAvisoPrazo] = useState('');
  const [atrelar, setAtrelar] = useState(true);
  const [doc, setDoc] = useState('');
  const [cep, setCep] = useState('');
  const [erroLocal, setErroLocal] = useState('');
  // BLOCO 177: impressão DIRETA do mini boleto (sem preview) — estado dos
  // canais + config/nota que chegam do servidor (GET /api/boletos).
  const [ocupadoMini, setOcupadoMini] = useState<'bt' | 'usb' | ''>('');
  const [temBt] = useState(() => temBluetoothNavegador());
  const [notaApi, setNotaApi] = useState<NotaDaVendaInfo | null>(null);
  const [cfgApi, setCfgApi] = useState<BoletoConfigInfo | null>(null);
  // ===================== BLOCO 200: DIVISÃO EM 2 BOLETOS =====================
  // CRIAR/EDITAR a divisão na tela do cupom (onde aparece "Gerar Boleto"):
  // dois boletos que JUNTOS fecham o saldo da venda — o 2º é SEMPRE o
  // restante (impossível não fechar). Exemplo do dono: 1º em 7 dias com
  // parte do valor e o restante no 2º em 14 dias, ou dividir por 2.
  const [formDiv, setFormDiv] = useState(false);
  const [v1Doc, setV1Doc] = useState('');
  const [venc1Doc, setVenc1Doc] = useState('');
  const [venc2Doc, setVenc2Doc] = useState('');
  const [busyDiv, setBusyDiv] = useState(false);
  // BLOCO 200: o SERVIDOR também diz se a venda é da rota 5 (GET /api/boletos
  // devolve podeDividir) — reforço à prova de falha do casamento feito no
  // client (id fixo/nome): se um dos dois disser SIM, a divisão aparece.
  const [podeDivApi, setPodeDivApi] = useState(false);
  // =========================================================================
  // BLOCO 210 — BOTÃO CANCELAR BOLETO (pedido do dono): junto ao boleto de
  // cada cliente, depois de gerado. Cancela APENAS o boleto escolhido (a
  // venda segue normal) e devolve a chance de gerar um NOVO boleto com a
  // data que o cliente decidir (ex.: saiu com data X e o cliente quer Y).
  // O SERVIDOR diz (GET podeCancelar) se o botão aparece — cancelamento
  // segue só ADMIN; o motivo (máx. 50) vai registrado no banco Inter.
  // =========================================================================
  const [podeCancelApi, setPodeCancelApi] = useState(false);
  const [alvoCancel, setAlvoCancel] = useState<string>(''); // '' | 'unico' | parcelaId
  const [motivoCancel, setMotivoCancel] = useState('Cliente pediu nova data');
  const [busyCancel, setBusyCancel] = useState(false);

  /* ===========================================================
   * BLOCO 217 — VISUALIZADOR DE PDF DO BOLETO (visualizar /
   * compartilhar / salvar).
   * O window.open(blob) antigo era bloqueado no celular (popup
   * depois de fetch async não é gesto do usuário) e blob: não
   * abre em apps externos — por isso o dono não conseguia ver,
   * compartilhar nem salvar. Agora o PDF abre NUM MODAL do
   * próprio app com os três botões, todos com gesto direto:
   * COMPARTILHAR (Web Share API com o ARQUIVO real — vai no
   * WhatsApp, e-mail etc.), SALVAR (download) e ABRIR EM NOVA
   * ABA (fallback desktop).
   * =========================================================== */
  const [pdfModal, setPdfModal] = useState<{ url: string; nome: string } | null>(null);
  const [ocupadoPdf, setOcupadoPdf] = useState(false);

  const abrirPdfModal = (base64: string, nome: string) => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    setPdfModal({ url: URL.createObjectURL(blob), nome });
  };

  const fecharPdfModal = () => {
    if (pdfModal) URL.revokeObjectURL(pdfModal.url);
    setPdfModal(null);
  };

  const compartilharPdf = async () => {
    if (!pdfModal) return;
    try {
      const res = await fetch(pdfModal.url);
      const blob = await res.blob();
      const arquivo = new File([blob], pdfModal.nome, { type: 'application/pdf' });
      const podeArquivo = !!navigator.canShare && navigator.canShare({ files: [arquivo] });
      if (podeArquivo) {
        await navigator.share({ files: [arquivo], title: pdfModal.nome, text: 'Boleto Doce Mania' });
        showToast?.('Boleto compartilhado!', 'success');
      } else {
        // Fallback: sem Web Share de arquivo (desktop/PC) — salva o PDF
        // (o dono anexa manualmente no WhatsApp Web) e avisa.
        const a = document.createElement('a');
        a.href = pdfModal.url; a.download = pdfModal.nome;
        document.body.appendChild(a); a.click(); a.remove();
        showToast?.('Compartilhamento direto indisponível aqui — o PDF foi salvo, anexe no WhatsApp.', 'success');
      }
    } catch (e: unknown) {
      if ((e as Error)?.name === 'AbortError') return; // usuário fechou a janela de compartilhar
      showToast?.('Não foi possível compartilhar — use SALVAR e anexe no WhatsApp.', 'error');
    }
  };

  const salvarPdf = () => {
    if (!pdfModal) return;
    const a = document.createElement('a');
    a.href = pdfModal.url; a.download = pdfModal.nome;
    document.body.appendChild(a); a.click(); a.remove();
    showToast?.('PDF salvo!', 'success');
  };

  const modalPdf = pdfModal ? (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[600] flex items-center justify-center p-3" onClick={fecharPdfModal}>
      <div className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92dvh]" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-800 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
          <p className="text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 min-w-0"><i className="fa-solid fa-file-pdf"></i><span className="truncate">Boleto — PDF do Inter</span></p>
          <button onClick={fecharPdfModal} className="text-white/80 active:scale-90 p-1" aria-label="Fechar PDF"><i className="fa-solid fa-xmark text-lg"></i></button>
        </div>
        {/* Visualização embutida do PDF — funciona no Chrome/Safari modernos */}
        <div className="flex-1 min-h-[280px] bg-gray-100 overflow-hidden">
          <iframe src={pdfModal.url} title="Boleto PDF" className="w-full h-full" />
        </div>
        <div className="p-3 grid grid-cols-3 gap-2 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button onClick={() => void compartilharPdf()} className="bg-green-600 text-white font-black py-3 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 flex flex-col items-center gap-1">
            <i className="fa-solid fa-share-nodes text-sm"></i>Compartilhar
          </button>
          <button onClick={salvarPdf} className="bg-blue-600 text-white font-black py-3 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 flex flex-col items-center gap-1">
            <i className="fa-solid fa-download text-sm"></i>Salvar
          </button>
          <a href={pdfModal.url} target="_blank" rel="noopener noreferrer" className="bg-gray-200 text-gray-700 font-black py-3 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 flex flex-col items-center gap-1">
            <i className="fa-solid fa-up-right-from-square text-sm"></i>Nova aba
          </a>
        </div>
      </div>
    </div>
  ) : null;

  /** BLOCO 217: PDF do boleto único — abre no visualizador (não mais window.open). */
  const handlePdf = async () => {
    if (busy || !saleId) return;
    setBusy(true);
    const r = await boletoService.obterPdf(saleId);
    setBusy(false);
    if (!r.ok || !r.pdfBase64) { showToast?.(r.erro || 'Falha ao buscar o PDF.', 'error'); return; }
    abrirPdfModal(r.pdfBase64, `boleto-doce-mania-${saleId.slice(0, 8).toUpperCase()}.pdf`);
  };

  useEffect(() => {
    if (!saleId) return;
    let vivo = true;
    (async () => {
      const r = await boletoService.status(saleId);
      if (!vivo) return;
      if (!r.ok) { setIndisponivel(true); return; } // SQL/Inter nao configurado: esconde a secao
      setBoleto(r.boleto || null);
      setParcelas(r.parcelas || []);
      setInter(r.inter || null);
      setNotaApi(r.nota || null);
      setCfgApi(r.config || null);
      setPodeDivApi(r.podeDividir === true);
      setPodeCancelApi(r.podeCancelar === true);
      if (r.boleto?.status === 'NAO_GERADO' && !(r.parcelas && r.parcelas.length > 0)) {
        // BLOCO 153: prazo correto = vencimento COMBINADO na venda (tela 6 do
        // PDV — sales.data_vencimento); sem prazo gravado, mantém o padrão +7d
        // BLOCO 212: data_vencimento é fim-do-dia em SP (30/11T23:59:59-03:00
        // = 01/12 02:59 UTC) — slice(0,10) direto mostrava/gravava D+1. A data
        // é convertida para o fuso America/Sao_Paulo antes de cortar.
        // ----------------------------------------------------------------
        // BLOCO 227 — CONFLITO QUE TRAVAVA "NENHUM BOLETO NOVO": prazo da
        // venda ja VENCIDO preenchia o campo com data do passado e o Inter
        // RECUSAVA o POST com a mensagem generica "Verifique se os dados
        // informados..." (caso real: venda Missioneiro com venc. 08/10
        // emitida em 27/11 — 50 dias no passado; e o boleto do paradouro
        // da nota cancelada nem chegou a nascer pelo mesmo motivo). Agora
        // prazo valido preenche o campo; prazo VENCIDO sugere +7 dias e
        // avisa o dono no card. O servidor tambem se protege (corrige
        // vencimento vencido para hoje e devolve avisoVencimento).
        // ----------------------------------------------------------------
        const fmtSp227 = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        const hoje227 = fmtSp227(new Date());
        const isoRaw = vencimentoVenda && /^\d{4}-\d{2}-\d{2}/.test(vencimentoVenda) ? vencimentoVenda : null;
        const iso = isoRaw ? fmtSp227(new Date(isoRaw)) : null;
        if (iso && iso >= hoje227) {
          setVenc(iso);
          setAvisoPrazo('');
        } else {
          setVenc(fmtSp227(new Date(Date.now() + 7 * 24 * 3600 * 1000)));
          setAvisoPrazo(iso ? `O prazo da venda (${iso.split('-').reverse().join('/')}) ja tinha passado — o campo veio com um novo prazo (+7 dias). Ajuste a data se quiser outro dia.` : '');
        }
        const saldo = Math.max(0, (valorTotal || 0) - (valorPago || 0));
        setValor(saldo > 0 ? saldo.toFixed(2) : (valorTotal || 0).toFixed(2));
      }
    })();
    return () => { vivo = false; };
  }, [saleId, vencimentoVenda]);

  // ===================== BLOCO 199: handlers das parcelas =====================
  /** Refresca a lista da API (usada após cada operação). */
  const refrescarParcelas = async () => {
    const r = await boletoService.status(saleId);
    if (r.ok && r.parcelas) setParcelas(r.parcelas);
    if (r.ok && r.boleto) setBoleto(r.boleto);
    if (r.ok) setPodeCancelApi(r.podeCancelar === true);
  };

  // ======================================================================
  // BLOCO 239 — AUTO-POLL: a emissão é ASSÍNCRONA no Inter — o POST aceita
  // em segundos e a LINHA DIGITÁVEL chega depois. O card pergunta sozinho.
  // ======================================================================
  // BLOCO 240 — AUTO-POLL PACIENTE (fim do “boleto não gera / demora”):
  // o caso REAL de 28/11 (Mercado Bagé) provou nos dados: o POST é ACEITO
  // pelo Inter em segundos, mas o PROCESSAMENTO (linha digitável/pix) é
  // assíncrono LÁ DENTRO e nos últimos dias o Inter está aceitando rápido e
  // processando em MINUTOS (cobrança do Bagé aceita 16:06, processando
  // 20+ min depois — o próprio sync/webhook confirmou EM_PROCESSAMENTO na
  // API deles). O auto-poll antigo parava em 24s (6x4s) e o card congelava
  // em “Gerando...” para o dono tocar ATUALIZAR na mão — ele via “não gera”.
  // Agora o poll ESCALONA: 6x4s (24s) + 8x10s (80s) + 5x20s (100s) =
  // ~3,4 min de paciência automática, parando no primeiro status final.
  // O sync (cron 3x/dia + auto-sync 1h) e o webhook continuam a rede por
  // trás: quando o Inter processar, o card atualiza SOZINHO.
  // ======================================================================
  const pollVivoRef = useRef(false);
  useEffect(() => () => { pollVivoRef.current = false; }, []);

  /** BLOCO 240: agenda de esperas do auto-poll (backoff paciente). */
  const PLANOPOLL_MS = [4000, 4000, 4000, 4000, 4000, 4000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 20000, 20000, 20000, 20000, 20000];

  const autoPollUnico = () => {
    let rodadas = 0;
    const passo = async () => {
      while (rodadas < PLANOPOLL_MS.length) {
        await new Promise(res => setTimeout(res, PLANOPOLL_MS[rodadas]));
        rodadas++;
        if (!pollVivoRef.current) return;
        try {
          const c = await boletoService.consultar(saleId);
          if (!pollVivoRef.current) return;
          if (c.ok && c.boleto) {
            setBoleto(c.boleto);
            if (c.boleto.status !== 'EM_PROCESSAMENTO') return; // linha chegou — para
          }
        } catch { /* próxima rodada */ }
      }
    };
    void passo();
  };

  const autoRefreshParcelas = () => {
    let rodadas = 0;
    const passo = async () => {
      while (rodadas < PLANOPOLL_MS.length) {
        await new Promise(res => setTimeout(res, PLANOPOLL_MS[rodadas]));
        rodadas++;
        if (!pollVivoRef.current) return;
        try { await refrescarParcelas(); } catch { /* próxima rodada */ }
      }
    };
    void passo();
  };

  /** Doc/CEP finais: digitado no card > cadastro (mesma regra do boleto único). */
  const docFinal = doc.replace(/\D/g, '') || (clienteDoc || '').replace(/\D/g, '');
  const cepFinal = cep.replace(/\D/g, '') || (clienteCep || '').replace(/\D/g, '');

  // ===================================================================
  // BLOCO 200 — conta da divisão: saldo que os DOIS boletos precisam
  // fechar (mesma conta da API: total - pago). O 2º boleto é SEMPRE o
  // restante — a soma fecha EXATAMENTE o valor da venda.
  // ===================================================================
  const saldoDiv = Math.max(0, Math.round(((valorTotal || 0) - (valorPago || 0)) * 100) / 100);
  const v1Num = Math.round((parseFloat(v1Doc) || 0) * 100) / 100;
  const v2Num = Math.round((saldoDiv - v1Num) * 100) / 100;
  const dataOkDiv = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const divOk = v1Num >= 2.5 && v2Num >= 2.5 && dataOkDiv(venc1Doc) && dataOkDiv(venc2Doc);
  const formatoDiaBRDiv = (iso: string) => (iso || '').split('-').reverse().join('/');
  /** Data de hoje + n dias no fuso de São Paulo (YYYY-MM-DD). */
  const plusDias = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * 24 * 3600 * 1000));

  /** BLOCO 200: abre o form da divisão — CRIAR (sem parcelas: metade do
   *  valor + 1º em 7 dias / 2º em 14 dias, o exemplo do dono) ou EDITAR
   *  (os valores/vencimentos atuais voltam nos campos). */
  const abrirDivisao = (editar: boolean) => {
    setErroLocal('');
    if (editar && parcelas.length >= 2) {
      setV1Doc(Number(parcelas[0].valor || 0).toFixed(2));
      setVenc1Doc(String(parcelas[0].vencimento || '').slice(0, 10));
      setVenc2Doc(String(parcelas[1].vencimento || '').slice(0, 10));
    } else {
      setV1Doc((Math.floor((saldoDiv / 2) * 100) / 100).toFixed(2));
      setVenc1Doc(plusDias(7));
      setVenc2Doc(plusDias(14));
    }
    setFormDiv(true);
  };

  /** BLOCO 200: grava a divisão (2 boletos que juntos fecham o saldo). A API
   *  recria do zero enquanto NADA foi emitido no Inter — depois de emitido,
   *  editar exige cancelar os boletos no Inter (Admin). */
  const confirmarDivisao = async () => {
    if (busyDiv || !saleId) return;
    if (!(saldoDiv > 0)) {
      setErroLocal('A venda não tem saldo em aberto para dividir.');
      showToast?.('Sem saldo em aberto para dividir.', 'error');
      return;
    }
    if (!divOk) {
      setErroLocal('Cada boleto precisa de no mínimo R$ 2,50 (regra do Inter) e as duas datas de vencimento preenchidas.');
      showToast?.('Ajuste os valores e as datas da divisão.', 'error');
      return;
    }
    setBusyDiv(true);
    const r = await boletoService.criarParcelas(saleId, [
      { valor: v1Num, vencimento: venc1Doc },
      { valor: v2Num, vencimento: venc2Doc },
    ]);
    setBusyDiv(false);
    if (!r.ok) {
      setErroLocal(r.erro || 'Falha ao gravar a divisão.');
      showToast?.(r.erro || 'Falha ao gravar a divisão.', 'error');
      return;
    }
    setFormDiv(false);
    await refrescarParcelas();
    showToast?.(`Divisão gravada: R$ ${v1Num.toFixed(2)} em ${formatoDiaBRDiv(venc1Doc)} + R$ ${v2Num.toFixed(2)} em ${formatoDiaBRDiv(venc2Doc)} — os dois juntos fecham a venda.`, 'success');
  };

  /** BLOCO 200: form da divisão (o MESMO para criar e editar — aparece
   *  no modo boleto único e no modo parcelado). */
  const formDivisao = (
    <div className="space-y-2.5 bg-violet-50/60 rounded-xl p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[8px] font-black uppercase text-gray-500">Boleto 1 — valor (R$)</span>
          <input type="number" step="0.01" min="2.5" inputMode="decimal" value={v1Doc} onChange={e => setV1Doc(e.target.value)} placeholder="0.00" aria-label="Valor do primeiro boleto"
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-black text-center text-gray-800 focus:outline-none focus:border-violet-300" />
        </label>
        <div>
          <span className="text-[8px] font-black uppercase text-gray-500">Boleto 2 — restante (automático)</span>
          <div className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-black text-center text-violet-700 bg-white" aria-label="Valor do segundo boleto">R$ {v2Num.toFixed(2)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setV1Doc((Math.floor((saldoDiv / 2) * 100) / 100).toFixed(2))}
          className="py-2 rounded-lg text-[9px] font-black uppercase bg-white border-2 border-violet-200 text-violet-600 active:scale-95">
          <i className="fa-solid fa-divide mr-1"></i>Dividir por 2
        </button>
        <button type="button" onClick={() => { setVenc1Doc(plusDias(7)); setVenc2Doc(plusDias(14)); }}
          className="py-2 rounded-lg text-[9px] font-black uppercase bg-white border-2 border-violet-200 text-violet-600 active:scale-95">
          <i className="fa-solid fa-calendar-days mr-1"></i>7D + 14D
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[8px] font-black uppercase text-gray-500">Boleto 1 — vencimento</span>
          <input type="date" min={plusDias(0)} value={venc1Doc} onChange={e => setVenc1Doc(e.target.value)} aria-label="Vencimento do primeiro boleto" // BLOCO 227: min = hoje — data passada o Inter recusa na hora
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-black text-center text-gray-800 focus:outline-none focus:border-violet-300" />
        </label>
        <label className="block">
          <span className="text-[8px] font-black uppercase text-gray-500">Boleto 2 — vencimento</span>
          <input type="date" min={plusDias(0)} value={venc2Doc} onChange={e => setVenc2Doc(e.target.value)} aria-label="Vencimento do segundo boleto" // BLOCO 227: min = hoje
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-black text-center text-gray-800 focus:outline-none focus:border-violet-300" />
        </label>
      </div>
      {dataOkDiv(venc1Doc) && dataOkDiv(venc2Doc) && (
        <p className="text-[8px] font-black text-violet-600 uppercase text-center leading-snug">
          R$ {v1Num.toFixed(2)} vence {formatoDiaBRDiv(venc1Doc)} + R$ {v2Num.toFixed(2)} vence {formatoDiaBRDiv(venc2Doc)} = R$ {saldoDiv.toFixed(2)}
        </p>
      )}
      {!divOk && (
        <p className="text-[8px] font-black text-rose-600 uppercase text-center leading-snug">
          <i className="fa-solid fa-triangle-exclamation mr-1"></i>Cada boleto precisa de no mínimo R$ 2,50 e das duas datas — o 2º fecha o restante.
        </p>
      )}
      <button onClick={() => void confirmarDivisao()} disabled={busyDiv || !divOk}
        className="block w-full bg-violet-600 text-white font-black py-2.5 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-50">
        <i className={`fa-solid ${busyDiv ? 'fa-spinner fa-spin' : 'fa-check'} mr-1`}></i>
        Salvar divisão em 2 boletos
      </button>
    </div>
  );

  const validarDocCepParcela = (): boolean => {
    if (inter && !inter.configurado) {
      setErroLocal('Boleto temporariamente indisponível: as credenciais do Inter não estão configuradas no servidor (env da Vercel). Avise o admin para definir INTER_CLIENT_ID, INTER_CLIENT_SECRET e o certificado.');
      showToast?.('Inter não configurado no servidor (env Vercel).', 'error');
      return false;
    }
    if (!docFinal) {
      setErroLocal('Informe o CPF/CNPJ do pagador.');
      showToast?.('Informe o CPF/CNPJ do pagador.', 'error');
      return false;
    }
    if (!validaCpfCnpj(docFinal)) {
      setErroLocal('CPF/CNPJ inválido — confira os números (CPF tem 11 dígitos, CNPJ tem 14).');
      showToast?.('CPF/CNPJ do pagador inválido.', 'error');
      return false;
    }
    if (cepFinal.length !== 8) {
      setErroLocal('O boleto do Inter precisa do CEP do pagador (8 dígitos). Informe abaixo ou complete no cadastro do cliente.');
      showToast?.('Informe o CEP do pagador (8 dígitos).', 'error');
      return false;
    }
    return true;
  };

  /** Gera TODAS as parcelas abertas de uma vez (os 2 boletos juntos). */
  const handleEmitirTodas = async () => {
    // BLOCO 212: o lock agora é ÚNICO (busy || busyParcela) — antes "Gerar os
    // 2 boletos" e "Gerar" individual usavam locks separados e um atravessava
    // o outro, emitindo cobrança DUPLA no Inter para o mesmo débito.
    if (busy || busyParcela || !saleId) return;
    if (!validarDocCepParcela()) return;
    setErroLocal('');
    setBusy(true);
    const r = await boletoService.emitirTodasParcelas(saleId, { docManual: doc || undefined, cepManual: cep || undefined });
    setBusy(false);
    await refrescarParcelas();
    const falhas = (r.resultados || []).filter(x => !x.ok);
    if (!r.ok && (r.resultados || []).length === 0) {
      // BLOCO 212: falha de rede/HTTP (resultados vazio) agora APARECE na tela
      // — antes o ok/erro do servidor era ignorado e o clique "não fazia nada".
      showToast?.(r.erro || 'Falha ao gerar os boletos.', 'error');
      setErroLocal(r.erro || 'Falha ao gerar os boletos.');
      return;
    }
    if (falhas.length > 0) {
      const okN = (r.resultados || []).length - falhas.length;
      showToast?.(`Boleto ${falhas[0].seq} falhou: ${falhas[0].erro || 'erro no Inter'}${okN > 0 ? ` (${okN} gerado(s) com sucesso)` : ''}`, 'error');
      setErroLocal(`Boleto ${falhas[0].seq}: ${falhas[0].erro || 'falha na emissão'}`);
    } else if ((r.resultados || []).length > 0) {
      showToast?.(`${(r.resultados || []).length} boleto(s) gerado(s)! O Inter pode demorar alguns segundos para liberar a linha digitável.`, 'success');
      // BLOCO 239: emissão é assíncrona — o card PERGUNTA sozinho até a linha
      // chegar (antes era UMA consulta de 4s e parava).
      autoRefreshParcelas();
    }
  };

  /** Gera UMA parcela (botão individual do boleto). */
  const handleGerarParcela = async (p: BoletoParcelaInfo) => {
    // BLOCO 212: mesmo lock único da geração em lote (ver comentário acima).
    if (busy || busyParcela || !saleId) return;
    if (!validarDocCepParcela()) return;
    setErroLocal('');
    setBusyParcela(p.id);
    const r = await boletoService.gerarParcela(saleId, p.id, { docManual: doc || undefined, cepManual: cep || undefined });
    setBusyParcela('');
    if (!r.ok && !r.parcela) {
      setErroLocal(r.erro || 'Falha ao gerar o boleto.');
      showToast?.(r.erro || 'Falha ao gerar o boleto.', 'error');
      return;
    }
    await refrescarParcelas();
    // BLOCO 239: cobranca sombra da tentativa anterior foi RECUPERADA —
    // o boleto nasceu lá e NÃO foi emitido em dobro.
    if (r.avisoRecuperacao) showToast?.(r.avisoRecuperacao, 'success');
    if (r.jaGerado) { showToast?.(`Boleto ${p.seq} já está gerado.`, 'success'); return; }
    if (r.parcela?.status === 'EM_PROCESSAMENTO') {
      showToast?.(`Boleto ${p.seq} gerado! O Inter está processando...`, 'success');
      // BLOCO 239: auto-poll das parcelas (antes era UMA consulta de 4s).
      autoRefreshParcelas();
    } else {
      showToast?.(`Boleto ${p.seq} gerado!`, 'success');
    }
  };

  const handleConsultarParcela = async (p: BoletoParcelaInfo) => {
    if (busyParcela || !saleId) return;
    setBusyParcela(p.id);
    const r = await boletoService.consultarParcela(saleId, p.id);
    setBusyParcela('');
    if (!r.ok && !r.parcela) { showToast?.(r.erro || 'Falha ao consultar.', 'error'); return; }
    await refrescarParcelas();
  };

  /** BLOCO 217: PDF da parcela — mesmo visualizador do boleto único. */
  const handlePdfParcela = async (p: BoletoParcelaInfo) => {
    if (busyParcela || !saleId) return;
    setBusyParcela(p.id);
    const r = await boletoService.obterPdfParcela(saleId, p.id);
    setBusyParcela('');
    if (!r.ok || !r.pdfBase64) { showToast?.(r.erro || 'Falha ao buscar o PDF.', 'error'); return; }
    abrirPdfModal(r.pdfBase64, `boleto-${p.seq}-doce-mania-${saleId.slice(0, 8).toUpperCase()}.pdf`);
  };

  /* BLOCO 217 (regra do dono): o WhatsApp não leva mais linha digitável nem
   * PIX copia-e-cola — não usamos isso. Mensagem curta: valor, vencimento e
   * pedido de confirmação. O PDF real vai pelo botão COMPARTILHAR do
   * visualizador (arquivo do Inter). */
  const handleWhatsParcela = (p: BoletoParcelaInfo) => {
    const linhas = [
      `*BOLETO ${p.seq} DE ${parcelas.length} — DOCE MANIA*`,
      p.valor ? `Valor: R$ ${Number(p.valor).toFixed(2)}` : '',
      p.vencimento ? `Vencimento: ${dataBR(p.vencimento)}` : '',
      'Assim que pagar, me manda o comprovante por aqui. Obrigado!',
    ].filter(Boolean).join('\n');
    const phone = (clienteTelefone || '').replace(/\D/g, '');
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(linhas)}`, '_blank');
  };

  /** Mini boleto 80mm por parcela (mesmos canais BT/USB do boleto único). */
  const imprimirMiniParcela = async (canal: 'bt' | 'usb', p: BoletoParcelaInfo) => {
    if (ocupadoMini) return;
    setOcupadoMini(canal);
    try {
      const dados: MiniBoletoDados = {
        beneficiarioNome: cfgApi?.beneficiarioNome,
        beneficiarioDoc: cfgApi?.beneficiarioDoc,
        pagadorNome: clienteNome,
        pagadorDoc: clienteDoc,
        valor: p.valor,
        vencimento: p.vencimento,
        status: p.status,
        linhaDigitavel: p.linhaDigitavel,
        codigoBarras: p.codigoBarras,
        pixCopiaECola: p.pixCopiaECola,
        vendaRef: `${saleId.slice(0, 8).toUpperCase()}-P${p.seq}`,
        seuNumero: p.seuNumero,
        mensagemPadrao: cfgApi?.mensagemPadrao,
      };
      if (canal === 'usb') {
        const html = await miniBoleto80Html(dados);
        imprimirHtmlViaUsb(html, (m) => showToast?.(`Falha na janela USB: ${m}`, 'error'));
        showToast?.('Janela de impressão aberta — escolha a térmica USB.', 'success');
        return;
      }
      const ok = await imprimirHtmlViaBt(
        () => miniBoleto80Html(dados, { raster: true }),
        () => comprovanteBoletoTexto({
          empresaNome: dados.beneficiarioNome || 'DOCE MANIA',
          empresaDoc: dados.beneficiarioDoc,
          vendaRef: dados.vendaRef,
          seuNumero: dados.seuNumero,
          pagadorNome: dados.pagadorNome,
          pagadorDoc: dados.pagadorDoc,
          valor: dados.valor,
          vencimento: dados.vencimento,
          status: dados.status,
          linhaDigitavel: dados.linhaDigitavel,
          codigoBarras: dados.codigoBarras,
          pixCopiaECola: dados.pixCopiaECola,
          mensagemPadrao: dados.mensagemPadrao,
        }),
      );
      if (ok) showToast?.('Mini Boleto enviado à impressora Bluetooth!', 'success');
      else showToast?.('Impressão não realizada — conecte a impressora.', 'error');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast?.(msg === 'BLUETOOTH_NAO_SUPORTADO'
        ? 'Bluetooth indisponível aqui — use o botão USB do PC.'
        : `Erro: ${msg}`, 'error');
    } finally {
      setOcupadoMini('');
    }
  };

  // BLOCO 123: reporta o status do boleto ao pai (gate fiscal da pronta
  // entrega a prazo). Card indisponível (Inter sem credenciais) reporta
  // 'INDISPONIVEL' — o pai decide o que fazer (não bloqueia o impossível).
  // BLOCO 199: no modo parcelado o status AGREGADO conta as parcelas.
  const statusAgregado = useMemo(() => {
    if (parcelas.length > 0) {
      const todasPagas = parcelas.every(p => p.status === 'RECEBIDO' || p.status === 'MARCADO_RECEBIDO');
      if (todasPagas) return 'RECEBIDO';
      const temAberta = parcelas.some(p => ['A_RECEBER', 'ATRASADO', 'EM_PROCESSAMENTO'].includes(p.status));
      if (temAberta) return 'A_RECEBER';
      return 'NAO_GERADO';
    }
    return boleto?.status || 'NAO_GERADO';
  }, [parcelas, boleto?.status]);

  useEffect(() => {
    if (!onStatusChange) return;
    onStatusChange(indisponivel ? 'INDISPONIVEL' : statusAgregado);
  }, [statusAgregado, indisponivel, onStatusChange]);

  const handleGerar = async () => {
    if (busy || !saleId) return;
    // BLOCO 85: sem env do Inter o clique so frustra — avisa na hora
    if (inter && !inter.configurado) {
      setErroLocal('Boleto temporariamente indisponível: as credenciais do Inter não estão configuradas no servidor (env da Vercel). Avise o admin para definir INTER_CLIENT_ID, INTER_CLIENT_SECRET e o certificado.');
      showToast?.('Inter não configurado no servidor (env Vercel).', 'error');
      return;
    }
    setErroLocal('');
    // Validacao local (evita a mensagem generica do Inter e poupa a chamada):
    if (!docFinal) {
      setErroLocal('Informe o CPF/CNPJ do pagador.');
      showToast?.('Informe o CPF/CNPJ do pagador.', 'error');
      return;
    }
    if (!validaCpfCnpj(docFinal)) {
      setErroLocal('CPF/CNPJ inválido — confira os números (CPF tem 11 dígitos, CNPJ tem 14).');
      showToast?.('CPF/CNPJ do pagador inválido.', 'error');
      return;
    }
    if (cepFinal.length !== 8) {
      setErroLocal('O boleto do Inter precisa do CEP do pagador (8 dígitos). Informe abaixo ou complete no cadastro do cliente.');
      showToast?.('Informe o CEP do pagador (8 dígitos).', 'error');
      return;
    }
    // BLOCO 227: data vencida NAO segue para o Inter (a recusa dele é a
    // mensagem generica "Verifique os dados..." que confundia o dono) —
    // corrige para HOJE na hora e avisa.
    let vencEnvio = venc;
    if (vencEnvio && vencEnvio < plusDias(0)) {
      vencEnvio = plusDias(0);
      setVenc(vencEnvio);
      showToast?.(`Vencimento corrigido para HOJE (a data ${venc.split('-').reverse().join('/')} ja tinha passado).`, 'success');
    }
    setBusy(true);
    const r = await boletoService.gerar(saleId, {
      vencimento: vencEnvio,
      valor: valor || undefined,
      atrelarNFe: atrelar,
      docManual: doc || undefined,
      cepManual: cep || undefined,
    });
    setBusy(false);
    if (r.erro && !r.boleto) {
      setErroLocal(r.erro);
      showToast?.(r.erro, 'error');
      return;
    }
    if (r.boleto) setBoleto(r.boleto);
    setForm(false);
    if (r.ok && r.boleto) {
      // FIX atrelamento: o vendedor fica sabendo NA HORA se o boleto nasceu
      // sem a nota (chave ainda nao sincronizada ou checkbox desligado).
      // BLOCO 227: o servidor pode ter corrigido o vencimento vencido —
      // avisa o dono na hora.
      // BLOCO 239: a cobranca sombra da tentativa anterior foi RECUPERADA —
      // o boleto nasceu (a emissão anterior foi aceita lá) e NÃO foi dobrado.
      if (r.avisoRecuperacao) showToast?.(r.avisoRecuperacao, 'success');
      if (r.avisoVencimento) showToast?.(r.avisoVencimento, 'success');
      if (r.avisoAtrelamento) {
        showToast?.(r.avisoAtrelamento, 'error');
      } else if (r.notaAtrelada) {
        showToast?.('Boleto gerado com a NF-e/NFC-e atrelada (chave enviada ao Inter).', 'success');
      }
      if (r.boleto.status === 'EM_PROCESSAMENTO') {
        showToast?.('Boleto gerado! O Inter esta processando...', 'success');
        // BLOCO 239: auto-poll — o card PERGUNTA sozinho (6x4s) até a linha
        // digitável chegar; sem clique extra no ATUALIZAR.
        autoPollUnico();
      } else {
        showToast?.('Boleto gerado!', 'success');
      }
    }
  };

  const handleConsultar = async () => {
    if (busy || !saleId) return;
    setBusy(true);
    const r = await boletoService.consultar(saleId);
    setBusy(false);
    if (r.erro && !r.boleto) { showToast?.(r.erro, 'error'); return; }
    if (r.boleto) setBoleto(r.boleto);
  };

  // ============================================================
  // BLOCO 224 — DESTRAVAR boleto preso em "EM PROCESSAMENTO"
  // (caso Paradouro do Campo / Zotti Tijuca): o Inter RECUSA o
  // cancelamento de cobrança em processamento lá dentro e a
  // reconsulta não sai do lugar; o GERAR devolvia "já gerado"
  // para sempre. O DESTRAVAR (ADMIN) marca FALHA DE EMISSÃO local
  // e libera o GERAR para um boleto NOVO. A cobrança antiga fica
  // no Inter sem linha digitável — ninguém consegue pagá-la.
  // ============================================================
  const handleDestravar = async (parcelaId?: string) => {
    if (busy || busyParcela || !saleId) return;
    const ehParcela = !!parcelaId;
    if (!window.confirm(ehParcela
      ? 'Destavar este boleto travado em "EM PROCESSAMENTO"?\n\nMarca FALHA DE EMISSÃO no sistema e libera o GERAR para um boleto novo. A cobrança antiga fica no Inter sem linha digitável — ninguém consegue pagá-la.'
      : 'Destavar o boleto travado em "EM PROCESSAMENTO"?\n\nMarca FALHA DE EMISSÃO no sistema e libera o GERAR para um boleto novo. A cobrança antiga fica no Inter sem linha digitável — ninguém consegue pagá-la.')) return;
    setErroLocal('');
    if (ehParcela) {
      setBusyParcela(parcelaId);
      const r = await boletoService.destravar(saleId, parcelaId);
      setBusyParcela('');
      if (!r.ok && !r.parcela) { showToast?.(r.erro || 'Falha ao destravar.', 'error'); return; }
      showToast?.('Boleto destravado — clique GERAR para gerar o novo.', 'success');
      await refrescarParcelas();
      return;
    }
    setBusy(true);
    const r = await boletoService.destravar(saleId);
    setBusy(false);
    if (!r.ok && !r.boleto) { showToast?.(r.erro || 'Falha ao destravar.', 'error'); return; }
    if (r.boleto) setBoleto(r.boleto);
    showToast?.('Boleto destravado — clique GERAR para gerar o novo.', 'success');
  };

  // ============================================================
  // BLOCO 227 — RESET TOTAL (admin, ultimo recurso; pedido do dono:
  // "reseta todo o sistema de boletos e deixa tudo funcional").
  // Cancela as cobrancas vivas no Inter (o que o Inter recusar fica
  // vigiado e o sistema cancela sozinho depois), apaga o boleto unico
  // e a divisao de parcelas e devolve a venda ao estado SEM BOLETO —
  // o GERAR volta a funcionar do zero em qualquer situacao travada.
  // Protecao no servidor: boleto ja RECEBIDO nao pode ser apagado.
  // ============================================================
  const handleResetar = async () => {
    if (busy || !saleId) return;
    if (!window.confirm('RESETAR TODO O BOLETO desta venda?\n\nApaga o boleto unico e a divisao de parcelas do sistema e tenta cancelar as cobrancas no Inter (o que o Inter recusar fica vigiado e sera cancelado sozinho pelo sistema). A venda volta ao estado SEM BOLETO para gerar tudo de novo.\n\nNao afeta boletos ja RECEBIDOS (dinheiro real fica intocado).')) return;
    setErroLocal('');
    setBusy(true);
    const r = await boletoService.resetar(saleId);
    setBusy(false);
    if (!r.ok) { showToast?.(r.erro || 'Falha ao resetar o boleto.', 'error'); return; }
    setBoleto(r.boleto || null);
    setParcelas([]);
    setAvisoPrazo('');
    if (r.aviso) showToast?.(r.aviso, 'success');
    showToast?.('Boleto resetado — a venda voltou para SEM BOLETO. Clique GERAR para comecar de novo.', 'success');
  };

  // BLOCO 217: o handlePdf do boleto único agora vive junto do visualizador
  // (topo do componente — usa boletoService.obterPdf e abre o modal PDF).
  // BLOCO 170: COMPROVANTE 80mm removido deste card (pedido do dono) — o mini
  // boleto completo (impressão DIRETA, BLOCO 177) cobre a térmica com linha
  // digitável + código de barras + QR do PIX.

  const handleCopiarTexto = async (txt: string, rotulo: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(txt);
      } else {
        const ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast?.(`${rotulo} copiado!`, 'success');
    } catch { showToast?.('Falha ao copiar.', 'error'); }
  };

  /* BLOCO 217 (regra do dono): WhatsApp do boleto único SEM linha digitável
   * e SEM PIX copia-e-cola — mensagem curta com valor e vencimento. */
  const handleWhats = () => {
    if (!boleto) return;
    const linhas = [
      '*BOLETO DOCE MANIA*',
      boleto.valor ? `Valor: R$ ${Number(boleto.valor).toFixed(2)}` : '',
      boleto.vencimento ? `Vencimento: ${dataBR(boleto.vencimento)}` : '',
      'Assim que pagar, me manda o comprovante por aqui. Obrigado!',
    ].filter(Boolean).join('\n');
    const phone = (clienteTelefone || '').replace(/\D/g, '');
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(linhas)}`, '_blank');
  };

  // =====================================================================
  // BLOCO 210: CANCELAR APENAS O BOLETO (venda NÃO é cancelada — BLOCO 192
  // já garantia isso no servidor). Boleto único OU a parcela escolhida.
  // Depois recarrega: status CANCELADO volta a oferecer "Gerar Novamente"
  // (boleto único) / "Refazer" (parcela) — a chance de gerar o novo boleto
  // com a data que o cliente escolheu.
  // =====================================================================
  const confirmarCancelamento = async () => {
    if (busyCancel || !saleId) return;
    const motivo = motivoCancel.trim();
    if (!motivo) return;
    setBusyCancel(true);
    const r = alvoCancel === 'unico'
      ? await boletoService.cancelar(saleId, motivo)
      : await boletoService.cancelarParcela(saleId, alvoCancel, motivo);
    setBusyCancel(false);
    if (!r.ok) {
      setErroLocal(r.erro || 'Falha ao cancelar o boleto.');
      showToast?.(r.erro || 'Falha ao cancelar o boleto.', 'error');
      return;
    }
    setAlvoCancel('');
    await refrescarParcelas();
    showToast?.('Boleto cancelado no banco — a venda segue normal. Agora gere o novo boleto com a data que o cliente escolheu.', 'success');
  };

  /** BLOCO 210: mini-form de CONFIRMAÇÃO do cancelamento (motivo editável —
   *  vai registrado no banco; máx. 50 chars, limite da API do Inter). */
  const formCancel = (alvo: string, rotulo: string) => (
    <div className="space-y-2 bg-rose-50/70 border border-rose-200 rounded-xl p-2.5">
      <p className="text-[9px] font-black text-rose-700 uppercase leading-snug">
        <i className="fa-solid fa-ban mr-1"></i>
        Cancelar {rotulo}? O cliente NÃO poderá mais pagar ESTE boleto. A venda fica NORMAL — depois toque em GERAR com a nova data escolhida.
      </p>
      <label className="block">
        <span className="text-[8px] font-black uppercase text-gray-500">Motivo no banco (máx. 50)</span>
        <input type="text" maxLength={50} value={motivoCancel} onChange={e => setMotivoCancel(e.target.value)} aria-label="Motivo do cancelamento"
          className="w-full border border-rose-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-rose-300" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setAlvoCancel('')} disabled={busyCancel}
          className="bg-white border-2 border-gray-200 text-gray-500 font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest active:scale-95 disabled:opacity-50">
          <i className="fa-solid fa-arrow-left mr-1"></i>Voltar
        </button>
        <button type="button" onClick={() => void confirmarCancelamento()} disabled={busyCancel || !motivoCancel.trim()}
          className="bg-rose-600 text-white font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest active:scale-95 disabled:opacity-50">
          <i className={`fa-solid ${busyCancel ? 'fa-spinner fa-spin' : 'fa-ban'} mr-1`}></i>Cancelar boleto
        </button>
      </div>
    </div>
  );

  const badge = (): { cls: string; icon: string; txt: string } => {
    const s = boleto?.status || 'NAO_GERADO';
    switch (s) {
      case 'A_RECEBER': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-barcode', txt: `BOLETO A RECEBER — venc. ${dataBR(boleto?.vencimento)}` };
      case 'RECEBIDO': case 'MARCADO_RECEBIDO': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-circle-check', txt: `BOLETO PAGO${boleto?.valorRecebido ? ` — R$ ${Number(boleto.valorRecebido).toFixed(2)}` : ''}` };
      // BLOCO 225: badge mostra HÁ QUANTO tempo o Inter está processando.
      case 'EM_PROCESSAMENTO': return { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'fa-hourglass-half', txt: boleto?.processandoMin != null ? `Gerando boleto no Inter... (~${boleto.processandoMin} min)` : 'Gerando boleto no Inter...' };
      case 'ATRASADO': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-triangle-exclamation', txt: `BOLETO ATRASADO — venc. ${dataBR(boleto?.vencimento)}` };
      case 'PROTESTO': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-gavel', txt: 'Boleto em protesto' };
      case 'CANCELADO': case 'EXPIRADO': return { cls: 'bg-gray-100 text-gray-500 border-gray-200', icon: 'fa-ban', txt: 'Boleto cancelado' };
      case 'FALHA_EMISSAO': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-circle-xmark', txt: 'Falha ao gerar — toque em tentar de novo' };
      default: return { cls: 'bg-gray-50 text-gray-500 border-gray-200', icon: 'fa-file-invoice-dollar', txt: 'Sem boleto — toque para gerar' };
    }
  };

  // ===================================================================
  // BLOCO 199: badge AGREGADO do modo parcelado (a venda fecha quando as
  // duas parcelas pagarem — cada uma com o seu status).
  // ===================================================================
  const badgeParcelado = (): { cls: string; icon: string; txt: string } => {
    const pagas = parcelas.filter(p => p.status === 'RECEBIDO' || p.status === 'MARCADO_RECEBIDO').length;
    const todas = parcelas.length;
    const soma = parcelas.reduce((acc, p) => acc + (Number(p.valor) || 0), 0);
    if (pagas === todas) return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-circle-check', txt: `BOLETO DUPLICO — PAGO (${pagas}/${todas}) — R$ ${soma.toFixed(2)}` };
    if (pagas > 0) return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-circle-half-stroke', txt: `BOLETO DUPLICO — ${pagas}/${todas} pago(s)` };
    if (parcelas.some(p => p.status === 'EM_PROCESSAMENTO')) {
      // BLOCO 225: o badge agregado mostra o maior tempo em processamento.
      const maxMin = Math.max(0, ...parcelas.map(p => (p.status === 'EM_PROCESSAMENTO' && p.processandoMin != null) ? p.processandoMin : 0));
      return { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'fa-hourglass-half', txt: maxMin > 0 ? `Gerando os boletos no Inter... (~${maxMin} min)` : 'Gerando os boletos no Inter...' };
    }
    if (parcelas.some(p => ['A_RECEBER', 'ATRASADO'].includes(p.status))) {
      const atrasada = parcelas.some(p => p.status === 'ATRASADO');
      return atrasada
        ? { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-triangle-exclamation', txt: 'BOLETO DUPLICO — há boleto atrasado' }
        : { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-barcode', txt: 'BOLETO DUPLICO — aguardando pagamento' };
    }
    return { cls: 'bg-violet-50 text-violet-700 border-violet-200', icon: 'fa-file-invoice-dollar', txt: `2 BOLETOS — R$ ${soma.toFixed(2)} (juntos fecham a venda)` };
  };

  // BLOCO 177: tipo/número da nota — props do pai primeiro (imediato),
  // senão o que o servidor devolveu no GET.
  const tipoNotaFinal = (notaTipo || notaApi?.tipo || '').toUpperCase();
  const numeroNotaFinal = notaNumero || notaApi?.numero || '';
  const podeAtrelarNfe = notaStatus === 'AUTORIZADA' && tipoNotaFinal === 'NFE';

  // BLOCO 177: dados do MINI BOLETO 80mm — MAIS COMPLETO: beneficiário real
  // (emitente do ERP), texto configurado em Configurações (ERP Fiscal) e a
  // NF-e atrelada (só modelo 55).
  const miniDados: MiniBoletoDados | null = boleto ? {
    beneficiarioNome: cfgApi?.beneficiarioNome,
    beneficiarioDoc: cfgApi?.beneficiarioDoc,
    pagadorNome: clienteNome,
    pagadorDoc: clienteDoc,
    valor: boleto.valor,
    vencimento: boleto.vencimento,
    status: boleto.status,
    linhaDigitavel: boleto.linhaDigitavel,
    codigoBarras: boleto.codigoBarras,
    pixCopiaECola: boleto.pixCopiaECola,
    vendaRef: saleId.slice(0, 8).toUpperCase(),
    seuNumero: boleto.seuNumero,
    mensagemPadrao: cfgApi?.mensagemPadrao,
    nfeTipo: tipoNotaFinal,
    nfeNumero: podeAtrelarNfe || (tipoNotaFinal === 'NFE' && notaStatus === 'AUTORIZADA') ? numeroNotaFinal : '',
  } : null;

  // Texto 48 colunas da térmica Bluetooth (mesmo gerador do papel, canal BT)
  const textoMiniBt = useMemo(() => {
    if (!miniDados) return '';
    try {
      return comprovanteBoletoTexto({
        empresaNome: miniDados.beneficiarioNome || 'DOCE MANIA',
        empresaDoc: miniDados.beneficiarioDoc,
        vendaRef: miniDados.vendaRef,
        seuNumero: miniDados.seuNumero,
        pagadorNome: miniDados.pagadorNome,
        pagadorDoc: miniDados.pagadorDoc,
        valor: miniDados.valor,
        vencimento: miniDados.vencimento,
        status: miniDados.status,
        linhaDigitavel: miniDados.linhaDigitavel,
        codigoBarras: miniDados.codigoBarras,
        pixCopiaECola: miniDados.pixCopiaECola,
        mensagemPadrao: miniDados.mensagemPadrao,
        nfeTipo: miniDados.nfeTipo,
        nfeNumero: miniDados.nfeNumero,
      });
    } catch { return ''; }
  }, [miniDados]);

  // BLOCO 177: imprime o MINI BOLETO DIRETO (sem preview).
  // BT = ESC/POS 48 colunas (mesmo caminho do cupom); USB = papel HTML 80mm
  // completo (barras + QR do PIX) na janela de impressão do PC.
  const imprimirMiniBoleto = async (canal: 'bt' | 'usb') => {
    if (ocupadoMini || !boleto) return;
    setOcupadoMini(canal);
    try {
      if (canal === 'usb') {
        if (!miniDados) return;
        const html = await miniBoleto80Html(miniDados);
        imprimirHtmlViaUsb(html, (m) => showToast?.(`Falha na janela USB: ${m}`, 'error'));
        showToast?.('Janela de impressão aberta — escolha a térmica USB.', 'success');
        return;
      }
      if (!miniDados || !textoMiniBt) { showToast?.('Dados do boleto incompletos para a térmica.', 'error'); return; }
      // BLOCO 185: BT imprime o MESMO papel do USB (miniBoleto80Html rasterizado
      // a 203dpi — barras, QR do PIX e grade idênticos). Fallback: texto 48 colunas.
      const ok = await imprimirHtmlViaBt(
        () => miniBoleto80Html(miniDados, { raster: true }),
        () => textoMiniBt,
      );
      if (ok) showToast?.('Mini Boleto enviado à impressora Bluetooth!', 'success');
      else showToast?.('Impressão não realizada — conecte a impressora.', 'error');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast?.(msg === 'BLUETOOTH_NAO_SUPORTADO'
        ? 'Bluetooth indisponível aqui — use o botão USB do PC.'
        : `Erro: ${msg}`, 'error');
    } finally {
      setOcupadoMini('');
    }
  };

  if (indisponivel || !boleto) return null;
  const clienteTemDoc = !!(clienteDoc || '').replace(/\D/g, '');
  const clienteTemCep = (clienteCep || '').replace(/\D/g, '').length === 8;
  const modoParcelado = parcelas.length > 0;
  // BLOCO 200: divisão aparece se o CLIENT casou a rota 5 (prop podeDividir)
  // OU se o SERVIDOR confirmou (GET /api/boletos → podeDividir).
  const podeDiv = !!podeDividir || podeDivApi;
  // BLOCO 210: o botão CANCELAR BOLETO aparece só quando o SERVIDOR autorizou
  // (ADMIN) e o boleto está numa situação cancelável (ativo no banco).
  const podeCancel = podeCancelApi;
  const cancelavel = ['A_RECEBER', 'ATRASADO', 'EM_PROCESSAMENTO'];
  // BLOCO 210: regravar a divisão (Editar divisão) passou a ser permitido
  // quando as parcelas com cobrança estão TODAS canceladas/expiradas/falhadas
  // e nenhuma paga — é o fluxo "cancelei o boleto e quero regravar a divisão
  // com outra data/valor". Cobrança ATIVA ou paga continua travando.
  const temCobrancaAtivaDiv = parcelas.some(p => p.codigo && !['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO'].includes(p.status));
  const temParcelaPagaDiv = parcelas.some(p => ['RECEBIDO', 'MARCADO_RECEBIDO'].includes(p.status));

  // ===================================================================
  // BLOCO 199 — MODO PARCELADO: 2 boletos que juntos fecham a venda.
  // Substitui todo o conteúdo do card (o boleto único não existe aqui).
  // ===================================================================
  if (modoParcelado) {
    const bb2 = badgeParcelado();
    const temAberta = parcelas.some(p => ['NAO_GERADO', 'FALHA_EMISSAO', 'CANCELADO', 'EXPIRADO'].includes(p.status));
    return (
      <div className={`rounded-2xl border ${bb2.cls}`}>
        <button onClick={() => setExpandido(!expandido)} className="w-full flex items-center gap-2 p-3 text-left" aria-expanded={expandido}>
          <i className={`fa-solid ${bb2.icon}`}></i>
          <span className="text-[10px] font-black uppercase flex-1">{bb2.txt}</span>
          <i className={`fa-solid fa-chevron-${expandido ? 'up' : 'down'} text-[9px] opacity-60`}></i>
        </button>
        {expandido && (
          <div className="px-3 pb-3 space-y-2">
            {inter && !inter.configurado && (
              <p className="text-[9px] leading-snug font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-2 py-1.5">
                <i className="fa-solid fa-plug-circle-xmark mr-1"></i>
                Boleto temporariamente indisponível: credenciais do Inter ausentes no servidor. O admin precisa definir INTER_CLIENT_ID, INTER_CLIENT_SECRET e o certificado (mTLS) nas variáveis da Vercel.
              </p>
            )}
            {erroLocal && (
              <p className="text-[9px] leading-snug font-bold text-rose-600 break-words">{erroLocal}</p>
            )}
            {/* Botão GERAL: gera os boletos que ainda não saíram */}
            {temAberta && (
              <button onClick={handleEmitirTodas} disabled={busy}
                className="block w-full bg-slate-800 text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-layer-group'} mr-1`}></i>
                Gerar {parcelas.filter(p => ['NAO_GERADO', 'FALHA_EMISSAO', 'CANCELADO', 'EXPIRADO'].includes(p.status)).length > 1 ? 'os 2 boletos' : 'o boleto que falta'}
              </button>
            )}
            {/* ============================================================
                BLOCO 200 (regra do dono, rota 5): EDITAR a divisão — os
                dois boletos JUNTOS fecham a venda; enquanto NADA saiu no
                Inter, os valores e vencimentos podem ser refeitos aqui
                (mesma tela do cupom onde aparece "Gerar Boleto").
                ============================================================ */}
            {podeDiv && parcelas.length >= 2 && !temCobrancaAtivaDiv && !temParcelaPagaDiv && (
              <button onClick={() => (formDiv ? setFormDiv(false) : abrirDivisao(true))} aria-expanded={formDiv}
                className="block w-full bg-white border-2 border-violet-200 text-violet-600 font-black py-2.5 rounded-xl text-[9px] uppercase tracking-widest active:scale-95">
                <i className={`fa-solid ${formDiv ? 'fa-xmark' : 'fa-pen-to-square'} mr-1`}></i>
                {formDiv ? 'Fechar edição da divisão' : 'Editar divisão (valores e vencimentos)'}
              </button>
            )}
            {formDiv && podeDiv && parcelas.length >= 2 && !temCobrancaAtivaDiv && !temParcelaPagaDiv && (
              formDivisao
            )}
            {/* Os DOIS boletos da divisão */}
            {parcelas.map(p => {
              const ocupado = busyParcela === p.id;
              const aberta = ['NAO_GERADO', 'FALHA_EMISSAO', 'CANCELADO', 'EXPIRADO'].includes(p.status);
              const paga = p.status === 'RECEBIDO' || p.status === 'MARCADO_RECEBIDO';
              return (
                <div key={p.id} className={`rounded-xl border p-2.5 space-y-1.5 ${paga ? 'bg-emerald-50 border-emerald-200' : p.status === 'ATRASADO' || p.status === 'FALHA_EMISSAO' ? 'bg-rose-50 border-rose-200' : 'bg-white/80 border-gray-200'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${paga ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-white'}`}>Boleto {p.seq}/{parcelas.length}</span>
                    <span className="text-[11px] font-black text-gray-800">R$ {Number(p.valor).toFixed(2)}</span>
                    <span className="text-[9px] font-black text-gray-500 uppercase flex-1 text-right truncate">{badgeParcelaTxt(p)}</span>
                  </div>
                  {p.erro && p.status === 'FALHA_EMISSAO' && (
                    <p className="text-[8px] font-bold text-rose-600 leading-snug break-words">{p.erro}</p>
                  )}
                  {/* BLOCO 225: emissão presa há 30+ min em EM_PROCESSAMENTO —
                      o Inter pode ter travado essa cobrança lá dentro. O
                      dono fica orientado: ATUALIZAR primeiro; se não sair,
                      DESTRavar (admin) libera e libera o GERAR de um boleto
                      novo (a cobrança antiga não tem linha digitável). */}
                  {/* BLOCO 240: parcela aceita pelo Inter e processando devagar
                      (mesma verdade do boleto único) — com codigo gravado, a
                      linha/pix chegam sozinhas; sem segunda emissão. */}
                  {p.status === 'EM_PROCESSAMENTO' && !p.avisarDestravar && (p.processandoMin ?? 0) >= 3 && p.codigo && (
                    <p className="text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5 leading-snug">
                      <i className="fa-solid fa-circle-info mr-1"></i>
                      O Inter ACEITOU o boleto {p.seq} e está processando lá dentro (hoje eles estão processando devagar). A linha digitável aparece SOZINHA em alguns minutos — não gere outro.
                    </p>
                  )}
                  {p.status === 'EM_PROCESSAMENTO' && p.avisarDestravar && (
                    <p className="text-[8px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-snug">
                      <i className="fa-solid fa-hourglass-half mr-1"></i>
                      Preso no Inter há ~{p.processandoMin} min sem sair do processamento. Toque ATUALIZAR; se não sair, use DESTRavar para liberar e GERAR um boleto novo.
                    </p>
                  )}
                  {/* BLOCO 217 (regra do dono): linha digitável e PIX copia-e-cola
                      SAÍRAM do card — “não vamos usar isso, apenas informe se o
                      boleto foi gerado com sucesso”. O status segue no badge e
                      o PDF do Inter abre pelo botão PDF. */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {aberta ? (
                      <button onClick={() => void handleGerarParcela(p)} disabled={ocupado}
                        className="bg-slate-800 text-white font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                        <i className={`fa-solid ${ocupado ? 'fa-spinner fa-spin' : 'fa-file-invoice-dollar'} mr-1`}></i>{p.status === 'NAO_GERADO' ? 'Gerar' : 'Refazer'}
                      </button>
                    ) : ['A_RECEBER', 'ATRASADO', 'EM_PROCESSAMENTO'].includes(p.status) ? (
                      <button onClick={() => void handleConsultarParcela(p)} disabled={ocupado}
                        className="bg-gray-100 text-gray-600 font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                        <i className={`fa-solid ${ocupado ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'} mr-1`}></i>Atualizar
                      </button>
                    ) : (
                      <div className="bg-gray-50 text-gray-300 font-black py-2.5 rounded-xl text-[8px] uppercase text-center">OK</div>
                    )}
                    {!aberta && (
                      <button onClick={() => void handlePdfParcela(p)} disabled={ocupado}
                        className="bg-slate-800 text-white font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                        <i className={`fa-solid ${ocupado ? 'fa-spinner fa-spin' : 'fa-file-pdf'} mr-1`}></i>PDF
                      </button>
                    )}
                    {!aberta && (
                      <button onClick={() => handleWhatsParcela(p)}
                        className="bg-green-600 text-white font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest active:scale-95">
                        <i className="fa-brands fa-whatsapp mr-1"></i>Enviar
                      </button>
                    )}
                    {!aberta && (p.linhaDigitavel || p.codigoBarras || p.pixCopiaECola) && (
                      <>
                        {temBt && (
                          <button onClick={() => void imprimirMiniParcela('bt', p)} disabled={ocupadoMini !== ''}
                            className="bg-teal-600 text-white font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                            <i className={`fa-solid ${ocupadoMini === 'bt' ? 'fa-spinner fa-spin' : 'fa-bluetooth-b'} mr-1`}></i>Mini
                          </button>
                        )}
                        <button onClick={() => void imprimirMiniParcela('usb', p)} disabled={ocupadoMini !== ''}
                          className={`${temBt ? '' : 'col-span-2'}bg-emerald-700 text-white font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest active:scale-95 disabled:opacity-60`}>
                          <i className={`fa-solid ${ocupadoMini === 'usb' ? 'fa-spinner fa-spin' : 'fa-print'} mr-1`}></i>Mini USB
                        </button>
                      </>
                    )}
                    {/* BLOCO 210 (pedido do dono): CANCELAR ESTE boleto — só o
                        boleto da parcela; a venda e a outra parcela seguem.
                        Depois o botão vira GERAR de novo (nova data). */}
                    {podeCancel && cancelavel.includes(p.status) && (
                      <button onClick={() => { setErroLocal(''); setAlvoCancel(alvoCancel === p.id ? '' : p.id); }} disabled={busyCancel}
                        className="bg-white border-2 border-rose-200 text-rose-600 font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                        <i className="fa-solid fa-ban mr-1"></i>Cancelar
                      </button>
                    )}
                    {/* BLOCO 224: DESTRAVAR a parcela travada em EM_PROCESSAMENTO
                        (o Inter recusa cancelar cobrança em processamento) —
                        marca FALHA DE EMISSÃO e libera o GERAR. */}
                    {podeCancel && p.status === 'EM_PROCESSAMENTO' && (
                      <button onClick={() => void handleDestravar(p.id)} disabled={ocupado}
                        className="bg-white border-2 border-amber-300 text-amber-700 font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                        <i className={`fa-solid ${ocupado ? 'fa-spinner fa-spin' : 'fa-unlock'} mr-1`}></i>Destravar
                      </button>
                    )}
                  </div>
                  {alvoCancel === p.id && formCancel(p.id, `Boleto ${p.seq}`)}
                </div>
              );
            })}
            {/* BLOCO 227: RESET TOTAL da divisao (admin, ultimo recurso) —
                apaga TODAS as parcelas e as cobrancas do sistema desta venda
                (cancela no Inter o que estiver vivo) e volta ao zero. Aparece
                so quando ha parcela travada/morta/falhada — nada recebido
                pode ser apagado (o servidor bloqueia). */}
            {podeCancel && parcelas.some(p => ['EM_PROCESSAMENTO', 'FALHA_EMISSAO', 'CANCELADO', 'EXPIRADO'].includes(p.status)) && (
              <button onClick={handleResetar} disabled={busy}
                className="block w-full bg-white border-2 border-slate-200 text-slate-500 font-black py-2 rounded-xl text-[8px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-rotate-left'} mr-1`}></i>
                Resetar todos os boletos desta venda (admin)
              </button>
            )}
            {/* Doc/CEP do pagador — 1 form só para os DOIS boletos (aparece
                quando o cadastro não tem documento/CEP — Bloco 187/196) */}
            {(!clienteTemDoc || !clienteTemCep) && (
              <div className="space-y-2 bg-white/70 rounded-xl p-2.5">
                {!clienteTemDoc && (
                  <label className="block">
                    <span className="text-[8px] font-black uppercase text-gray-500">CPF/CNPJ do pagador (vale para os 2 boletos)</span>
                    <input type="text" inputMode="numeric" value={doc} onChange={e => setDoc(e.target.value)}
                      placeholder="000.000.000-00"
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
                  </label>
                )}
                {!clienteTemCep && (
                  <label className="block">
                    <span className="text-[8px] font-black uppercase text-gray-500">CEP do pagador (obrigatório no Inter — vale para os 2 boletos)</span>
                    <input type="text" inputMode="numeric" value={cep} onChange={e => setCep(e.target.value)}
                      placeholder="89500000"
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
                  </label>
                )}
              </div>
            )}
            <p className="text-[8px] font-bold text-gray-400 leading-snug text-center">
              Os dois boletos JUNTOS fecham o valor da venda — cada um com o seu vencimento. A venda entra como paga quando os dois forem recebidos.
            </p>
          </div>
        )}
      {/* BLOCO 217: visualizador do PDF (compartilhar/salvar/nova aba) */}
      {modalPdf}
    </div>
  );
  }

  // ====================== FLUXO DE BOLETO ÚNICO (inalterado) ======================
  const bb = badge();

  return (
    <div className={`rounded-2xl border ${bb.cls}`}>
      <button onClick={() => setExpandido(!expandido)} className="w-full flex items-center gap-2 p-3 text-left" aria-expanded={expandido}>
        <i className={`fa-solid ${bb.icon}`}></i>
        <span className="text-[10px] font-black uppercase flex-1">{bb.txt}</span>
        <i className={`fa-solid fa-chevron-${expandido ? 'up' : 'down'} text-[9px] opacity-60`}></i>
      </button>
      {expandido && (
        <div className="px-3 pb-3 space-y-2">
          {/* BLOCO 85: env do Inter faltando no servidor — aviso claro no lugar
              de falha generica ao gerar (o dono suspeitava "env na vercel") */}
          {inter && !inter.configurado && (
            <p className="text-[9px] leading-snug font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-2 py-1.5">
              <i className="fa-solid fa-plug-circle-xmark mr-1"></i>
              Boleto temporariamente indisponível: credenciais do Inter ausentes no servidor. O admin precisa definir INTER_CLIENT_ID, INTER_CLIENT_SECRET e o certificado (mTLS) nas variáveis da Vercel.
            </p>
          )}
          {/* BLOCO 224: ATUALIZAR também quando está EM_PROCESSAMENTO — o
              dono precisava ver se a cobrança já saiu lá no Inter. */}
          {/* BLOCO 225: aviso do boleto ÚNICO preso há 30+ min — orienta o
              DESTRAVAR (admin) em vez do “atualizar que não sai do lugar”. */}
          {boleto.status === 'EM_PROCESSAMENTO' && boleto.avisarDestravar && (
            <p className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-snug">
              <i className="fa-solid fa-hourglass-half mr-1"></i>
              Preso no Inter há ~{boleto.processandoMin} min sem sair do processamento. Toque ATUALIZAR; se não sair, use DESTRavar (admin) para liberar e GERAR um boleto novo.
            </p>
          )}
          {/* BLOCO 240 (caso real Mercado Bagé 28/11): o Inter ACEITOU o boleto
              (código gravado) e está PROCESSANDO devagar lá dentro — hoje o
              Inter anda aceitando rápido e processando em minutos. O dono via
              “Gerando...” e achava que não gerou. Este banner diz a verdade:
              o boleto EXISTE, a linha/pix chegam SOZINHOS, e o botão de gerar
              de novo fica escondido (não há segunda cobrança a fazer). */}
          {boleto.status === 'EM_PROCESSAMENTO' && !boleto.avisarDestravar && (boleto.processandoMin ?? 0) >= 3 && boleto.codigo && (
            <p className="text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5 leading-snug">
              <i className="fa-solid fa-circle-info mr-1"></i>
              O Inter ACEITOU este boleto (código {boleto.codigo.slice(0, 8)}) e está processando lá dentro. Hoje o Inter está aceitando rápido mas processando devagar (instabilidade deles — não é erro do app). A linha digitável e o Pix aparecem SOZINHOS em alguns minutos (o sistema consulta por conta própria). NÃO gere outro boleto: este já existe — risco de cobrar o cliente em dobro.
            </p>
          )}
          {['A_RECEBER', 'ATRASADO', 'EM_PROCESSAMENTO'].includes(boleto.status) && (
            <button onClick={handleConsultar} disabled={busy} className="text-[10px] font-black underline py-1 inline-block disabled:opacity-50">
              Atualizar situação no Inter
            </button>
          )}
          {(erroLocal || (boleto.erro && boleto.status === 'FALHA_EMISSAO')) && (
            <p className="text-[9px] leading-snug font-bold opacity-80 break-words">{erroLocal || boleto.erro}</p>
          )}
          {/* BLOCO 217 (regra do dono): linha digitável e PIX copia-e-cola
              REMOVIDOS do card — “não vamos usar isso, apenas informe se o
              boleto foi gerado com sucesso”. O badge do card informa o status
              e o PDF do Inter abre pelo botão PDF (visualizar/compartilhar/salvar). */}
          {/* BLOCO 240: “Gerar Novamente” só existe quando a cobranca NÃO
              existe lá (sem codigo = emissão morta/em voo). Com codigo, o
              boleto JÁ FOI ACEITO: re-gerar só devolve “já gerado” — o botão
              induzia à cobrança em dobro imaginada e virou o ATUALIZAR. */}
          {boleto.status === 'EM_PROCESSAMENTO' && !boleto.codigo && (
            <button onClick={handleGerar} disabled={busy}
              className="block w-full bg-slate-800 text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
              <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'} mr-1`}></i>
              Gerar Novamente
            </button>
          )}
          {/* BLOCO 224: DESTRAVAR (admin) — o Inter recusa cancelar cobrança
              que está EM_PROCESSAMENTO lá dentro; este botão marca FALHA
              DE EMISSÃO local e libera o GERAR para um boleto novo. */}
          {podeCancel && boleto.status === 'EM_PROCESSAMENTO' && (
            <button onClick={() => void handleDestravar()} disabled={busy}
              className="block w-full bg-white border-2 border-amber-300 text-amber-700 font-black py-2.5 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
              <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-unlock'} mr-1`}></i>
              Destavar boleto travado (admin)
            </button>
          )}
          {/* BLOCO 227: RESET TOTAL (admin, último recurso) — quando NADA
              resolve (travado em processamento, falha estranha, cancelado,
              expirado), o reset devolve a venda a NAO_GERADO e o GERAR
              funciona de novo do zero ("resetar todo o sistema de boletos"). */}
          {podeCancel && ['EM_PROCESSAMENTO', 'FALHA_EMISSAO', 'CANCELADO', 'EXPIRADO'].includes(boleto.status) && (
            <button onClick={handleResetar} disabled={busy}
              className="block w-full bg-white border-2 border-slate-200 text-slate-500 font-black py-2 rounded-xl text-[8.5px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
              <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-rotate-left'} mr-1`}></i>
              Resetar boleto desta venda (admin)
            </button>
          )}
          {['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO', 'NAO_GERADO'].includes(boleto.status) && !form && (
            <button onClick={() => { setErroLocal(''); setForm(true); }} disabled={busy}
              className="block w-full bg-slate-800 text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
              <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-file-invoice-dollar'} mr-1`}></i>
              {boleto.status === 'NAO_GERADO' ? 'Gerar Boleto' : 'Gerar Novamente'}
            </button>
          )}
          {/* ============================================================
              BLOCO 200 (regra do dono, EXCLUSIVO ROTA 5 / Deivid): DIVIDIR
              EM 2 BOLETOS — aparece na tela do cupom exatamente onde o
              dono procurava (ao lado do "Gerar Boleto"). Dois boletos que
              JUNTOS fecham o valor da venda: 1º em 7 dias com parte do
              valor e o restante no 2º em 14 dias — ou dividir por 2. Só
              aparece SEM boleto único ativo (senão o cliente pagaria duas
              vezes) e a soma é conferida pela API (mín. R$ 2,50 cada).
              ============================================================ */}
          {podeDiv && ['NAO_GERADO', 'CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO'].includes(boleto.status) && (
            <div className="rounded-xl border border-violet-100 bg-white/70 p-2.5 space-y-2">
              <button onClick={() => (formDiv ? setFormDiv(false) : abrirDivisao(false))} aria-expanded={formDiv}
                className="w-full flex items-center gap-2 text-left active:scale-95 transition-transform">
                <i className="fa-solid fa-layer-group text-violet-500"></i>
                <span className="flex-1 min-w-0">
                  <span className="block text-[10px] font-black uppercase text-gray-700">Dividir em 2 boletos — o valor fecha dividido em dois</span>
                  <span className="block text-[8px] font-bold text-gray-400 leading-snug">Ex.: 1º em 7 dias com parte do valor e o restante no 2º em 14 dias, ou dividir por 2. Exclusivo da rota 5.</span>
                </span>
                <i className={`fa-solid fa-chevron-${formDiv ? 'up' : 'down'} text-[9px] text-gray-300`}></i>
              </button>
              {formDiv && formDivisao}
            </div>
          )}
          {['A_RECEBER', 'ATRASADO', 'RECEBIDO', 'MARCADO_RECEBIDO'].includes(boleto.status) && (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handlePdf} disabled={busy}
                className="bg-slate-800 text-white font-black py-2.5 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-file-pdf'} mr-1`}></i> PDF
              </button>
              <button onClick={handleWhats}
                className="bg-green-600 text-white font-black py-2.5 rounded-xl text-[9px] uppercase tracking-widest active:scale-95">
                <i className="fa-brands fa-whatsapp mr-1"></i> Enviar
              </button>
            </div>
          )}
          {/* BLOCO 167/177: MINI BOLETO 80mm — imprime DIRETO (sem preview) nos
              dois canais: BLUETOOTH (mesmo caminho do cupom) e USB DO PC (papel
              completo com barras + QR). BLOCO 152: o boleto OFICIAL segue sendo
              o PDF ORIGINAL do Inter. */}
          {(boleto.linhaDigitavel || boleto.codigoBarras || boleto.pixCopiaECola) && miniDados && (
            <div className="grid grid-cols-2 gap-2">
              {temBt && (
                <button onClick={() => void imprimirMiniBoleto('bt')} disabled={ocupadoMini !== ''}
                  className="bg-teal-600 text-white font-black py-2.5 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1">
                  <i className={`fa-solid ${ocupadoMini === 'bt' ? 'fa-spinner fa-spin' : 'fa-bluetooth-b'}`}></i> Mini Boleto BT
                </button>
              )}
              <button onClick={() => void imprimirMiniBoleto('usb')} disabled={ocupadoMini !== ''}
                className={`${temBt ? '' : 'col-span-2 '}bg-emerald-700 text-white font-black py-2.5 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1`}>
                <i className={`fa-solid ${ocupadoMini === 'usb' ? 'fa-spinner fa-spin' : 'fa-print'}`}></i> Mini Boleto USB
              </button>
            </div>
          )}
          {/* ============================================================
              BLOCO 210 (pedido do dono): CANCELAR BOLETO — junto ao boleto
              de cada cliente, depois de gerado. Cancela APENAS o boleto (a
              venda segue) e libera a geração de um NOVO boleto com a data
              que o cliente escolher (gerou com data X, cliente quer data Y).
              Só o ADMIN vê o botão; motivo vai registrado no banco Inter.
              ============================================================ */}
          {podeCancel && cancelavel.includes(boleto.status) && alvoCancel === '' && (
            <button onClick={() => { setErroLocal(''); setAlvoCancel('unico'); }} disabled={busyCancel}
              className="block w-full bg-white border-2 border-rose-200 text-rose-600 font-black py-2.5 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
              <i className="fa-solid fa-ban mr-1"></i>Cancelar boleto (cliente pediu outra data?)
            </button>
          )}
          {podeCancel && alvoCancel === 'unico' && formCancel('unico', 'este boleto')}
          {form && (
            <div className="space-y-2 bg-white/70 rounded-xl p-2.5">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[8px] font-black uppercase text-gray-500">Valor (R$) — já vem com o VALOR DA VENDA (X)</span>
                  <input type="number" step="0.01" min="2.5" value={valor} onChange={e => setValor(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
                  <span className="block text-[7.5px] font-bold text-gray-400 mt-0.5">O boleto segue o valor da venda — a NFC-e anônima (preço cupom) não interfere.</span>
                </label>
                <label className="block">
                  <span className="text-[8px] font-black uppercase text-gray-500">Vencimento</span>
                  {/* BLOCO 227: min = hoje — o Inter recusa boleto com data passada
                      (era a recusa genérica "Verifique os dados informados..." */}
                  <input type="date" min={plusDias(0)} value={venc} onChange={e => setVenc(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
                </label>
              </div>
              {avisoPrazo && (
                <p className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-snug">
                  <i className="fa-solid fa-calendar-xmark mr-1"></i>{avisoPrazo}
                </p>
              )}
              {!clienteTemDoc && (
                <label className="block">
                  <span className="text-[8px] font-black uppercase text-gray-500">CPF/CNPJ do pagador (cliente sem documento no cadastro)</span>
                  <input type="text" inputMode="numeric" value={doc} onChange={e => setDoc(e.target.value)}
                    placeholder="000.000.000-00"
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
                </label>
              )}
              {!clienteTemCep && (
                <label className="block">
                  <span className="text-[8px] font-black uppercase text-gray-500">CEP do pagador (obrigatório no Inter — cliente sem CEP no cadastro)</span>
                  <input type="text" inputMode="numeric" value={cep} onChange={e => setCep(e.target.value)}
                    placeholder="89500000"
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
                </label>
              )}
              {/* BLOCO 177 (regra do dono): só NF-e (modelo 55) se atrela ao
                  boleto — NFC-e NUNCA (boleto de cliente PF com CPF não tem
                  nota para atrelar). */}
              {podeAtrelarNfe && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={atrelar} onChange={e => setAtrelar(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
                  <span className="text-[9px] font-black uppercase text-gray-600">Atrelar NF-e {numeroNotaFinal || ''} ao boleto</span>
                </label>
              )}
              <button onClick={handleGerar} disabled={busy || !venc}
                className="block w-full bg-emerald-600 text-white font-black py-2.5 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-50">
                <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-check'} mr-1`}></i>
                Confirmar boleto
              </button>
            </div>
          )}
        </div>
      )}
      {/* BLOCO 177: o modal de PREVIEW do mini boleto (MiniBoletoImpressao) foi
          REMOVIDO pelo dono — os botões acima imprimem DIRETO no canal escolhido. */}
      {/* BLOCO 217: visualizador do PDF (compartilhar/salvar/nova aba) */}
      {modalPdf}
    </div>
  );
};

export default BoletoCard;
