import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import { Banner } from '../../entities/banner';

interface BannersResponse {
  data: Banner[];
}

export function useBannersQuery() {
  return useQuery<BannersResponse>({
    queryKey: ['banners'],
    queryFn: () => apiGet('/banners')
  });
}
