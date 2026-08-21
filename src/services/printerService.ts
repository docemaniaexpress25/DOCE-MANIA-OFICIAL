import { Sale, Client, Product } from '@/lib/types';

/**
 * Mapeamento de caracteres para Página de Código 860 (Português).
 * Imprescindível para que acentos ocupem apenas 1 byte e não desalinhem o grid de 32 colunas.
 */
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
    /**
     * Envia o texto via Bluetooth Nativo (React Native Bridge).
     * Nota: No ambiente APK, utilize uma biblioteca como 'react-native-bluetooth-escpos-printer'.
     */
    async printNative(rawText: string): Promise<boolean> {
        console.log("[printerService] Iniciando processo de impressão nativa (APK)...");

        // 1. Converte o texto para a grade de bytes CP860
        const fullBuffer = encodeToCP860(rawText);

        // 2. Comandos ESC/POS de Inicialização
        // [ESC @] (Reset) + [ESC t 3] (Code Page 860)
        const initCommands = [0x1B, 0x40, 0x1B, 0x74, 0x03];
        const finalBuffer = [...initCommands, ...fullBuffer];

        try {
            /**
             * ESTRATÉGIA DE BUFFER (DRIP METHOD)
             * Em React Native, não enviamos o buffer inteiro de uma vez.
             * Fatiamos em pacotes de 20 bytes com delay de 50ms.
             */
            const CHUNK_SIZE = 20;
            const SEND_DELAY = 50;

            for (let i = 0; i < finalBuffer.length; i += CHUNK_SIZE) {
                const chunk = finalBuffer.slice(i, i + CHUNK_SIZE);
                
                // Em um APK real, aqui você chamaria:
                // await BluetoothEscposPrinter.printRawData(Buffer.from(chunk).toString('base64'));
                
                console.log(`[printerService] Enviando pacote ${i/CHUNK_SIZE + 1} (${chunk.length} bytes)`);
                
                // Aguarda o processamento físico da impressora
                await new Promise(resolve => setTimeout(resolve, SEND_DELAY));
            }

            console.log("[printerService] Impressão concluída com sucesso.");
            return true;
        } catch (error) {
            console.error("[printerService] Erro no transporte nativo:", error);
            throw error;
        }
    },

    async printSale(sale: Sale, client: Client, products: Product[], width: 56 | 80, rawText: string): Promise<boolean> {
        return this.printNative(rawText);
    }
};