import { useEffect, useCallback, useRef } from 'react';
import { Header } from './components/common/Header';
import { BetPanel } from './components/game/BetPanel';
import { GameLobby } from './components/game/GameLobby';
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { useGame } from './hooks/useGame';
import { useSealSession } from './hooks/useSealSession';
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
    sessionKey,
    isCreating: isCreatingSealSession,
    error: sealError,
    createSessionKey,
  } = useSealSession();

  const {
    games,
    loading,
    error,
    createRoom,
    joinRoom,
    claimReward,
    cancelRoom,
    refreshGames,
    decryptingGames,
  } = useGame(sessionKey);

  const processingRef = useRef<Set<string>>(new Set()); // Ref for immediate check

  // Initialize backend wallet (always needed for processing)
  useEffect(() => {
    initBackendWallet();
  }, []);

  // Create Seal session key when wallet connects
  useEffect(() => {
    if (currentAccount && !sessionKey && !isCreatingSealSession) {
      // Auto-create session key when user connects wallet
      createSessionKey();
    }
  }, [currentAccount, sessionKey, isCreatingSealSession, createSessionKey]);

  // Start event listener only if BACKEND_ENABLED
  useEffect(() => {
    if (!CONTRACT_CONFIG.BACKEND_ENABLED) return;

    let cleanup: (() => void) | null = null;

    const start = async () => {
      cleanup = await startEventListener(client);
    };

    start();

    return () => {
      if (cleanup) cleanup();
    };
  }, [client]);

  // Auto-process games that are full/flipping but don't have winners yet
  // Process ONE game at a time to avoid wallet object locking conflicts
  const processFullGames = useCallback(async () => {
    // Find the first game that needs processing
    const gameToProcess = games.find(
      (game) => {
        const needsProcessing = (game.status === 'full' || game.status === 'flipping') &&
          !game.blobId && // No blob_id means backend hasn't processed it yet
          game.currentPlayers === game.maxPlayers &&
          !processingRef.current.has(game.id);
        
        return needsProcessing;
      }
    );

    if (!gameToProcess) return;

    // Mark as processing immediately
    processingRef.current.add(gameToProcess.id);

    try {
      await manualProcessGame(client, gameToProcess.id);
    } catch (err) {
      // Remove from processing set so it can be retried
      processingRef.current.delete(gameToProcess.id);
    }

    // Always refresh and try to process next game after a delay
    setTimeout(() => {
      refreshGames();
    }, 3000); // Increased delay to reduce rate limiting
  }, [games, client, refreshGames]);

  // Check for full games to process on games change
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

    await createRoom(bet.maxPlayers, bet.side, bet.amount);
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
      // Trigger refresh to check if game is now full
      setTimeout(() => refreshGames(), 2000);
    }
  };

  const handleClaimReward = async (gameId: string) => {
    const game = games.find((g) => g.id === gameId);
    if (!game) return;

    await claimReward(gameId, game.escrowId);
  };

  const handleCancelGame = async (gameId: string) => {
    const game = games.find((g) => g.id === gameId);
    if (!game) return;

    await cancelRoom(gameId, game.escrowId);
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
    winner: game.winners && game.winners.length > 0 ? game.winners[0] : null, // First winner for backward compatibility
    winners: game.winners || [], // Ensure winners is always an array
    coinResult: game.coinResult,
    unlockMs: game.unlockMs,
    timeUntilUnlock: game.timeUntilUnlock,
    canClaim: game.canClaim,
    rewardPerWinner: game.rewardPerWinner,
    blobId: game.blobId, // Add blobId for backend processing check
    isCreator: currentAccount?.address === game.creator.address,
    isWinner: game.winners?.includes(currentAccount?.address || '') || false,
    isPlayer: game.players.some((p) => p.address === currentAccount?.address),
  }));

  return (
    <div className="app-container">
      <Header />

      <main className="main-content">
        {/* Status Bar */}
        {(error || sealError) && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 mb-4">
            <p className="text-red-400 text-sm">{error || sealError}</p>
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
          decryptingGames={decryptingGames}
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
