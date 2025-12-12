import React from 'react';
import { Avatar } from '../common/Avatar';

interface GameItem {
  id: string;
  opponent: string;
  opponentSeed: string;
  amount: string;
  result: 'win' | 'loss';
}

interface GameHistoryProps {
  games: GameItem[];
}

export const GameHistory: React.FC<GameHistoryProps> = ({ games }) => {
  return (
    <section className="recent-games">
      <h2 className="section-title">Recent games</h2>
      <div className="game-list">
        {games.map((game) => (
          <div key={game.id} className={`game-item ${game.result}`}>
            <div className="opponent">
              <Avatar seed={game.opponentSeed} size="medium" />
              <span>vs {game.opponent}</span>
            </div>
            <div className="amount">{game.amount}</div>
            <div className={`result ${game.result}-badge`}>
              {game.result.toUpperCase()}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};