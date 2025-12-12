import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useSuiClient,
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from '@mysten/dapp-kit';
import { CONTRACT_CONFIG } from '../config/constants';
import type { GameDisplay } from '../types/game';
import {
  buildCreateRoomTx,
  buildJoinRoomTx,
  buildClaimRewardTx,
  buildCancelRoomTx,
  suiToMist,
  mistToSui,
} from '../services/suiService';

interface UseGameReturn {
  games: GameDisplay[];
  loading: boolean;
  error: string | null;
  createRoom: (
    maxPlayers: number,
    side: 'heads' | 'tails',
    stakeAmount: number
  ) => Promise<string | null>;
  joinRoom: (
    gameId: string,
    escrowId: string,
    side: 'heads' | 'tails',
    stakeAmount: bigint
  ) => Promise<boolean>;
  claimReward: (gameId: string, escrowId: string) => Promise<boolean>;
  cancelRoom: (gameId: string, escrowId: string) => Promise<boolean>;
  refreshGames: () => Promise<void>;
}

export const useGame = (): UseGameReturn => {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [games, setGames] = useState<GameDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isFirstLoad = useRef(true);

  // Fetch games from events - silent refresh (no loading spinner)
  const fetchGames = useCallback(
    async (showLoading = false) => {
      try {
        // Only show loading on first load
        if (showLoading || isFirstLoad.current) {
          setLoading(true);
        }
        setError(null);

        // Query GameCreated events to find all games
        const events = await client.queryEvents({
          query: {
            MoveEventType: `${CONTRACT_CONFIG.PACKAGE_ID}::${CONTRACT_CONFIG.MODULE_NAME}::GameCreated`,
          },
          limit: 50,
          order: 'descending',
        });

        const gameDisplays: GameDisplay[] = [];
        const currentTime = Date.now();

        for (const event of events.data) {
          try {
            const eventData = event.parsedJson as {
              game_id: string;
              escrow_id: string;
            };
            const gameId = eventData.game_id;
            const escrowId = eventData.escrow_id;

            // Fetch current game state
            const gameObj = await client.getObject({
              id: gameId,
              options: { showContent: true },
            });

            if (gameObj.data?.content?.dataType === 'moveObject') {
              const fields = (
                gameObj.data.content as { fields: Record<string, unknown> }
              ).fields;

              const unlockMs = Number(fields.unlock_ms || 0);
              const timeUntilUnlock = Math.max(0, unlockMs - currentTime);

              let status: GameDisplay['status'] = 'waiting';
              if (fields.claimed) {
                status = 'completed';
              } else if (fields.winner) {
                // Has winner - check if time passed
                status = timeUntilUnlock > 0 ? 'flipping' : 'completed';
              } else if (fields.game_started) {
                // Game started but no winner yet - still processing
                status = 'flipping';
              } else if (
                ((fields.players as string[])?.length || 0) ===
                (fields.max_players as number)
              ) {
                status = 'full';
              }

              // Convert player_sides (0=heads, 1=tails)
              const playerSides = ((fields.player_sides as number[]) || []).map(
                (s: number) => (s === 0 ? 'heads' : 'tails') as 'heads' | 'tails'
              );

              gameDisplays.push({
                id: gameId,
                escrowId: escrowId,
                creator: { address: fields.creator as string },
                maxPlayers: fields.max_players as number,
                currentPlayers: (fields.players as string[])?.length || 0,
                players: ((fields.players as string[]) || []).map(
                  (addr: string) => ({ address: addr })
                ),
                playerSides,
                stakePerPlayer: mistToSui(fields.stake_per_player as string),
                totalStake: mistToSui(fields.total_stake as string),
                unlockMs,
                blobId: fields.blob_id
                  ? bytesToHex(fields.blob_id as number[])
                  : null,
                winner: (fields.winner as string) || null,
                status,
                createdAt: new Date(Number(fields.created_at)),
                timeUntilUnlock,
                canClaim:
                  (fields.game_started as boolean) &&
                  !!(fields.winner as string) &&
                  !(fields.claimed as boolean) &&
                  timeUntilUnlock <= 0,
              });
            }
          } catch (e) {
            // Game might be deleted after claim, skip it
            console.debug('Skipping game:', e);
          }
        }

        setGames(gameDisplays);
        isFirstLoad.current = false;
      } catch (e) {
        console.error('Error fetching games:', e);
        setError('Failed to fetch games');
      } finally {
        setLoading(false);
      }
    },
    [client]
  );

  // Create a new room
  const createRoom = useCallback(
    async (maxPlayers: number, side: 'heads' | 'tails', stakeAmount: number): Promise<string | null> => {
      if (!account) {
        setError('Please connect your wallet');
        return null;
      }

      try {
        console.log('useGame.createRoom - side:', side, 'maxPlayers:', maxPlayers, 'stakeAmount:', stakeAmount);
        const stakeMist = suiToMist(stakeAmount);
        const tx = buildCreateRoomTx(maxPlayers, side, stakeMist);

        const result = await signAndExecute({
          transaction: tx,
        });

        console.log('Create room result:', result);

        // Refresh games after creation
        setTimeout(() => fetchGames(), 2000);

        return result.digest;
      } catch (e: unknown) {
        console.error('Create room error:', e);
        setError((e as Error).message || 'Failed to create room');
        return null;
      }
    },
    [account, signAndExecute, fetchGames]
  );

  // Join a room
  const joinRoom = useCallback(
    async (
      gameId: string,
      escrowId: string,
      side: 'heads' | 'tails',
      stakeAmount: bigint
    ): Promise<boolean> => {
      if (!account) {
        setError('Please connect your wallet');
        return false;
      }

      try {
        const tx = buildJoinRoomTx(gameId, escrowId, side, stakeAmount);

        const result = await signAndExecute({
          transaction: tx,
        });

        console.log('Join room result:', result);

        // Refresh games after joining
        setTimeout(() => fetchGames(), 2000);

        return true;
      } catch (e: unknown) {
        console.error('Join room error:', e);
        setError((e as Error).message || 'Failed to join room');
        return false;
      }
    },
    [account, signAndExecute, fetchGames]
  );

  // Claim reward
  const claimReward = useCallback(
    async (gameId: string, escrowId: string): Promise<boolean> => {
      if (!account) {
        setError('Please connect your wallet');
        return false;
      }

      try {
        const tx = buildClaimRewardTx(gameId, escrowId);

        const result = await signAndExecute({
          transaction: tx,
        });

        console.log('Claim reward result:', result);

        // Refresh games after claiming
        setTimeout(() => fetchGames(), 2000);

        return true;
      } catch (e: unknown) {
        console.error('Claim reward error:', e);
        setError((e as Error).message || 'Failed to claim reward');
        return false;
      }
    },
    [account, signAndExecute, fetchGames]
  );

  // Cancel room
  const cancelRoom = useCallback(
    async (gameId: string, escrowId: string): Promise<boolean> => {
      if (!account) {
        setError('Please connect your wallet');
        return false;
      }

      try {
        const tx = buildCancelRoomTx(gameId, escrowId);

        const result = await signAndExecute({
          transaction: tx,
        });

        console.log('Cancel room result:', result);

        // Refresh games after canceling
        setTimeout(() => fetchGames(), 2000);

        return true;
      } catch (e: unknown) {
        console.error('Cancel room error:', e);
        setError((e as Error).message || 'Failed to cancel room');
        return false;
      }
    },
    [account, signAndExecute, fetchGames]
  );

  // Initial fetch
  useEffect(() => {
    fetchGames(true);
  }, [fetchGames]);

  // Auto-refresh every 3 seconds (silent, no loading)
  useEffect(() => {
    const interval = setInterval(() => fetchGames(false), 3000);
    return () => clearInterval(interval);
  }, [fetchGames]);

  return {
    games,
    loading,
    error,
    createRoom,
    joinRoom,
    claimReward,
    cancelRoom,
    refreshGames: () => fetchGames(false),
  };
};

// Helper function
const bytesToHex = (bytes: number[]): string => {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
};
