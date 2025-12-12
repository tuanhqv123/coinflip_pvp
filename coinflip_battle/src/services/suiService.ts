import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { CONTRACT_CONFIG, CLOCK_ID } from '../config/constants';
import type { Game, GameDisplay } from '../types/game';

// Convert MIST to SUI
export const mistToSui = (mist: bigint | string): string => {
  const value = typeof mist === 'string' ? BigInt(mist) : mist;
  return (Number(value) / 1_000_000_000).toFixed(4);
};

// Convert SUI to MIST
export const suiToMist = (sui: number): bigint => {
  return BigInt(Math.floor(sui * 1_000_000_000));
};

// Parse game object from chain
export const parseGameObject = (obj: any): Game | null => {
  try {
    const fields = obj.data?.content?.fields;
    if (!fields) return null;

    return {
      id: obj.data.objectId,
      escrowId: '', // Will be fetched separately
      creator: fields.creator,
      maxPlayers: fields.max_players,
      players: fields.players || [],
      stakePerPlayer: BigInt(fields.stake_per_player),
      totalStake: BigInt(fields.total_stake),
      unlockMs: BigInt(fields.unlock_ms || 0),
      blobId: fields.blob_id ? bytesToHex(fields.blob_id) : null,
      winner: fields.winner || null,
      gameStarted: fields.game_started,
      claimed: fields.claimed,
      createdAt: BigInt(fields.created_at),
    };
  } catch (e) {
    console.error('Error parsing game object:', e);
    return null;
  }
};

// Convert bytes to hex string
const bytesToHex = (bytes: number[]): string => {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
};

// Convert game to display format
// Note: This function is not used - useGame.ts fetches directly from chain
export const gameToDisplay = (game: Game, currentTime: number, playerSides: ('heads' | 'tails')[] = []): GameDisplay => {
  const unlockMs = Number(game.unlockMs);
  const timeUntilUnlock = Math.max(0, unlockMs - currentTime);
  
  let status: GameDisplay['status'] = 'waiting';
  if (game.claimed) {
    status = 'completed';
  } else if (game.winner) {
    status = timeUntilUnlock > 0 ? 'flipping' : 'completed';
  } else if (game.gameStarted) {
    status = 'flipping';
  } else if (game.players.length === game.maxPlayers) {
    status = 'full';
  }

  return {
    id: game.id,
    escrowId: game.escrowId,
    creator: { address: game.creator },
    maxPlayers: game.maxPlayers,
    currentPlayers: game.players.length,
    players: game.players.map(addr => ({ address: addr })),
    playerSides,
    stakePerPlayer: mistToSui(game.stakePerPlayer),
    totalStake: mistToSui(game.totalStake),
    unlockMs,
    blobId: game.blobId,
    winner: game.winner,
    status,
    createdAt: new Date(Number(game.createdAt)),
    timeUntilUnlock,
    canClaim: game.gameStarted && !!game.winner && !game.claimed && timeUntilUnlock <= 0,
  };
};

// Build create room transaction
// side: 'heads' = 0, 'tails' = 1
export const buildCreateRoomTx = (
  maxPlayers: number,
  side: 'heads' | 'tails',
  stakeAmount: bigint,
): Transaction => {
  const tx = new Transaction();
  
  const [coin] = tx.splitCoins(tx.gas, [stakeAmount]);
  const sideValue = side === 'heads' ? 0 : 1;
  console.log('buildCreateRoomTx - side:', side, 'sideValue:', sideValue);
  
  tx.moveCall({
    target: `${CONTRACT_CONFIG.PACKAGE_ID}::${CONTRACT_CONFIG.MODULE_NAME}::create_room`,
    arguments: [
      tx.pure.u8(maxPlayers),
      tx.pure.u8(sideValue),
      coin,
      tx.object(CLOCK_ID),
    ],
  });

  return tx;
};

// Build join room transaction
// side: 'heads' = 0, 'tails' = 1
export const buildJoinRoomTx = (
  gameId: string,
  escrowId: string,
  side: 'heads' | 'tails',
  stakeAmount: bigint,
): Transaction => {
  const tx = new Transaction();
  
  const [coin] = tx.splitCoins(tx.gas, [stakeAmount]);
  const sideValue = side === 'heads' ? 0 : 1;
  
  tx.moveCall({
    target: `${CONTRACT_CONFIG.PACKAGE_ID}::${CONTRACT_CONFIG.MODULE_NAME}::join_room`,
    arguments: [
      tx.object(gameId),
      tx.object(escrowId),
      tx.pure.u8(sideValue),
      coin,
      tx.object(CLOCK_ID),
    ],
  });

  return tx;
};

// Build set winner transaction (called by backend)
export const buildSetWinnerTx = (
  gameId: string,
  winner: string,
  blobId: Uint8Array,
): Transaction => {
  const tx = new Transaction();
  
  tx.moveCall({
    target: `${CONTRACT_CONFIG.PACKAGE_ID}::${CONTRACT_CONFIG.MODULE_NAME}::set_winner`,
    arguments: [
      tx.object(gameId),
      tx.pure.address(winner),
      tx.pure.vector('u8', Array.from(blobId)),
    ],
  });

  return tx;
};

// Build claim reward transaction
export const buildClaimRewardTx = (
  gameId: string,
  escrowId: string,
): Transaction => {
  const tx = new Transaction();
  
  tx.moveCall({
    target: `${CONTRACT_CONFIG.PACKAGE_ID}::${CONTRACT_CONFIG.MODULE_NAME}::claim_reward`,
    arguments: [
      tx.object(gameId),
      tx.object(escrowId),
      tx.object(CLOCK_ID),
    ],
  });

  return tx;
};

// Build cancel room transaction
export const buildCancelRoomTx = (
  gameId: string,
  escrowId: string,
): Transaction => {
  const tx = new Transaction();
  
  tx.moveCall({
    target: `${CONTRACT_CONFIG.PACKAGE_ID}::${CONTRACT_CONFIG.MODULE_NAME}::cancel_room`,
    arguments: [
      tx.object(gameId),
      tx.object(escrowId),
    ],
  });

  return tx;
};

// Fetch all active games
export const fetchActiveGames = async (client: SuiClient): Promise<Game[]> => {
  try {
    // Query all FlipGame objects
    const { data } = await client.getOwnedObjects({
      owner: CONTRACT_CONFIG.PACKAGE_ID,
      filter: {
        StructType: `${CONTRACT_CONFIG.PACKAGE_ID}::${CONTRACT_CONFIG.MODULE_NAME}::FlipGame`,
      },
      options: {
        showContent: true,
      },
    });

    // For shared objects, we need to use queryEvents or dynamic field queries
    // This is a simplified version - in production, use event indexing
    const games: Game[] = [];
    
    for (const obj of data) {
      const game = parseGameObject(obj);
      if (game) {
        games.push(game);
      }
    }

    return games;
  } catch (e) {
    console.error('Error fetching games:', e);
    return [];
  }
};
