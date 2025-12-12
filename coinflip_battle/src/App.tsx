import { useEffect, useCallback, useRef } from 'react';
import { Header } from './components/common/Header';
import { BetPanel } from './components/game/BetPanel';
import { GameLobby } from './components/game/GameLobby';
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { useGame } from './hooks/useGame';
import { CONTRACT_CONFIG } from './config/constants';
import {
  initBackendWallet,
  startEventListener,
  manualProcessGame,
} from './services/backendService';
import { suiToMist } from './services/suiService';

function App() {
  const currentAccount = useCurrentAccount();
  const client = useSuiClient();
  const {
    games,
    loading,
    error,
    createRoom,
    joinRoom,
    claimReward,
    cancelRoom,
    refreshGames,
  } = useGame();

  const processingRef = useRef<Set<string>>(new Set()); // Ref for immediate check

  // Initialize backend wallet (always needed for processing)
  useEffect(() => {
    const address = initBackendWallet();
    if (address) {
      console.log('Backend wallet ready:', address);
    }
  }, []);

  // Start event listener only if BACKEND_ENABLED
  useEffect(() => {
    if (!CONTRACT_CONFIG.BACKEND_ENABLED) return;

    let cleanup: (() => void) | null = null;

    const start = async () => {
      cleanup = await startEventListener(client);
      console.log('Backend event listener started');
    };

    start();

    return () => {
      if (cleanup) cleanup();
      console.log('Backend event listener stopped');
    };
  }, [client]);

  // Auto-process games that are full/flipping but don't have a winner yet
  // Process ONE game at a time to avoid wallet object locking conflicts
  const processFullGames = useCallback(async () => {
    // Find the first game that needs processing
    const gameToProcess = games.find(game => 
      (game.status === 'full' || game.status === 'flipping') &&
      !game.winner &&
      game.currentPlayers === game.maxPlayers &&
      !processingRef.current.has(game.id)
    );

    if (!gameToProcess) return;

    // Mark as processing immediately
    processingRef.current.add(gameToProcess.id);
    console.log('Auto-processing game:', gameToProcess.id, 'status:', gameToProcess.status);

    try {
      const result = await manualProcessGame(client, gameToProcess.id);
      if (result) {
        console.log('Game processed! Winner:', result.winner);
        // Refresh and process next game
        setTimeout(() => refreshGames(), 1000);
      }
    } catch (err) {
      console.error('Error processing game:', err);
      // Remove from processing set so it can be retried
      processingRef.current.delete(gameToProcess.id);
    }
  }, [games, client, refreshGames]);

  // Check for full games to process
  useEffect(() => {
    processFullGames();
  }, [processFullGames]);

  const handleCreateGame = async (bet: {
    side: 'heads' | 'tails';
    amount: number;
    maxPlayers: number;
  }) => {
    if (!currentAccount) {
      alert('Please connect your wallet first');
      return;
    }

    console.log('Creating game with side:', bet.side, 'amount:', bet.amount, 'maxPlayers:', bet.maxPlayers);
    const result = await createRoom(bet.maxPlayers, bet.side, bet.amount);
    if (result) {
      console.log('Game created:', result);
    }
  };

  const handleJoinGame = async (gameId: string, side: 'heads' | 'tails' = 'tails') => {
    if (!currentAccount) {
      alert('Please connect your wallet first');
      return;
    }

    const game = games.find((g) => g.id === gameId);
    if (!game) {
      alert('Game not found');
      return;
    }

    const stakeMist = suiToMist(parseFloat(game.stakePerPlayer));
    const success = await joinRoom(gameId, game.escrowId, side, stakeMist);
    if (success) {
      console.log('Joined game:', gameId);
      // Trigger refresh to check if game is now full
      setTimeout(() => refreshGames(), 2000);
    }
  };

  const handleClaimReward = async (gameId: string) => {
    const game = games.find((g) => g.id === gameId);
    if (!game) return;

    const success = await claimReward(gameId, game.escrowId);
    if (success) {
      console.log('Reward claimed:', gameId);
    }
  };

  const handleCancelGame = async (gameId: string) => {
    const game = games.find((g) => g.id === gameId);
    if (!game) return;

    const success = await cancelRoom(gameId, game.escrowId);
    if (success) {
      console.log('Game cancelled:', gameId);
    }
  };

  // Convert games to lobby format
  const lobbyGames = games.map((game) => ({
    id: game.id,
    escrowId: game.escrowId,
    creator: {
      address: game.creator.address,
      avatarSeed: game.creator.address,
    },
    maxPlayers: game.maxPlayers,
    currentPlayers: game.currentPlayers,
    players: game.players.map((p) => ({
      address: p.address,
      avatarSeed: p.address,
    })),
    playerSides: game.playerSides,
    betAmount: game.stakePerPlayer,
    totalStake: game.totalStake,
    status: game.status,
    createdAt: game.createdAt,
    winner: game.winner,
    unlockMs: game.unlockMs,
    timeUntilUnlock: game.timeUntilUnlock,
    canClaim: game.canClaim,
    isCreator: currentAccount?.address === game.creator.address,
    isWinner: currentAccount?.address === game.winner,
    isPlayer: game.players.some((p) => p.address === currentAccount?.address),
  }));

  return (
    <div className="app-container">
      <Header />

      <main className="main-content">
        {/* Status Bar */}
        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Bet Panel */}
        <BetPanel onCreateGame={handleCreateGame} />

        {/* Game Lobby */}
        <GameLobby
          games={lobbyGames}
          onJoinGame={handleJoinGame}
          onClaimReward={handleClaimReward}
          onCancelGame={handleCancelGame}
          loading={loading}
          currentAddress={currentAccount?.address}
        />

        {/* Refresh Button */}
        <div className="flex justify-center mt-4">
          <button
            onClick={refreshGames}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white/70 text-sm transition-colors"
          >
            Refresh Games
          </button>
        </div>
      </main>
    </div>
  );
}

export default App;
