import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useSuiClient,
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from '@mysten/dapp-kit';
import { SessionKey } from '@mysten/seal';
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
import { tryDecryptGameResult, canDecryptGame } from '../services/decryptionService';
import { bytesToBlobId } from '../services/walrusService';

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
  decryptingGames: Set<string>;
}

export const useGame = (sessionKey?: SessionKey | null): UseGameReturn => {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [games, setGames] = useState<GameDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decryptingGames, setDecryptingGames] = useState<Set<string>>(new Set());
  // Store decrypted results so they persist across fetchGames calls
  const decryptedResults = useRef<Map<string, { coinResult: number | null; winners: string[] }>>(new Map());
  // Track games currently being decrypted (ref to avoid re-renders)
  const decryptingRef = useRef<Set<string>>(new Set());
  const isFirstLoad = useRef(true);
  const lastFetchTime = useRef<number>(0);
  // Store sessionKey in ref to avoid recreating fetchGames callback
  const sessionKeyRef = useRef<SessionKey | null>(null);
  sessionKeyRef.current = sessionKey || null;

  // Fetch games from events - silent refresh (no loading spinner)
  const fetchGames = useCallback(
    async (showLoading = false) => {
      // Rate limiting: don't fetch more than once every 5 seconds
      const now = Date.now();
      if (now - lastFetchTime.current < 5000 && !showLoading) {
        return;
      }
      lastFetchTime.current = now;

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
              let actualWinners = fields.winners as string[] || [];
              let actualCoinResult = fields.coin_result as number | null;

              // Check if we need to decrypt the result
              const blobId = fields.blob_id ? bytesToBlobId(new Uint8Array(fields.blob_id as number[])) : null;
              const gameStarted = fields.game_started as boolean;
              const isGameFull = ((fields.players as string[])?.length || 0) === (fields.max_players as number);
              
              // If blob_id exists, we MUST decrypt to show result - NEVER use on-chain data directly
              if (blobId) {
                // Check if we already have decrypted result stored
                const cached = decryptedResults.current.get(gameId);
                
                console.log(`🔍 Game ${gameId.slice(0,10)}: blobId=${!!blobId}, cached=${!!cached}, decrypting=${decryptingRef.current.has(gameId)}, sessionKey=${!!sessionKeyRef.current}, canDecrypt=${sessionKeyRef.current ? canDecryptGame(blobId, unlockMs, sessionKeyRef.current) : false}`);
                
                if (cached) {
                  // Use stored decrypted result from this session
                  actualWinners = cached.winners;
                  actualCoinResult = cached.coinResult;
                } else if (decryptingRef.current.has(gameId)) {
                  // Already decrypting this game - don't start again
                  actualWinners = [];
                  actualCoinResult = null;
                } else if (sessionKeyRef.current && canDecryptGame(blobId, unlockMs, sessionKeyRef.current)) {
                  // NEW game that needs decryption - start it
                  console.log(`🔓 Starting decryption for ${gameId.slice(0,10)}`);
                  decryptingRef.current.add(gameId);
                  setDecryptingGames(prev => new Set(prev).add(gameId));
                  
                  tryDecryptGameResult(gameId, blobId, unlockMs, sessionKeyRef.current, client)
                    .then(result => {
                      console.log(`📦 Decryption result for ${gameId.slice(0,10)}:`, result);
                      if (result.success && result.winners && result.winners.length > 0) {
                        // Store decrypted result for this session
                        decryptedResults.current.set(gameId, {
                          coinResult: result.coinResult ?? null,
                          winners: result.winners
                        });
                        
                        // Update games state with decrypted result
                        setGames(prevGames => prevGames.map(g => {
                          if (g.id === gameId) {
                            return {
                              ...g,
                              coinResult: result.coinResult ?? null,
                              winners: result.winners!,
                              status: 'completed' as const,
                              canClaim: result.winners!.includes(account?.address || '')
                            };
                          }
                          return g;
                        }));
                      }
                    })
                    .finally(() => {
                      decryptingRef.current.delete(gameId);
                      setDecryptingGames(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(gameId);
                        return newSet;
                      });
                    });
                  
                  // Clear on-chain data while decrypting
                  actualWinners = [];
                  actualCoinResult = null;
                } else {
                  // Not decrypted yet - clear on-chain data
                  actualWinners = [];
                  actualCoinResult = null;
                }
              }

              // Determine status with proper logic
              // IMPORTANT: Always show flipping during lock period, even if we have cached result
              if (fields.claimed) {
                status = 'completed';
              } else if (timeUntilUnlock > 0 && (gameStarted || blobId)) {
                // Still in lock period - MUST show flipping animation for all players
                status = 'flipping';
                // Don't show result yet during lock period
                actualWinners = [];
                actualCoinResult = null;
              } else if (decryptingRef.current.has(gameId)) {
                // Currently decrypting - show flipping
                status = 'flipping';
              } else if (actualCoinResult !== null || actualWinners.length > 0) {
                // Has result (either decrypted or on-chain) and lock period has passed
                status = 'completed';
              } else if (gameStarted || blobId) {
                // Game started or has blob but no result yet - show flipping
                status = 'flipping';
              } else if (isGameFull) {
                // Game is full but not started yet - should trigger game start soon
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
                blobId: blobId,
                coinResult: actualCoinResult,
                winners: actualWinners,
                status,
                createdAt: new Date(Number(fields.created_at)),
                timeUntilUnlock,
                canClaim:
                  !!(fields.game_started) &&
                  (actualCoinResult !== null || actualWinners.length > 0) &&
                  !(fields.claimed) &&
                  timeUntilUnlock <= 0 &&
                  !!account &&
                  actualWinners.length > 0 &&
                  actualWinners.includes(account.address),
                rewardPerWinner: actualWinners.length > 0
                  ? mistToSui(String(BigInt(fields.total_stake as string) / BigInt(actualWinners.length)))
                  : undefined,
              });
            }
          } catch (e) {
            // Game might be deleted after claim, skip it silently
          }
        }

        // Merge any already-decrypted results into gameDisplays before setting state
        const mergedGames = gameDisplays.map(game => {
          const cached = decryptedResults.current.get(game.id);
          if (cached) {
            return {
              ...game,
              coinResult: cached.coinResult,
              winners: cached.winners,
              status: 'completed' as const,
              canClaim: cached.winners.includes(account?.address || '')
            };
          }
          return game;
        });
        
        setGames(mergedGames);
        isFirstLoad.current = false;
      } catch (e) {
        const errorMsg = (e as Error).message || String(e);
        if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
          // Rate limited - just skip this fetch, don't show error
        } else {
          setError('Failed to fetch games');
        }
      } finally {
        setLoading(false);
      }
    },
    [client, account]
  );

  // Create a new room
  const createRoom = useCallback(
    async (maxPlayers: number, side: 'heads' | 'tails', stakeAmount: number): Promise<string | null> => {
      if (!account) {
        setError('Please connect your wallet');
        return null;
      }

      try {
        const stakeMist = suiToMist(stakeAmount);
        const tx = buildCreateRoomTx(maxPlayers, side, stakeMist);

        const result = await signAndExecute({
          transaction: tx,
        });

        console.log('🎮 Create Room Transaction:', {
          digest: result.digest,
          side,
          stakeAmount,
          maxPlayers
        });

        // Refresh games after creation
        setTimeout(() => fetchGames(true), 2000);

        return result.digest;
      } catch (e: unknown) {
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

        console.log('🎮 Join Room Transaction:', {
          digest: result.digest,
          gameId,
          escrowId,
          side,
          stakeAmount: stakeAmount.toString()
        });

        // Refresh games after joining
        setTimeout(() => fetchGames(true), 2000);

        return true;
      } catch (e: unknown) {
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

        await signAndExecute({
          transaction: tx,
        });

        // Refresh games after claiming
        setTimeout(() => fetchGames(true), 2000);

        return true;
      } catch (e: unknown) {
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

        await signAndExecute({
          transaction: tx,
        });

        // Refresh games after canceling
        setTimeout(() => fetchGames(true), 2000);

        return true;
      } catch (e: unknown) {
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

  // Re-fetch when session key becomes available (to start decryption)
  useEffect(() => {
    if (sessionKey) {
      console.log('🔑 Session key available, triggering re-fetch for decryption');
      // Force re-fetch by resetting the rate limit
      lastFetchTime.current = 0;
      fetchGames(false);
    }
  }, [sessionKey, fetchGames]);

  // Poll every 5 seconds so all users see new rooms and game updates quickly
  useEffect(() => {
    const interval = setInterval(() => {
      lastFetchTime.current = 0; // Reset rate limit
      fetchGames(false);
    }, 5000);
    
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
    decryptingGames,
  };
};


