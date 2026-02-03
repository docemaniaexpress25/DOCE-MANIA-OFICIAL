import { Sale, Client, Product } from '../types';

// UUIDs de serviço e característica para impressoras térmicas portáteis (MTP e similares)
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb'; 
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb'; 

/**
 * Gera os comandos ESC/POS básicos para MTP-1 e MTP-3.
 */
const generateEscPosCommands = (text: string): Uint8Array => {
    const encoder = new TextEncoder();
    
    // ESC @ (Inicialização)
    const initCommand = new Uint8Array([0x1B, 0x40]); 
    
    // ESC t 2 (Página de código CP850 - Multilingual)
    const codePageCommand = new Uint8Array([0x1B, 0x74, 0x02]); 
    
    // ESC d 5 (Avança 5 linhas ao final para permitir o destaque manual)
    const feedLines = new Uint8Array([0x1B, 0x64, 0x05]); 

    const textBytes = encoder.encode(text);

    // Concatenando comandos: Init + CodePage + Texto + Feed
    const totalLength = initCommand.length + codePageCommand.length + textBytes.length + feedLines.length;
    const buffer = new Uint8Array(totalLength);
    
    let offset = 0;
    buffer.set(initCommand, offset); offset += initCommand.length;
    buffer.set(codePageCommand, offset); offset += codePageCommand.length;
    buffer.set(textBytes, offset); offset += textBytes.length;
    buffer.set(feedLines, offset);
    
    return buffer;
};

export const printerService = {
    /**
     * Gerencia a conexão GATT e o envio "gota a gota" (Drip Method) para MTP-1/3.
     */
    async connectAndPrint(dataBuffer: Uint8Array): Promise<boolean> {
        const nav = navigator as any;

        if (!nav.bluetooth) {
            throw new Error("Bluetooth não suportado ou bloqueado no navegador.");
        }

        try {
            // Solicita o dispositivo com os UUIDs configurados
            const device = await nav.bluetooth.requestDevice({
                filters: [{ services: [PRINTER_SERVICE_UUID] }],
                optionalServices: [PRINTER_SERVICE_UUID]
            });

            console.log("[printerService] Conectando a:", device.name);
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
            const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

            // Fragmentação Crítica para MTP-1 e MTP-3 (Máximo 20 bytes por pacote)
            const chunkSize = 20; 
            
            for (let i = 0; i < dataBuffer.length; i += chunkSize) {
                const chunk = dataBuffer.slice(i, i + chunkSize);
                
                // Escreve sem esperar resposta (mais rápido e compatível com impressoras genéricas)
                await characteristic.writeValueWithoutResponse(chunk);
                
                // Delay de 50ms: Essencial para evitar que a MTP-1/3 perca dados
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            console.log("[printerService] Impressão finalizada.");
            
            // Aguarda o buffer físico da impressora terminar antes de desconectar
            setTimeout(() => {
                if (device.gatt.connected) device.gatt.disconnect();
            }, 1500);

            return true;

        } catch (error) {
            console.error("[printerService] Erro:", error);
            throw error;
        }
    },

    /**
     * Prepara e imprime a venda.
     */
    async printSale(sale: Sale, client: Client, products: Product[], width: 56 | 80, rawText: string): Promise<boolean> {
        const commands = generateEscPosCommands(rawText);
        return this.connectAndPrint(commands);
    }
};