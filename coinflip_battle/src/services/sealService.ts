import { SealClient, SessionKey, EncryptedObject } from '@mysten/seal';
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { CONTRACT_CONFIG } from '../config/constants';
import { bcs } from '@mysten/sui/bcs';
import { fromHex } from '@mysten/sui/utils';

/**
 * Seal Service - Time-locked encryption for winner data
 * 
 * Using official @mysten/seal SDK
 * Docs: https://seal-docs.wal.app/
 * 
 * Flow:
 * 1. Build identity from unlock_ms timestamp
 * 2. Encrypt winner data with Seal
 * 3. After unlock_ms, decrypt using Seal key servers
 */

let sealClient: SealClient | null = null;

// Seal key server object IDs for testnet
const SEAL_SERVER_OBJECT_IDS = [
  '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
];

// Initialize Seal client
export const initSealClient = (suiClient: SuiClient): SealClient => {
  if (!sealClient) {
    sealClient = new SealClient({
      suiClient,
      serverConfigs: SEAL_SERVER_OBJECT_IDS.map((id) => ({
        objectId: id,
        weight: 1,
      })),
      verifyKeyServers: false, // Set to true in production
    });
  }
  return sealClient;
};

// Get Seal client instance
export const getSealClient = (): SealClient | null => sealClient;

// Build Seal identity from unlock timestamp
// Identity format for timelock: package_id + bcs(unlock_ms)
export const buildSealIdentity = (unlockMs: bigint): string => {
  const packageIdBytes = hexToBytes(CONTRACT_CONFIG.PACKAGE_ID);
  const unlockMsBytes = bcs.u64().serialize(unlockMs).toBytes();
  
  const identity = new Uint8Array(packageIdBytes.length + unlockMsBytes.length);
  identity.set(packageIdBytes, 0);
  identity.set(unlockMsBytes, packageIdBytes.length);
  
  return bytesToHex(identity);
};

/**
 * Encrypt data using Seal time-lock encryption
 * 
 * @param data - Data to encrypt
 * @param unlockMs - Timestamp when decryption becomes available
 * @returns Encrypted data bytes
 */
export const encryptWithSeal = async (
  data: Uint8Array,
  unlockMs: bigint
): Promise<Uint8Array> => {
  if (!sealClient) {
    throw new Error('Seal client not initialized. Call initSealClient first.');
  }

  const identity = buildSealIdentity(unlockMs);
  
  try {
    const { encryptedObject } = await sealClient.encrypt({
      threshold: 2, // Require 2 of 3 key servers
      packageId: CONTRACT_CONFIG.PACKAGE_ID,
      id: identity,
      data,
    });

    return encryptedObject;
  } catch (error) {
    console.error('Seal encryption error:', error);
    throw error;
  }
};

/**
 * Decrypt data using Seal
 * 
 * This will only succeed after unlock_ms has passed.
 * The Seal key servers verify the time condition via seal_approve.
 * 
 * @param encryptedData - Encrypted data from Seal
 * @param sessionKey - Session key for decryption
 * @param txBytes - Transaction bytes for verification
 */
export const decryptWithSeal = async (
  encryptedData: Uint8Array,
  sessionKey: SessionKey,
  txBytes: Uint8Array,
): Promise<Uint8Array> => {
  if (!sealClient) {
    throw new Error('Seal client not initialized. Call initSealClient first.');
  }

  try {
    const decryptedData = await sealClient.decrypt({
      data: encryptedData,
      sessionKey,
      txBytes,
    });

    return decryptedData;
  } catch (error) {
    console.error('Seal decryption error:', error);
    throw error;
  }
};

/**
 * Create a session key for decryption
 * Requires user to sign a personal message
 */
export const createSessionKey = async (
  address: string,
  suiClient: SuiClient,
  signPersonalMessage: (message: Uint8Array) => Promise<{ signature: string }>,
  packageId: string = CONTRACT_CONFIG.PACKAGE_ID
): Promise<SessionKey> => {
  const sessionKey = await SessionKey.create({
    address,
    packageId,
    ttlMin: 10, // 10 minutes TTL
    suiClient,
  });

  // Get the message to sign
  const message = sessionKey.getPersonalMessage();
  
  // User signs the message
  const { signature } = await signPersonalMessage(message);
  
  // Set the signature to complete initialization
  sessionKey.setPersonalMessageSignature(signature);

  return sessionKey;
};

/**
 * Build transaction for Seal decryption approval
 * This calls the seal_approve function in our contract
 */
export const buildSealApproveTx = (
  gameId: string,
  identity: string,
): Transaction => {
  const tx = new Transaction();
  
  tx.moveCall({
    target: `${CONTRACT_CONFIG.PACKAGE_ID}::${CONTRACT_CONFIG.MODULE_NAME}::seal_approve`,
    arguments: [
      tx.pure.vector('u8', Array.from(fromHex(identity))),
      tx.object(gameId),
      tx.object('0x6'), // Clock
    ],
  });

  return tx;
};

/**
 * Fetch and decrypt winner data from encrypted blob
 */
export const fetchAndDecryptWinner = async (
  encryptedData: Uint8Array,
  gameId: string,
  unlockMs: bigint,
  sessionKey: SessionKey,
  suiClient: SuiClient,
): Promise<string | null> => {
  try {
    // Initialize Seal client if needed
    initSealClient(suiClient);

    // Check if we can decrypt (time has passed)
    if (BigInt(Date.now()) < unlockMs) {
      console.log('Cannot decrypt yet - timelock not expired');
      return null;
    }

    // Build approval transaction
    const identity = buildSealIdentity(unlockMs);
    const tx = buildSealApproveTx(gameId, identity);
    const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

    // Decrypt
    const decryptedData = await decryptWithSeal(encryptedData, sessionKey, txBytes);
    
    // Parse winner data
    const jsonStr = new TextDecoder().decode(decryptedData);
    const data = JSON.parse(jsonStr);
    
    return data.winner;
  } catch (error) {
    console.error('Error fetching/decrypting winner:', error);
    return null;
  }
};

/**
 * Check if decryption is available (time-lock expired)
 */
export const canDecrypt = (unlockMs: bigint): boolean => {
  return BigInt(Date.now()) >= unlockMs;
};

/**
 * Parse encrypted object to get metadata
 */
export const parseEncryptedObject = (encryptedBytes: Uint8Array) => {
  return EncryptedObject.parse(encryptedBytes);
};

// Helper functions
const hexToBytes = (hex: string): Uint8Array => {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  // Pad to 64 characters (32 bytes) if needed
  const paddedHex = cleanHex.padStart(64, '0');
  const bytes = new Uint8Array(paddedHex.length / 2);
  for (let i = 0; i < paddedHex.length; i += 2) {
    bytes[i / 2] = parseInt(paddedHex.substring(i, i + 2), 16);
  }
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};
