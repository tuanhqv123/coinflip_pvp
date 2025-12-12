// Contract Configuration
// Update these after deploying the contract

export const CONTRACT_CONFIG = {
  // Package ID - DEPLOYED TO TESTNET (v2 with player_sides)
  PACKAGE_ID: '0x6d8cd865567867325fd627b945690d2e65f6f4a3ae089be012aa4eac75588aa5',
  
  // Module name
  MODULE_NAME: 'game',
  
  // Network
  NETWORK: 'testnet' as const,
  
  // Walrus Configuration (Testnet)
  // Docs: https://docs.walrus.site/
  WALRUS_PUBLISHER_URL: 'https://publisher.walrus-testnet.walrus.space',
  WALRUS_AGGREGATOR_URL: 'https://aggregator.walrus-testnet.walrus.space',
  
  // Lock duration in milliseconds (must match contract: 5 seconds)
  LOCK_DURATION_MS: 5000,
  
  // Minimum stake in MIST (0.001 SUI = 1,000,000 MIST)
  MIN_STAKE_MIST: 1000000,
  
  // Backend event listener (set to false - using App.tsx processing instead)
  BACKEND_ENABLED: false,
};

// Clock object ID (shared system object on Sui)
export const CLOCK_ID = '0x6';

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
