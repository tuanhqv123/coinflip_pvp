/**
 * Decryption Service - Handles fetching and decrypting game results
 * 
 * Flow:
 * 1. Check if game has blob_id and unlock time has passed
 * 2. Fetch encrypted data from Walrus using blob_id
 * 3. Decrypt using user's Seal session key
 * 4. Return decrypted winner data
 */

import { SuiClient } from '@mysten/sui/client';
import { SessionKey } from '@mysten/seal';
import { fetchFromWalrus } from './walrusService';
import { fetchAndDecryptWinner, canDecrypt, initSealClient } from './sealService';
import type { EncryptedResultData } from '../types/game';

export interface DecryptionResult {
  success: boolean;
  coinResult?: number;
  winners?: string[];
  error?: string;
}

/**
 * Attempt to decrypt game result if conditions are met
 */
export const tryDecryptGameResult = async (
  gameId: string,
  blobId: string | null,
  unlockMs: number,
  sessionKey: SessionKey | null,
  suiClient: SuiClient
): Promise<DecryptionResult> => {
  try {
    // Check if we have all required data
    if (!blobId) {
      return { success: false, error: 'No blob ID available' };
    }

    if (!sessionKey) {
      return { success: false, error: 'No session key available' };
    }

    // Check if unlock time has passed
    if (!canDecrypt(BigInt(unlockMs))) {
      const timeLeft = Math.ceil((unlockMs - Date.now()) / 1000);
      return { success: false, error: `Result locked for ${timeLeft}s` };
    }



    // Initialize Seal client
    initSealClient(suiClient);

    // Fetch encrypted data from Walrus
    const encryptedData = await fetchFromWalrus(blobId);

    // Decrypt using Seal
    const winner = await fetchAndDecryptWinner(
      encryptedData,
      gameId,
      BigInt(unlockMs),
      sessionKey,
      suiClient
    );

    if (!winner) {
      return { success: false, error: 'Failed to decrypt result' };
    }

    // Try to parse as JSON (new format)
    try {
      const resultData: EncryptedResultData = JSON.parse(winner);
      return {
        success: true,
        coinResult: resultData.coinResult,
        winners: resultData.winners,
      };
    } catch {
      // Fallback: treat as single winner string (old format)
      return {
        success: true,
        winners: [winner],
      };
    }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Decryption failed' 
    };
  }
};

/**
 * Check if a game result can be decrypted
 */
export const canDecryptGame = (
  blobId: string | null,
  unlockMs: number,
  sessionKey: SessionKey | null
): boolean => {
  return !!(blobId && sessionKey && canDecrypt(BigInt(unlockMs)));
};

/**
 * Get time until decryption is available
 */
export const getTimeUntilDecryption = (unlockMs: number): number => {
  return Math.max(0, unlockMs - Date.now());
};

/**
 * Format time remaining as human readable string
 */
export const formatTimeRemaining = (ms: number): string => {
  if (ms <= 0) return 'Available now';
  
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};