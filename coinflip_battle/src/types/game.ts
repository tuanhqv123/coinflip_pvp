// Game types matching the Move contract

export interface Player {
  address: string;
  avatarSeed?: string;
}

export interface Game {
  id: string;
  escrowId: string;
  creator: string;
  maxPlayers: number;
  players: string[];
  stakePerPlayer: bigint;
  totalStake: bigint;
  unlockMs: bigint;
  blobId: string | null;
  winner: string | null;
  gameStarted: boolean;
  claimed: boolean;
  createdAt: bigint;
}

export interface GameDisplay {
  id: string;
  escrowId: string;
  creator: Player;
  maxPlayers: number;
  currentPlayers: number;
  players: Player[];
  playerSides: ('heads' | 'tails')[]; // Player side choices
  stakePerPlayer: string; // In SUI (formatted)
  totalStake: string;
  unlockMs: number;
  blobId: string | null;
  winner: string | null;
  status: 'waiting' | 'full' | 'flipping' | 'completed';
  createdAt: Date;
  timeUntilUnlock: number;
  canClaim: boolean;
}

// Event types from contract
export interface GameCreatedEvent {
  game_id: string;
  escrow_id: string;
  creator: string;
  max_players: number;
  stake_per_player: string;
}

export interface PlayerJoinedEvent {
  game_id: string;
  player: string;
  current_players: number;
  max_players: number;
}

export interface GameFullEvent {
  game_id: string;
  players: string[];
  total_stake: string;
  unlock_ms: string;
}

export interface WinnerSetEvent {
  game_id: string;
  winner: string;
  blob_id: number[];
  unlock_ms: string;
}

export interface RewardClaimedEvent {
  game_id: string;
  winner: string;
  amount: string;
  claimed_at: string;
}

// Walrus encrypted data structure
export interface EncryptedWinnerData {
  winner: string;
  gameId: string;
  timestamp: number;
}
