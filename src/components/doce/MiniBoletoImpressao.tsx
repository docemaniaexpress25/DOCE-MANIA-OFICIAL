'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { miniBoleto80Html, type MiniBoletoDados } from '@/lib/miniBoleto80Html';
import { comprovanteBoletoTexto } from '@/lib/danfeTexto';
import { imprimirHtmlViaUsb, lerCanalImpressao, dispositivoIOS } from '@/lib/usbPrint';
import { imprimirHtmlViaBt } from '@/lib/impressaoHtml';

/**
 * BLOCO 167 — MINI BOLETO 80mm: PREVIEW + IMPRESSAO (pedido do dono).
 * Mesmo padrão do ModelosImpressao (mini DANFE): preview = papel real em
 * iframe (HTML de @page 70mm) e dois canais — USB do PC e Bluetooth.
 *
 * BLOCO 170 (dono: "a impressão está perfeita, porém a visualização está
 * bugada"): o CSS do papel usava transform:scale(1.6) no @media screen —
 * transform NÃO muda o layout, então o scrollHeight do iframe ficava com a
 * altura sem escala e o papel visual (1.6x) transbordava/cortava o preview.
 * Correção: no onLoad o preview desliga o transform e aplica ZOOM dinâmico
 * (afeta o layout real) calculado pela largura disponível do iframe — papel
 * inteiro visível, sem corte, em celular e PC. A impressão (@media print e
 * janela USB) continua 100% inalterada.
 *
 * BLOCO 186 (dono: "a impressão da mini danfe e mini boleto no bluetooth
 * ainda está tudo bugado — tem que ficar exatamente igual à impressão por
 * USB, impressora térmica MTP3"): este modal foi o ÚNICO ponto que ficou
 * para trás no bloco 185 — o Bluetooth daqui ainda mandava o TEXTO 48
 * colunas (layout "bugado", diferente do USB). Agora o BT imprime o MESMO
 * papel do USB (miniBoleto80Html rasterizado a 203dpi — grade, código de
 * barras, QR do PIX e linhas digitáveis idênticos ao canal USB), com envio
 * em bandas de GS v 0 e escrita COM resposta para o módulo BLE da MTP-3
 * (ver btRaster/impressaoHtml). Fallback: texto 48 colunas se o navegador
 * não rasterizar.
 */

interface MiniBoletoImpressaoProps {
  abrir: boolean;
  onClose: () => void;
  dados: MiniBoletoDados | null;
  showToast?: (msg: string, tipo?: 'success' | 'error') => void;
}

const MiniBoletoImpressao: React.FC<MiniBoletoImpressaoProps> = ({ abrir, onClose, dados, showToast }) => {
  const [ocupado, setOcupado] = useState<'bt' | 'usb' | ''>('');
  const [montado, setMontado] = useState(false);
  const [canalAtual, setCanalAtual] = useState<'BT' | 'USB'>('BT');
  const [ios, setIos] = useState(false);
  // BLOCO 170: ref do iframe do preview (recalcula zoom/altura em resize)
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    if (!abrir) return;
    setMontado(true);
    setCanalAtual(lerCanalImpressao());
    setIos(dispositivoIOS());
  }, [abrir]);

  // HTML do papel (async — QR do PIX) — estado preenchido no useEffect
  const [htmlBoleto, setHtmlBoleto] = useState('');
  useEffect(() => {
    if (!abrir || !dados) { setHtmlBoleto(''); return; }
    let vivo = true;
    miniBoleto80Html(dados)
      .then((h) => { if (vivo) setHtmlBoleto(h); })
      .catch(() => { if (vivo) setHtmlBoleto(''); });
    return () => { vivo = false; };
  }, [abrir, dados]);

  // texto 48 colunas — FALLBACK do canal Bluetooth (só se o navegador não rasterizar)
  const textoBoleto = useMemo(() => {
    if (!dados) return '';
    try {
      return comprovanteBoletoTexto({
        vendaRef: dados.vendaRef,
        pagadorNome: dados.pagadorNome,
        pagadorDoc: dados.pagadorDoc,
        valor: dados.valor,
        vencimento: dados.vencimento,
        status: dados.status,
        linhaDigitavel: dados.linhaDigitavel,
        codigoBarras: dados.codigoBarras,
        pixCopiaECola: dados.pixCopiaECola,
      });
    } catch { return ''; }
  }, [dados]);

  // BLOCO 170: ajuste do preview — ZOOM REAL (layout) no lugar do transform.
  // O transform:scale do @media screen só redesenha: o scrollHeight continua
  // na escala 1 e o iframe cortava o papel. Aqui: transform none + zoom que
  // cabe na largura do iframe (máx 1.6) + altura = scrollHeight pós-zoom.
  const recalcularPreview = () => {
    const frame = frameRef.current;
    if (!frame) return;
    try {
      const doc = frame.contentDocument;
      if (!doc || !doc.body) return;
      const larguraPapel = 264.6; // 70mm @ 96dpi (papel lógico do gerador)
      const disp = frame.clientWidth || 430;
      const zoom = Math.min(1.6, Math.max(1, Math.floor((disp / larguraPapel) * 100) / 100));
      doc.body.style.transform = 'none';   // desliga o scale (não ajusta layout)
      doc.body.style.zoom = String(zoom);  // zoom real — scrollHeight passa a refletir
      requestAnimationFrame(() => {
        try { frame.style.height = `${Math.ceil(doc.documentElement.scrollHeight)}px`; } catch { /* ignora */ }
      });
    } catch { /* cross-origin impossível com srcdoc — ignora */ }
  };

  // BLOCO 170: reajusta em resize (giro do celular) e pós-pintura do papel
  useEffect(() => {
    if (!abrir || !htmlBoleto) return;
    const onResize = () => recalcularPreview();
    window.addEventListener('resize', onResize);
    const t1 = setTimeout(recalcularPreview, 200);
    const t2 = setTimeout(recalcularPreview, 600);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [abrir, htmlBoleto]);

  if (!abrir || !dados) return null;

  const imprimirBoleto = async (canal: 'bt' | 'usb') => {
    setOcupado(canal);
    try {
      if (canal === 'usb' || lerCanalImpressao() === 'USB') {
        if (!htmlBoleto) { showToast?.('Boleto indisponível para o layout.', 'error'); return; }
        imprimirHtmlViaUsb(htmlBoleto, (m) => showToast?.(`Falha na janela USB: ${m}`, 'error'));
        showToast?.('Janela de impressão aberta — escolha a térmica USB.', 'success');
        return;
      }
      if (!dados) return;
      // BLOCO 186: BT imprime o MESMO papel do USB (miniBoleto80Html rasterizado
      // a 203dpi, bandas GS v 0 + write com resposta — modúlo BLE da MTP-3).
      const ok = await imprimirHtmlViaBt(
        () => miniBoleto80Html(dados, { raster: true }),
        () => textoBoleto,
      );
      if (ok) showToast?.('Mini Boleto enviado à impressora Bluetooth!', 'success');
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

  return (
    <div className="fixed inset-0 z-[170] bg-black/80 backdrop-blur-sm flex flex-col" role="dialog" aria-label="Mini Boleto 80mm">
      {/* HEADER */}
      <div className="bg-slate-900 text-white px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center active:scale-90" aria-label="Fechar">
          <i className="fa-solid fa-xmark"></i>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest">Mini Boleto 80mm</p>
          <p className="text-[9px] font-bold text-white/60 truncate">Layout igual à mini DANFE — conferência na térmica</p>
        </div>
        <span className="text-[8px] font-black uppercase bg-amber-400 text-amber-950 px-2 py-1 rounded-md shrink-0 hidden sm:block">Boleto oficial = PDF do Inter</span>
      </div>

      {/* CONTEUDO — PREVIEW do papel 80mm (HTML real, isolado no iframe) */}
      <div className="flex-1 overflow-y-auto bg-slate-950/60 p-4">
        <div className="space-y-3">
          <p className="text-[9px] font-black text-white/50 uppercase tracking-wide text-center">
            Papel térmico 80mm — como sai da impressora
          </p>
          {htmlBoleto ? (
            <iframe
              srcDoc={htmlBoleto}
              title="Mini Boleto 80mm"
              ref={frameRef}
              onLoad={recalcularPreview}
              className="w-[430px] max-w-full mx-auto block bg-white rounded shadow-lg border-0"
              style={{ minHeight: '320px' }}
            />
          ) : (
            <p className="text-center text-[10px] font-bold text-white/60 py-10">Gerando o papel do boleto...</p>
          )}
          {!montado || !ios ? (
            <p className="text-[8px] font-bold text-white/40 text-center leading-snug">
              USB e Bluetooth: sai EXATAMENTE esta folha (linha digitável + código de barras + QR do PIX — BLOCO 186: o BT rasteriza este mesmo papel a 203dpi).
            </p>
          ) : null}
        </div>
      </div>

      {/* RODAPE — ACOES DE IMPRESSAO */}
      <div className="shrink-0 border-t border-white/10 bg-slate-900 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {!ios && (
          <p className="text-[8px] font-black text-white/40 uppercase tracking-wide mb-2 text-center">
            Canal atual: {canalAtual === 'USB' ? 'USB do PC' : 'Bluetooth'}
          </p>
        )}
        <div className="flex gap-2 max-w-[520px] mx-auto">
          {!ios && (
            <button onClick={() => void imprimirBoleto('bt')} disabled={ocupado !== ''} className="flex-1 bg-indigo-600 text-white font-black py-3.5 rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
              <i className={`fa-solid ${ocupado === 'bt' ? 'fa-spinner fa-spin' : 'fa-bluetooth-b'}`}></i> Bluetooth
            </button>
          )}
          <button onClick={() => void imprimirBoleto('usb')} disabled={ocupado !== ''} className="flex-1 bg-emerald-600 text-white font-black py-3.5 rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
            <i className={`fa-solid ${ocupado === 'usb' ? 'fa-spinner fa-spin' : 'fa-print'}`}></i> USB do PC
          </button>
        </div>
      </div>
    </div>
  );
};

export default MiniBoletoImpressao;
