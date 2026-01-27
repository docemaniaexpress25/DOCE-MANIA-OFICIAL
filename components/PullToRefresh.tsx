"use client";

import React, { useRef, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

const THRESHOLD = 100; // Pixels necessários para disparar o refresh
const MAX_PULL = 150; // Distância máxima de puxada

const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh, children }) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    // Só permite iniciar o pull se estiver no topo da rolagem
    if (contentRef.current && contentRef.current.scrollTop === 0 && !isRefreshing) {
      startY.current = e.touches[0].clientY;
    } else {
      startY.current = 0;
    }
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (startY.current === 0 || isRefreshing) return;

    const currentY = e.touches[0].clientY;
    let distance = currentY - startY.current;

    if (distance > 0) {
      e.preventDefault(); // Previne a rolagem padrão da página ao puxar para baixo
      distance = Math.min(distance, MAX_PULL);
      setPullDistance(distance);
    } else {
      setPullDistance(0);
      startY.current = 0;
    }
  }, [isRefreshing]);

  const handleTouchEnd = useCallback(() => {
    if (pullDistance >= THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      onRefresh().finally(() => {
        // Mantém o estado de refresh por um breve momento para feedback visual
        setTimeout(() => {
            setIsRefreshing(false);
            setPullDistance(0);
        }, 500); 
      });
    }
    setPullDistance(0);
    startY.current = 0;
  }, [pullDistance, isRefreshing, onRefresh]);

  const refreshIconSize = Math.min(30, pullDistance / 3);
  const refreshIconOpacity = Math.min(1, pullDistance / THRESHOLD);

  return (
    <div 
      className="relative h-full overflow-y-auto flex-1"
      ref={contentRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ WebkitOverflowScrolling: 'touch' }} // Para rolagem suave no iOS
    >
      {/* Indicador de Pull-to-Refresh */}
      <div 
        className="absolute top-0 left-0 right-0 flex justify-center items-center transition-all duration-100 z-10"
        style={{ 
          height: pullDistance, 
          transform: `translateY(${-pullDistance}px)`, // Mantém o ícone no topo da área de pull
        }}
      >
        <RefreshCw 
          size={refreshIconSize} 
          className={`text-blue-600 transition-transform duration-300 ${isRefreshing ? 'animate-spin' : ''}`} 
          style={{ opacity: refreshIconOpacity }}
        />
      </div>
      
      {/* Conteúdo principal */}
      <div style={{ transform: `translateY(${pullDistance}px)`, transition: isRefreshing ? 'transform 0.3s ease-out' : 'none' }}>
        {children}
      </div>
    </div>
  );
};

export default PullToRefresh;