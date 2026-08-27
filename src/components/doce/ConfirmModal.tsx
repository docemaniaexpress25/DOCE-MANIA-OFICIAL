"use client";
import React from 'react';

interface ConfirmModalProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
  icon?: string;
  iconColor?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: 'confirm' | 'alert' | 'danger';
  gradient?: string;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ 
  title, 
  message, 
  onConfirm, 
  onCancel, 
  icon = 'fa-solid fa-question', 
  iconColor = 'text-white',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  type = 'confirm',
  gradient,
}) => {

  const gradients = {
    confirm: gradient || 'from-blue-500 to-indigo-600',
    danger: gradient || 'from-rose-500 to-red-600',
    alert: gradient || 'from-amber-400 to-orange-500',
    success: gradient || 'from-emerald-500 to-teal-600',
  };

  const bg = gradients[type] || gradients.confirm;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
        <div className={`bg-gradient-to-br ${bg} p-6 text-center`}>
          <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <i className={`${icon} ${iconColor} text-2xl`}></i>
          </div>
          <h3 className="font-black text-white text-sm uppercase tracking-tight">{title}</h3>
        </div>
        <div className="p-6">
          <p className="text-center text-[12px] text-gray-600 font-semibold leading-relaxed whitespace-pre-line">{message}</p>
        </div>
        <div className={`p-5 pt-0 ${type === 'alert' ? '' : 'grid grid-cols-2 gap-2'}`}>
          {type === 'alert' ? (
            <button
              onClick={onConfirm}
              className={`w-full font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest text-white bg-gradient-to-br ${bg}`}
            >
              OK
            </button>
          ) : (
            <>
              <button
                onClick={onCancel}
                className="w-full bg-gray-100 text-gray-600 font-black py-4 rounded-2xl active:scale-95 uppercase text-[10px] tracking-widest"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`w-full font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-[10px] tracking-widest text-white ${type === 'danger' ? 'bg-rose-600' : 'bg-blue-600'}`}
              >
                {confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
