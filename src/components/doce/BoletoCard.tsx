'use client';

import { useState, useEffect, useMemo } from 'react';
import { boletoService, BoletoInfo, BoletoConfigInfo, NotaDaVendaInfo } from '@/services/boletoService';
import { validaCpfCnpj } from '@/lib/validaDoc';
// BLOCO 177: MINI BOLETO imprime DIRETO (sem preview) nos DOIS canais:
// USB do PC = papel HTML 80mm (miniBoleto80Html); Bluetooth = texto ESC/POS
// 48 colunas (comprovanteBoletoTexto) — MESMO caminho do cupom, toque e sai.
import { miniBoleto80Html, type MiniBoletoDados } from '@/lib/miniBoleto80Html';
import { comprovanteBoletoTexto } from '@/lib/danfeTexto';
import { bluetoothPrinter } from '@/services/bluetoothPrinterService';
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

const BoletoCard: React.FC<BoletoCardProps> = ({ saleId, valorTotal, valorPago, notaStatus, notaNumero, notaTipo, clienteDoc, clienteCep, clienteTelefone, clienteNome, showToast, abertoInicial, onStatusChange, vencimentoVenda }) => {
  const [boleto, setBoleto] = useState<BoletoInfo | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [inter, setInter] = useState<InterStatus | null>(null); // BLOCO 85: env do Inter visivel
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(false);
  // BLOCO 67: card DOBRAVEL — a linha de status e sempre visivel (1 linha),
  // os botoes/form ficam atras do toque. Nao empurra mais o cupom pra fora.
  const [expandido, setExpandido] = useState<boolean>(!!abertoInicial);
  const [valor, setValor] = useState('');
  const [venc, setVenc] = useState('');
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

  useEffect(() => {
    if (!saleId) return;
    let vivo = true;
    (async () => {
      const r = await boletoService.status(saleId);
      if (!vivo) return;
      if (!r.ok) { setIndisponivel(true); return; } // SQL/Inter nao configurado: esconde a secao
      setBoleto(r.boleto || null);
      setInter(r.inter || null);
      setNotaApi(r.nota || null);
      setCfgApi(r.config || null);
      if (r.boleto?.status === 'NAO_GERADO') {
        // BLOCO 153: prazo correto = vencimento COMBINADO na venda (tela 6 do
        // PDV — sales.data_vencimento); sem prazo gravado, mantém o padrão +7d
        const iso = vencimentoVenda && /^\d{4}-\d{2}-\d{2}/.test(vencimentoVenda) ? vencimentoVenda.slice(0, 10) : null;
        if (iso) {
          setVenc(iso);
        } else {
          const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
          setVenc(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d));
        }
        const saldo = Math.max(0, (valorTotal || 0) - (valorPago || 0));
        setValor(saldo > 0 ? saldo.toFixed(2) : (valorTotal || 0).toFixed(2));
      }
    })();
    return () => { vivo = false; };
  }, [saleId, vencimentoVenda]);

  // BLOCO 123: reporta o status do boleto ao pai (gate fiscal da pronta
  // entrega a prazo). Card indisponível (Inter sem credenciais) reporta
  // 'INDISPONIVEL' — o pai decide o que fazer (não bloqueia o impossível).
  useEffect(() => {
    if (!onStatusChange) return;
    onStatusChange(indisponivel ? 'INDISPONIVEL' : (boleto?.status || 'NAO_GERADO'));
  }, [boleto?.status, indisponivel, onStatusChange]);

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
    const docFinal = doc.replace(/\D/g, '') || (clienteDoc || '').replace(/\D/g, '');
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
    const cepFinal = cep.replace(/\D/g, '') || (clienteCep || '').replace(/\D/g, '');
    if (cepFinal.length !== 8) {
      setErroLocal('O boleto do Inter precisa do CEP do pagador (8 dígitos). Informe abaixo ou complete no cadastro do cliente.');
      showToast?.('Informe o CEP do pagador (8 dígitos).', 'error');
      return;
    }
    setBusy(true);
    const r = await boletoService.gerar(saleId, {
      vencimento: venc,
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
      if (r.avisoAtrelamento) {
        showToast?.(r.avisoAtrelamento, 'error');
      } else if (r.notaAtrelada) {
        showToast?.('Boleto gerado com a NF-e/NFC-e atrelada (chave enviada ao Inter).', 'success');
      }
      if (r.boleto.status === 'EM_PROCESSAMENTO') {
        showToast?.('Boleto gerado! O Inter esta processando...', 'success');
        setTimeout(async () => {
          const c = await boletoService.consultar(saleId);
          if (c.ok && c.boleto) setBoleto(c.boleto);
        }, 4000);
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

  // BLOCO 152: PDF ORIGINAL do Inter — único documento do boleto no app
  // (mini boleto 80mm foi excluido pelo dono).
  const handlePdf = async () => {
    if (busy || !saleId) return;
    setBusy(true);
    const r = await boletoService.abrirPdf(saleId);
    setBusy(false);
    if (!r.ok && r.erro) showToast?.(r.erro, 'error');
  };

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

  const handleWhats = () => {
    if (!boleto) return;
    const linhas = [
      '*BOLETO DOCE MANIA*',
      boleto.valor ? `Valor: R$ ${Number(boleto.valor).toFixed(2)}` : '',
      boleto.vencimento ? `Vencimento: ${dataBR(boleto.vencimento)}` : '',
      boleto.linhaDigitavel ? `Linha digitavel:\n${boleto.linhaDigitavel}` : '',
      boleto.pixCopiaECola ? `PIX (copia e cola):\n${boleto.pixCopiaECola}` : '',
    ].filter(Boolean).join('\n\n');
    const phone = (clienteTelefone || '').replace(/\D/g, '');
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(linhas)}`, '_blank');
  };

  const badge = (): { cls: string; icon: string; txt: string } => {
    const s = boleto?.status || 'NAO_GERADO';
    switch (s) {
      case 'A_RECEBER': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-barcode', txt: `BOLETO A RECEBER — venc. ${dataBR(boleto?.vencimento)}` };
      case 'RECEBIDO': case 'MARCADO_RECEBIDO': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-circle-check', txt: `BOLETO PAGO${boleto?.valorRecebido ? ` — R$ ${Number(boleto.valorRecebido).toFixed(2)}` : ''}` };
      case 'EM_PROCESSAMENTO': return { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'fa-hourglass-half', txt: 'Gerando boleto no Inter...' };
      case 'ATRASADO': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-triangle-exclamation', txt: `BOLETO ATRASADO — venc. ${dataBR(boleto?.vencimento)}` };
      case 'PROTESTO': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-gavel', txt: 'Boleto em protesto' };
      case 'CANCELADO': case 'EXPIRADO': return { cls: 'bg-gray-100 text-gray-500 border-gray-200', icon: 'fa-ban', txt: 'Boleto cancelado' };
      case 'FALHA_EMISSAO': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-circle-xmark', txt: 'Falha ao gerar — toque em tentar de novo' };
      default: return { cls: 'bg-gray-50 text-gray-500 border-gray-200', icon: 'fa-file-invoice-dollar', txt: 'Sem boleto — toque para gerar' };
    }
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
      if (!textoMiniBt) { showToast?.('Dados do boleto incompletos para a térmica.', 'error'); return; }
      const ok = await bluetoothPrinter.print(textoMiniBt, '80MM', { skipConfirm: true });
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
  const bb = badge();
  const clienteTemDoc = !!(clienteDoc || '').replace(/\D/g, '');
  const clienteTemCep = (clienteCep || '').replace(/\D/g, '').length === 8;

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
          {['A_RECEBER', 'ATRASADO'].includes(boleto.status) && (
            <button onClick={handleConsultar} disabled={busy} className="text-[10px] font-black underline py-1 inline-block disabled:opacity-50">
              Atualizar situação no Inter
            </button>
          )}
          {(erroLocal || (boleto.erro && boleto.status === 'FALHA_EMISSAO')) && (
            <p className="text-[9px] leading-snug font-bold opacity-80 break-words">{erroLocal || boleto.erro}</p>
          )}
          {['A_RECEBER', 'ATRASADO'].includes(boleto.status) && boleto.linhaDigitavel && (
            <div className="space-y-1.5">
              <button onClick={() => handleCopiarTexto(boleto.linhaDigitavel!, 'Linha digitavel')}
                className="w-full text-left font-mono text-[9px] font-bold bg-white/70 rounded-lg px-2 py-2.5 break-all active:scale-95">
                {boleto.linhaDigitavel}
              </button>
              {boleto.pixCopiaECola && (
                <button onClick={() => handleCopiarTexto(boleto.pixCopiaECola!, 'PIX copia e cola')}
                  className="w-full text-left text-[9px] font-black bg-white/70 rounded-lg px-2 py-2.5 break-all active:scale-95">
                  <i className="fa-solid fa-qrcode mr-1"></i>PIX COPIA E COLA — TOQUE PARA COPIAR
                </button>
              )}
            </div>
          )}
          {boleto.status === 'EM_PROCESSAMENTO' && (
            <button onClick={handleGerar} disabled={busy}
              className="block w-full bg-slate-800 text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
              <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'} mr-1`}></i>
              Gerar Novamente
            </button>
          )}
          {['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO', 'NAO_GERADO'].includes(boleto.status) && !form && (
            <button onClick={() => { setErroLocal(''); setForm(true); }} disabled={busy}
              className="block w-full bg-slate-800 text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
              <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-file-invoice-dollar'} mr-1`}></i>
              {boleto.status === 'NAO_GERADO' ? 'Gerar Boleto' : 'Gerar Novamente'}
            </button>
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
                  <input type="date" value={venc} onChange={e => setVenc(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
                </label>
              </div>
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
    </div>
  );
};

export default BoletoCard;
