import { Banner } from '../../../entities/banner';

const banners: Banner[] = [
  {
    id: 'banner-assinatura',
    title: 'Clube Assinatura - 15% OFF + entrega programada',
    imageUrl: 'https://images.unsplash.com/photo-1619983081593-ec60bb0feb84?auto=format&fit=crop&w=1400&q=80',
    link: '/produtos'
  },
  {
    id: 'banner-banho-tosa',
    title: 'Banho & Tosa: agenda online com especialistas',
    imageUrl: 'https://images.unsplash.com/photo-1601758125946-6ec2e7c0e98d?auto=format&fit=crop&w=1400&q=80',
    link: '/ajuda'
  },
  {
    id: 'banner-nfce',
    title: 'Emissão de NFC-e homologada em todo o Brasil',
    imageUrl: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1400&q=80',
    link: '/admin/finance'
  },
  {
    id: 'banner-planos',
    title: 'Planos de saúde veterinária com cobertura nacional',
    imageUrl: 'https://images.unsplash.com/photo-1522276498395-f4f68f7f8453?auto=format&fit=crop&w=1400&q=80',
    link: '/conta/meus-dados'
  },
  {
    id: 'banner-delivery',
    title: 'Entrega expressa em até 2h para São Paulo e Rio',
    imageUrl: 'https://images.unsplash.com/photo-1612536069070-95e1d7860be5?auto=format&fit=crop&w=1400&q=80',
    link: '/nossas-lojas'
  }
];

export const bannersMock = [
  {
    method: 'GET' as const,
    test: (url: string) => url === '/banners',
    handler: async () => ({ data: banners })
  }
];
