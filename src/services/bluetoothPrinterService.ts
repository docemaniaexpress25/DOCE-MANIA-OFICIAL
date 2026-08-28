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
// Bluetooth Printer Service
// ============================================================

class BluetoothPrinterService {
  private printer: BluetoothPrinter | null = null;
  private lastPrinterId: string | null = null;
  private onStatusChange: ((job: PrintJob) => void) | null = null;

  constructor() {
    // Recover last printer ID from localStorage
    if (typeof window !== 'undefined') {
      this.lastPrinterId = localStorage.getItem('bt_printer_id');
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
   * Subscribe to print job status changes
   */
  onStatus(callback: (job: PrintJob) => void) {
    this.onStatusChange = callback;
  }

  private emitStatus(job: PrintJob) {
    this.onStatusChange?.(job);
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

      // Connect GATT
      const server = await device.gatt!.connect();

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

      this.printer = {
        device,
        server,
        service,
        characteristic,
        name: device.name || 'Impressora BT',
      };

      // Save printer ID for reconnection
      this.lastPrinterId = device.id;
      localStorage.setItem('bt_printer_id', device.id);
      localStorage.setItem('bt_printer_name', this.printer.name);

      // Listen for disconnection
      device.addEventListener('gattserverdisconnected', () => {
        this.printer = null;
        this.emitStatus({ status: 'idle' });
      });

      this.emitStatus({ status: 'connected', printerName: this.printer.name });
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
   * Try to reconnect to the last used printer
   */
  async reconnect(): Promise<boolean> {
    if (!this.lastPrinterId || !this.isAvailable()) return false;

    try {
      const devices = await navigator.bluetooth.getDevices();
      const device = devices.find(d => d.id === this.lastPrinterId);
      if (!device) return false;

      this.emitStatus({ status: 'connecting', printerName: device.name || 'Impressora' });

      const server = await device.gatt!.connect();

      let service: BluetoothRemoteGATTService | null = null;
      for (const uuid of PRINTER_SERVICE_UUIDS) {
        try {
          service = await server.getPrimaryService(uuid);
          break;
        } catch { continue; }
      }
      if (!service) {
        const services = await server.getPrimaryServices();
        if (services.length > 0) service = services[0];
      }
      if (!service) return false;

      let characteristic: BluetoothRemoteGATTCharacteristic | null = null;
      for (const uuid of PRINTER_WRITE_UUIDS) {
        try {
          characteristic = await service.getCharacteristic(uuid);
          break;
        } catch { continue; }
      }
      if (!characteristic) {
        const chars = await service.getCharacteristics();
        characteristic = chars.find(c => c.properties.write || c.properties.writeWithoutResponse) || null;
      }
      if (!characteristic) return false;

      this.printer = { device, server, service, characteristic, name: device.name || 'Impressora BT' };

      device.addEventListener('gattserverdisconnected', () => {
        this.printer = null;
        this.emitStatus({ status: 'idle' });
      });

      this.emitStatus({ status: 'connected', printerName: this.printer.name });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Disconnect from the current printer
   */
  disconnect(): void {
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

    const char = this.printer.characteristic;
    const CHUNK = 100; // bytes per chunk for stability
    const DELAY = 30;  // ms between chunks

    for (let i = 0; i < data.length; i += CHUNK) {
      const chunk = data.slice(i, i + CHUNK);

      try {
        if (char.properties.writeWithoutResponse) {
          await char.writeValueWithoutResponse(chunk);
        } else if (char.properties.write) {
          await char.writeValue(chunk);
        } else {
          throw new Error('CARACTERISTICA_SEM_ESCRITA');
        }
      } catch (err) {
        // Retry once
        try {
          if (char.properties.writeWithoutResponse) {
            await char.writeValueWithoutResponse(chunk);
          } else {
            await char.writeValue(chunk);
          }
        } catch (retryErr) {
          throw new Error('ERRO_ENVIO_DADOS');
        }
      }

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

      // Detect centered lines (start with spaces on both sides, or are short)
      if (trimmed.includes('***') || trimmed.startsWith('CUPOM') || trimmed.includes('OBRIGADO') || trimmed === '*'.repeat(trimmed.length) || trimmed === '-'.repeat(trimmed.length) || trimmed === '='.repeat(trimmed.length)) {
        push(escpos.align(1)); // center
      }
      // Detect right-aligned (lines that are padded on the left)
      else if (/^\s{4,}\S/.test(line) && !trimmed.includes('TOTAL') && !trimmed.includes('Metodo') && !trimmed.includes('Vencimento') && !trimmed.includes('Info:')) {
        push(escpos.align(0)); // left (data lines)
      }
      // Total line - right align the value
      else if (trimmed.includes('TOTAL GERAL')) {
        push(escpos.align(0));
        push(escpos.bold(true));
      }
      else {
        push(escpos.align(0)); // default left
      }

      // Send the text line
      push(escpos.text(trimmed + '\n'));

      // Reset formatting after bold
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
   * Main print method: connects (or reconnects), confirms, and prints.
   */
  async print(rawText: string, width: PrinterWidth = '56MM', options?: { skipConfirm?: boolean }): Promise<boolean> {
    if (!this.isAvailable()) {
      throw new Error('BLUETOOTH_NAO_SUPORTADO');
    }

    // Step 1: Check if connected, try reconnect, or scan
    if (!this.isConnected()) {
      const reconnected = await this.reconnect();
      if (!reconnected) {
        if (!options?.skipConfirm) {
          const wantsToScan = window.confirm(
            'Nenhuma impressora Bluetooth conectada.\n\nDeseja buscar uma impressora agora?'
          );
          if (!wantsToScan) {
            this.emitStatus({ status: 'idle' });
            return false;
          }
        }

        const connected = await this.scanAndConnect();
        if (!connected) {
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
    this.emitStatus({ status: 'printing', printerName, progress: 0 });

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
    }
  }

  /**
   * Forget the last printer (for settings/reset)
   */
  forgetPrinter(): void {
    this.disconnect();
    this.lastPrinterId = null;
    localStorage.removeItem('bt_printer_id');
    localStorage.removeItem('bt_printer_name');
  }
}

// Singleton
export const bluetoothPrinter = new BluetoothPrinterService();
export default bluetoothPrinter;
