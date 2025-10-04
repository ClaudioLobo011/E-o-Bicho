import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../../shared/api/client';
import { SessionUser } from '../../entities/user';
import { AccountFormValues } from './schemas';

export function useAccountQuery() {
  return useQuery<SessionUser>({
    queryKey: ['account', 'me'],
    queryFn: () => apiGet('/account/me')
  });
}

export function useUpdateAccount() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (payload: AccountFormValues) => apiPut('/account/me', payload),
    onSuccess: (data) => {
      client.setQueryData(['account', 'me'], data);
    }
  });
}
