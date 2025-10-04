export type UserRole = 'cliente' | 'admin' | 'manager' | 'staff';

export interface Address {
  street: string;
  number: string;
  complement?: string;
  district: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  cpf?: string;
  cnpj?: string;
  phone?: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  address?: Address;
}

export interface SessionUser extends User {
  token: string;
}
