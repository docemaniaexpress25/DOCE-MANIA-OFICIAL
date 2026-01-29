import React, { useState } from 'react';
import { User, Product, Carga } from '../types';

interface RelatorioFiscalProps {
  user: User;
  carga: Carga[];
  products: Product[];
  companyName: string;
  companyCnpj: string;
  onClose: () => void;
}

const RelatorioFiscal: React.FC<RelatorioFiscalProps> = ({ user, carga, products, companyName, companyCnpj, onClose }) => {
  const [format, setFormat] = useState<'80MM' | '56MM'>('80MM');

  const items = carga.filter(c => c.quantidade > 0).map(c => {
    const p = products.find(prod => prod.id === c.produtoId);
    return {
      nome: p?.nome ?? 'Produto Desconhecido',
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
    t += center('RELATÓRIO DE CARGA PARA CONTROLE', width) + '\n';
    t += center('DE ESTOQUE E FISCALIZAÇÃO', width) + '\n';
    t += '-'.repeat(width) + '\n\n';

    t += `EMPRESA: ${companyName.toUpperCase()}\n`;
    t += `CNPJ: ${companyCnpj}\n`;
    t += `VENDEDOR: ${user.nome.toUpperCase()}\n`;
    t += `PLACA: ${user.placaVeiculo?.toUpperCase() ?? 'NÃO INFORMADA'}\n\n`;

    t += '-'.repeat(width) + '\n';
    if (format === '80MM') {
      t += pad('PRODUTO', 40) + ' QTD\n';
    } else {
      t += pad('PRODUTO', 24) + ' QTD\n';
    }
    t += '-'.repeat(width) + '\n';

    items.forEach(item => {
      const nameLen = format === '80MM' ? 40 : 24;
      const name = item.nome.toUpperCase();
      // Se o nome for maior que o espaço, quebra em linhas
      if (name.length > nameLen) {
        t += name.substring(0, nameLen) + ' ' + item.quantidade.toString().padStart(width - nameLen - 1) + '\n';
        t += name.substring(nameLen).substring(0, nameLen) + '\n';
      } else {
        t += pad(name, nameLen) + ' ' + item.quantidade.toString().padStart(width - nameLen - 1) + '\n';
      }
    });

    t += '-'.repeat(width) + '\n';
    t += pad('TOTAL DE ITENS:', width - 10) + items.length.toString().padStart(10) + '\n';
    t += pad('QUANTIDADE TOTAL DE UNIDADES:', width - 10) + totalUnidades.toString().padStart(10) + '\n\n';

    t += center(`GERADO EM ${dataGeracao}`, width) + '\n';
    t += center(`CÓDIGO DE AUTENTICAÇÃO: ${codigoAutenticacao}`, width) + '\n';
    t += center('--- FIM DO RELATÓRIO ---', width);

    return t;
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-[200] flex flex-col items-center overflow-y-auto p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg">
        <header className="flex items-center justify-between mb-8">
          <button onClick={onClose} className="w-12 h-12 bg-white/10 text-white rounded-2xl flex items-center justify-center active:scale-90 transition-transform">
            <i className="fa-solid fa-chevron-left"></i>
          </button>
          <h2 className="text-white font-black uppercase text-sm tracking-widest">Relatório Oficial de Carga</h2>
          <div className="w-12"></div>
        </header>

        <div className="flex bg-slate-800 p-1 rounded-2xl mb-8 shadow-xl border border-slate-700">
          <button 
            onClick={() => setFormat('80MM')} 
            className={`flex-1 py-4 rounded-xl text-[10px] font-black uppercase transition-all ${format === '80MM' ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400'}`}
          >
            80MM (PADRÃO)
          </button>
          <button 
            onClick={() => setFormat('56MM')} 
            className={`flex-1 py-4 rounded-xl text-[10px] font-black uppercase transition-all ${format === '56MM' ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400'}`}
          >
            56MM (MÓVEL)
          </button>
        </div>

        <div className={`bg-white shadow-2xl mx-auto mb-10 p-6 sm:p-10 transition-all duration-300 ${format === '80MM' ? 'max-w-[400px]' : 'max-w-[300px]'}`}>
          <div className="font-mono text-[11px] leading-[1.4] text-black whitespace-pre overflow-x-hidden">
            {generateText()}
          </div>
          
          {/* Detalhe estético de picote na imagem */}
          <div className="mt-10 flex justify-between gap-1 opacity-10 select-none">
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className="w-2 h-2 bg-black rotate-45 transform translate-y-1"></div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-10">
          <button 
            onClick={() => {
              navigator.clipboard.writeText(generateText());
              alert("Relatório copiado para a área de transferência!");
            }}
            className="bg-blue-600 text-white font-black py-5 rounded-[2rem] shadow-xl active:scale-95 transition-all uppercase text-[10px] tracking-widest flex items-center justify-center gap-3"
          >
            <i className="fa-solid fa-copy text-lg"></i> COPIAR TEXTO
          </button>
          <button 
            className="bg-emerald-600 text-white font-black py-5 rounded-[2rem] shadow-xl active:scale-95 transition-all uppercase text-[10px] tracking-widest flex items-center justify-center gap-3"
            onClick={() => alert("Função de PDF disponível apenas em aplicativo nativo.")}
          >
            <i className="fa-solid fa-file-pdf text-lg"></i> COMPARTILHAR
          </button>
        </div>
      </div>
    </div>
  );
};

export default RelatorioFiscal;