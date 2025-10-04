import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import { Banner } from '../../entities/banner';
import { LegacyBanner, normalizeBannersResponse } from '../../shared/api/transformers/banner';

interface BannersResponse {
  data: Banner[];
}

export function useBannersQuery() {
  return useQuery<BannersResponse>({
    queryKey: ['banners'],
    queryFn: async () => {
      const response = await apiGet<BannersResponse | LegacyBanner[]>('/banners');

      if ('data' in (response as BannersResponse) && Array.isArray((response as BannersResponse).data)) {
        return response as BannersResponse;
      }

      return { data: normalizeBannersResponse(response) } satisfies BannersResponse;
    }
  });
}
