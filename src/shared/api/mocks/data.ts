import { Product } from '../../../entities/product';
import { SessionUser, User } from '../../../entities/user';
import { Order } from '../../../entities/order';

export const products: Product[] = [
  {
    id: 'racao-premium-01',
    name: 'Ração Premium para Cães Adultos 10kg',
    description:
      'Alimento completo e balanceado com proteínas selecionadas, fibras naturais e complexo vitamínico para cães adultos de raças médias.',
    price: 189.9,
    promotionalPrice: 159.9,
    images: ['/images/products/racao-premium-01.jpg'],
    category: 'Ração',
    brand: 'E o Bicho Nutrition',
    rating: 4.8,
    stock: 34,
    highlights: ['Entrega em 24h', 'Assinatura com 15% OFF'],
    isFeatured: true,
    clubPrice: 154.9,
    discountPercentage: 16
  },
  {
    id: 'areia-granulada-01',
    name: 'Areia Sanitária Granulada 12kg',
    description:
      'Areia sanitária de alta absorção com controle de odores e grãos macios que não machucam as patinhas.',
    price: 74.5,
    promotionalPrice: 69.9,
    images: ['/images/products/areia-granulada-01.jpg'],
    category: 'Higiene',
    brand: 'CleanPet',
    rating: 4.6,
    stock: 87,
    highlights: ['Fórmula hipoalergênica'],
    isFeatured: true
  },
  {
    id: 'pet-bed-fofinho-01',
    name: 'Cama Ergonômica Fofinho Plus',
    description:
      'Cama com espuma viscoelástica, capa lavável e base antiderrapante. Ideal para cães e gatos de pequeno porte.',
    price: 229.0,
    images: ['/images/products/pet-bed-fofinho-01.jpg'],
    category: 'Camas',
    brand: 'CozyPets',
    rating: 4.9,
    stock: 12,
    highlights: ['Capa impermeável', 'Espuma com memória'],
    isFeatured: true
  },
  {
    id: 'brinquedo-interativo-01',
    name: 'Brinquedo Interativo Inteligência Canina',
    description:
      'Brinquedo com labirinto para petiscos que estimula o olfato, reduz a ansiedade e fortalece a cognição do pet.',
    price: 119.9,
    images: ['/images/products/brinquedo-interativo-01.jpg'],
    category: 'Brinquedos',
    brand: 'FunMind',
    rating: 4.7,
    stock: 53,
    highlights: ['Material atóxico', 'Indicado por adestradores'],
    isFeatured: true
  },
  {
    id: 'suplemento-omega-01',
    name: 'Suplemento Ômega 3 Ultra 60 cápsulas',
    description:
      'Suplemento com DHA e EPA purificados para suporte à pele, pelagem e articulações de cães e gatos.',
    price: 96.9,
    images: ['/images/products/suplemento-omega-01.jpg'],
    category: 'Saúde',
    brand: 'VitalPet',
    rating: 4.5,
    stock: 42,
    highlights: ['Certificado IFOS'],
    isFeatured: true,
    conditionalPromotionLabel: 'Leve 3 Pague 2'
  }
];

const baseUsers: User[] = [
  {
    id: 'user-julia-souza',
    firstName: 'Júlia',
    lastName: 'Souza',
    email: 'julia.souza@cliente.com',
    cpf: '111.222.333-44',
    phone: '+55 11 99888-7766',
    role: 'cliente',
    createdAt: '2023-02-12T08:30:00Z',
    updatedAt: '2024-08-21T15:15:00Z',
    address: {
      street: 'Rua das Acácias',
      number: '120',
      complement: 'Apto 42',
      district: 'Jardim Primavera',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '04567-080'
    }
  },
  {
    id: 'admin-fernando-melo',
    firstName: 'Fernando',
    lastName: 'Melo',
    email: 'fernando.melo@eobicho.com.br',
    cpf: '222.333.444-55',
    role: 'admin',
    createdAt: '2021-09-04T10:00:00Z',
    updatedAt: '2024-10-02T09:45:00Z'
  }
];

export const usersWithSessions: SessionUser[] = [
  {
    ...baseUsers[0],
    token: 'token-cliente-julia'
  },
  {
    ...baseUsers[1],
    token: 'token-admin-fernando'
  }
];

// Chaves fiscais de exemplo extraídas das publicações oficiais de ambientes de homologação
// informadas nas notas técnicas da NFC-e/NF-e/NFS-e das Secretarias da Fazenda do PR e SP.
// Fontes:
// - Nota Técnica 2023.003 - NFC-e (SEFAZ/PR)
// - Ambiente de Homologação NF-e 4.0 (SEFAZ/RS)
// - Manual de Integração NFS-e (Prefeitura de São Paulo)
export const orders: Order[] = [
  {
    id: 'pedido-001',
    createdAt: '2024-09-15T14:30:00Z',
    updatedAt: '2024-09-16T11:20:00Z',
    status: 'entregue',
    paymentMethod: 'pix',
    total: 259.8,
    nfce: '41230689340586000167650010000000031000000038',
    nfe: '43220506012312000190650010000000081500000080',
    nfse: '35220530253013000124550010000012341000012345',
    items: [
      {
        productId: 'racao-premium-01',
        quantity: 1,
        subscription: true,
        product: products[0]
      },
      {
        productId: 'brinquedo-interativo-01',
        quantity: 1,
        product: products[3]
      }
    ]
  }
];
