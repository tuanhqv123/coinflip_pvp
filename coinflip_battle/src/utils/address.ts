/**
 * Shorten a wallet address for display
 * @param address - The full wallet address
 * @param startChars - Number of characters to show at the start (default: 6)
 * @param endChars - Number of characters to show at the end (default: 4)
 * @returns Shortened address format
 */
export const shortenAddress = (
  address: string | undefined | null,
  startChars: number = 6,
  endChars: number = 4
): string => {
  if (!address) return 'Not connected';

  if (address.length <= startChars + endChars) {
    return address;
  }

  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
};

/**
 * Format balance from MIST to SUI
 * @param balance - Balance in MIST (smallest unit)
 * @returns Formatted balance string
 */
export const formatBalance = (balance: number | string | undefined): string => {
  if (!balance) return '0.0000';

  const balanceNum = typeof balance === 'string' ? parseFloat(balance) : balance;
  const suiBalance = balanceNum / 1000000000; // Convert MIST to SUI

  return suiBalance.toFixed(4);
};

/**
 * Validate if a string is a valid Sui address
 * @param address - Address to validate
 * @returns Boolean indicating if address is valid
 */
export const isValidSuiAddress = (address: string): boolean => {
  if (!address || typeof address !== 'string') return false;

  // Sui addresses start with '0x' and are 66 characters long (including 0x)
  return /^0x[a-fA-F0-9]{64}$/.test(address);
};