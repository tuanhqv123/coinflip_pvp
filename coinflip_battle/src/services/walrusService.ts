import { CONTRACT_CONFIG } from '../config/constants';
import type { EncryptedResultData } from '../types/game';

/**
 * Walrus Service - Upload and fetch encrypted winner data
 * 
 * Using Walrus REST API for testnet
 * Docs: https://docs.walrus.site/
 * 
 * Flow:
 * 1. Backend picks winner → encrypts with Seal → uploads to Walrus
 * 2. After unlock time → anyone can fetch and decrypt from Walrus
 */

// Upload data to Walrus using Publisher API
export const uploadToWalrus = async (data: Uint8Array): Promise<string> => {
  try {
    // Convert Uint8Array to ArrayBuffer for fetch body
    const arrayBuffer = new ArrayBuffer(data.length);
    new Uint8Array(arrayBuffer).set(data);
    
    const response = await fetch(`${CONTRACT_CONFIG.WALRUS_PUBLISHER_URL}/v1/blobs`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: arrayBuffer,
    });

    if (!response.ok) {
      throw new Error(`Walrus upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    
    // Handle different response formats
    if (result.newlyCreated) {
      return result.newlyCreated.blobObject.blobId;
    } else if (result.alreadyCertified) {
      return result.alreadyCertified.blobId;
    }
    
    throw new Error('Unexpected Walrus response format');
  } catch (error) {
    console.error('Walrus upload error:', error);
    throw error;
  }
};

// Fetch data from Walrus using Aggregator API
export const fetchFromWalrus = async (blobId: string): Promise<Uint8Array> => {
  try {
    const response = await fetch(`${CONTRACT_CONFIG.WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`);
    
    if (!response.ok) {
      throw new Error(`Walrus fetch failed: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    throw new Error('Walrus fetch failed');
  }
};

// Convert blob ID string to bytes (for storing on-chain)
export const blobIdToBytes = (blobId: string): Uint8Array => {
  // Store the blob ID as UTF-8 encoded string
  // This preserves the original blob ID format exactly
  return new TextEncoder().encode(blobId);
};

// Convert bytes to blob ID string
export const bytesToBlobId = (bytes: Uint8Array): string => {
  // The bytes stored on-chain need to be converted back to the original blob ID
  // First try to decode as UTF-8 (if it was stored as a string)
  try {
    const decoded = new TextDecoder().decode(bytes);
    // Check if it looks like a valid base64 blob ID (alphanumeric + / + = + -)
    if (/^[A-Za-z0-9+/=_-]+$/.test(decoded)) {
      return decoded;
    }
  } catch {
    // Ignore decode errors
  }
  
  // If UTF-8 decode failed or result doesn't look like base64, convert to base64
  // This handles the case where raw bytes were stored
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

// Encode result data to bytes (before encryption)
export const encodeResultData = (data: EncryptedResultData): Uint8Array => {
  const json = JSON.stringify(data);
  return new TextEncoder().encode(json);
};

// Decode result data from bytes (after decryption)
export const decodeResultData = (bytes: Uint8Array): EncryptedResultData => {
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
};

// Check if Walrus is available
export const checkWalrusHealth = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${CONTRACT_CONFIG.WALRUS_AGGREGATOR_URL}/v1/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
};
