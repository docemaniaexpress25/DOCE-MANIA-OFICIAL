'use client';

import { useState, useEffect, useMemo } from 'react';
import { DanfeFiscalData, danfeFiscal80 } from '@/lib/danfe80';
import { bluetoothPrinter } from '@/services/bluetoothPrinterService';
import { imprimirViaUsb, lerCanalImpressao, dispositivoIOS } from '@/lib/usbPrint';

/**
 * MODELOS DE IMPRESSAO 80mm — VISUALIZACAO + IMPRESSAO do MINI DANFE.
 *
 * "vou anexar aqui um pdf da nfe e um pdf do boleto! esses sao os modelos
 *  padrao para imprimir a4 na impressora comum, porem tbm precisamos de
 *  modelos menores ou seja mini danfe e mini boleto para ser impressos tanto
 *  na 80mm pelo bluetooth ou pelo 80mm usb!"
 *
 * BLOCO 152: o MINI BOLETO (80mm paisagem) foi EXCLUIDO pelo dono — o boleto
 * do app e o PDF ORIGINAL do Inter. Este modal sobra apenas com o:
 *  - MINI DANFE (80mm RETRATO): papel renderizado com o texto do cupom fiscal
 *    (danfeFiscal80) — mesma folha que sai no rolo.
 *
 * Canais: Bluetooth (Web Bluetooth, raster) e USB do PC (papel virtual
 * do navegador). O canal padrao do dispositivo e o mesmo do cupom.
 */

interface ModelosImpressaoProps {
  abrir: boolean;
  onClose: () => void;
  /** Dados reais do cupom fiscal (quando veem do portal/venda); demo quando ausente */
  cupom?: DanfeFiscalData | null;
  showToast?: (msg: string, tipo?: 'success' | 'error') => void;
}

// ---------------------------------------------------------------------------
// Dados DEMO do DANFE — exatamente os do PDF A4 anexado pelo dono (NF-e 139)
// ---------------------------------------------------------------------------
const DEMO_CUPOM: DanfeFiscalData = {
  autorizada: true,
  modelo: 'NFE',
  numero: '000000139',
  serie: '1',
  chave: '43261163720443000177550010000001391693448071',
  protocolo: '243260472622402',
  dataAutorizacao: '2026-11-12T17:57:36-03:00',
  dataEmissao: '2026-11-12T17:41:00-03:00',
  natureza: 'VENDA',
  emitente: {
    nome: 'DOCE MANIA EXPRESS LTDA',
    fantasia: 'DOCE MANIA ATACADISTA',
    cnpj: '63720443000177',
    ie: '0290764262',
    endereco: 'Rua dos Mimo-de-Venus, 185\nCinquentenario - 95012400\nCaxias do Sul/RS',
  },
  destinatario: {
    nome: 'CLEUZA MARIA DA SILVA PORTO',
    doc: '34970849000100',
    ie: '8002233148',
    endereco: 'Rua Paul A. Harrys 350 SALALOTE 001\nCinquentenario - 95012430\nCaxias do Sul/RS',
  },
  itens: [
    { codigo: 'DOR120', descricao: 'DORITOS NACHO 120G', quantidade: 5, unidade: 'un', valorUnitario: 11.59, valorTotal: 57.95, ncm: '19059090', cst: '0101', cfop: '5102' },
    { codigo: 'RFS68', descricao: 'RUFFLES SAL 68G', quantidade: 5, unidade: 'un', valorUnitario: 7.59, valorTotal: 37.95, ncm: '20052000', cst: '0101', cfop: '5102' },
    { codigo: 'RUFCEB68', descricao: 'RUFFLES CEBOLA E SALSA 68G', quantidade: 3, unidade: 'un', valorUnitario: 7.59, valorTotal: 22.77, ncm: '20052000', cst: '0101', cfop: '5102' },
    { codigo: 'FDP85', descricao: 'FANDANGOS PRESUNTO 85G', quantidade: 5, unidade: 'un', valorUnitario: 7.59, valorTotal: 37.95, ncm: '19041000', cst: '0101', cfop: '5102' },
    { codigo: 'CHON90', descricao: 'CHEETOS ONDA 90G', quantidade: 10, unidade: 'un', valorUnitario: 7.59, valorTotal: 75.9, ncm: '19041000', cst: '0101', cfop: '5102' },
    { codigo: 'PPIC55', descricao: 'PINGO PICANHA 55G', quantidade: 5, unidade: 'un', valorUnitario: 4.99, valorTotal: 24.95, ncm: '19059090', cst: '0101', cfop: '5102' },
    { codigo: 'STI160', descricao: 'STIKSY 160G', quantidade: 10, unidade: 'un', valorUnitario: 9.59, valorTotal: 95.9, ncm: '19059090', cst: '0101', cfop: '5102' },
    { codigo: 'TOD200', descricao: 'TODDYNHO 200ML', quantidade: 27, unidade: 'un', valorUnitario: 2.98, valorTotal: 80.46, ncm: '22029900', cst: '0101', cfop: '5102' },
    { codigo: 'KERO330', descricao: 'KERO COCO 330ML', quantidade: 12, unidade: 'un', valorUnitario: 6.29, valorTotal: 75.48, ncm: '20098921', cst: '0101', cfop: '5102' },
    { codigo: 'CEB91', descricao: 'CEBOLITOS 91G', quantidade: 3, unidade: 'un', valorUnitario: 7.99, valorTotal: 23.97, ncm: '19041000', cst: '0101', cfop: '5102' },
  ],
  quantidadeItens: 85,
  valorProdutos: 932.21,
  valorDesconto: 0,
  valorTotal: 932.21,
  valorTributos: 271.76,
  baseIcms: 0,
  valorIcms: 0,
  pagamentos: [{ forma: 'BOLETO BANCARIO', valor: 932.21 }],
  troco: 0,
  informacoes: 'Valor aproximado dos tributos: R$ 126,65 federais R$ 145,11 estaduais Fonte: IBPT/empresometro.com.br AA45DF',
  simplesNacional: true,
  fonte: 'XML',
};

// ---------------------------------------------------------------------------
// Papel termico 80mm em HTML (o texto 48 colunas como sai no rolo)
// ---------------------------------------------------------------------------
const Papel80: React.FC<{ texto: string }> = ({ texto }) => (
  <div className="relative mx-auto w-[300px] max-w-full">
    {/* topo do rolo (recorte) */}
    <div className="h-3 rounded-t-[3px] bg-white border border-b-0 border-gray-300"
      style={{ backgroundImage: 'repeating-linear-gradient(90deg, #d4d4d8 0 6px, transparent 6px 12px)' }} />
    <div className="bg-white border-x border-gray-300 px-4 py-4 font-mono text-[11px] leading-[1.45] whitespace-pre text-black shadow-sm"
      style={{ letterSpacing: '-0.3px' }}>
      {texto}
    </div>
    {/* base do rolo (recorte) */}
    <div className="h-3 rounded-b-[3px] bg-white border border-t-0 border-gray-300"
      style={{ backgroundImage: 'repeating-linear-gradient(90deg, #d4d4d8 0 6px, transparent 6px 12px)' }} />
  </div>
);

const ModelosImpressao: React.FC<ModelosImpressaoProps> = ({ abrir, onClose, cupom, showToast }) => {
  const [ocupado, setOcupado] = useState<'bt' | 'usb' | ''>('');
  // canal atual / iOS so existem no navegador — estado pos-montagem evita
  // mismatch de hidratacao (lerCanalImpressao le localStorage do dispositivo)
  const [montado, setMontado] = useState(false);
  const [canalAtual, setCanalAtual] = useState<'BT' | 'USB'>('BT');
  const [ios, setIos] = useState(false);
  useEffect(() => {
    if (!abrir) return;
    setMontado(true);
    setCanalAtual(lerCanalImpressao());
    setIos(dispositivoIOS());
  }, [abrir]);

  const cupomFinal = cupom || DEMO_CUPOM;
  const ehDemo = !cupom;

  // texto do mini DANFE (48 colunas) — renderizado no papel
  const textoDanfe = useMemo(() => {
    try { return danfeFiscal80(cupomFinal); } catch { return ''; }
  }, [cupomFinal]);

  if (!abrir) return null;

  // ---------- impressao do mini DANFE (texto 48 colunas) ----------
  const imprimirDanfe = async (canal: 'bt' | 'usb') => {
    if (!textoDanfe) return;
    setOcupado(canal);
    try {
      if (canal === 'usb' || lerCanalImpressao() === 'USB') {
        imprimirViaUsb(textoDanfe, '80MM', (m) => showToast?.(`Falha na janela USB: ${m}`, 'error'));
        showToast?.('Janela de impressão aberta — escolha a térmica USB.', 'success');
        return;
      }
      const ok = await bluetoothPrinter.print(textoDanfe, '80MM', { skipConfirm: true });
      if (ok) showToast?.('Mini DANFE enviado à impressora Bluetooth!', 'success');
      else showToast?.('Impressão não realizada — conecte a impressora.', 'error');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast?.(msg === 'BLUETOOTH_NAO_SUPORTADO'
        ? 'Bluetooth indisponível aqui — use o canal USB do PC.'
        : `Erro: ${msg}`, 'error');
    } finally {
      setOcupado('');
    }
  };

  const canalAtualSel = canalAtual;
  const iosSel = montado && ios;

  return (
    <div className="fixed inset-0 z-[170] bg-black/80 backdrop-blur-sm flex flex-col" role="dialog" aria-label="Modelos de impressão 80mm">
      {/* HEADER */}
      <div className="bg-slate-900 text-white px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center active:scale-90" aria-label="Fechar">
          <i className="fa-solid fa-xmark"></i>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest">Modelos de impressão 80mm</p>
          <p className="text-[9px] font-bold text-white/60 truncate">Mini DANFE (retrato) — como sai na térmica</p>
        </div>
        {ehDemo && (
          <span className="text-[8px] font-black uppercase bg-amber-400 text-amber-950 px-2 py-1 rounded-md shrink-0">Exemplo NF-e 139</span>
        )}
      </div>

      {/* CONTEUDO — PREVIEW */}
      <div className="flex-1 overflow-y-auto bg-slate-950/60 p-4">
        <div className="space-y-3">
          <p className="text-[9px] font-black text-white/50 uppercase tracking-wide text-center">
            Papel térmico 80mm — como sai da impressora
          </p>
          <Papel80 texto={textoDanfe || 'Cupom indisponível'} />
        </div>
      </div>

      {/* RODAPE — ACOES DE IMPRESSAO */}
      <div className="shrink-0 border-t border-white/10 bg-slate-900 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {!iosSel && (
          <p className="text-[8px] font-black text-white/40 uppercase tracking-wide mb-2 text-center">
            Canal atual: {canalAtualSel === 'USB' ? 'USB do PC' : 'Bluetooth'}
          </p>
        )}
        <div className="flex gap-2 max-w-[520px] mx-auto">
          {!iosSel && (
            <button onClick={() => void imprimirDanfe('bt')} disabled={ocupado !== ''} className="flex-1 bg-indigo-600 text-white font-black py-3.5 rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
              <i className={`fa-solid ${ocupado === 'bt' ? 'fa-spinner fa-spin' : 'fa-bluetooth-b'}`}></i> Bluetooth
            </button>
          )}
          <button onClick={() => void imprimirDanfe('usb')} disabled={ocupado !== ''} className="flex-1 bg-emerald-600 text-white font-black py-3.5 rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
            <i className={`fa-solid ${ocupado === 'usb' ? 'fa-spinner fa-spin' : 'fa-print'}`}></i> USB do PC
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModelosImpressao;
