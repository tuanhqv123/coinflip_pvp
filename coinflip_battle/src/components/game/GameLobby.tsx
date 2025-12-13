import React from 'react';
import { Avatar } from '../common/Avatar';
import { shortenAddress } from '../../utils/address';
import suiSymbol from '../../assets/Sui_Symbol_White.png';
import { PixelCoin, FlippingCoin3D } from './PixelCoin';

interface Player {
  address: string;
  avatarSeed: string;
}

interface Game {
  id: string;
  escrowId: string;
  creator: Player;
  maxPlayers: number;
  currentPlayers: number;
  players: Player[];
  playerSides: ('heads' | 'tails')[];
  betAmount: string;
  totalStake: string;
  status: 'waiting' | 'full' | 'flipping' | 'completed';
  createdAt: Date;
  winner: string | null; // Keep for backward compatibility
  winners: string[]; // New field for multiple winners
  unlockMs: number;
  timeUntilUnlock: number;
  canClaim: boolean;
  isCreator: boolean;
  isWinner: boolean;
  isPlayer: boolean;
}

interface GameLobbyProps {
  games: Game[];
  onJoinGame: (gameId: string, side: 'heads' | 'tails') => void;
  onClaimReward: (gameId: string) => void;
  onCancelGame: (gameId: string) => void;
  loading: boolean;
  currentAddress?: string;
  decryptingGames: Set<string>;
}

// Center content - VS, Flipping Coin, or Result Coin
const CenterContent: React.FC<{
  status: Game['status'];
  playerCount: string;
  winners: string[];
  winnerSide: 'heads' | 'tails' | null;
  isDecrypting?: boolean;
}> = ({ status, playerCount, winners, winnerSide, isDecrypting }) => {
  // Waiting - show VS
  if (status === 'waiting') {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="text-2xl font-bold text-white/50">VS</div>
        <div className="text-sm text-white/60 mt-1">{playerCount}</div>
      </div>
    );
  }

  // Game is full, flipping, or decrypting - show flipping coin
  if (status === 'full' || status === 'flipping' || isDecrypting) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <FlippingCoin3D size="medium" />
        <div className="text-sm text-white/60 mt-2">
          {isDecrypting ? 'Decrypting...' : status === 'flipping' ? 'Flipping...' : playerCount}
        </div>
      </div>
    );
  }

  // Winner revealed - show the winning coin side (stopped)
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <PixelCoin side={winnerSide || 'heads'} size="medium"/>
      <div className="text-sm text-white/60 mt-2">{playerCount}</div>
      {winners.length > 1 && (
        <div className="text-xs text-green-400 mt-1">{winners.length} winners!</div>
      )}
    </div>
  );
};

// Game card component
const GameCard: React.FC<{
  game: Game;
  onJoin: (side: 'heads' | 'tails') => void;
  onClaim: () => void;
  onCancel: () => void;
  currentAddress?: string;
  isDecrypting?: boolean;
}> = ({ game, onJoin, onClaim, onCancel, currentAddress, isDecrypting }) => {
  const canJoin = game.status === 'waiting' && !game.isPlayer && currentAddress;
  const canCancel = game.isCreator && game.status === 'waiting' && game.currentPlayers === 1;

  // Get player side from actual data
  const getPlayerSide = (index: number): 'heads' | 'tails' => {
    return game.playerSides[index] || (index % 2 === 0 ? 'heads' : 'tails');
  };

  // Determine the opposite side for joining (for 2-player games)
  const getJoinSide = (): 'heads' | 'tails' => {
    if (game.playerSides.length > 0) {
      // Join with opposite side of first player
      return game.playerSides[0] === 'heads' ? 'tails' : 'heads';
    }
    return 'tails';
  };

  // Get the winner's side
  const getWinnerSide = (): 'heads' | 'tails' | null => {
    // Check for multiple winners first
    if (game.winners && game.winners.length > 0) {
      const winnerIndex = game.players.findIndex(p => p.address === game.winners[0]);
      if (winnerIndex >= 0 && game.playerSides[winnerIndex]) {
        return game.playerSides[winnerIndex];
      }
    }
    // Fallback to single winner for backward compatibility
    if (game.winner) {
      const winnerIndex = game.players.findIndex(p => p.address === game.winner);
      if (winnerIndex >= 0 && game.playerSides[winnerIndex]) {
        return game.playerSides[winnerIndex];
      }
    }
    return 'heads';
  };

  const playerCount = `${game.currentPlayers}/${game.maxPlayers}`;
  const winnerSide = getWinnerSide();

  return (
    <div className="bg-gradient-to-br from-white/10 to-white/5 border border-white/20 rounded-2xl p-5 hover:border-white/30 transition-all relative">
      {/* Close button for creator */}
      {canCancel && (
        <button
          onClick={onCancel}
          className="absolute top-2 right-2 w-8 h-8 rounded-full text-white-70 flex items-center justify-center transition-all hover:scale-110"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      )}

      {/* Top: Amount */}
      <div className="flex items-center justify-center gap-2 mb-4">
        <img src={suiSymbol} alt="SUI" className="w-4 h-5" />
        <span className="text-2xl font-mono text-white">{game.totalStake}</span>
      </div>

      {/* 2 Players Layout */}
      {game.maxPlayers === 2 && (
        <div className="flex items-center justify-between gap-2 mb-4">
          {/* Player 1 (Left) */}
          <div className="flex flex-col items-center gap-2 flex-1">
            <div className="relative">
              <Avatar seed={game.players[0]?.avatarSeed || game.creator.avatarSeed} size="large" />
              <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full p-0.5">
                <PixelCoin side={getPlayerSide(0)} size="small" />
              </div>
              {game.status === 'completed' && (game.winner === game.players[0]?.address || game.winners.includes(game.players[0]?.address)) && (
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xl">🏆</div>
              )}
            </div>
            <p className={`text-sm font-medium truncate max-w-[80px] ${
              game.players[0]?.address === currentAddress ? 'text-yellow-400' : 'text-white/90'
            }`}>
              {shortenAddress(game.players[0]?.address || game.creator.address)}
            </p>
          </div>

          {/* Center: VS / Flipping Coin / Result Coin */}
          <CenterContent
            status={game.status}
            playerCount={playerCount}
            winners={game.winners}
            winnerSide={winnerSide}
            isDecrypting={isDecrypting}
          />

          {/* Player 2 (Right) or Empty */}
          {game.players[1] ? (
            <div className="flex flex-col items-center gap-2 flex-1">
              <div className="relative">
                <Avatar seed={game.players[1].avatarSeed} size="large" />
                <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full p-0.5">
                  <PixelCoin side={getPlayerSide(1)} size="small" />
                </div>
                {game.status === 'completed' && (game.winner === game.players[1].address || game.winners.includes(game.players[1].address)) && (
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xl">🏆</div>
                )}
              </div>
              <p className={`text-sm font-medium truncate max-w-[80px] ${
                game.players[1].address === currentAddress ? 'text-yellow-400' : 'text-white/90'
              }`}>
                {shortenAddress(game.players[1].address)}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 flex-1">
              <div className="relative group">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-green-500/20 to-emerald-500/20 border-2 border-dashed border-green-500/30 flex items-center justify-center cursor-pointer transition-all hover:scale-105 hover:border-green-500/50"
                     onClick={canJoin ? () => onJoin(getJoinSide()) : undefined}>
                  <span className="text-green-400 text-xl group-hover:scale-110 transition-transform">+</span>
                </div>
                <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full p-0.5">
                  <PixelCoin side={getJoinSide()} size="small" />
                </div>
              </div>
              <p className="text-white/40 text-sm">Join</p>
            </div>
          )}
        </div>
      )}

      {/* >2 Players Layout */}
      {game.maxPlayers > 2 && (
        <>
          {/* Center animation for multiplayer */}
          {(game.status === 'full' || game.status === 'flipping' || game.status === 'completed' || isDecrypting) && (
            <div className="flex justify-center mb-4">
              <CenterContent
                status={game.status}
                playerCount={playerCount}
                winners={game.winners}
                winnerSide={winnerSide}
                isDecrypting={isDecrypting}
              />
            </div>
          )}
          
          {/* Player count if not flipping */}
          {game.status !== 'full' && game.status !== 'flipping' && (
            <div className="text-center text-xs text-white/40">{playerCount}</div>
          )}

          {/* Player list - simple row layout */}
          <div className="mb-4 max-h-40 overflow-y-auto space-y-1 pr-1">
            {game.players.map((player, idx) => {
              const isWinner = game.status === 'completed' && (player.address === game.winner || game.winners.includes(player.address));
              return (
                <div
                  key={idx}
                  className={`flex items-center gap-3 py-1 px-2 rounded-lg ${
                    isWinner
                      ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/50'
                      : ''
                  }`}
                >
                  <Avatar seed={player.avatarSeed} size="small" />
                  <p className={`text-xs font-medium flex-1 ${
                    player.address === currentAddress ? 'text-yellow-400' : isWinner ? 'text-green-400 font-bold' : 'text-white/90'
                  }`}>
                    {shortenAddress(player.address)}
                  </p>
                  {isWinner && <span className="text-green-400">🏆</span>}
                  <div className="w-6 h-6">
                    <PixelCoin side={getPlayerSide(idx)} size="small" />
                  </div>
                </div>
              );
            })}
            {/* Empty slots */}
            {Array.from({ length: game.maxPlayers - game.currentPlayers }).map((_, idx) => {
              const playerIndex = game.currentPlayers + idx;
              const side = getPlayerSide(playerIndex);

              return (
                <div key={`empty-${idx}`} className="flex items-center gap-3 py-1 px-2 rounded-lg group cursor-pointer transition-all hover:scale-[1.02]"
                     style={{
                       background: 'linear-gradient(to-r, rgba(34, 197, 94, 0.1), rgba(16, 185, 129, 0.1))',
                       border: '1px solid rgba(34, 197, 94, 0.2)'
                     }}
                     onClick={canJoin ? () => onJoin(getJoinSide()) : undefined}>
                  <div className="relative">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500/20 to-emerald-500/20 border-2 border-dashed border-green-500/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <span className="text-green-400 text-lg group-hover:scale-110 transition-transform">+</span>
                    </div>
                  </div>
                  <p className="text-green-400 text-xs font-medium flex-1 group-hover:text-green-300 transition-colors">Join</p>
                  <div className="w-6 h-6 opacity-60">
                    <PixelCoin side={side} size="small" />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Bottom Actions */}
      <div className="flex gap-2">
        {game.canClaim && game.isWinner && (
          <button
            onClick={onClaim}
            className="flex-1 py-2.5 px-4 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white rounded-xl font-bold text-sm transition-all animate-pulse"
          >
            Claim {game.totalStake} 🎉
          </button>
        )}

        {game.status === 'completed' && !game.canClaim && game.isPlayer && (
          <div className="flex-1 py-2.5 px-4 bg-white/10 text-white/50 rounded-xl text-center text-sm">
            {game.isWinner ? '🎉 Won!' : 'Lost'}
          </div>
        )}
      </div>
    </div>
  );
};

// Main GameLobby component
export const GameLobby: React.FC<GameLobbyProps> = ({
  games,
  onJoinGame,
  onClaimReward,
  onCancelGame,
  loading,
  currentAddress,
  decryptingGames,
}) => {
  // Separate my games and other games
  const myGames = games.filter((game) => game.isPlayer || game.isCreator);
  const otherGames = games.filter((game) => !game.isPlayer && !game.isCreator);

  // Sort: active games first
  const sortGames = (gameList: Game[]) => {
    return [...gameList].sort((a, b) => {
      const statusOrder = { flipping: 0, full: 1, waiting: 2, completed: 3 };
      return statusOrder[a.status] - statusOrder[b.status];
    });
  };

  const sortedMyGames = sortGames(myGames);
  const sortedOtherGames = sortGames(otherGames);

  const showLoading = loading && games.length === 0;

  return (
    <div className="mt-6 space-y-6">
      {/* Loading */}
      {showLoading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
        </div>
      )}

      {/* My Games Section */}
      {!showLoading && myGames.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-white mb-3">
            My Games
            <span className="text-white/50 text-sm font-normal ml-2">({sortedMyGames.length})</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedMyGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onJoin={(side) => onJoinGame(game.id, side)}
                onClaim={() => onClaimReward(game.id)}
                onCancel={() => onCancelGame(game.id)}
                currentAddress={currentAddress}
                isDecrypting={decryptingGames.has(game.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* All Games Section */}
      {!showLoading && sortedOtherGames.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-white mb-3">
            All Games
            <span className="text-white/50 text-sm font-normal ml-2">({sortedOtherGames.length})</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedOtherGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onJoin={(side) => onJoinGame(game.id, side)}
                onClaim={() => onClaimReward(game.id)}
                onCancel={() => onCancelGame(game.id)}
                currentAddress={currentAddress}
                isDecrypting={decryptingGames.has(game.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!showLoading && games.length === 0 && (
        <div className="text-center py-8 bg-white/5 rounded-2xl border border-white/10">
          <p className="text-white/60 text-sm">No games found</p>
          <p className="text-white/40 text-xs mt-1">Create a new game!</p>
        </div>
      )}
    </div>
  );
};
