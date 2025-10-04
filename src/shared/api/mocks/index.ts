import { AxiosRequestConfig } from 'axios';
import { productsMock } from './products';
import { authMock } from './sessions';
import { accountMock } from './account';
import { cartMock } from './cart';
import { ordersMock } from './orders';
import { fiscalDocumentsMock } from './fiscal-documents';
import { bannersMock } from './banners';

interface MockHandler {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  test: (url: string) => boolean;
  handler: (config: AxiosRequestConfig) => Promise<unknown> | unknown;
}

export const mockHandlers: MockHandler[] = [
  ...authMock,
  ...productsMock,
  ...accountMock,
  ...cartMock,
  ...ordersMock,
  ...fiscalDocumentsMock,
  ...bannersMock
];
