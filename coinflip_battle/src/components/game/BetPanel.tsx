import { useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import suiSymbol from '../../assets/Sui_Symbol_White.png';
import { PixelCoin } from './PixelCoin';
import { useBalance } from '../../hooks/useBalance';

interface BetPanelProps {
  onCreateGame: (bet: { side: 'heads' | 'tails'; amount: number; maxPlayers: number }) => void;
}

export const BetPanel: React.FC<BetPanelProps> = ({ onCreateGame }) => {
  const [betAmount, setBetAmount] = useState<string>('1');
  const [maxPlayers, setMaxPlayers] = useState<number>(2);
  const [selectedSide, setSelectedSide] = useState<'heads' | 'tails'>('heads');
  const currentAccount = useCurrentAccount();
  const { balance } = useBalance();

  const handleAmountChange = (value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setBetAmount(value);
    }
  };

  const handleQuickBet = (amount: string) => {
    const current = parseFloat(betAmount || '0');
    setBetAmount((current + parseFloat(amount)).toString());
  };

  const handleHalfBet = () => {
    const current = parseFloat(betAmount || '0');
    setBetAmount((current / 2).toString());
  };

  const handleDoubleBet = () => {
    const current = parseFloat(betAmount || '0');
    setBetAmount((current * 2).toString());
  };

  const handleClear = () => {
    setBetAmount('0');
  };

  const handleMax = () => {
    // Set to wallet balance (leave some for gas)
    const balanceNum = parseFloat(balance) || 0;
    const maxAmount = Math.max(0, balanceNum - 0.1);
    setBetAmount(maxAmount.toFixed(4));
  };

  const handleCreateGame = () => {
    const amount = parseFloat(betAmount);
    if (amount >= 0.001 && currentAccount) {
      onCreateGame({ side: selectedSide, amount, maxPlayers });
    }
  };

  return (
    <section className="bet-panel liquid-glass rounded-full px-4 py-4">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Amount Label & Input */}
        <div className="flex items-center gap-2">
          <span className="text-white/70 text-sm">Amount</span>
          <div className="relative">
            <img
              src={suiSymbol}
              alt="SUI"
              className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-5"
            />
            <input
              type="text"
              value={betAmount}
              onChange={(e) => handleAmountChange(e.target.value)}
              className="w-32 bg-white/10 border border-white/20 rounded-full pl-7 pr-6 py-2 text-white text-sm font-mono focus:outline-none focus:ring-1 focus:ring-violet-500"
              placeholder="0"
            />
            <button
              onClick={handleClear}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-white/40 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Quick Bet Buttons */}
        <div className="flex items-center gap-1">
          {['+1', '+10', '+100'].map(amt => (
            <button
              key={amt}
              onClick={() => handleQuickBet(amt.replace('+', ''))}
              className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 rounded-full text-white/70 transition-colors"
            >
              {amt}
            </button>
          ))}
          <button
            onClick={handleHalfBet}
            className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 rounded-full text-white/70 transition-colors"
          >
            1/2
          </button>
          <button
            onClick={handleDoubleBet}
            className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 rounded-full text-white/70 transition-colors"
          >
            x2
          </button>
          <button
            onClick={handleMax}
            className="px-3 py-2 text-xs bg-yellow-500/20 hover:bg-yellow-500/30 rounded-full text-yellow-400 transition-colors"
          >
            Max
          </button>
        </div>

        {/* Players Input with Stacked +/- */}
        <div className="flex items-center gap-2">
          <span className="text-white/70 text-sm">Players:</span>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={maxPlayers}
              readOnly
              className="w-12 bg-white/10 border border-white/20 rounded-lg px-2 py-2 text-white text-sm font-mono text-center focus:outline-none"
            />
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => setMaxPlayers(Math.min(10, maxPlayers + 1))}
                className="w-5 h-4 bg-white/10 hover:bg-white/20 rounded text-white text-xs transition-colors flex items-center justify-center"
              >
                ▲
              </button>
              <button
                onClick={() => setMaxPlayers(Math.max(2, maxPlayers - 1))}
                className="w-5 h-4 bg-white/10 hover:bg-white/20 rounded text-white text-xs transition-colors flex items-center justify-center"
              >
                ▼
              </button>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-white/20" />

        {/* Side Selection - Toggle Switch with Actual Coin */}
        <div className="flex items-center gap-2">
          <span className="text-white/70 text-sm">Side:</span>
          <div className="relative bg-white/10 rounded-full px-1 py-0.25 flex items-center">
            {/* Sliding background */}
            <div
              className={`absolute top-0.5 bottom-0.5 rounded-full transition-all duration-300 ${
                selectedSide === 'heads'
                  ? 'left-0.5 w-[calc(50%-2px)] bg-gradient-to-r from-yellow-500 to-orange-500'
                  : 'left-[calc(50%+1px)] w-[calc(50%-2px)] bg-gradient-to-r from-gray-400 to-gray-500'
              }`}
            />
            
            {/* Heads Button */}
            <button
              onClick={() => setSelectedSide('heads')}
              className={`relative z-10 flex items-center justify-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                selectedSide === 'heads' ? 'text-white' : 'text-white/50'
              }`}
            >
              <div className="w-8 h-8 flex items-center justify-center">
                <PixelCoin side="heads" size="small" />
              </div>
              <span>Heads</span>
            </button>
            
            {/* Tails Button */}
            <button
              onClick={() => setSelectedSide('tails')}
              className={`relative z-10 flex items-center justify-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                selectedSide === 'tails' ? 'text-white' : 'text-white/50'
              }`}
            >
              <div className="w-8 h-8 flex items-center justify-center">
                <PixelCoin side="tails" size="small" />
              </div>
              <span>Tails</span>
            </button>
          </div>
        </div>

        {/* Create Button - Right next to Side selector */}
        <button
          onClick={handleCreateGame}
          disabled={!currentAccount || !betAmount || parseFloat(betAmount) < 0.01}
          className="px-8 py-3 rounded-full font-bold text-sm transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 bg-gradient-to-r from-green-600 to-emerald-400 hover:from-green-600 hover:to-emerald-600 text-white"
        >
          Create game
        </button>
      </div>
    </section>
  );
};
