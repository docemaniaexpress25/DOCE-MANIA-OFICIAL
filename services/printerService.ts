import { Sale, Client, Product } from '../types';

// UUIDs de serviço e característica comuns para impressoras térmicas Bluetooth
// ATENÇÃO: Estes são UUIDs genéricos de exemplo. Eles DEVEM ser substituídos pelos UUIDs
// específicos das suas impressoras (56mm e 80mm) para que a conexão funcione.
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb'; 
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb'; 

// Função utilitária para converter string em ArrayBuffer (simulando comandos ESC/POS)
// Na implementação real, esta função usaria uma biblioteca ESC/POS para gerar comandos binários
const generateEscPosCommands = (text: string, width: 56 | 80): ArrayBuffer => {
    // Para fins conceituais, vamos apenas converter a string em bytes UTF-8
    const encoder = new TextEncoder();
    const header = encoder.encode(`\n--- IMPRESSAO ${width}MM ---\n\n`);
    const footer = encoder.encode(`\n--- FIM ---\n\n\n`);
    const textBytes = encoder.encode(text);

    const totalLength = header.byteLength + textBytes.byteLength + footer.byteLength;
    const buffer = new Uint8Array(totalLength);
    
    buffer.set(header, 0);
    buffer.set(textBytes, header.byteLength);
    buffer.set(footer, header.byteLength + textBytes.byteLength);

    return buffer.buffer;
};

export const printerService = {
    /**
     * Conecta à impressora Bluetooth e envia os dados de impressão.
     * @param dataBuffer ArrayBuffer contendo os comandos ESC/POS.
     * @param width Largura da impressora para filtragem (56 ou 80).
     */
    async connectAndPrint(dataBuffer: ArrayBuffer, width: 56 | 80): Promise<boolean> {
        const nav = navigator as any; // Asserção de tipo para acessar a API Bluetooth

        if (typeof nav === 'undefined' || !nav.bluetooth) {
            console.error("Web Bluetooth API não suportada neste ambiente.");
            throw new Error("Web Bluetooth API não suportada.");
        }

        try {
            // 1. Solicitar dispositivo (o navegador abre a janela de seleção)
            const device = await nav.bluetooth.requestDevice({
                filters: [{ services: [PRINTER_SERVICE_UUID] }],
                optionalServices: [PRINTER_SERVICE_UUID]
            });

            if (!device.gatt) {
                throw new Error("GATT Server não encontrado no dispositivo.");
            }

            // 2. Conectar ao servidor GATT
            const server = await device.gatt.connect();

            // 3. Obter o serviço de impressão
            const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);

            // 4. Obter a característica de escrita
            const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

            // 5. Enviar os dados em chunks (necessário para grandes volumes de dados)
            const chunkSize = 512; // Tamanho comum de chunk
            for (let i = 0; i < dataBuffer.byteLength; i += chunkSize) {
                const chunk = dataBuffer.slice(i, i + chunkSize);
                // Usamos writeValueWithoutResponse para maior velocidade em impressoras
                await characteristic.writeValueWithoutResponse(chunk);
            }

            // 6. Desconectar (opcional, mas recomendado)
            // server.disconnect(); 

            return true;

        } catch (error) {
            console.error("Erro durante a impressão Bluetooth:", error);
            // Lançar o erro para que o Cupom.tsx possa exibir o toast de falha
            throw new Error(`Falha na impressão: ${error instanceof Error ? error.message : String(error)}`);
        }
    },

    /**
     * Prepara os dados da venda e inicia o processo de impressão.
     */
    async printSale(sale: Sale, client: Client, products: Product[], width: 56 | 80, rawText: string): Promise<boolean> {
        // 1. Gerar comandos ESC/POS a partir do texto formatado
        const escposData = generateEscPosCommands(rawText, width);
        
        // 2. Conectar e imprimir
        return this.connectAndPrint(escposData, width);
    }
};