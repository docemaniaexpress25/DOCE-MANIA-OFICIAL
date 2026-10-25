// @ts-nocheck

/**
 * bluetoothPrinterService.ts
 * Serviço de impressão Bluetooth NATIVO via Web Bluetooth API.
 * Funciona diretamente no Android Chrome e APKs empacotados (WebView/Capacitor).
 * Suporta impressoras térmicas ESC/POS de 56mm e 80mm.
 */

// ============================================================
// CP860 (Português) Character Encoding
// ============================================================
const charCodeMapCP860: { [key: string]: number } = {
  'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3,
  'â': 0x83, 'ê': 0x88, 'ô': 0x93, 'ã': 0xC6, 'õ': 0xE4,
  'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9,
  'Â': 0xB6, 'Ê': 0xD2, 'Ô': 0xE2, 'Ã': 0xC7, 'Õ': 0xE5,
  'ç': 0x87, 'Ç': 0x80, 'º': 0xA7, 'ª': 0xA6,
  'à': 0xA0, 'è': 0x8A, 'ì': 0xD4, 'ò': 0x95, 'ù': 0x97,
  'À': 0xB7, 'È': 0xD3, 'Ì': 0xDA, 'Ò': 0xE1, 'Ù': 0xEB,
};

const encodeToCP860 = (text: string): Uint8Array => {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    bytes.push(charCodeMapCP860[char] || (text.charCodeAt(i) < 128 ? text.charCodeAt(i) : 63));
  }
  return new Uint8Array(bytes);
};

// ============================================================
// ESC/POS Command Builders
// ============================================================
const ESC = 0x1B;
const GS = 0x1D;

const escpos = {
  /** Reset printer */
  init(): Uint8Array { return new Uint8Array([ESC, 0x40]); },

  /** Set code page 860 (Portuguese) */
  codePage860(): Uint8Array { return new Uint8Array([ESC, 0x74, 0x03]); },

  /** Align: 0=left, 1=center, 2=right */
  align(mode: number): Uint8Array { return new Uint8Array([ESC, 0x61, mode]); },

  /** Bold on/off */
  bold(on: boolean): Uint8Array { return new Uint8Array([ESC, 0x45, on ? 0x01 : 0x00]); },

  /** Underline: 0=off, 1=1dot, 2=2dot */
  underline(mode: number): Uint8Array { return new Uint8Array([ESC, 0x2D, mode]); },

  /** Double-height on/off */
  doubleHeight(on: boolean): Uint8Array { return new Uint8Array([GS, 0x21, on ? 0x10 : 0x00]); },

  /** Double-width on/off */
  doubleWidth(on: boolean): Uint8Array { return new Uint8Array([GS, 0x21, on ? 0x20 : 0x00]); },

  /** Feed N lines */
  feed(lines: number): Uint8Array { return new Uint8Array([ESC, 0x64, lines]); },

  /** Cut paper (partial) */
  cut(): Uint8Array { return new Uint8Array([GS, 0x56, 0x01]); },

  /** Open cash drawer */
  openCashDrawer(): Uint8Array { return new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xFA]); },

  /** Set character size: 0=normal, 0x11=double H+W */
  charSize(mode: number): Uint8Array { return new Uint8Array([GS, 0x21, mode]); },

  /** Raw text encoded in CP860 */
  text(str: string): Uint8Array { return encodeToCP860(str); },

  /** Horizontal rule */
  hr(cols: number, char: string = '-'): Uint8Array {
    return encodeToCP860(char.repeat(cols) + '\n');
  },

  /** Dotted line */
  dottedLine(cols: number): Uint8Array {
    return encodeToCP860('-'.repeat(cols) + '\n');
  },

  /** Double line */
  doubleLine(cols: number): Uint8Array {
    return encodeToCP860('='.repeat(cols) + '\n');
  },
};

// ============================================================
// Types
// ============================================================

export interface BluetoothPrinter {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  service: BluetoothRemoteGATTService;
  characteristic: BluetoothRemoteGATTCharacteristic;
  name: string;
}

export type PrinterWidth = '56MM' | '80MM';

export interface PrintJob {
  status: 'idle' | 'scanning' | 'connecting' | 'connected' | 'printing' | 'done' | 'error';
  printerName?: string;
  progress?: number;
  error?: string;
}

/** Impressora previamente autorizada pelo usuario neste aparelho */
export interface KnownPrinter {
  id: string;
  name: string;
}

// ============================================================
// Service UUIDs for common thermal printers
// ============================================================

// Many Chinese thermal printers use these UUIDs
const PRINTER_SERVICE_UUIDS = [
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];

const PRINTER_WRITE_UUIDS = [
  '0000ff02-0000-1000-8000-00805f9b34fb',
  '000018f1-0000-1000-8000-00805f9b34fb',
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
];

// ============================================================
// BLOCO 68 — KEEP-ALIVE DA CONEXAO (o link nao pode "dormir" entre cupons)
// Impressoras térmicas BLE de entrada derrubam o GATT quando ficam SEM
// tráfego por alguns segundos (economia de energia do firmware). É
// exatamente a rotina do vendedor: cupom 1 sai, ele atende o proximo
// cliente (1-5 min sem trafego), cupom 2 "cai" e pede reconexao na mao.
// O heartbeat manda a cada 5s um DLE EOT (0x10 0x04 0x01) — comando
// ESC/POS de STATUS EM TEMPO REAL, que NÃO imprime nada e existe
// justamente para consultas — mantendo o link ocupado e a impressora
// "acordada" entre um cupom e outro.
// ============================================================
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_CMD = new Uint8Array([0x10, 0x04, 0x01]); // DLE EOT 1 (status)
/** Falhas CONSECUTIVAS do heartbeat antes de declarar o link morto */
const HEARTBEAT_FAIL_LIMIT = 2;

// ============================================================
// Bluetooth Printer Service
// ============================================================

class BluetoothPrinterService {
  private printer: BluetoothPrinter | null = null;
  private lastPrinterId: string | null = null;
  private statusListeners = new Set<(job: PrintJob) => void>();
  // BLOCO 34 — ESTABILIDADE DA CONEXAO: impressoras térmicas BLE derrubam o
  // GATT sozinhas (economia de energia do firmware) e antes o app só limpava
  // o estado — o vendedor tinha que reconectar na mão "toda hora". Agora o
  // próprio app reconecta em background com o device em memória (sem seletor,
  // sem gesto, invisível para quem está trabalhando) e o envio sobrevive a
  // queda no meio do cupom (retry que RECONECTA e continua do chunk atual).
  private manualDisconnect = false;
  private autoReconnecting = false;
  private printing = false;
  // BLOCO 68 — infraestrutura de conexão permanente:
  private lastDevice: BluetoothDevice | null = null;   // device em memoria p/ reconexao silenciosa
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pulsing = false;
  private pulseFails = 0;
  private printQueue: Promise<unknown> = Promise.resolve(); // serializa cupons

  constructor() {
    // Recover last printer ID from localStorage
    if (typeof window !== 'undefined') {
      this.lastPrinterId = localStorage.getItem('bt_printer_id');

      // BLOCO 68: o Android/Chrome costuma derrubar o GATT com o app em
      // segundo plano (tela apagada entre um atendimento e outro). Ao VOLTAR
      // para o app, religa a impressora em background — ANTES do vendedor
      // bater o proximo cupom — sem seletor, sem gesto, sem confirm.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (this.isConnected() || this.manualDisconnect || this.printing || this.autoReconnecting) return;
        if (this.lastDevice) void this.autoReconnect(this.lastDevice);
      });
    }
  }

  /**
   * Check if Web Bluetooth is available
   */
  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  /**
   * Check if a printer is currently connected
   */
  isConnected(): boolean {
    return this.printer !== null && this.printer.device.gatt?.connected === true;
  }

  /**
   * Get the name of the connected printer
   */
  getConnectedPrinterName(): string | null {
    return this.printer?.name ?? null;
  }

  /**
   * Get the id of the connected printer
   */
  getConnectedPrinterId(): string | null {
    return this.printer?.device.id ?? null;
  }

  /**
   * Nome da impressora salva como padrao (ultima usada)
   */
  getSavedPrinterName(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('bt_printer_name');
  }

  /**
   * Subscribe to print job status changes (suporta varios ouvintes).
   * Retorna funcao para cancelar a inscricao; onStatus(null) limpa todos.
   */
  onStatus(callback: ((job: PrintJob) => void) | null): () => void {
    if (!callback) {
      this.statusListeners.clear();
      return () => {};
    }
    this.statusListeners.add(callback);
    return () => { this.statusListeners.delete(callback); };
  }

  private emitStatus(job: PrintJob) {
    this.statusListeners.forEach(listener => {
      try { listener(job); } catch { /* listener isolado */ }
    });
  }

  /**
   * Conecta GATT (com timeout) e descobre servico/caracteristica de
   * escrita de um dispositivo. Usado por scan, reconexao e troca manual.
   */
  private async openDevice(device: BluetoothDevice, timeoutMs: number = 8000): Promise<BluetoothPrinter> {
    const server = await Promise.race([
      device.gatt!.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TEMPO_DE_CONEXAO_EXCEDIDO')), timeoutMs)
      ),
    ]);

    // Try to find the printer service
    let service: BluetoothRemoteGATTService | null = null;
    for (const uuid of PRINTER_SERVICE_UUIDS) {
      try {
        service = await server.getPrimaryService(uuid);
        break;
      } catch {
        continue;
      }
    }

    // Fallback: try to get any service
    if (!service) {
      const services = await server.getPrimaryServices();
      if (services.length > 0) {
        service = services[0];
      }
    }

    if (!service) {
      throw new Error('SERVICO_NAO_ENCONTRADO');
    }

    // Try to find the write characteristic
    let characteristic: BluetoothRemoteGATTCharacteristic | null = null;
    for (const uuid of PRINTER_WRITE_UUIDS) {
      try {
        characteristic = await service.getCharacteristic(uuid);
        break;
      } catch {
        continue;
      }
    }

    // Fallback: get any writable characteristic
    if (!characteristic) {
      const chars = await service.getCharacteristics();
      characteristic = chars.find(c =>
        c.properties.write || c.properties.writeWithoutResponse
      ) || null;
    }

    if (!characteristic) {
      throw new Error('CARACTERISTICA_ESCRITA_NAO_ENCONTRADA');
    }

    return { device, server, service, characteristic, name: device.name || 'Impressora BT' };
  }

  /**
   * Torna uma impressora a ATIVA e a PADRAO (salva em localStorage) e
   * registra listener de desconexao protegido por identidade (trocar de
   * impressora nao faz a antiga "derrubar" a nova).
   */
  private installPrinter(printer: BluetoothPrinter): void {
    // Se estiver trocando de impressora, libera a conexao anterior
    if (this.printer && this.printer.device.id !== printer.device.id) {
      try { this.printer.device.gatt?.disconnect(); } catch { /* ignora */ }
    }

    this.printer = printer;
    this.lastPrinterId = printer.device.id;
    localStorage.setItem('bt_printer_id', printer.device.id);
    localStorage.setItem('bt_printer_name', printer.name);
    this.manualDisconnect = false;

    // BLOCO 68: guarda o device da sessao para reconexões silenciosas e
    // liga o heartbeat (mantém o link vivo entre cupons).
    this.lastDevice = printer.device;
    this.pulseFails = 0;
    this.startHeartbeat();

    // BLOCO 34: UM handler de desconexao por device — remove o anterior antes
    // de adicionar. Antes, reconectar a mesma impressora N vezes acumulava N
    // ouvintes que disparavam N auto-reconexoes em paralelo.
    const device = printer.device;
    const anterior = (device as any).__dmDiscHandler as ((e: Event) => void) | undefined;
    if (anterior) device.removeEventListener('gattserverdisconnected', anterior);
    const handler = () => {
      if (this.printer?.device.id !== device.id) return; // desconexao de impressora antiga
      this.stopHeartbeat();
      this.printer = null;
      if (this.manualDisconnect) { this.emitStatus({ status: 'idle' }); return; }
      // Se caiu no MEIO de uma impressao, o retry do sendBytes que reconecta
      // (evita duas reconexoes brigando pelo mesmo device).
      if (this.printing) return;
      this.autoReconnect(device);
    };
    (device as any).__dmDiscHandler = handler;
    device.addEventListener('gattserverdisconnected', handler);

    this.emitStatus({ status: 'connected', printerName: printer.name });
  }

  /**
   * BLOCO 34/68 — AUTO-RECONEXAO: tenta religar o GATT com a MESMA impressora
   * (device em memória) em até 5 tentativas com espera crescente (1s, 2s, 3s,
   * 4s, 5s — o módulo BLE da impressora às vezes está renes em religar o
   * rádio; acontece em background, então quanto mais paciente, melhor).
   * NÃO usa requestDevice/getDevices: nao precisa de gesto nem abre seletor.
   * Se esgotar, fica 'idle' silencioso — a proxima impressão oferece reconectar.
   */
  async autoReconnect(device: BluetoothDevice, tentativas: number = 5): Promise<boolean> {
    if (this.printer) return true;
    if (this.autoReconnecting || this.manualDisconnect) return false;
    this.autoReconnecting = true;
    this.stopHeartbeat();
    try {
      for (let i = 0; i < tentativas; i++) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        if (this.printer) return true;                    // outra via conectou antes
        if (this.manualDisconnect) return false;
        this.emitStatus({ status: 'connecting', printerName: device.name || 'Impressora' });
        try {
          const printer = await this.openDevice(device, 6000);
          if (this.printer) return true;
          this.installPrinter(printer);
          return true;
        } catch { /* impressora fora de alcance/ligando — proxima tentativa */ }
      }
    } finally {
      this.autoReconnecting = false;
    }
    if (!this.printer) this.emitStatus({ status: 'idle' });
    return false;
  }

  /**
   * Scan and connect to a Bluetooth thermal printer.
   * Shows the native Bluetooth device picker dialog.
   */
  async scanAndConnect(): Promise<boolean> {
    if (!this.isAvailable()) {
      throw new Error('BLUETOOTH_NAO_SUPORTADO');
    }

    this.emitStatus({ status: 'scanning' });

    try {
      // Request any Bluetooth device - the native picker will show
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICE_UUIDS,
      });

      if (!device) {
        this.emitStatus({ status: 'idle' });
        return false;
      }

      this.emitStatus({ status: 'connecting', printerName: device.name || 'Impressora' });

      const printer = await this.openDevice(device, 8000);
      this.installPrinter(printer);
      return true;

    } catch (error: any) {
      if (error.message === 'BLUETOOTH_NAO_SUPORTADO') {
        throw error;
      }
      // User cancelled the picker
      if (error.name === 'NotFoundError' || error.message?.includes('User')) {
        this.emitStatus({ status: 'idle' });
        return false;
      }
      this.emitStatus({
        status: 'error',
        error: `Falha ao conectar: ${error.message || 'Erro desconhecido'}`,
      });
      throw error;
    }
  }

  /**
   * Try to reconnect to the last used printer.
   * Com timeout (ms) para nao travar o fluxo quando a impressora
   * esta desligada/fora de alcance — isso preserva o "user gesture"
   * necessario para abrir o seletor nativo do Chrome logo em seguida.
   */
  async reconnect(timeoutMs: number = 2500): Promise<boolean> {
    if (this.isConnected()) return true;
    if (this.manualDisconnect || !this.isAvailable()) return false;

    // BLOCO 68 (1ª via): o DEVICE EM MEMÓRIA desta sessão — não depende de
    // getDevices nem de seletor; é a via mais rápida e mais compatível.
    if (this.lastDevice?.gatt) {
      this.emitStatus({ status: 'connecting', printerName: this.lastDevice.name || 'Impressora' });
      try {
        const printer = await this.openDevice(this.lastDevice, timeoutMs);
        if (this.printer) return true;
        this.installPrinter(printer);
        return true;
      } catch { /* impressora fora de alcance */ }
      if (this.isConnected()) return true;
      // getDevices devolve o MESMO device físico — insistir de novo só
      // queimaria a janela de gesto do toque em Imprimir. Falhou, falhou.
      return false;
    }

    // API getDevices() nao existe em todos os navegadores/WebView
    if (!this.lastPrinterId || typeof navigator.bluetooth?.getDevices !== 'function') return false;

    const run = async (): Promise<boolean> => {
      try {
        const devices = await navigator.bluetooth.getDevices();
        const device = devices.find(d => d.id === this.lastPrinterId);
        if (!device) return false;

        this.emitStatus({ status: 'connecting', printerName: device.name || 'Impressora' });

        const printer = await this.openDevice(device, 8000);

        // Guarda: se o usuario ja conectou outra impressora (fluxo ativo),
        // a reconexao em atraso nao deve sobrescrever a conexao atual.
        if (this.printer) return true;

        this.installPrinter(printer);
        return true;
      } catch {
        return false;
      }
    };

    if (!timeoutMs || timeoutMs <= 0) return run();

    // Corrida contra o tempo: se a impressora nao responder rapido,
    // seguimos o fluxo (o seletor nativo abre com o gesto ainda valido).
    return await Promise.race([
      run(),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeoutMs)),
    ]);
  }

  /**
   * Lista as impressoras que o vendedor ja autorizou neste aparelho
   * (navigator.bluetooth.getDevices). Fallback seguro: [] quando a API
   * nao existe no navegador/WebView.
   */
  async listKnownPrinters(): Promise<KnownPrinter[]> {
    if (!this.isAvailable() || typeof navigator.bluetooth?.getDevices !== 'function') return [];
    try {
      const devices = await navigator.bluetooth.getDevices();
      return devices.map(d => ({ id: d.id, name: d.name || 'Impressora BT' }));
    } catch {
      return [];
    }
  }

  /**
   * Conecta direto a uma impressora conhecida (por id) e a torna padrao.
   * Usada pelo seletor de impressoras quando ha mais de uma pareada.
   */
  async connectToPrinter(id: string, timeoutMs: number = 6000): Promise<boolean> {
    if (!id || !this.isAvailable() || typeof navigator.bluetooth?.getDevices !== 'function') return false;
    if (this.printer?.device.id === id && this.isConnected()) return true;

    try {
      const devices = await navigator.bluetooth.getDevices();
      const device = devices.find(d => d.id === id);
      if (!device) return false;

      this.emitStatus({ status: 'connecting', printerName: device.name || 'Impressora' });

      const printer = await this.openDevice(device, timeoutMs);
      this.installPrinter(printer); // troca a ativa + padrao
      return true;
    } catch {
      this.emitStatus({ status: 'idle' });
      return false;
    }
  }

  /**
   * Disconnect from the current printer (manual — o auto-reconnect NAO luta
   * contra a vontade do usuario: flag manualDisconnect).
   */
  disconnect(): void {
    this.manualDisconnect = true;
    this.stopHeartbeat();
    if (this.printer) {
      this.printer.device.gatt?.disconnect();
      this.printer = null;
      this.emitStatus({ status: 'idle' });
    }
  }

  /**
   * Send raw bytes to the printer in chunks
   */
  private async sendBytes(data: Uint8Array, onProgress?: (pct: number) => void): Promise<void> {
    if (!this.printer) throw new Error('IMPRESSORA_NAO_CONECTADA');

    const device = this.printer.device;
    const CHUNK = 100; // bytes per chunk
    const DELAY = 40;  // BLOCO 34: 30 -> 40ms — buffer do modulo BLE dos
                       // chineses com write sem resposta estoura e o firmware
                       // se defende DERRUBANDO o GATT (causa da queda no meio
                       // do cupom). 40ms mantem o mesmo ritmo com folga.

    for (let i = 0; i < data.length; i += CHUNK) {
      const chunk = data.slice(i, i + CHUNK);
      let ok = false;

      // BLOCO 34: 3 tentativas por chunk. Na 2a/3a o app RECONECTA o GATT
      // (device em memoria) e CONTINUA do chunk atual — o cupom nao se perde
      // e nao recomeça do zero quando o BLE cai no meio da impressao.
      for (let t = 0; t < 3 && !ok; t++) {
        // BLOCO 68: se o link morreu no meio do cupom (printer null), a 1ª
        // tentativa JÁ reconecta — não desperdiça uma rodada de escrita.
        if (!this.printer || t > 0) {
          try {
            const printer = await this.openDevice(device, 6000);
            this.installPrinter(printer);
          } catch {
            await new Promise(r => setTimeout(r, 800));
            continue;
          }
        }
        try {
          const char = this.printer!.characteristic;
          if (char.properties.writeWithoutResponse) {
            await char.writeValueWithoutResponse(chunk);
          } else if (char.properties.write) {
            await char.writeValue(chunk);
          } else {
            throw new Error('CARACTERISTICA_SEM_ESCRITA');
          }
          ok = true;
        } catch {
          await new Promise(r => setTimeout(r, 300));
        }
      }
      if (!ok) throw new Error('ERRO_ENVIO_DADOS');

      onProgress?.(Math.min(100, Math.round(((i + CHUNK) / data.length) * 100)));

      if (i + CHUNK < data.length) {
        await new Promise(r => setTimeout(r, DELAY));
      }
    }
  }

  /**
   * Build ESC/POS byte buffer from receipt text, adapted for paper width.
   * Converts plain text with alignment markers into proper ESC/POS commands.
   */
  buildEscposBuffer(text: string, width: PrinterWidth): Uint8Array {
    const cols = width === '80MM' ? 48 : 32;
    const parts: Uint8Array[] = [];

    const push = (data: Uint8Array) => parts.push(data);

    // Initialize printer + set CP860
    push(escpos.init());
    push(escpos.codePage860());

    // Process line by line
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trimEnd();

      if (width !== '80MM') {
        // ------------------------------------------------------------
        // 56MM: imprime o cupom inteiro como um BLOCO CENTRALIZADO.
        // Todas as linhas sao normalizadas para 32 colunas e enviadas
        // com alinhamento CENTRAL do papel:
        //  - Na impressora de 56mm: o bloco preenche a largura inteira
        //    e o resultado e identico ao de antes (sem mudanca visual).
        //  - Na impressora de 80mm: o cupom sai CENTRADO no papel, com
        //    tracos e colunas perfeitamente alinhados (antes o texto
        //    ficava colado na esquerda e os tracos no meio = "bugado").
        // ------------------------------------------------------------
        push(escpos.align(1));
        if (trimmed.includes('TOTAL GERAL')) push(escpos.bold(true));
        push(escpos.text(trimmed.padEnd(cols, ' ') + '\n'));
        if (trimmed.includes('TOTAL GERAL')) push(escpos.bold(false));
        continue;
      }

      // ------------------------------------------------------------
      // 80MM: layout em largura cheia (48 colunas). Cabecalhos entre
      // asteriscos/obrigado centralizados, corpo a esquerda.
      // ------------------------------------------------------------
      if (trimmed.includes('***') || trimmed.startsWith('CUPOM') || trimmed.includes('OBRIGADO')) {
        push(escpos.align(1)); // center
      }
      else if (trimmed.includes('TOTAL GERAL')) {
        push(escpos.align(0));
        push(escpos.bold(true));
      }
      else {
        push(escpos.align(0)); // default left
      }

      push(escpos.text(trimmed + '\n'));

      if (trimmed.includes('TOTAL GERAL')) {
        push(escpos.bold(false));
      }
    }

    // Feed lines and cut
    push(escpos.feed(3));
    push(escpos.cut());

    // Concatenate all parts
    const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }

    return result;
  }

  /**
   * Main print method. BLOCO 68: cupons entram numa FILA (nunca dois GATT
   * writes disputando o mesmo link) e a conexão é restaurada SILENCIOSAMENTE
   * antes do seletor nativo — o vendedor não precisa mais "reconectar" na mão.
   */
  async print(rawText: string, width: PrinterWidth = '56MM', options?: { skipConfirm?: boolean }): Promise<boolean> {
    const job = this.printQueue.then(() => this._print(rawText, width, options));
    this.printQueue = job.then(() => undefined, () => undefined);
    return job;
  }

  private async _print(rawText: string, width: PrinterWidth = '56MM', options?: { skipConfirm?: boolean }): Promise<boolean> {
    if (!this.isAvailable()) {
      throw new Error('BLUETOOTH_NAO_SUPORTADO');
    }

    // Step 1: garantir conexão. BLOCO 68 — ordem de resgate SEM mostrar seletor:
    //   a) heartbeat/auto-reconnect podem já ter religado sozinhos;
    //   b) device em memória (mesma sessão, via reconnect);
    //   c) getDevices (pareamento autorizado, via reconnect);
    //   d) tolerância à corrida (reconexao que venceu "justo depois" do timeout);
    //   e) SÓ ENTÃO o seletor nativo (último recurso, usa o gesto do toque).
    if (!this.isConnected()) {
      await this.reconnect(2500);
      if (!this.isConnected()) {
        for (let i = 0; i < 7 && !this.isConnected(); i++) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
      if (!this.isConnected()) {
        if (!options?.skipConfirm) {
          const wantsToScan = window.confirm(
            'Nenhuma impressora Bluetooth conectada.\n\nDeseja buscar uma impressora agora?'
          );
          if (!wantsToScan) {
            this.emitStatus({ status: 'idle' });
            return false;
          }
        }
        try {
          const connected = await this.scanAndConnect();
          if (!connected) {
            this.emitStatus({ status: 'idle' });
            return false;
          }
        } catch {
          // Gesto expirado ou seletor falhou — o vendedor toca em Imprimir
          // de novo e a reconexão silenciosa provavelmente já religou.
          this.emitStatus({ status: 'idle' });
          return false;
        }
      }
    }

    // Step 2: Confirmation before printing (skippable)
    if (!options?.skipConfirm) {
      const printerName = this.printer?.name || 'Impressora';
      const confirmed = window.confirm(
        `Confirmar impressao?\n\nImpressora: ${printerName}\nPapel: ${width}\n\nToque em OK para imprimir.`
      );
      if (!confirmed) {
        this.emitStatus({ status: 'connected', printerName });
        return false;
      }
    }

    // Step 3: Build ESC/POS buffer and send
    const printerName = this.printer?.name || 'Impressora';
    // BLOCO 34: referencia do device ANTES do envio — se o GATT morrer no
    // meio, this.printer vira null e so este device permite reconectar.
    const deviceDaImpressao = this.printer?.device || null;
    this.emitStatus({ status: 'printing', printerName, progress: 0 });

    // BLOCO 34: flag printing — o listener de desconexao NAO dispara a
    // auto-reconexao em paralelo durante o envio; quem reconecta aqui e o
    // retry do sendBytes (que retoma do chunk atual).
    this.printing = true;
    try {
      const buffer = this.buildEscposBuffer(rawText, width);
      await this.sendBytes(buffer, (pct) => {
        this.emitStatus({ status: 'printing', printerName, progress: pct });
      });

      this.emitStatus({ status: 'done', printerName, progress: 100 });
      return true;
    } catch (error: any) {
      this.emitStatus({
        status: 'error',
        printerName,
        error: `Erro na impressao: ${error.message || 'Falha desconhecida'}`,
      });
      throw error;
    } finally {
      this.printing = false;
      // Se o GATT morreu durante o envio e o retry esgotou, deixa a
      // auto-reconexao cuidar para a impressora voltar sozinha.
      if (deviceDaImpressao && !this.isConnected()) {
        try { await this.autoReconnect(deviceDaImpressao); } catch { /* silencioso */ }
      }
    }
  }

  /**
   * Forget the last printer (for settings/reset)
   */
  forgetPrinter(): void {
    this.disconnect();
    this.lastDevice = null;
    this.lastPrinterId = null;
    localStorage.removeItem('bt_printer_id');
    localStorage.removeItem('bt_printer_name');
  }

  // ============================================================
  // BLOCO 68 — HEARTBEAT (mantém o link vivo entre um cupom e outro)
  // ============================================================

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (typeof window === 'undefined') return;
    this.heartbeatTimer = setInterval(() => { void this.pulse(); }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Um "pulso": manda DLE EOT (status em tempo real — NÃO imprime nada).
   * Mantém o firmware da impressora acordado e, de quebra, funciona como
   * detector de link morto: se 2 pulsos seguidos falharem, o GATT já caiu
   * e a auto-reconexao religa ANTES do vendedor bater o proximo cupom.
   */
  private async pulse(): Promise<void> {
    if (this.pulsing || this.printing || this.autoReconnecting || this.manualDisconnect) return;
    // Em background o BLE fica suspenso (escritas falham sem significar queda);
    // o visibilitychange religa quando o app volta para a frente.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const printer = this.printer;
    if (!printer) return;
    this.pulsing = true;
    try {
      const char = printer.characteristic;
      if (char.properties.writeWithoutResponse) {
        await char.writeValueWithoutResponse(HEARTBEAT_CMD);
      } else if (char.properties.write) {
        await char.writeValue(HEARTBEAT_CMD);
      } else {
        return; // sem escrita disponível — não há o que manter vivo
      }
      this.pulseFails = 0;
    } catch {
      this.pulseFails++;
      if (
        this.pulseFails >= HEARTBEAT_FAIL_LIMIT &&
        this.printer === printer &&
        !this.printing && !this.autoReconnecting && !this.manualDisconnect
      ) {
        this.printer = null;
        this.stopHeartbeat();
        try { printer.device.gatt?.disconnect(); } catch { /* ignora */ }
        void this.autoReconnect(printer.device);
      }
    } finally {
      this.pulsing = false;
    }
  }
}

// Singleton
export const bluetoothPrinter = new BluetoothPrinterService();
export default bluetoothPrinter;
