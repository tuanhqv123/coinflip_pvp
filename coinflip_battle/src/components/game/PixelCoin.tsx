import React from 'react';

interface PixelCoinProps {
  side: 'heads' | 'tails';
  size?: 'small' | 'medium' | 'large';
  isFlipping?: boolean;
}

// Single side coin (static)
export const PixelCoin: React.FC<PixelCoinProps> = ({
  side,
  size = 'medium',
  isFlipping = false,
}) => {
  const sizeClasses = {
    small: 'w-8 h-8',
    medium: 'w-12 h-12',
    large: 'w-24 h-24',
  };

  if (isFlipping) {
    return <FlippingCoin3D size={size} />;
  }

  return (
    <div className={`${sizeClasses[size]} relative`}>
      <CoinFace side={side} />
    </div>
  );
};

// Coin face SVG component
const CoinFace: React.FC<{ side: 'heads' | 'tails' }> = ({ side }) => (
  <svg
    viewBox="0 0 32 32"
    className="w-full h-full"
    style={{
      imageRendering: 'pixelated',
      filter: 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.3))',
    }}
  >
    {side === 'heads' ? (
      // Gold coin - Heads
      <>
        {/* Outer ring - dark gold */}
        <rect x="8" y="4" width="16" height="2" fill="#b45309" />
        <rect x="6" y="6" width="2" height="2" fill="#b45309" />
        <rect x="24" y="6" width="2" height="2" fill="#b45309" />
        <rect x="4" y="8" width="2" height="16" fill="#b45309" />
        <rect x="26" y="8" width="2" height="16" fill="#b45309" />
        <rect x="6" y="24" width="2" height="2" fill="#b45309" />
        <rect x="24" y="24" width="2" height="2" fill="#b45309" />
        <rect x="8" y="26" width="16" height="2" fill="#b45309" />

        {/* Main body - bright gold */}
        <rect x="8" y="6" width="16" height="2" fill="#fbbf24" />
        <rect x="6" y="8" width="20" height="16" fill="#fbbf24" />
        <rect x="8" y="24" width="16" height="2" fill="#fbbf24" />

        {/* "H" letter in pixel style */}
        <rect x="11" y="11" width="2" height="10" fill="#92400e" />
        <rect x="19" y="11" width="2" height="10" fill="#92400e" />
        <rect x="13" y="15" width="6" height="2" fill="#92400e" />
      </>
    ) : (
      // Silver coin - Tails
      <>
        {/* Outer ring - medium silver */}
        <rect x="8" y="4" width="16" height="2" fill="#6b7280" />
        <rect x="6" y="6" width="2" height="2" fill="#6b7280" />
        <rect x="24" y="6" width="2" height="2" fill="#6b7280" />
        <rect x="4" y="8" width="2" height="16" fill="#6b7280" />
        <rect x="26" y="8" width="2" height="16" fill="#6b7280" />
        <rect x="6" y="24" width="2" height="2" fill="#6b7280" />
        <rect x="24" y="24" width="2" height="2" fill="#6b7280" />
        <rect x="8" y="26" width="16" height="2" fill="#6b7280" />

        {/* Main body - light silver */}
        <rect x="8" y="6" width="16" height="2" fill="#d1d5db" />
        <rect x="6" y="8" width="20" height="16" fill="#d1d5db" />
        <rect x="8" y="24" width="16" height="2" fill="#d1d5db" />

        {/* "T" letter in pixel style */}
        <rect x="10" y="11" width="12" height="2" fill="#4b5563" />
        <rect x="14" y="13" width="4" height="8" fill="#4b5563" />
      </>
    )}
  </svg>
);

// 3D Flipping Coin - shows both sides rotating
interface FlippingCoin3DProps {
  size?: 'small' | 'medium' | 'large';
  result?: 'heads' | 'tails';
  onComplete?: (result: 'heads' | 'tails') => void;
}

export const FlippingCoin3D: React.FC<FlippingCoin3DProps> = ({
  size = 'large',
}) => {
  const sizeClasses = {
    small: 'w-8 h-8',
    medium: 'w-12 h-12',
    large: 'w-24 h-24',
  };

  return (
    <div className={`${sizeClasses[size]} perspective-500 flex items-center justify-center`}>
      <div className="coin-3d-container relative">
        {/* Front - Heads (Gold) */}
        <div className="coin-3d-face coin-3d-front">
          <CoinFace side="heads" />
        </div>
        {/* Back - Tails (Silver) */}
        <div className="coin-3d-face coin-3d-back">
          <CoinFace side="tails" />
        </div>
      </div>
    </div>
  );
};

// Coin Toss Animation with countdown
interface CoinTossProps {
  onFlipComplete?: (result: 'heads' | 'tails') => void;
  finalResult?: 'heads' | 'tails';
  duration?: number;
}

export const CoinToss: React.FC<CoinTossProps> = ({
  onFlipComplete,
  finalResult,
  duration = 5000,
}) => {
  const [phase, setPhase] = React.useState<'flipping' | 'result'>('flipping');
  const [result, setResult] = React.useState<'heads' | 'tails' | null>(null);

  React.useEffect(() => {
    // Flip for the duration, then show result
    const timer = setTimeout(() => {
      const finalSide = finalResult || (Math.random() > 0.5 ? 'heads' : 'tails');
      setResult(finalSide);
      setPhase('result');
      onFlipComplete?.(finalSide);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, finalResult, onFlipComplete]);

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      {phase === 'flipping' && (
        <>
          <FlippingCoin3D size="large" />
          <p className="text-white/70 text-sm animate-pulse">Flipping...</p>
        </>
      )}

      {phase === 'result' && result && (
        <div className="animate-coin-land">
          <div className="w-32 h-32">
            <CoinFace side={result} />
          </div>
          <p className="text-center mt-2 text-lg font-bold text-white">
            {result === 'heads' ? '🪙 HEADS!' : '🥈 TAILS!'}
          </p>
        </div>
      )}
    </div>
  );
};

// Legacy FlippingCoin for backwards compatibility
export const FlippingCoin: React.FC<{
  onFlipComplete?: (result: 'heads' | 'tails') => void;
}> = ({ onFlipComplete }) => {
  return <CoinToss onFlipComplete={onFlipComplete} />;
};
