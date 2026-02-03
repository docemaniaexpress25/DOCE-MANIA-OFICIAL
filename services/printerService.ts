import { Sale, Client, Product } from '../types';

// UUIDs de serviço e característica comuns para impressoras térmicas Bluetooth
// ATENÇÃO: Estes são UUIDs genéricos de exemplo. Eles DEVEM ser substituídos pelos UUIDs
// específicos das suas impressoras (56mm e 80mm) para que a conexão funcione.
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb'; 
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb'; 

// Função utilitária para converter string em ArrayBuffer (simulando comandos ESC/POS)
const generateEscPosCommands = (text: string, width: 56 | 80): ArrayBuffer => {
    const encoder = new TextEncoder();
    
    // Comandos ESC/POS Conceituais:
    // 1. Inicialização (ESC @)
    const initCommand = new Uint8Array([0x1B, 0x40]); 
    // 2. Corte de papel (GS V 0)
    const cutCommand = new Uint8Array([0x1D, 0x56, 0x01]); 
    
    const textBytes = encoder.encode(text);

    // Calculando o tamanho total do buffer: Inicialização + Texto + Corte + 5 linhas vazias
    const totalLength = initCommand.byteLength + textBytes.byteLength + cutCommand.byteLength + 5; 
    const buffer = new Uint8Array(totalLength);
    
    let offset = 0;
    
    // Adiciona comando de inicialização
    buffer.set(initCommand, offset);
    offset += initCommand.byteLength;
    
    // Adiciona o texto formatado
    buffer.set(textBytes, offset);
    offset += textBytes.byteLength;
    
    // Adiciona 5 linhas vazias para empurrar o papel
    for (let i = 0; i < 5; i++) {
        buffer.set(encoder.encode('\n'), offset);
        offset += 1;
    }

    // Adiciona comando de corte
    buffer.set(cutCommand, offset);
    
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
            let errorMessage = "Erro desconhecido na impressão.";
            
            if (error instanceof Error) {
                // Erro de cancelamento do usuário (ex: DOMException: User cancelled the request)
                if (error.name === 'NotFoundError' || error.message.includes('cancelled')) {
                    errorMessage = "Conexão cancelada ou impressora não encontrada. Verifique o Bluetooth.";
                } else {
                    errorMessage = `Falha na conexão: ${error.message}`;
                }
            } else if (typeof error === 'string') {
                errorMessage = error;
            }

            console.error("[printerService] Erro durante a impressão Bluetooth:", errorMessage, error);
            
            // Lançar o erro para que o Cupom.tsx possa exibir o toast de falha
            throw new Error(errorMessage);
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