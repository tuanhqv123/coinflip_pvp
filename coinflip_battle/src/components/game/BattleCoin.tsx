import React from 'react';
import { FlippingCoin } from './PixelCoin';

interface BattleCoinProps {
  betAmount: string;
  isFlipping?: boolean;
}

export const BattleCoin: React.FC<BattleCoinProps> = ({ betAmount, isFlipping = false }) => {
  return (
    <div className="battle-center">
      <div className="vs-text">VS</div>
      <div className="battle-coin flex items-center justify-center">
        {isFlipping ? (
          <FlippingCoin />
        ) : (
          <div className="text-6xl opacity-50">?</div>
        )}
      </div>
      <div className="bet-amount flex items-center gap-2">
        <img src="/Sui_Symbol_White.png" alt="SUI" className="w-5 h-6" />
        {betAmount}
      </div>
    </div>
  );
};