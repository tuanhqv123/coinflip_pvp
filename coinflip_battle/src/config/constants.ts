// Contract Configuration
// Update these after deploying the contract

export const CONTRACT_CONFIG = {
  // Package ID - DEPLOYED TO TESTNET (v3 with on-chain randomness and multiple winners)
  PACKAGE_ID: '0xa19bd42ca1944981462dc9da0b2445be899f12d360c8a3881186a7c68ff84aef',
  
  // Module name
  MODULE_NAME: 'game',
  
  // Network
  NETWORK: 'testnet' as const,
  
  // Walrus Configuration (Testnet) - Using proxy to avoid CORS
  // Docs: https://docs.walrus.site/
  WALRUS_PUBLISHER_URL: import.meta.env.DEV ? '/walrus-publisher' : 'https://publisher.walrus-testnet.walrus.space',
  WALRUS_AGGREGATOR_URL: import.meta.env.DEV ? '/walrus-aggregator' : 'https://aggregator.walrus-testnet.walrus.space',
  
  // Lock duration in milliseconds (must match contract: 5 seconds)
  LOCK_DURATION_MS: 5000,
  
  // Minimum stake in MIST (0.001 SUI = 1,000,000 MIST)
  MIN_STAKE_MIST: 1000000,
  
  // Backend event listener (set to true for automatic processing)
  BACKEND_ENABLED: true,
};

// System object IDs on Sui
export const CLOCK_ID = '0x6';
export const RANDOM_ID = '0x8'; // Random object for on-chain randomness

// Game status enum
export enum GameStatus {
  WAITING = 'waiting',    // Waiting for players
  FULL = 'full',          // Room full, waiting for backend
  FLIPPING = 'flipping',  // Coin is flipping (during timelock)
  COMPLETED = 'completed', // Game finished
}

// Seal Key Servers for Testnet
// These are the official Seal key server object IDs
export const SEAL_KEY_SERVERS = {
  testnet: [
    '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
    '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
  ],
};

// Instructions for deployment
export const DEPLOYMENT_INSTRUCTIONS = `
=== DEPLOYMENT INSTRUCTIONS ===

1. Deploy the Move contract:
   cd coinflip_battle_move
   sui move publish --gas-budget 100000000

2. Copy the Package ID from the output and update PACKAGE_ID above

3. Fund the backend wallet (optional, for auto-processing):
   - Get testnet SUI from faucet: https://faucet.testnet.sui.io/
   - Send to the backend wallet address shown in the app

4. Set BACKEND_ENABLED to true if using auto-processing

5. Test the flow:
   - Connect wallet
   - Create a room
   - Have another wallet join
   - Watch the coin flip animation
   - Winner claims reward

=== SEAL + WALRUS INTEGRATION ===

The game uses:
- Seal: Time-locked encryption for winner data
- Walrus: Decentralized storage for encrypted winner blob

Flow:
1. Room fills up → unlock_ms set (now + 5s)
2. Backend picks winner → encrypts with Seal → uploads to Walrus
3. During 5s locktime: UI shows flipping, no one can decrypt
4. After unlock: Winner decrypts from Walrus, claims reward

=== MANUAL TESTING ===

If BACKEND_ENABLED is false, you can manually process games:
1. Create a room with wallet A
2. Join with wallet B
3. In browser console:
   import { manualProcessGame } from './services/backendService';
   await manualProcessGame(suiClient, gameId);
4. Wait for unlock, winner claims
`;
