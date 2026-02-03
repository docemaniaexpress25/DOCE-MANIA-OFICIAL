import { Sale, Client, Product } from '../types';

// UUIDs GATT padrão para impressoras térmicas portáteis
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb'; 
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb'; 

/**
 * Prepara comandos binários ESC/POS puros.
 */
const prepareBinaryData = (text: string): Uint8Array => {
    const encoder = new TextEncoder(); // UTF-8 por padrão
    
    // COMANDOS ESC/POS HEX
    const ESC = 0x1B;
    const AT = 0x40;   // Reset
    const T = 0x74;    // Select Code Page
    const CP850 = 0x02; // Página de Código Multilingual

    const init = new Uint8Array([ESC, AT, ESC, T, CP850]);
    const body = encoder.encode(text);
    
    const combined = new Uint8Array(init.length + body.length);
    combined.set(init);
    combined.set(body, init.length);
    
    return combined;
};

export const printerService = {
    /**
     * Envia dados via GATT com fragmentação (Drip Method)
     * Essencial para impressoras MTP-1/3 que possuem buffer pequeno.
     */
    async printNative(data: Uint8Array): Promise<boolean> {
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

            // DRIP METHOD: 20 bytes por pacote | 50ms de intervalo
            const CHUNK_SIZE = 20;
            const DELAY_MS = 50;

            for (let i = 0; i < data.length; i += CHUNK_SIZE) {
                const chunk = data.slice(i, i + CHUNK_SIZE);
                
                // Write sem resposta para maior compatibilidade e velocidade em BLE
                await characteristic.writeValueWithoutResponse(chunk);
                
                // Espera o buffer térmico processar o pacote
                await new Promise(r => setTimeout(r, DELAY_MS));
            }

            // Garante o esvaziamento do buffer antes de desconectar
            await new Promise(r => setTimeout(r, 1000));
            device.gatt.disconnect();
            
            return true;
        } catch (error) {
            console.error("[printerService] Erro GATT:", error);
            throw error;
        }
    },

    async printSale(sale: Sale, client: Client, products: Product[], width: 56 | 80, rawText: string): Promise<boolean> {
        const binaryData = prepareBinaryData(rawText);
        return this.printNative(binaryData);
    }
};