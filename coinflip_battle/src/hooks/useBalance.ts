import { useSuiClientQuery } from '@mysten/dapp-kit';
import { useCurrentAccount } from '@mysten/dapp-kit';

export function useBalance() {
  const currentAccount = useCurrentAccount();

  const { data: balanceData, isPending, error } = useSuiClientQuery(
    'getBalance',
    {
      owner: currentAccount?.address || '',
    },
    {
      enabled: !!currentAccount,
    }
  );

  const balance = balanceData?.totalBalance || '0';

  return {
    balance,
    isPending,
    error,
    hasBalance: !!currentAccount && parseInt(balance) > 0,
  };
}