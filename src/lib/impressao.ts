/**
 * impressao.ts — BLOCO 143
 * SERVIÇO CENTRAL DE IMPRESSÃO TÉRMICA (80mm) — UM só caminho para TODOS os
 * documentos do sistema (cupom, DANFE/cupom fiscal, comprovante do boleto,
 * pré-pedido, lista de carga, relatório fiscal).
 *
 * REGRA DO DONO (verbatim): "imprimir em 80mm todos os tipos de documentos
 * sempre deve chamar ou impressora por bluetooth ou impressora por usb! quem
 * deve escolher é o usuario".
 *
 * O que isso significa na prática:
 *  1. TODOS os documentos saem em 80mm (48 colunas) — o papel 56mm saiu do
 *     sistema (era o causador dos cupons cortados/apertados).
 *  2. A CADA impressão o USUÁRIO escolhe o canal: BLUETOOTH (térmica pareada
 *     no celular) ou USB (janela de impressão do PC — o navegador lembra a
 *     última impressora). O seletor guarda a última escolha e destaca o canal
 *     mais usado — a segunda impressão já sai com 1 toque em cima do canal.
 *  3. iPhone (sem Web Bluetooth): o seletor é pulado e a folha AirPrint abre
 *     pelo caminho iOS do usbPrint (painel com botão de gesto garantido).
 *  4. Navegador sem Web Bluetooth (Firefox/desktop sem BT): o botão Bluetooth
 *     nasce desabilitado — só o USB fica de pé.
 */

import { bluetoothPrinter } from '@/services/bluetoothPrinterService';
import {
  imprimirViaUsb,
  salvarCanalImpressao,
  lerCanalImpressao,
  temBluetoothNavegador,
  dispositivoIOS,
  type CanalImpressao,
} from '@/lib/usbPrint';

export type LarguraImpressao = '80MM';

export interface ImpressaoDocOpts {
  /** Nome do documento no seletor (ex.: 'Cupom', 'Cupom fiscal', 'Comprovante do boleto') */
  titulo?: string;
  /** Toast curto da tela (quando existir). Só recebe 'success' | 'error'. */
  toast?: (msg: string, tipo?: 'success' | 'error') => void;
  /** Detalhe de erro para o modal próprio da tela (textos longos/instruções). */
  erro?: (msg: string) => void;
  /** Saiu no Bluetooth com sucesso (selo "impresso ✓", fechar janela...). */
  sucesso?: () => void;
  /** Janela USB aberta (mesmo uso do sucesso — o papel sai quando o usuário confirmar). */
  abriuUsb?: () => void;
}

const LARGURA: LarguraImpressao = '80MM';

/** Um canal de feedback só: a tela com modal próprio recebe o DETALHE (erro),
 *  a tela sem modal recebe o toast curto — nunca os dois (barulho demais). */
function falha(opts: ImpressaoDocOpts, detalhe: string, curto: string): void {
  if (opts.erro) opts.erro(detalhe);
  else opts.toast?.(curto, 'error');
}

const CSS_SELETOR = `
#dm-seletor-impressao { position: fixed; inset: 0; background: rgba(0,0,0,.72); z-index: 2147483001;
  display: flex; align-items: flex-end; justify-content: center; padding: 16px 12px calc(16px + env(safe-area-inset-bottom)); }
#dm-seletor-impressao .dm-sel-card { background: #fff; width: 100%; max-width: 420px; border-radius: 20px 20px 16px 16px;
  overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  box-shadow: 0 18px 50px rgba(0,0,0,.4); animation: dm-sel-in .18s ease-out; }
@keyframes dm-sel-in { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
#dm-seletor-impressao .dm-sel-head { background: #1e293b; color: #fff; padding: 14px 16px 12px; }
#dm-seletor-impressao .dm-sel-head .t { font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .6px; }
#dm-seletor-impressao .dm-sel-head .s { font-size: 10px; font-weight: 600; color: #94a3b8; margin-top: 2px; }
#dm-seletor-impressao .dm-sel-body { padding: 12px; display: grid; gap: 10px; background: #f1f5f9; }
#dm-seletor-impressao .dm-sel-btn { width: 100%; min-height: 60px; border: 0; border-radius: 16px; padding: 10px 14px;
  display: flex; align-items: center; gap: 12px; cursor: pointer; text-align: left; transition: transform .08s; }
#dm-seletor-impressao .dm-sel-btn:active { transform: scale(.97); }
#dm-seletor-impressao .dm-sel-btn.bt { background: #2563eb; color: #fff; }
#dm-seletor-impressao .dm-sel-btn.bt:disabled { background: #cbd5e1; color: #64748b; cursor: not-allowed; }
#dm-seletor-impressao .dm-sel-btn.usb { background: #7c3aed; color: #fff; }
#dm-seletor-impressao .dm-sel-btn .ic { font-size: 20px; width: 26px; text-align: center; flex-shrink: 0; }
#dm-seletor-impressao .dm-sel-btn .tx { flex: 1; min-width: 0; }
#dm-seletor-impressao .dm-sel-btn .l1 { font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: .4px; display: block; }
#dm-seletor-impressao .dm-sel-btn .l2 { font-size: 10px; font-weight: 600; opacity: .85; display: block; margin-top: 2px; line-height: 1.35; }
#dm-seletor-impressao .dm-sel-ultimo { background: rgba(255,255,255,.22); color: #fff; border-radius: 999px;
  font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: .5px; padding: 3px 8px; flex-shrink: 0; }
#dm-seletor-impressao .dm-sel-cancel { width: 100%; min-height: 44px; border: 0; background: transparent; color: #64748b;
  font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; cursor: pointer; }
`;

interface SeletorHandle {
  fechar: () => void;
  /** true = escolheu Bluetooth; 'USB' = escolheu USB; false = cancelou */
  escolha: Promise<'BT' | 'USB' | false>;
}

/** Seletor DOM (overlay leve) — o USUÁRIO escolhe Bluetooth ou USB a cada impressão. */
function abrirSeletor(titulo: string): SeletorHandle {
  let resolver!: (v: 'BT' | 'USB' | false) => void;
  const escolha = new Promise<'BT' | 'USB' | false>((res) => { resolver = res; });

  const raiz = document.createElement('div');
  raiz.id = 'dm-seletor-impressao';
  raiz.setAttribute('role', 'dialog');
  raiz.setAttribute('aria-modal', 'true');
  raiz.setAttribute('aria-label', `Como imprimir ${titulo}?`);

  const btOk = temBluetoothNavegador();
  const ultimo = lerCanalImpressao();
  const selo = (canal: CanalImpressao) =>
    ultimo === canal ? '<span class="dm-sel-ultimo">último usado</span>' : '';

  raiz.innerHTML = `
<style>${CSS_SELETOR}</style>
<div class="dm-sel-card" role="document">
  <div class="dm-sel-head">
    <p class="t"><i class="fa-solid fa-print" aria-hidden="true"></i>&nbsp; Imprimir ${titulo}</p>
    <p class="s">Escolha a impressora — Bluetooth do aparelho ou USB do computador.</p>
  </div>
  <div class="dm-sel-body">
    <button type="button" class="dm-sel-btn bt" data-canal="BT" ${btOk ? '' : 'disabled'}>
      <span class="ic"><i class="fa-brands fa-bluetooth-b" aria-hidden="true"></i></span>
      <span class="tx">
        <span class="l1">Bluetooth ${selo('BT')}</span>
        <span class="l2">${btOk ? 'Térmica pareada neste aparelho (Chrome/Android).' : 'Bluetooth indisponível neste navegador — use o Chrome do Android ou escolha USB.'}</span>
      </span>
    </button>
    <button type="button" class="dm-sel-btn usb" data-canal="USB">
      <span class="ic"><i class="fa-solid fa-desktop" aria-hidden="true"></i></span>
      <span class="tx">
        <span class="l1">USB do PC ${selo('USB')}</span>
        <span class="l2">Abre a janela de impressão do computador — escolha a térmica conectada por USB.</span>
      </span>
    </button>
    <button type="button" class="dm-sel-cancel" data-canal="CANCELAR">Cancelar</button>
  </div>
</div>`;

  const fechar = () => {
    try { raiz.remove(); } catch { /* já removido */ }
  };

  const fecharECancelar = () => { fechar(); resolver(false); };
  raiz.addEventListener('click', (ev) => {
    const alvo = (ev.target as HTMLElement | null)?.closest('[data-canal]') as HTMLElement | null;
    if (!alvo) return;
    const canal = alvo.getAttribute('data-canal');
    if (canal === 'CANCELAR') { fecharECancelar(); return; }
    if (canal === 'BT' && !btOk) return;
    // GESTO PRESERVADO: a escolha sai no toque — quem chama imprime logo em seguida.
    resolver(canal === 'BT' ? 'BT' : 'USB');
    fechar();
  });
  raiz.addEventListener('click', (ev) => {
    if (ev.target === raiz) fecharECancelar(); // fundo escuro cancela
  });

  document.body.appendChild(raiz);
  return { fechar, escolha };
}

/**
 * PONTO DE ENTRADA ÚNICO de impressão térmica (80mm) do sistema.
 * - iPhone: vai direto para o papel AirPrint (painel iOS do usbPrint).
 * - Resto: o usuário escolhe Bluetooth ou USB no seletor (a escolha vira o
 *   canal padrão salvo no localStorage, destacado na próxima).
 * Retorna true se o documento foi despachado (impresso ou janela aberta).
 */
export async function imprimirDoc(texto: string, opts: ImpressaoDocOpts = {}): Promise<boolean> {
  if (typeof document === 'undefined') {
    opts.erro?.('Impressão indisponível neste contexto.');
    return false;
  }
  const titulo = (opts.titulo || 'documento').trim();
  const toast = opts.toast;

  // ===== iPhone/iPad: Safari não tem Web Bluetooth — folha AirPrint direto =====
  if (dispositivoIOS()) {
    try {
      imprimirViaUsb(texto, LARGURA, (m) => {
        falha(opts, `Falha na impressão: ${m}`, 'Falha na impressão.');
      });
      return true;
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      falha(opts, `Falha na impressão: ${m}`, 'Falha na impressão.');
      return false;
    }
  }

  // ===== Seletor: o usuário escolhe Bluetooth OU USB =====
  const seletor = abrirSeletor(titulo);
  const canal = await seletor.escolha;
  if (!canal) return false; // cancelou — sem barulho

  if (canal === 'USB') {
    salvarCanalImpressao('USB');
    try {
      imprimirViaUsb(texto, LARGURA, (m) => {
        falha(opts, `Não consegui abrir a janela de impressão: ${m}`, 'Erro na impressão USB.');
      });
      toast?.('Janela de impressão aberta — escolha a térmica USB do PC.', 'success');
      opts.abriuUsb?.();
      return true;
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      falha(opts, `Não consegui abrir a janela de impressão: ${m}`, 'Erro na impressão USB.');
      return false;
    }
  }

  // ===== Bluetooth =====
  salvarCanalImpressao('BT');
  try {
    const ok = await bluetoothPrinter.print(texto, LARGURA, { skipConfirm: true });
    if (ok) {
      toast?.(`${titulo.charAt(0).toUpperCase() + titulo.slice(1)} enviado à impressora!`, 'success');
      opts.sucesso?.();
      return true;
    }
    if (opts.erro) opts.erro('Impressão não realizada — nenhuma impressora foi conectada.\n\n1. Ligue a impressora Bluetooth\n2. Toque em imprimir de novo\n3. Selecione o aparelho na janela do Chrome');
    else toast?.('Impressão não realizada — conecte a impressora.', 'error');
    return false;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'BLUETOOTH_NAO_SUPORTADO') {
      falha(opts, 'Bluetooth não disponível neste aparelho/navegador. Use o Chrome do Android para a térmica Bluetooth, ou escolha "USB do PC" no seletor.', 'Bluetooth indisponível.');
    } else if (msg.includes('SERVICO_NAO_ENCONTRADO') || msg.includes('CARACTERISTICA')) {
      try { bluetoothPrinter.forgetPrinter(); } catch { /* segue */ }
      falha(opts, 'Serviço de impressão não encontrado na impressora.\n\nVerifique se a térmica está ligada e pareada, e toque em imprimir de novo.', 'Erro na impressora.');
    } else {
      falha(opts, `Erro na impressão: ${msg}`, 'Erro na impressão.');
    }
    return false;
  }
}
