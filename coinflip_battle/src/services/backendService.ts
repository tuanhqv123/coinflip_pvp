/**
 * Backend Service - Handles winner selection and encryption
 *
 * Flow:
 * 1. Listen for GameFull events
 * 2. Pick random winner from players
 * 3. Encrypt winner with Seal (using unlock_ms as identity)
 * 4. Upload encrypted data to Walrus
 * 5. Call set_winner on contract
 */

import { SuiClient, EventId } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { CONTRACT_CONFIG } from '../config/constants';
import { initSealClient, encryptWithSeal } from './sealService';
import { uploadToWalrus, blobIdToBytes } from './walrusService';
import type { EncryptedWinnerData, GameFullEvent } from '../types/game';
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
    console.log('Backend wallet initialized:', address);

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

// Pick random winner from players
export const pickRandomWinner = (players: string[]): string => {
  const randomIndex = Math.floor(Math.random() * players.length);
  return players[randomIndex];
};

// Encode winner data to bytes
const encodeWinnerData = (data: EncryptedWinnerData): Uint8Array => {
  const json = JSON.stringify(data);
  return new TextEncoder().encode(json);
};

// Process a full game - pick winner, encrypt, upload, set on chain
export const processFullGame = async (
  client: SuiClient,
  gameId: string,
  players: string[],
  unlockMs: bigint
): Promise<{ winner: string; blobId: string } | null> => {
  if (!backendKeypair) {
    console.error('Backend wallet not initialized');
    return null;
  }

  try {
    console.log('Processing full game:', gameId);
    console.log('Players:', players);
    console.log('Unlock time:', new Date(Number(unlockMs)).toISOString());

    // Initialize Seal client
    initSealClient(client);

    // 1. Pick random winner
    const winner = pickRandomWinner(players);
    console.log('Selected winner:', winner);

    // 2. Create winner data
    const winnerData: EncryptedWinnerData = {
      winner,
      gameId,
      timestamp: Date.now(),
    };

    // 3. Encode and encrypt with Seal (REQUIRED - no fallback)
    const encodedData = encodeWinnerData(winnerData);
    
    console.log('Encrypting winner data with Seal...');
    const encryptedData = await encryptWithSeal(encodedData, unlockMs);
    console.log('Data encrypted with Seal successfully');

    // 4. Upload to Walrus
    const blobId = await uploadToWalrus(encryptedData);
    console.log('Uploaded to Walrus, blob ID:', blobId);

    // 5. Call set_winner on contract
    const tx = new Transaction();
    tx.moveCall({
      target: `${CONTRACT_CONFIG.PACKAGE_ID}::${CONTRACT_CONFIG.MODULE_NAME}::set_winner`,
      arguments: [
        tx.object(gameId),
        tx.pure.address(winner),
        tx.pure.vector('u8', Array.from(blobIdToBytes(blobId))),
      ],
    });

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: backendKeypair,
    });

    console.log('set_winner transaction:', result.digest);

    return { winner, blobId };
  } catch (error) {
    console.error('Error processing full game:', error);
    return null;
  }
};

// Listen for GameFull events and process them
export const startEventListener = async (
  client: SuiClient
): Promise<() => void> => {
  console.log('Starting event listener for GameFull events...');

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

          // Check if winner already set
          const gameObj = await client.getObject({
            id: gameId,
            options: { showContent: true },
          });

          if (gameObj.data?.content?.dataType === 'moveObject') {
            const fields = (
              gameObj.data.content as { fields: Record<string, unknown> }
            ).fields;

            // Only process if winner not set yet
            if (!fields.winner) {
              console.log('Processing new full game:', gameId);

              const result = await processFullGame(
                client,
                gameId,
                eventData.players,
                BigInt(eventData.unlock_ms)
              );

              if (result) {
                processedGames.add(gameId);
              }
            } else {
              processedGames.add(gameId);
            }
          }
        }

        if (events.nextCursor) {
          lastCursor = events.nextCursor;
        }
      } catch (error) {
        console.error('Event polling error:', error);
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
): Promise<{ winner: string; blobId: string } | null> => {
  if (!backendKeypair) {
    console.error('Backend wallet not configured. Set VITE_BACKEND_PRIVATE_KEY in .env');
    return null;
  }

  // Check if already processing another game
  if (isProcessing) {
    console.log('Already processing another game, skipping:', gameId);
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

    if (fields.winner) {
      console.log('Winner already set for game:', gameId);
      return null;
    }

    if (!fields.game_started) {
      throw new Error('Game not started yet');
    }

    return await processFullGame(
      client,
      gameId,
      fields.players as string[],
      BigInt(fields.unlock_ms as string)
    );
  } catch (error) {
    console.error('Manual process error:', error);
    return null;
  } finally {
    // Release processing lock
    isProcessing = false;
  }
};
