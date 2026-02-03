import { Sale, Client, Product } from '../types';

// UUIDs GATT padrão para impressoras térmicas portáteis
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb'; 
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb'; 

/**
 * Mapeamento manual de caracteres UTF-16 para Bytes da Página de Código 860 (Português).
 * Isso garante que 'Ç' ou 'Á' ocupem apenas 1 byte, mantendo o alinhamento de 32 colunas.
 */
const charCodeMapCP860: { [key: string]: number } = {
  'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3,
  'â': 0x83, 'ê': 0x88, 'ô': 0x93, 'ã': 0xC6, 'õ': 0xE4,
  'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9,
  'Â': 0xB6, 'Ê': 0xD2, 'Ô': 0xE2, 'Ã': 0xC7, 'Õ': 0xE5,
  'ç': 0x87, 'Ç': 0x80, 'º': 0xA7, 'ª': 0xA6
};

const encodeToCP860 = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    bytes[i] = charCodeMapCP860[char] || (text.charCodeAt(i) < 128 ? text.charCodeAt(i) : 63);
  }
  return bytes;
};

export const printerService = {
    /**
     * Envia o cupom para a impressora tratando o buffer de forma rigorosa.
     */
    async printNative(rawText: string): Promise<boolean> {
        const nav = navigator as any;
        if (!nav.bluetooth) throw new Error("Bluetooth indisponível");

        try {
            const device = await nav.bluetooth.requestDevice({
                filters: [{ services: [PRINTER_SERVICE_UUID] }],
                optionalServices: [PRINTER_SERVICE_UUID]
            });

            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
            const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

            // 1. COMANDOS DE INICIALIZAÇÃO ESC/POS
            // [ESC @] (Reset) + [ESC t 3] (Seleciona CP860 - Português)
            const initCommands = new Uint8Array([0x1B, 0x40, 0x1B, 0x74, 0x03]);
            await characteristic.writeValueWithoutResponse(initCommands);
            await new Promise(r => setTimeout(r, 100));

            // 2. ENVIO LINHA POR LINHA COM FRAGMENTAÇÃO (DRIP METHOD)
            const lines = rawText.split('\n');
            const CHUNK_SIZE = 20; // Limite físico do pacote BLE
            const PACKET_DELAY = 40; // Delay entre pacotes em ms

            for (const line of lines) {
                // Adicionamos o \n manualmente para garantir a terminação da linha
                const binaryLine = encodeToCP860(line + '\n');
                
                // Quebra a linha em pacotes de 20 bytes para não estourar o buffer da MTP
                for (let j = 0; j < binaryLine.length; j += CHUNK_SIZE) {
                    const chunk = binaryLine.slice(j, j + CHUNK_SIZE);
                    await characteristic.writeValueWithoutResponse(chunk);
                    await new Promise(r => setTimeout(r, PACKET_DELAY));
                }
            }

            // 3. FINALIZAÇÃO: AVANÇO DE PAPEL (FEED)
            // [ESC d 5] (Avança 5 linhas para permitir destaque)
            const endCommands = new Uint8Array([0x1B, 0x64, 0x05]);
            await characteristic.writeValueWithoutResponse(endCommands);
            
            // Aguarda o processamento físico antes de desconectar
            await new Promise(r => setTimeout(r, 1200));
            device.gatt.disconnect();
            
            return true;
        } catch (error) {
            console.error("[printerService] Erro na transmissão ESC/POS:", error);
            throw error;
        }
    },

    async printSale(sale: Sale, client: Client, products: Product[], width: 56 | 80, rawText: string): Promise<boolean> {
        return this.printNative(rawText);
    }
};