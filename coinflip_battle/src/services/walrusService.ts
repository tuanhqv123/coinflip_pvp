import { CONTRACT_CONFIG } from '../config/constants';
import type { EncryptedWinnerData } from '../types/game';

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
    console.error('Walrus fetch error:', error);
    throw error;
  }
};

// Convert blob ID string to bytes (for storing on-chain)
export const blobIdToBytes = (blobId: string): Uint8Array => {
  // Walrus blob IDs are base64 encoded
  // Try base64 first, then hex
  try {
    // Check if it's hex (starts with 0x or all hex chars)
    if (blobId.startsWith('0x') || /^[0-9a-fA-F]+$/.test(blobId)) {
      const hex = blobId.startsWith('0x') ? blobId.slice(2) : blobId;
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
      }
      return bytes;
    }
    
    // Otherwise treat as base64
    const binaryString = atob(blobId);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch {
    // Fallback: encode as UTF-8
    return new TextEncoder().encode(blobId);
  }
};

// Convert bytes to blob ID string
export const bytesToBlobId = (bytes: Uint8Array): string => {
  // Convert to base64
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
};

// Encode winner data to bytes (before encryption)
export const encodeWinnerData = (data: EncryptedWinnerData): Uint8Array => {
  const json = JSON.stringify(data);
  return new TextEncoder().encode(json);
};

// Decode winner data from bytes (after decryption)
export const decodeWinnerData = (bytes: Uint8Array): EncryptedWinnerData => {
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
