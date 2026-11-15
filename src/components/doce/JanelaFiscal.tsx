"use client";

import React, { useState, useEffect } from 'react';
import { Sale, Client } from '@/lib/types';
import {
  notaService,
  NotaInfo,
  FocusStatusInfo,
} from '@/services/notaService';
// BLOCO 134: a janela fiscal imprime o CUPOM FISCAL 80mm PERFEITO (danfe80)
import { danfeFiscal80 } from '@/lib/danfe80';
import { bluetoothPrinter } from '@/services/bluetoothPrinterService';
// BLOCO 111: canal USB do PC — o cupom fiscal também sai na térmica USB
import { imprimirViaUsb, lerCanalImpressao } from '@/lib/usbPrint';
// BLOCO 132: regras de documento do cadastro (CPF/CNPJ no mesmo campo)
import { tipoDocDigitos, validaCpfOuCnpj } from '@/lib/cnpjAutocomplete';
// BLOCO 134 (regra do dono): preço anônimo SÓ na NFC-e anônima; o cupom
// (não fiscal) segue o preço digitado pelo vendedor.
import { intencaoNotaDaVenda, prazoCancelamentoNota, PrazoCancelamento } from '@/lib/regras-fiscais';
// MINI DANFE 80mm — visualizar o modelo antes de imprimir (o dono aprova o layout)
import ModelosImpressao from './ModelosImpressao';
import { DanfeFiscalData } from '@/lib/danfe80';

interface JanelaFiscalProps {
  sale: Sale;
  client: Client;
  /** Status atual da nota (sincronizado com o Cupom que abriu a janela) */
  nota: NotaInfo;
  focus: FocusStatusInfo | null;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
  /** Devolve o status atualizado da nota pro Cupom (banner pendente muda ao vivo) */
  onNotaChange: (n: NotaInfo) => void;
  onClose: () => void;
  /** BLOCO 142: ADMIN pode cancelar a nota (vendas realizadas / cupom do admin) */
  podeCancelar?: boolean;
  /** BLOCO 142: disparado após cancelar com sucesso (recarregar vendas) */
  onNotaCancelada?: () => void;
}

type OpcaoFiscal = 'NFE' | 'NFCE_IDENTIFICADA' | 'NFCE_ANONIMA';

/**
 * BLOCO 134 — JANELA FISCAL (regra do dono).
 *
 * "botão fiscal que abre outra janela para gerar nfe, se escolhida, nfc se
 *  escolhida, nfc anonima regra do preço anonimo só no nfc, o cupom segue
 *  preço normal ou seja o digitado pelo vendedor".
 *
 * Uma janela, 3 documentos, ZERO poluição na tela do cupom:
 *  1. NF-e (modelo 55)  — só com CNPJ válido no cadastro. Preço da venda.
 *  2. NFC-e identificada — leva o CPF/CNPJ do cadastro (BLOCO 128). Preço da venda.
 *  3. NFC-e ANÔNIMA — sem consumidor, itens no PREÇO CUPOM/custo (preço
 *     anônimo). O cupom físico continua no preço normal do vendedor.
 *
 * A venda pode ficar SEM nota (fechar e emitir depois) — o Cupom mostra o
 * banner "NOTA PENDENTE" e esta janela resolve quando o dono quiser.
 */
const JanelaFiscal: React.FC<JanelaFiscalProps> = ({ sale, client, nota, focus, showToast, onNotaChange, onClose, podeCancelar, onNotaCancelada }) => {
  const [busy, setBusy] = useState(false);
  const [aberta, setAberta] = useState<OpcaoFiscal | null>(null);
  const [erro, setErro] = useState<string>('');
  const [info, setInfo] = useState<string>('');
  // MINI DANFE 80mm (retrato) — modal de visualização com os dados REAIS do cupom
  const [previewAberto, setPreviewAberto] = useState(false);
  const [previewCupom, setPreviewCupom] = useState<DanfeFiscalData | null>(null);

  // ====================================================================
  // BLOCO 142 — CANCELAR NOTA (ADMIN): dentro do prazo SEFAZ (NFC-e 30min
  // / NF-e 24h após a autorização) o botão aparece com a contagem ao
  // vivo; venceu = botão fica INATIVO/SOME. O servidor (/api/notas) aplica
  // a MESMA regra — fonte única em regras-fiscais.ts.
  // ====================================================================
  const [cancelAberto, setCancelAberto] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    if (!podeCancelar || nota.status !== 'AUTORIZADA') return;
    const iv = setInterval(() => setAgora(new Date()), 10_000);
    return () => clearInterval(iv);
  }, [podeCancelar, nota.status]);

  const prazoNota: PrazoCancelamento | null = nota.status === 'AUTORIZADA'
    ? prazoCancelamentoNota({
        tipo: nota.tipo,
        status: nota.status,
        emitidaEm: sale.notaEmitidaEm || nota.dataAutorizacao || null,
        fallbackData: sale.data,
        agora,
      })
    : null;

  const cancelar = async () => {
    if (busy || !sale.id) return;
    const just = justificativa.trim();
    if (just.length < 15) {
      setErro('Justificativa obrigatória (mínimo 15 caracteres — regra da SEFAZ).');
      return;
    }
    if (prazoNota?.expirado) {
      setErro(`Prazo SEFAZ de cancelamento vencido (${prazoNota.prazoLabel} após a autorização).`);
      return;
    }
    setErro(''); setBusy(true);
    const r = await notaService.cancelar(String(sale.id), just);
    setBusy(false);
    if (r.erro && !r.nota) { setErro(r.erro); return; }
    if (r.nota) {
      onNotaChange({ ...nota, ...r.nota });
      setCancelAberto(false); setJustificativa('');
      if (r.nota.status === 'CANCELADA') {
        // BLOCO 147: o servidor cancelou o BOLETO junto, arquivou a nota no
        // Portal Fiscal (CANCELADAS) e limpou a venda — mostra a cascata.
        setInfo(r.aviso || 'Nota CANCELADA na SEFAZ — o XML original continua existindo (evento de cancelamento).');
        showToast?.(r.bloqueioBoleto
          ? 'Nota cancelada, mas o BOLETO continua VIVO! Cancele-o no Portal Fiscal (Ações > Boleto > Cancelar).'
          : 'Nota cancelada na SEFAZ!', r.bloqueioBoleto ? 'error' : 'success');
        onNotaCancelada?.();
      } else {
        setInfo('Cancelamento enviado — toque em "Atualizar situação" em alguns segundos.');
      }
    }
  };

  const docCadastro = String(client?.cnpj || '').replace(/\D/g, '');
  const docTipo = tipoDocDigitos(docCadastro);
  const docValido = !!docCadastro && validaCpfOuCnpj(docCadastro);
  const temCnpj = docTipo === 'CNPJ' && docValido;
  const temCpf = docTipo === 'CPF' && docValido;
  const razao = String(client?.razaoSocial || client?.nomeFantasia || client?.nome || '').trim();

  // Intenção gravada na venda (PDV tela 4) — pré-seleciona o documento escolhido
  const intencao = intencaoNotaDaVenda(sale as { modoNota?: string | null; detalhePagamento?: string | null });

  // Disponibilidade das 3 opções (regras do dono)
  const nfeOk = temCnpj && !!razao;
  const nfeMotivo = !docCadastro
    ? 'Cliente sem CPF/CNPJ no cadastro — edite o cadastro para emitir NF-e.'
    : !temCnpj
      ? 'NF-e exige CNPJ válido no cadastro (com 14 dígitos).'
      : !razao
        ? 'NF-e exige Razão Social/Nome no cadastro.'
        : '';
  const nfceIdentOk = docValido; // CPF ou CNPJ do cadastro (BLOCO 128)
  const nfceIdentMotivo = !docCadastro
    ? 'Cliente sem documento no cadastro — use a NFC-e ANÔNIMA ou cadastre o CPF/CNPJ.'
    : !docValido
      ? 'CPF/CNPJ do cadastro inválido (dígitos verificadores) — confira no cadastro.'
      : '';
  const nfceAnonimaOk = true; // a validação do modo cupom (ERP) é feita pelo servidor

  // Pré-seleção: o documento que o vendedor escolheu na tela 4 do PDV
  // (roda UMA vez, na abertura da janela — de propósito sem deps)
  useEffect(() => {
    if (intencao === 'NFE' && nfeOk) setAberta('NFE');
    else if (intencao === 'NFCE') setAberta(nfceIdentOk ? 'NFCE_IDENTIFICADA' : 'NFCE_ANONIMA');
    else if (!docCadastro) setAberta('NFCE_ANONIMA');
    else if (temCnpj && nfeOk) setAberta('NFE');
    else if (docValido) setAberta('NFCE_IDENTIFICADA');
  }, []);

  const avisar = (msg: string, tipo: 'success' | 'error' = 'error') => {
    if (showToast) showToast(msg, tipo);
  };

  const badge = () => {
    switch (nota.status) {
      case 'AUTORIZADA': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-circle-check', txt: `AUTORIZADA — ${nota.tipo === 'NFCE' ? 'NFC-e' : 'NF-e'} nº ${nota.numero || ''}` };
      case 'EMITINDO': return { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'fa-hourglass-half', txt: 'EMITINDO — aguardando a SEFAZ...' };
      case 'REJEITADA': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-circle-xmark', txt: 'REJEITADA pela SEFAZ' };
      case 'CANCELADA': return { cls: 'bg-gray-100 text-gray-500 border-gray-200', icon: 'fa-ban', txt: 'Nota cancelada' };
      default: return { cls: 'bg-gray-50 text-gray-500 border-gray-200', icon: 'fa-file-circle-plus', txt: 'SEM NOTA — venda aberta no fiscal' };
    }
  };
  const nb = badge();

  // ---------- EMITIR ----------
  const emitir = async () => {
    if (busy || !sale.id || sale.id === 'preview') return;
    if (focus && !focus.configurado) {
      setErro('NF-e indisponível: token da Focus NFe ausente no servidor (FOCUS_NFE_TOKEN na Vercel). Avise o admin.');
      return;
    }
    setErro(''); setInfo('');
    const opts = {
      NFE: { tipo: 'NFE' as const, cpf: undefined as string | undefined, cupom: false },
      NFCE_IDENTIFICADA: { tipo: 'NFCE' as const, cpf: undefined as string | undefined, cupom: false },
      NFCE_ANONIMA: { tipo: 'NFCE' as const, cpf: undefined as string | undefined, cupom: true },
    };
    const o = aberta === 'NFE' ? opts.NFE : aberta === 'NFCE_IDENTIFICADA' ? opts.NFCE_IDENTIFICADA : opts.NFCE_ANONIMA;
    setBusy(true);
    const r = await notaService.emitir(String(sale.id), o.tipo, o.cpf, o.cupom);
    setBusy(false);
    if (r.erro && !r.nota) {
      setErro(r.erro);
      avisar(r.erro, 'error');
      return;
    }
    if (r.nota) {
      const merged = { ...nota, ...r.nota, tipo: o.tipo };
      onNotaChange(merged);
      if (r.nota.status === 'AUTORIZADA') {
        setInfo(`${o.tipo === 'NFE' ? 'NF-e' : 'NFC-e'} AUTORIZADA — nº ${r.nota.numero || ''}. Já pode imprimir o cupom fiscal.`);
        avisar('Nota autorizada!', 'success');
      } else if (r.nota.status === 'REJEITADA') {
        setErro(r.nota.erro || 'Nota rejeitada pela SEFAZ.');
        avisar(r.nota.erro || 'Nota rejeitada pela SEFAZ', 'error');
      } else if (r.nota.status === 'EMITINDO') {
        setInfo('Enviada à SEFAZ — toque em "Atualizar situação" em alguns segundos.');
      }
    }
  };

  // ---------- CONSULTAR ----------
  const consultar = async () => {
    if (busy || !sale.id) return;
    setBusy(true);
    const r = await notaService.consultar(String(sale.id));
    setBusy(false);
    if (r.erro && !r.nota) { setErro(r.erro); return; }
    if (r.nota) {
      onNotaChange({ ...nota, ...r.nota });
      if (r.nota.status === 'AUTORIZADA') { setInfo('SEFAZ confirmou: nota AUTORIZADA.'); setErro(''); }
      else if (r.nota.status === 'REJEITADA') setErro(r.nota.erro || 'Rejeitada pela SEFAZ.');
    }
  };

  // ---------- IMPRIMIR CUPOM FISCAL 80mm ----------
  // BLOCO 150 (dono: "os valores nao fecham" / "ta gerando nota nova"):
  // o cupom 80mm só sai do DOCUMENTO AUTORIZADO (XML da nota já emitida —
  // mesmos valores do PDF A4). NUNCA com os dados da venda: a NFC-e anônima
  // sai no preço cupom (menor que X) e o cupom com valores da venda parecia
  // uma "nota nova". XML indisponível = aviso e tentar de novo.
  const imprimirCupomFiscal = async () => {
    if (busy || !sale.id) return;
    setBusy(true);
    try {
      const c = await notaService.cupom80(String(sale.id));
      const cup = c.cupom;
      if (c.ok && cup?.cancelada) {
        setErro('Nota CANCELADA na SEFAZ — não pode ser impressa.');
        return;
      }
      if (!(c.ok && cup?.autorizada && cup.chave)) {
        setErro(c.erro || 'Cupom fiscal ainda não disponível — confirme a autorização da SEFAZ (Atualizar situação).');
        return;
      }
      if (cup.fonte !== 'XML') {
        setErro('O XML da nota ainda não baixou da SEFAZ — o cupom 80mm é fiel ao documento autorizado (mesmos valores do PDF). Aguarde uns instantes e toque de novo.');
        return;
      }
      const texto = danfeFiscal80(cup);
      if (lerCanalImpressao() === 'USB') {
        imprimirViaUsb(texto, '80MM', (m) => setErro(`Falha na janela de impressão USB: ${m}`));
        setInfo('Janela de impressão aberta — escolha a térmica USB do computador.');
        return;
      }
      const ok = await bluetoothPrinter.print(texto, '80MM', { skipConfirm: true });
      if (ok) { setInfo('Cupom fiscal enviado à impressora!'); avisar('Cupom fiscal enviado!', 'success'); }
      else setErro('Impressão não realizada — conecte a impressora Bluetooth.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErro(msg === 'BLUETOOTH_NAO_SUPORTADO'
        ? 'Bluetooth indisponível neste aparelho — troque o canal para "USB do PC" no passo 1 ou use o Chrome do Android.'
        : `Erro na impressão do cupom fiscal: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  // ---------- VER MINI DANFE (80mm retrato) — visualizar antes de imprimir ----------
  // BLOCO 150: o preview também só mostra o DOCUMENTO AUTORIZADO (XML).
  const verMiniDanfe = async () => {
    if (busy || !sale.id) return;
    setBusy(true);
    try {
      const c = await notaService.cupom80(String(sale.id));
      const cup = c.cupom;
      if (!c.ok || !cup?.chave) {
        setErro('Cupom fiscal ainda não disponível — confirme a autorização da SEFAZ.');
        return;
      }
      if (cup.fonte !== 'XML') {
        setErro('O XML da nota ainda não baixou da SEFAZ — o preview é fiel ao documento autorizado. Aguarde uns instantes e toque de novo.');
        return;
      }
      setPreviewCupom(cup);
      setPreviewAberto(true);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const opcoes: { id: OpcaoFiscal; ok: boolean; motivo: string; titulo: string; desc: string; preco: string; icon: string; bordaAtiva: string; fundoAtivo: string; textoAtivo: string; pontoAtivo: string; iconeAtivo: string }[] = [
    {
      id: 'NFE', ok: nfeOk, motivo: nfeMotivo,
      titulo: 'NF-e (modelo 55)',
      desc: 'Nota completa para EMPRESAS — leva razão social, CNPJ, IE e endereço do cadastro.',
      preco: 'Sai no PREÇO NORMAL da venda (o digitado pelo vendedor).',
      icon: 'fa-file-invoice-dollar',
      bordaAtiva: 'border-violet-500', fundoAtivo: 'bg-violet-50', textoAtivo: 'text-violet-700', pontoAtivo: 'text-violet-600', iconeAtivo: 'text-violet-600',
    },
    {
      id: 'NFCE_IDENTIFICADA', ok: nfceIdentOk, motivo: nfceIdentMotivo,
      titulo: `NFC-e identificada${temCpf ? ' (CPF)' : temCnpj ? ' (CNPJ)' : ''}`,
      desc: 'Cupom fiscal COM o consumidor identificado pelo cadastro (CPF/CNPJ + endereço).',
      preco: 'Sai no PREÇO NORMAL da venda (o digitado pelo vendedor).',
      icon: 'fa-id-card',
      bordaAtiva: 'border-blue-500', fundoAtivo: 'bg-blue-50', textoAtivo: 'text-blue-700', pontoAtivo: 'text-blue-600', iconeAtivo: 'text-blue-600',
    },
    {
      id: 'NFCE_ANONIMA', ok: nfceAnonimaOk, motivo: '',
      titulo: 'NFC-e ANÔNIMA (modo cupom)',
      desc: 'Cupom fiscal SEM consumidor — o preço ANÔNIMO (preço cupom) vale SÓ aqui.',
      preco: 'Sai no PREÇO ANÔNIMO dos produtos (preço cupom/custo). O cupom físico segue o preço normal.',
      icon: 'fa-receipt',
      bordaAtiva: 'border-teal-500', fundoAtivo: 'bg-teal-50', textoAtivo: 'text-teal-700', pontoAtivo: 'text-teal-600', iconeAtivo: 'text-teal-600',
    },
  ];

  const semNotaAberta = !nota.status || nota.status === 'NAO_EMITIDA' || nota.status === 'REJEITADA' || nota.status === 'CANCELADA';

  return (
    <div className="fixed inset-0 bg-black/90 z-[160] flex flex-col items-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] overflow-y-auto backdrop-blur-sm">
      <div className="bg-white w-full max-w-[420px] shadow-2xl flex flex-col shrink-0 rounded-t-3xl overflow-hidden my-auto animate-in zoom-in-95 duration-300">
        {/* HEADER */}
        <div className="bg-violet-600 text-white px-4 py-3 flex items-center gap-2">
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center active:scale-90" aria-label="Voltar">
            <i className="fa-solid fa-arrow-left"></i>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest">Documento Fiscal</p>
            <p className="text-[9px] font-bold text-white/70 truncate">{razao || 'Cliente'} · R$ {(Number(sale.valorTotal) || 0).toFixed(2)}</p>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* STATUS DA NOTA */}
          <div className={`rounded-2xl border ${nb.cls} px-3 py-2.5 flex items-center gap-2`}>
            <i className={`fa-solid ${nb.icon}`}></i>
            <span className="text-[10px] font-black uppercase flex-1 min-w-0 break-words">{nb.txt}</span>
          </div>
          {nota.status === 'REJEITADA' && nota.erro && (
            <p className="text-[9px] leading-snug font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 break-words"><i className="fa-solid fa-circle-exclamation mr-1"></i>{nota.erro}</p>
          )}
          {focus && !focus.configurado && (
            <p className="text-[9px] leading-snug font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded-xl px-3 py-2">
              <i className="fa-solid fa-plug-circle-xmark mr-1"></i>
              Token da Focus NFe ausente no servidor — o admin precisa definir FOCUS_NFE_TOKEN na Vercel.
            </p>
          )}
          {info && (
            <p className="text-[9px] leading-snug font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2"><i className="fa-solid fa-circle-info mr-1"></i>{info}</p>
          )}
          {erro && (
            <p className="text-[9px] leading-snug font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 break-words"><i className="fa-solid fa-triangle-exclamation mr-1"></i>{erro}</p>
          )}

          {/* AS 3 OPÇÕES — só aparecem enquanto não tem nota autorizada */}
          {semNotaAberta ? (
            <div className="space-y-2">
              {opcoes.map(op => (
                <button key={op.id} onClick={() => setAberta(op.id)} disabled={!op.ok} aria-pressed={aberta === op.id}
                  className={`w-full text-left rounded-2xl border-2 p-3 transition-all ${aberta === op.id ? `${op.bordaAtiva} ${op.fundoAtivo} shadow-sm` : op.ok ? 'border-gray-100 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                  <div className="flex items-center gap-2">
                    <i className={`fa-solid ${op.icon} ${aberta === op.id ? op.iconeAtivo : 'text-gray-400'} text-sm`}></i>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-[10px] font-black uppercase ${aberta === op.id ? op.textoAtivo : 'text-gray-700'}`}>{op.titulo}</span>
                    </span>
                    <i className={`fa-solid ${aberta === op.id ? 'fa-circle-dot ' + op.pontoAtivo : 'fa-regular fa-circle text-gray-300'} text-sm`}></i>
                  </div>
                  <p className="text-[9px] font-bold text-gray-500 leading-snug mt-1.5">{op.desc}</p>
                  <p className="text-[8px] font-black leading-snug mt-1 text-violet-500">{op.preco}</p>
                  {!op.ok && op.motivo && (
                    <p className="text-[8px] font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 leading-snug mt-1.5"><i className="fa-solid fa-circle-info mr-1"></i>{op.motivo}</p>
                  )}
                </button>
              ))}

              {/* EMITIR */}
              <button onClick={emitir} disabled={busy || !aberta}
                className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg">
                <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-bolt'} mr-1`}></i>
                {busy ? 'Emitindo...' : aberta === 'NFCE_ANONIMA' ? 'Emitir NFC-e anônima' : aberta === 'NFE' ? 'Emitir NF-e' : aberta === 'NFCE_IDENTIFICADA' ? 'Emitir NFC-e identificada' : 'Escolha o documento acima'}
              </button>
              {aberta === 'NFCE_ANONIMA' && (
                <p className="text-[8px] font-bold text-gray-400 leading-snug px-1">
                  O modo cupom precisa estar LIGADO nas Configurações → ERP Fiscal (cupomDuploNfc). Se estiver desligado, o servidor recusa com aviso.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {nota.status === 'EMITINDO' && (
                <button onClick={consultar} disabled={busy} className="w-full bg-amber-500 text-white font-black py-4 rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
                  <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`}></i> Atualizar situação na SEFAZ
                </button>
              )}
              {nota.status === 'REJEITADA' && (
                <button onClick={() => { onNotaChange({ ...nota, status: 'NAO_EMITIDA', erro: undefined }); setAberta(intencao === 'NFE' && nfeOk ? 'NFE' : docValido ? 'NFCE_IDENTIFICADA' : 'NFCE_ANONIMA'); }}
                  className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 flex items-center justify-center gap-2">
                  <i className="fa-solid fa-rotate-right"></i> Emitir novamente (escolher documento)
                </button>
              )}
              {nota.status === 'AUTORIZADA' && (
                <>
                  <button onClick={imprimirCupomFiscal} disabled={busy}
                    className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
                    <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-print'}`}></i> Imprimir Cupom Fiscal (80mm)
                  </button>
                  {/* MINI DANFE — visualizar o papel 80mm antes de mandar para a térmica */}
                  <button onClick={verMiniDanfe} disabled={busy}
                    className="w-full bg-slate-900 text-white font-black py-3 rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
                    <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-eye'}`}></i> Ver mini DANFE (80mm retrato)
                  </button>
                  {nota.pdfUrl && (
                    <a href={nota.pdfUrl} target="_blank" rel="noopener noreferrer"
                      className="block w-full bg-emerald-600 text-white font-black py-3.5 rounded-2xl text-center text-[10px] uppercase tracking-widest active:scale-95">
                      <i className="fa-solid fa-file-pdf mr-1"></i> Abrir DANFE A4 (Focus)
                    </a>
                  )}
                  {/* BLOCO 142: CANCELAR NOTA — só dentro do prazo SEFAZ; venceu = some/inativo */}
                  {podeCancelar && prazoNota && (
                    <div className="rounded-2xl border border-rose-100 bg-rose-50 p-3 space-y-2">
                      {!cancelAberto ? (
                        <>
                          <button onClick={() => { setCancelAberto(true); setJustificativa(''); setErro(''); }} disabled={busy || prazoNota.expirado}
                            className="w-full bg-rose-600 text-white font-black py-3.5 rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
                            <i className="fa-solid fa-ban"></i> Cancelar nota na SEFAZ
                          </button>
                          <p className="text-[8px] font-bold text-rose-500 leading-snug px-1">
                            {prazoNota.expirado
                              ? `Prazo vencido — a janela de ${prazoNota.prazoLabel} após a autorização acabou.`
                              : `Restam ${prazoNota.textoRestante} para cancelar (regra SEFAZ: ${prazoNota.prazoLabel}).`}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-[9px] font-black text-rose-700 uppercase tracking-wide">
                            <i className="fa-solid fa-stopwatch mr-1"></i>
                            {prazoNota.expirado ? `Prazo vencido (${prazoNota.prazoLabel})` : `Restam ${prazoNota.textoRestante}`}
                          </p>
                          <textarea value={justificativa} onChange={e => setJustificativa(e.target.value)} rows={3} maxLength={255}
                            placeholder="Justificativa (mínimo 15 caracteres) — ex.: erro na emissão, valores divergentes."
                            className="w-full p-3 bg-white rounded-xl font-semibold text-[12px] outline-none focus:ring-2 focus:ring-rose-200 resize-none border border-rose-100" />
                          <div className="flex gap-2">
                            <button onClick={() => { setCancelAberto(false); setJustificativa(''); }} disabled={busy}
                              className="flex-1 bg-white text-gray-500 border border-gray-200 rounded-xl py-3 text-[10px] font-black uppercase active:scale-95">Voltar</button>
                            <button onClick={() => void cancelar()} disabled={busy || justificativa.trim().length < 15 || prazoNota.expirado}
                              className="flex-1 bg-rose-600 text-white rounded-xl py-3 text-[10px] font-black uppercase active:scale-95 disabled:opacity-60">
                              {busy ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Confirmar cancelamento'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
              {nota.status === 'AUTORIZADA' && (
                <div className="rounded-2xl bg-gray-50 border border-gray-100 px-3 py-2.5 space-y-1">
                  <p className="text-[9px] font-black text-gray-500 uppercase">Chave de acesso</p>
                  <p className="text-[9px] font-bold text-gray-700 font-mono break-all">{nota.chave || '— consulte a SEFAZ'}</p>
                </div>
              )}
            </div>
          )}

          {/* REGRAS DO DONO — fixas no rodapé da janela */}
          <div className="rounded-2xl bg-violet-50 border border-violet-100 px-3 py-2.5">
            <p className="text-[8px] font-black text-violet-700 uppercase tracking-wide mb-1"><i className="fa-solid fa-scale-balanced mr-1"></i>Regras</p>
            <p className="text-[8px] font-bold text-violet-600 leading-snug">CUPOM (não fiscal) sai sempre no preço normal digitado. O PREÇO ANÔNIMO vale apenas na NFC-e anônima. A venda pode fechar sem nota — o banner vermelho no cupom lembra até a nota ser autorizada.</p>
          </div>

          <button onClick={onClose} className="w-full py-3.5 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Voltar ao cupom</button>
        </div>
      </div>

      {/* MINI DANFE 80mm — visualização + impressão (BT/USB) com os dados reais */}
      <ModelosImpressao
        abrir={previewAberto}
        onClose={() => setPreviewAberto(false)}
        abaInicial="danfe"
        cupom={previewCupom}
        showToast={showToast}
      />
    </div>
  );
};

export default JanelaFiscal;
