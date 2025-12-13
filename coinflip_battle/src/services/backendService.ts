/**
 * Backend Service - Handles result encryption
 *
 * Flow:
 * 1. Listen for GameFull events (result already determined on-chain)
 * 2. Read result from contract (coin flip result and winners)
 * 3. Encrypt result with Seal (using unlock_ms as identity)
 * 4. Upload encrypted data to Walrus
 * 5. Call set_blob_id on contract
 */

import { SuiClient, EventId } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { CONTRACT_CONFIG } from '../config/constants';
import { initSealClient, encryptWithSeal } from './sealService';
import { uploadToWalrus, blobIdToBytes } from './walrusService';
import type { EncryptedResultData, GameFullEvent } from '../types/game';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { fromBase64 } from '@mysten/sui/utils';

// Backend wallet keypair
let backendKeypair: Ed25519Keypair | null = null;

// Global processing lock to prevent concurrent transactions
let isProcessing = false;

// Initialize backend wallet from .env
export const initBackendWallet = (): string | null => {
  try {
    const privateKey = import.meta.env.VITE_BACKEND_PRIVATE_KEY;

    if (!privateKey) {
      console.warn(
        'VITE_BACKEND_PRIVATE_KEY not set in .env - backend processing disabled'
      );
      console.warn('To enable: add VITE_BACKEND_PRIVATE_KEY to .env file');
      return null;
    }

    // Handle bech32 format (suiprivkey1...) or base64
    if (privateKey.startsWith('suiprivkey')) {
      const { secretKey } = decodeSuiPrivateKey(privateKey);
      backendKeypair = Ed25519Keypair.fromSecretKey(secretKey);
    } else {
      // Assume base64 format
      const privateKeyBytes = fromBase64(privateKey);
      backendKeypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
    }

    const address = backendKeypair.getPublicKey().toSuiAddress();

    return address;
  } catch (error) {
    console.error('Error initializing backend wallet:', error);
    return null;
  }
};

// Get backend wallet address
export const getBackendWalletAddress = (): string | null => {
  return backendKeypair?.getPublicKey().toSuiAddress() || null;
};

// Check if backend is ready
export const isBackendReady = (): boolean => {
  return backendKeypair !== null;
};

// Encode game result data to bytes
const encodeResultData = (data: EncryptedResultData): Uint8Array => {
  const json = JSON.stringify(data);
  return new TextEncoder().encode(json);
};

// Process a full game - read result, encrypt, upload, set on chain
export const processFullGame = async (
  client: SuiClient,
  gameId: string,
  gameData: {
    coinResult: number;
    winners: string[];
    unlockMs: bigint;
  }
): Promise<{ blobId: string } | null> => {
  if (!backendKeypair) {
    console.error('Backend wallet not initialized');
    return null;
  }

  try {

    // Initialize Seal client
    initSealClient(client);

    // 1. Create result data
    const resultData: EncryptedResultData = {
      coinResult: gameData.coinResult,
      winners: gameData.winners,
      gameId,
      timestamp: Date.now(),
    };

    // 2. Encode and encrypt with Seal (REQUIRED - no fallback)
    const encodedData = encodeResultData(resultData);
    const encryptedData = await encryptWithSeal(encodedData, gameData.unlockMs);

    // 3. Upload to Walrus
    const blobId = await uploadToWalrus(encryptedData);

    // 4. Call set_blob_id on contract
    const tx = new Transaction();
    tx.moveCall({
      target: `${CONTRACT_CONFIG.PACKAGE_ID}::${CONTRACT_CONFIG.MODULE_NAME}::set_blob_id`,
      arguments: [
        tx.object(gameId),
        tx.pure.vector('u8', Array.from(blobIdToBytes(blobId))),
      ],
    });

    // Get available gas coins for backend wallet
    const backendAddress = backendKeypair.getPublicKey().toSuiAddress();
    const coins = await client.getCoins({
      owner: backendAddress,
      coinType: '0x2::sui::SUI',
    });

    if (coins.data.length === 0) {
      throw new Error('Backend wallet has no SUI for gas. Please fund it.');
    }

    // Try each coin until one works (skip locked coins)
    let lastError: Error | null = null;
    
    // Try coins in reverse order (newest first)
    for (let i = coins.data.length - 1; i >= 0; i--) {
      const gasCoin = coins.data[i];
      
      try {
        // Create fresh transaction for each attempt
        const attemptTx = new Transaction();
        attemptTx.moveCall({
          target: `${CONTRACT_CONFIG.PACKAGE_ID}::${CONTRACT_CONFIG.MODULE_NAME}::set_blob_id`,
          arguments: [
            attemptTx.object(gameId),
            attemptTx.pure.vector('u8', Array.from(blobIdToBytes(blobId))),
          ],
        });
        
        attemptTx.setGasPayment([{
          objectId: gasCoin.coinObjectId,
          version: gasCoin.version,
          digest: gasCoin.digest,
        }]);

        await client.signAndExecuteTransaction({
          transaction: attemptTx,
          signer: backendKeypair,
        });

        return { blobId };
      } catch (err: unknown) {
        const errMsg = (err as Error).message || String(err);
        if (errMsg.includes('already locked')) {
          lastError = err as Error;
          continue;
        }
        // Other error, throw immediately
        throw err;
      }
    }

    // All coins failed
    throw lastError || new Error('All gas coins are locked');
  } catch {
    return null;
  }
};

// Listen for GameFull events and process them
export const startEventListener = async (
  client: SuiClient
): Promise<() => void> => {
  let lastCursor: EventId | null = null;
  let running = true;
  const processedGames = new Set<string>();

  const pollEvents = async () => {
    while (running) {
      try {
        const events = await client.queryEvents({
          query: {
            MoveEventType: `${CONTRACT_CONFIG.PACKAGE_ID}::${CONTRACT_CONFIG.MODULE_NAME}::GameFull`,
          },
          cursor: lastCursor || undefined,
          limit: 10,
          order: 'ascending',
        });

        for (const event of events.data) {
          const eventData = event.parsedJson as GameFullEvent;
          const gameId = eventData.game_id;

          // Skip if already processed
          if (processedGames.has(gameId)) continue;

          // Check if blob_id already set
          const gameObj = await client.getObject({
            id: gameId,
            options: { showContent: true },
          });

          if (gameObj.data?.content?.dataType === 'moveObject') {
            const fields = (
              gameObj.data.content as { fields: Record<string, unknown> }
            ).fields;

            // Only process if blob_id not set yet (but result is available)
            if (!fields.blob_id && fields.coin_result !== null && fields.winners) {
              // Check if we're already processing this game
              if (!processedGames.has(gameId)) {
                const result = await processFullGame(
                  client,
                  gameId,
                  {
                    coinResult: Number(fields.coin_result),
                    winners: fields.winners as string[],
                    unlockMs: BigInt(eventData.unlock_ms),
                  }
                );

                if (result) {
                  processedGames.add(gameId);
                }
              }
            } else {
              // Already processed or not ready
              processedGames.add(gameId);
            }
          }
        }

        if (events.nextCursor) {
          lastCursor = events.nextCursor;
        }
      } catch (error) {
        // Silent error handling for polling
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  };

  // Start polling in background
  pollEvents();

  // Return cleanup function
  return () => {
    running = false;
  };
};

// Manual trigger for processing a specific game (for testing)
export const manualProcessGame = async (
  client: SuiClient,
  gameId: string
): Promise<{ blobId: string } | null> => {
  if (!backendKeypair) {
    console.error('Backend wallet not configured. Set VITE_BACKEND_PRIVATE_KEY in .env');
    return null;
  }

  // Check if already processing another game
  if (isProcessing) {
    return null;
  }

  try {
    // Set processing lock
    isProcessing = true;

    const gameObj = await client.getObject({
      id: gameId,
      options: { showContent: true },
    });

    if (gameObj.data?.content?.dataType !== 'moveObject') {
      throw new Error('Game not found');
    }

    const fields = (
      gameObj.data.content as { fields: Record<string, unknown> }
    ).fields;

    if (fields.blob_id) {
      return null;
    }

    if (!fields.game_started) {
      return null;
    }

    if (fields.coin_result === null || !fields.winners) {
      return null;
    }

    return await processFullGame(
      client,
      gameId,
      {
        coinResult: Number(fields.coin_result),
        winners: fields.winners as string[],
        unlockMs: BigInt(fields.unlock_ms as string),
      }
    );
  } catch (error) {
    return null;
  } finally {
    // Release processing lock
    isProcessing = false;
  }
};
