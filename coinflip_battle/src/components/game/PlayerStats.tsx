import React from 'react';
import { StatCard } from '../common/StatCard';

interface PlayerStatsProps {
  username: string;
  globalRank: string;
  winRate: string;
  winStreak: number;
}

export const PlayerStats: React.FC<PlayerStatsProps> = ({
  username,
  globalRank,
  winRate,
  winStreak
}) => {
  return (
    <section className="player-stats">
      <div className="username">@{username}</div>
      <div className="stats-grid">
        <StatCard label="Global rank" value={globalRank} />
        <StatCard label="Win rate" value={winRate} />
        <StatCard label="Win streak" value={winStreak} />
      </div>
    </section>
  );
};