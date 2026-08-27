import { Sale, Client, Product } from '../types';
import { nativeBridge } from '../utils/nativeBridge';

const charCodeMapCP860: { [key: string]: number } = {
  'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3,
  'â': 0x83, 'ê': 0x88, 'ô': 0x93, 'ã': 0xC6, 'õ': 0xE4,
  'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9,
  'Â': 0xB6, 'Ê': 0xD2, 'Ô': 0xE2, 'Ã': 0xC7, 'Õ': 0xE5,
  'ç': 0x87, 'Ç': 0x80, 'º': 0xA7, 'ª': 0xA6
};

const encodeToCP860 = (text: string): number[] => {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    bytes.push(charCodeMapCP860[char] || (text.charCodeAt(i) < 128 ? text.charCodeAt(i) : 63));
  }
  return bytes;
};

export const printerService = {
    async printNative(rawText: string): Promise<boolean> {
        console.log('[printerService] Iniciando impressão...');
        const fullBuffer = encodeToCP860(rawText);
        const initCommands = [0x1B, 0x40, 0x1B, 0x74, 0x03];
        const finalBuffer = [...initCommands, ...fullBuffer];

        try {
            // 1. Bridge nativa do APK
            if (window.Web2APK?.bluetoothPrint) {
                console.log('[printerService] Usando bridge nativa do APK');
                const binaryStr = finalBuffer.map(b => String.fromCharCode(b)).join('');
                const base64 = btoa(unescape(encodeURIComponent(binaryStr)));
                const result = await window.Web2APK.bluetoothPrint(base64);
                if (result) { console.log('[printerService] Impressão via APK concluída!'); return true; }
            }

            // 2. Web Bluetooth API (Chrome Android)
            if (navigator.bluetooth) {
                console.log('[printerService] Usando Web Bluetooth API');
                return await this._printViaWebBluetooth(finalBuffer);
            }

            console.warn('[printerService] Nenhuma API de Bluetooth disponível.');
            return false;
        } catch (error) {
            console.error('[printerService] Erro na impressão:', error);
            throw error;
        }
    },

    async _printViaWebBluetooth(buffer: number[]): Promise<boolean> {
        const PRINTER_SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
        const PRINTER_CHAR = '0000ff02-0000-1000-8000-00805f9b34fb';
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [PRINTER_SERVICE] }],
            optionalServices: [PRINTER_SERVICE]
        });
        console.log(`[printerService] Conectando a: ${device.name}`);
        const server = await device.gatt.connect();
        try {
            const service = await server.getPrimaryService(PRINTER_SERVICE);
            const char = await service.getCharacteristic(PRINTER_CHAR);
            for (let i = 0; i < buffer.length; i += 100) {
                await char.writeValue(new Uint8Array(buffer.slice(i, i + 100)));
                await new Promise(r => setTimeout(r, 50));
            }
            await char.writeValue(new Uint8Array([0x1D, 0x56, 0x01]));
            console.log('[printerService] Impressão concluída!');
            return true;
        } finally { server.disconnect(); }
    },

    async printSale(sale: Sale, client: Client, products: Product[], width: 56 | 80, rawText: string): Promise<boolean> {
        return this.printNative(rawText);
    }
};
