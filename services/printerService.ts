import { Sale, Client, Product } from '../types';

// UUIDs de serviço e característica comuns para impressoras térmicas Bluetooth
// Estes UUIDs são os padrões para a maioria das impressoras de 58mm/80mm baratas
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb'; 
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb'; 

// Função utilitária para converter string em ArrayBuffer com comandos ESC/POS
const generateEscPosCommands = (text: string): ArrayBuffer => {
    const encoder = new TextEncoder();
    
    // Comandos ESC/POS Fundamentais:
    // 1. Inicialização da impressora (ESC @) -> 1B 40
    const initCommand = new Uint8Array([0x1B, 0x40]); 
    
    // 2. Selecionar Página de Código (ESC t n) -> 1B 74 n
    // n=2 costuma ser CP850 (Multilingual), n=3 CP860 (Português)
    // Vamos usar n=2 (CP850) que é o padrão mais compatível para acentos
    const codePageCommand = new Uint8Array([0x1B, 0x74, 0x02]); 
    
    // 3. Comando de Corte de Papel (GS V 1) -> 1D 56 01
    const cutCommand = new Uint8Array([0x1D, 0x56, 0x01]); 
    
    // Codifica o texto (o Cupom.tsx já removeu acentos, o que garante compatibilidade ASCII)
    const textBytes = encoder.encode(text);

    // Calculando o tamanho total: Init + CodePage + Texto + 5 Newlines + Cut
    const totalLength = initCommand.byteLength + codePageCommand.byteLength + textBytes.byteLength + 5 + cutCommand.byteLength; 
    const buffer = new Uint8Array(totalLength);
    
    let offset = 0;
    
    // 1. Adiciona comando de inicialização
    buffer.set(initCommand, offset);
    offset += initCommand.byteLength;
    
    // 2. Adiciona comando de página de código
    buffer.set(codePageCommand, offset);
    offset += codePageCommand.byteLength;
    
    // 3. Adiciona o texto formatado
    buffer.set(textBytes, offset);
    offset += textBytes.byteLength;
    
    // 4. Adiciona 5 linhas vazias para garantir que o texto saia da impressora antes do corte
    for (let i = 0; i < 5; i++) {
        buffer.set(encoder.encode('\n'), offset);
        offset += 1;
    }

    // 5. Adiciona comando de corte
    buffer.set(cutCommand, offset);
    
    return buffer.buffer;
};

export const printerService = {
    /**
     * Conecta à impressora Bluetooth e envia os dados de impressão.
     */
    async connectAndPrint(dataBuffer: ArrayBuffer): Promise<boolean> {
        const nav = navigator as any;

        if (typeof nav === 'undefined' || !nav.bluetooth) {
            console.error("[printerService] Web Bluetooth API não suportada.");
            throw new Error("Seu navegador não suporta impressão Bluetooth direta.");
        }

        try {
            // 1. Solicitar dispositivo
            const device = await nav.bluetooth.requestDevice({
                filters: [{ services: [PRINTER_SERVICE_UUID] }],
                optionalServices: [PRINTER_SERVICE_UUID]
            });

            console.log("[printerService] Conectando ao dispositivo:", device.name);
            const server = await device.gatt.connect();

            // 2. Obter o serviço e característica
            const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
            const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

            // 3. Enviar os dados em chunks menores com um pequeno atraso entre eles
            // Isso evita o estouro do buffer da impressora (comum em BLE)
            const chunkSize = 20; // Chunks de 20 bytes são mais seguros para BLE genérico
            const view = new Uint8Array(dataBuffer);
            
            for (let i = 0; i < view.length; i += chunkSize) {
                const chunk = view.slice(i, i + chunkSize);
                await characteristic.writeValueWithoutResponse(chunk);
                // Pequena pausa de 20ms entre chunks para a impressora processar
                await new Promise(resolve => setTimeout(resolve, 20));
            }

            console.log("[printerService] Impressão concluída com sucesso.");
            
            // Desconecta após a impressão para liberar o dispositivo
            setTimeout(() => {
                if (device.gatt.connected) {
                    device.gatt.disconnect();
                    console.log("[printerService] Desconectado.");
                }
            }, 1000);

            return true;

        } catch (error) {
            console.error("[printerService] Erro na impressão Bluetooth:", error);
            throw error;
        }
    },

    /**
     * Prepara os dados da venda e inicia o processo de impressão.
     */
    async printSale(sale: Sale, client: Client, products: Product[], width: 56 | 80, rawText: string): Promise<boolean> {
        // Gerar comandos ESC/POS
        const escposData = generateEscPosCommands(rawText);
        
        // Conectar e imprimir
        return this.connectAndPrint(escposData);
    }
};