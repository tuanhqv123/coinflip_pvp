import React from 'react';
import { ConnectButton, useCurrentAccount, useDisconnectWallet } from '@mysten/dapp-kit';
import { formatBalance, shortenAddress } from '../../utils/address';
import { useBalance } from '../../hooks/useBalance';
import { useSealSession } from '../../hooks/useSealSession';
import { Avatar } from './Avatar';
import { FlippingCoin3D } from '../game/PixelCoin';
import suiSymbol from '../../assets/Sui_Symbol_White.png';

interface HeaderProps {
  title?: string;
}

export const Header: React.FC<HeaderProps> = ({
  title = "COINFLIP BATTLE"
}) => {
  const currentAccount = useCurrentAccount();
  const { balance, isPending } = useBalance();
  const { mutate: disconnect } = useDisconnectWallet();
  const { sessionKey, isCreating } = useSealSession();

  const handleDisconnect = () => {
    disconnect();
  };

  return (
    <header className="header">
      <div className="flex items-center gap-1">
        <div className="w-12 h-12 flex items-center justify-center">
          <FlippingCoin3D size="medium" />
        </div>
        <h1 className="logo text-2xl">{title}</h1>
      </div>

      {currentAccount ? (
        <div className="wallet-info flex items-center gap-3">
          {/* Seal Session Status */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${sessionKey ? 'bg-green-500' : isCreating ? 'bg-yellow-500' : 'bg-red-500'}`}></div>
            <span className="text-xs text-white/60">
              {sessionKey ? 'Seal Ready' : isCreating ? 'Seal Connecting...' : 'Seal Required'}
            </span>
          </div>

          <div className="balance text-white/90 font-medium flex items-center gap-2">
            {isPending ? (
              <span className="text-white/50">Loading...</span>
            ) : (
              <>
                <img src={suiSymbol} alt="SUI" className="w-4 h-5" />
                <span>{formatBalance(balance)}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Avatar seed={currentAccount.address} size="small" />
            <div className="address text-sm text-white/70 font-mono">
              {shortenAddress(currentAccount.address)}
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            className="logout-btn p-2 rounded-lg hover:bg-white/10 transition-colors"
            title="Disconnect Wallet"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"></path>
              <polyline points="16,17 21,12 16,7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <div className="balance text-white/90 font-medium flex items-center gap-2">
            <img src={suiSymbol} alt="SUI" className="w-4 h-5" />
            <span>0.0000</span>
          </div>
          <ConnectButton
            className="connect-btn liquid-glass text-white font-semibold px-6 py-2 rounded-lg transition-all hover:scale-105"
          />
        </div>
      )}
    </header>
  );
};