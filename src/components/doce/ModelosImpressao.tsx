'use client';

import { useState, useEffect, useMemo } from 'react';
import { DanfeFiscalData, danfeFiscal80 } from '@/lib/danfe80';
import { danfeFiscal80Html } from '@/lib/danfe80Html';
import { DEMO_DANFE_69 } from '@/lib/danfeDemo';
import { imprimirHtmlViaBt } from '@/lib/impressaoHtml';
import { imprimirHtmlViaUsb, lerCanalImpressao, dispositivoIOS } from '@/lib/usbPrint';

/**
 * MODELOS DE IMPRESSAO 80mm — VISUALIZACAO + IMPRESSAO do MINI DANFE.
 *
 * BLOCO 158 (dono: "PEGAR A DANFE CRIADA NA NFE E CRIAR ALGO 100% A ESSE
 * LAYOUT AQUI... SEMPRE OTIMIZADO PARA IMPRESSAO EM 80MM, DEIXE A MELHOR
 * DEFINICAO DE QUALIDADE DA FONTE"): o preview agora mostra o LAYOUT DE
 * REFERENCIA do dono (grade, caixa de valor total em destaque, codigo de
 * barras CODE 128 e fonte monoespacada de melhor definicao) — exatamente a
 * folha que sai no canal USB.
 *
 * BLOCO 185 (dono: "faça a impressao por bt ser igual a de usb, pois a de usb
 * esta muito boa"): o Bluetooth também imprime ESTA MESMA FOLHA (raster
 * 203dpi do HTML — btRaster) e não mais o texto 48 colunas. Nos dois canais
 * o papel sai idêntico, com forma de pagamento (bloco 180).
 *
 * Canais: Bluetooth (Web Bluetooth) e USB do PC (papel virtual do navegador).
 * O canal padrao do dispositivo e o mesmo do cupom.
 */

interface ModelosImpressaoProps {
  abrir: boolean;
  onClose: () => void;
  /** Dados reais do cupom fiscal (quando veem do portal/venda); demo quando ausente */
  cupom?: DanfeFiscalData | null;
  showToast?: (msg: string, tipo?: 'success' | 'error') => void;
}

// ---------------------------------------------------------------------------
// Dados DEMO — NF-e 69 Serie 1 do MODELO DE REFERENCIA do dono
// (Mini DANFE 80mm - NF-e 69 Serie 1.html) — vivem em src/lib/danfeDemo.ts
// ---------------------------------------------------------------------------
const DEMO_CUPOM: DanfeFiscalData = DEMO_DANFE_69;

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

  // BLOCO 158: HTML do layout de referencia (a folha que sai no USB).
  // O gerador e async (QR da NFC-e) — estado preenchido no useEffect.
  const [htmlDanfe, setHtmlDanfe] = useState('');
  useEffect(() => {
    if (!abrir) { setHtmlDanfe(''); return; }
    let vivo = true;
    danfeFiscal80Html(cupomFinal)
      .then((h) => { if (vivo) setHtmlDanfe(h); })
      .catch(() => { if (vivo) setHtmlDanfe(''); });
    return () => { vivo = false; };
  }, [abrir, cupomFinal]);

  // texto 48 colunas — usado só no canal Bluetooth (ESC/POS)
  const textoDanfe = useMemo(() => {
    try { return danfeFiscal80(cupomFinal); } catch { return ''; }
  }, [cupomFinal]);

  if (!abrir) return null;

  // ---------- impressao do mini DANFE (USB = HTML / BT = texto) ----------
  const imprimirDanfe = async (canal: 'bt' | 'usb') => {
    setOcupado(canal);
    try {
      if (canal === 'usb' || lerCanalImpressao() === 'USB') {
        if (!htmlDanfe) { showToast?.('Cupom indisponível para o layout.', 'error'); return; }
        imprimirHtmlViaUsb(htmlDanfe, (m) => showToast?.(`Falha na janela USB: ${m}`, 'error'));
        showToast?.('Janela de impressão aberta — escolha a térmica USB.', 'success');
        return;
      }
      if (!textoDanfe) return;
      // BLOCO 185: BT imprime o MESMO layout do USB (HTML rasterizado a 203dpi).
      const ok = await imprimirHtmlViaBt(
        () => danfeFiscal80Html(cupomFinal, { raster: true }),
        () => textoDanfe,
      );
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

  /** Ajusta a altura do iframe ao conteudo (papel do tamanho real). */
  const ajustarAlturaIframe = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    try {
      const doc = e.currentTarget.contentDocument;
      if (doc) e.currentTarget.style.height = `${Math.ceil(doc.documentElement.scrollHeight)}px`;
    } catch { /* cross-origin impossivel com srcdoc — ignora */ }
  };

  return (
    <div className="fixed inset-0 z-[170] bg-black/80 backdrop-blur-sm flex flex-col" role="dialog" aria-label="Modelos de impressão 80mm">
      {/* HEADER */}
      <div className="bg-slate-900 text-white px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center active:scale-90" aria-label="Fechar">
          <i className="fa-solid fa-xmark"></i>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest">Mini DANFE 80mm</p>
          <p className="text-[9px] font-bold text-white/60 truncate">Layout de referência — como sai na térmica</p>
        </div>
        {ehDemo && (
          <span className="text-[8px] font-black uppercase bg-amber-400 text-amber-950 px-2 py-1 rounded-md shrink-0">Exemplo NF-e 69</span>
        )}
      </div>

      {/* CONTEUDO — PREVIEW do papel 80mm (HTML real, isolado no iframe) */}
      <div className="flex-1 overflow-y-auto bg-slate-950/60 p-4">
        <div className="space-y-3">
          <p className="text-[9px] font-black text-white/50 uppercase tracking-wide text-center">
            Papel térmico 80mm — como sai da impressora
          </p>
          {htmlDanfe ? (
            <iframe
              srcDoc={htmlDanfe}
              title="Mini DANFE 80mm"
              onLoad={ajustarAlturaIframe}
              className="w-[430px] max-w-full mx-auto block bg-white rounded shadow-lg border-0"
              style={{ minHeight: '320px' }}
            />
          ) : (
            <p className="text-center text-[10px] font-bold text-white/60 py-10">Cupom indisponível</p>
          )}
          {!iosSel && (
            <p className="text-[8px] font-bold text-white/40 text-center leading-snug">
              USB e Bluetooth: sai EXATAMENTE esta folha (BLOCO 185 — o BT rasteriza este mesmo papel a 203dpi; se o navegador não rasterizar, sai o texto de 48 colunas).
            </p>
          )}
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
