import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount, useSuiClient, useSignPersonalMessage } from '@mysten/dapp-kit';
import { SessionKey } from '@mysten/seal';
import { CONTRACT_CONFIG } from '../config/constants';
import { initSealClient } from '../services/sealService';

interface UseSealSessionReturn {
  sessionKey: SessionKey | null;
  isCreating: boolean;
  error: string | null;
  createSessionKey: () => Promise<SessionKey | null>;
  clearSessionKey: () => void;
}

export const useSealSession = (): UseSealSessionReturn => {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const [sessionKey, setSessionKey] = useState<SessionKey | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  
  // Clear session key when account changes
  useEffect(() => {
    if (!currentAccount) {
      clearSessionKey();
    }
  }, [currentAccount]);

  const createSessionKey = useCallback(async (): Promise<SessionKey | null> => {
    if (!currentAccount) {
      setError('Please connect your wallet first');
      return null;
    }

    setIsCreating(true);
    setError(null);

    try {
      // Initialize Seal client
      initSealClient(suiClient);

      // Create new session key
      const newSessionKey = await SessionKey.create({
        address: currentAccount.address,
        packageId: CONTRACT_CONFIG.PACKAGE_ID,
        ttlMin: 30, // 10 minutes TTL
        suiClient,
      });

      // Get the message to sign
      const message = newSessionKey.getPersonalMessage();

      // Use dApp-kit's signPersonalMessage
      let signature: string;
      try {
        const result = await signPersonalMessage({
          message: new Uint8Array(message),
        });

        signature = result.signature;

        // Set the signature to complete initialization
        newSessionKey.setPersonalMessageSignature(signature);
      } catch (err: any) {
        if (err.message?.includes('rejected') || err.code === 4001) {
          throw new Error('User rejected signature');
        }
        throw err;
      }

      // Save to state
      setSessionKey(newSessionKey);

      console.log('Seal session key created successfully');
      return newSessionKey;
    } catch (err: any) {
      console.error('Failed to create session key:', err);
      setError(err.message || 'Failed to create session key');
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [currentAccount, suiClient]);

  const clearSessionKey = useCallback(() => {
    setSessionKey(null);
    setError(null);
  }, []);

  return {
    sessionKey,
    isCreating,
    error,
    createSessionKey,
    clearSessionKey,
  };
};