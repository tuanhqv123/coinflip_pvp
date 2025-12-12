import React from 'react';
import { Avatar } from '../common/Avatar';

interface PlayerProps {
  name: string;
  avatarSeed: string;
  coinSide: 'heads' | 'tails';
  position: 'left' | 'right';
}

export const Player: React.FC<PlayerProps> = ({
  name,
  avatarSeed,
  coinSide,
  position
}) => {
  const coinColors = {
    heads: 'fill-[#FFD700] text-[#B8860B]',
    tails: 'fill-[#C0C0C0] text-[#808080]'
  };

  const CoinSvg = () => (
    <svg
      width="50"
      height="50"
      viewBox="0 0 100 100"
      className={`choice-coin ${coinColors[coinSide]}`}
    >
      <circle cx="50" cy="50" r="45" className={coinColors[coinSide].split(' ')[0]} />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dy=".3em"
        fontSize="40"
        fontWeight="bold"
        className={coinColors[coinSide].split(' ')[1]}
      >
        ?
      </text>
    </svg>
  );

  return (
    <div className={`player player-${position}`}>
      {position === 'left' && <Avatar seed={avatarSeed} size="large" alt={name} />}
      <div className="player-info">
        <div className="player-name">{name}</div>
        <div className="player-choice">
          <CoinSvg />
        </div>
      </div>
      {position === 'right' && <Avatar seed={avatarSeed} size="large" alt={name} />}
    </div>
  );
};