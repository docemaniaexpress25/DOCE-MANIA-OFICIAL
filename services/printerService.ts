import { Sale, Client, Product } from '../types';

const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb'; 
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb'; 

const generateEscPosCommands = (text: string): Uint8Array => {
    const encoder = new TextEncoder();
    const initCommand = new Uint8Array([0x1B, 0x40]); 
    const codePageCommand = new Uint8Array([0x1B, 0x74, 0x02]); // CP850
    const feedLines = new Uint8Array([0x1B, 0x64, 0x06]); // 6 linhas no final
    const textBytes = encoder.encode(text);

    const buffer = new Uint8Array(initCommand.length + codePageCommand.length + textBytes.length + feedLines.length);
    let offset = 0;
    buffer.set(initCommand, offset); offset += initCommand.length;
    buffer.set(codePageCommand, offset); offset += codePageCommand.length;
    buffer.set(textBytes, offset); offset += textBytes.length;
    buffer.set(feedLines, offset);
    
    return buffer;
};

export const printerService = {
    async connectAndPrint(dataBuffer: Uint8Array): Promise<boolean> {
        const nav = navigator as any;
        if (!nav.bluetooth) throw new Error("Bluetooth não suportado.");

        try {
            const device = await nav.bluetooth.requestDevice({
                filters: [{ services: [PRINTER_SERVICE_UUID] }],
                optionalServices: [PRINTER_SERVICE_UUID]
            });

            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
            const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

            const chunkSize = 20; 
            
            for (let i = 0; i < dataBuffer.length; i += chunkSize) {
                const chunk = dataBuffer.slice(i, i + chunkSize);
                await characteristic.writeValueWithoutResponse(chunk);
                
                // Delay de 75ms: Intervalo conservador para evitar perda de pacotes em listas longas
                await new Promise(resolve => setTimeout(resolve, 75));

                // Pausa extra após cerca de 100 bytes (aproximadamente cabeçalho completo)
                if (i === 100) await new Promise(resolve => setTimeout(resolve, 200));
            }

            setTimeout(() => {
                if (device.gatt.connected) device.gatt.disconnect();
            }, 2000);

            return true;
        } catch (error) {
            console.error("[printerService] Erro:", error);
            throw error;
        }
    },

    async printSale(sale: Sale, client: Client, products: Product[], width: 56 | 80, rawText: string): Promise<boolean> {
        const commands = generateEscPosCommands(rawText);
        return this.connectAndPrint(commands);
    }
};