"use client";
import React, { useState } from 'react';
import { User, Product, Carga } from '@/lib/types';
import { bluetoothPrinter } from '@/services/bluetoothPrinterService';

interface RelatorioFiscalProps {
  user: User;
  carga: Carga[];
  products: Product[];
  companyName: string;
  companyCnpj: string;
  onClose: () => void;
}

// Funcao para remover acentos e caracteres especiais para compatibilidade com impressoras termicas
const normalizeText = (str: string): string => {
  return str.toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Ç/g, 'C');
};

const RelatorioFiscal: React.FC<RelatorioFiscalProps> = ({ user, carga, products, companyName, companyCnpj, onClose }) => {
  const [format, setFormat] = useState<'80MM' | '56MM'>('56MM');
  const [modal, setModal] = useState<{ title: string; message: string; icon?: string; iconColor?: string; type?: 'info' | 'error' | 'success'; onConfirm?: () => void } | null>(null);

  const items = carga.filter(c => c.quantidade > 0).map(c => {
    const p = products.find(prod => prod.id === c.produtoId);
    return {
      nome: normalizeText(p?.nome ?? 'PRODUTO DESCONHECIDO'),
      quantidade: c.quantidade
    };
  });

  const totalUnidades = items.reduce((acc, curr) => acc + curr.quantidade, 0);
  const dataGeracao = new Date().toLocaleString('pt-BR');
  const codigoAutenticacao = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

  const generateText = () => {
    const width = format === '80MM' ? 48 : 32;
    const pad = (str: string, len: number) => str.padEnd(len).substring(0, len);
    const center = (str: string, len: number) => {
      const spaces = Math.max(0, Math.floor((len - str.length) / 2));
      return ' '.repeat(spaces) + str;
    };

    let t = '-'.repeat(width) + '\n';
    t += center('DOCUMENTO PARA FISCALIZACAO', width) + '\n';
    t += center('RELATORIO DE CARGA ATIVA', width) + '\n';
    t += '-'.repeat(width) + '\n\n';

    t += `EMPRESA: ${normalizeText(companyName)}\n`;
    t += `CNPJ: ${companyCnpj}\n`;
    t += `VENDEDOR: ${normalizeText(user.nome)}\n`;
    t += `PLACA VEICULO: ${normalizeText(user.placaVeiculo ?? 'NAO INFORMADA')}\n\n`;

    t += '-'.repeat(width) + '\n';
    const nameLen = format === '80MM' ? 38 : 22;
    const qtyLen = width - nameLen - 1;
    t += pad('PRODUTO', nameLen) + ' QTD\n';
    t += '-'.repeat(width) + '\n';

    items.forEach(item => {
      const name = item.nome;
      const qtyStr = item.quantidade.toString();
      
      // Quebra de linha se o nome for muito longo
      if (name.length > nameLen) {
        t += pad(name.substring(0, nameLen), nameLen) + ' ' + qtyStr.padStart(qtyLen) + '\n';
        t += pad(name.substring(nameLen), nameLen) + '\n';
      } else {
        t += pad(name, nameLen) + ' ' + qtyStr.padStart(qtyLen) + '\n';
      }
    });

    t += '-'.repeat(width) + '\n';
    t += pad('QUANTIDADE TOTAL DE UNIDADES:', width - 10) + totalUnidades.toString().padStart(10) + '\n\n';

    t += center(`GERADO EM ${normalizeText(dataGeracao)}`, width) + '\n';
    t += center(`CODIGO DE AUTENTICACAO: ${codigoAutenticacao}`, width) + '\n';
    t += center('--- FIM DO RELATORIO ---', width);

    return t;
  };

  const handlePrint = async () => {
    setModal({
      title: 'Imprimir Relatorio',
      message: `Deseja imprimir este relatorio de fiscalizacao?\nModelo: ${format === '80MM' ? '80mm (Largo)' : '56mm (Estreito)'}`,
      icon: 'fa-solid fa-print',
      iconColor: 'text-blue-600',
      type: 'info',
      onConfirm: async () => {
        setModal(null);
        try {
          await bluetoothPrinter.print(generateText(), format, { skipConfirm: true });
          setModal({ title: 'Sucesso', message: 'Relatorio impresso com sucesso!', icon: 'fa-solid fa-check', iconColor: 'text-emerald-500', type: 'success', onConfirm: () => setModal(null) });
        } catch (err: any) {
          const msg = err?.message || 'Erro desconhecido';
          if (msg === 'BLUETOOTH_NAO_SUPORTADO') {
            setModal({ title: 'Bluetooth Indisponivel', message: 'Para impressao via Bluetooth:\n1. Use o Chrome no Android\n2. Ative o Bluetooth do dispositivo', icon: 'fa-brands fa-bluetooth-b', iconColor: 'text-gray-400', type: 'error', onConfirm: () => setModal(null) });
          } else {
            setModal({ title: 'Erro na Impressao', message: `Falha ao imprimir relatorio: ${msg}`, icon: 'fa-solid fa-triangle-exclamation', iconColor: 'text-rose-500', type: 'error', onConfirm: () => setModal(null) });
          }
        }
      }
    });
  };

  const handleCopy = async () => {
    navigator.clipboard.writeText(generateText());
    setModal({ title: 'Copiado!', message: 'Relatorio copiado para a area de transferencia!', icon: 'fa-solid fa-clipboard-check', iconColor: 'text-emerald-500', type: 'success', onConfirm: () => setModal(null) });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-[200] flex flex-col items-center overflow-y-auto p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg">
        <header className="flex items-center justify-between mb-8">
          <button onClick={onClose} className="w-12 h-12 bg-white/10 text-white rounded-2xl flex items-center justify-center active:scale-90 transition-transform">
            <i className="fa-solid fa-chevron-left"></i>
          </button>
          <h2 className="text-white font-black uppercase text-sm tracking-widest">Relatorio Oficial de Carga</h2>
          <div className="w-12"></div>
        </header>

        <div className="flex bg-slate-800 p-1 rounded-2xl mb-8 shadow-xl border border-slate-700">
          <button 
            onClick={() => setFormat('80MM')} 
            className={`flex-1 py-4 rounded-xl text-[10px] font-black uppercase transition-all ${format === '80MM' ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400'}`}
          >
            80MM
          </button>
          <button 
            onClick={() => setFormat('56MM')} 
            className={`flex-1 py-4 rounded-xl text-[10px] font-black uppercase transition-all ${format === '56MM' ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400'}`}
          >
            56MM (PADRAO)
          </button>
        </div>

        <div className={`bg-white shadow-2xl mx-auto mb-10 p-6 sm:p-10 transition-all duration-300 ${format === '80MM' ? 'max-w-[400px]' : 'max-w-[300px]'}`}>
          <div className="font-mono text-[11px] leading-[1.4] text-black whitespace-pre overflow-x-hidden">
            {generateText()}
          </div>
          
          {/* Detalhe estetico de picote na imagem */}
          <div className="mt-10 flex justify-between gap-1 opacity-10 select-none">
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className="w-2 h-2 bg-black rotate-45 transform translate-y-1"></div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-10">
          <button 
            onClick={handlePrint}
            className="bg-blue-600 text-white font-black py-5 rounded-[2rem] shadow-xl active:scale-95 transition-all uppercase text-[10px] tracking-widest flex items-center justify-center gap-3"
          >
            <i className="fa-solid fa-print text-lg"></i> IMPRIMIR
          </button>
          <button 
            onClick={handleCopy}
            className="bg-slate-700 text-slate-300 font-black py-5 rounded-[2rem] shadow-xl active:scale-95 transition-all uppercase text-[10px] tracking-widest flex items-center justify-center gap-3"
          >
            <i className="fa-solid fa-copy"></i> COPIAR
          </button>
        </div>
      </div>

      {/* MODAL: Confirmacao / Alerta estilizado */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className={`p-6 text-center ${modal.type === 'error' ? 'bg-gradient-to-br from-rose-500 to-red-600' : modal.type === 'success' ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-blue-500 to-indigo-600'}`}>
              <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <i className={`${modal.icon || 'fa-solid fa-info'} ${modal.iconColor || 'text-white'} text-2xl`}></i>
              </div>
              <h3 className="font-black text-white text-sm uppercase tracking-tight">{modal.title}</h3>
            </div>
            <div className="p-6">
              <p className="text-center text-[12px] text-gray-600 font-semibold leading-relaxed whitespace-pre-line">{modal.message}</p>
            </div>
            <div className="p-5 pt-0">
              {modal.onConfirm ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setModal(null)}
                    className="w-full bg-gray-100 text-gray-600 font-black py-4 rounded-2xl active:scale-95 uppercase text-[10px] tracking-widest"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={modal.onConfirm}
                    className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-[10px] tracking-widest"
                  >
                    Confirmar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setModal(null)}
                  className={`w-full font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest text-white ${modal.type === 'error' ? 'bg-rose-600' : modal.type === 'success' ? 'bg-emerald-600' : 'bg-blue-600'}`}
                >
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RelatorioFiscal;
