import { Banner } from '../../../entities/banner';

export interface LegacyBanner {
  _id?: string;
  id?: string;
  title?: string;
  subtitle?: string;
  buttonText?: string;
  link?: string;
  imageUrl?: string;
  imagem?: string;
  description?: string;
}

function generateBannerId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `banner-${Math.random().toString(36).slice(2, 11)}`;
}

function resolveImage(path?: string): string {
  if (!path) {
    return 'https://placehold.co/1400x600?text=Banner';
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return path.startsWith('/') ? path : `/${path}`;
}

export function mapBannerFromApi(payload: LegacyBanner): Banner {
  return {
    id: payload._id ?? payload.id ?? generateBannerId(),
    title: payload.title ?? 'Campanha',
    subtitle: payload.subtitle,
    buttonText: payload.buttonText,
    imageUrl: resolveImage(payload.imageUrl ?? payload.imagem),
    link: payload.link ?? '#',
    description: payload.description
  };
}

export function normalizeBannersResponse(response: unknown): Banner[] {
  if (!response) {
    return [];
  }

  if (Array.isArray(response)) {
    return response.map((item) => mapBannerFromApi(item as LegacyBanner));
  }

  if (typeof response === 'object' && 'data' in (response as Record<string, unknown>)) {
    const data = (response as { data: unknown }).data;
    if (Array.isArray(data)) {
      return data.map((item) => mapBannerFromApi(item as LegacyBanner));
    }
  }

  return [];
}
