import React from 'react';
import { Player } from './Player';
import { BattleCoin } from './BattleCoin';

interface BattleArenaProps {
  leftPlayer: {
    name: string;
    avatarSeed: string;
    coinSide: 'heads' | 'tails';
  };
  rightPlayer: {
    name: string;
    avatarSeed: string;
    coinSide: 'heads' | 'tails';
  };
  betAmount: string;
}

export const BattleArena: React.FC<BattleArenaProps> = ({
  leftPlayer,
  rightPlayer,
  betAmount
}) => {
  return (
    <section className="battle-arena">
      <div className="players">
        <Player {...leftPlayer} position="left" />
        <BattleCoin betAmount={betAmount} />
        <Player {...rightPlayer} position="right" />
      </div>
    </section>
  );
};