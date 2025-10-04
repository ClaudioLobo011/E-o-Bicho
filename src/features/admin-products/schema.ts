import { z } from 'zod';

export const adminProductSchema = z.object({
  id: z.string().min(3, 'Informe o identificador'),
  name: z.string().min(3, 'Informe o nome do produto'),
  category: z.string().min(2, 'Informe a categoria'),
  brand: z.string().min(2, 'Informe a marca'),
  price: z.number().positive('Preço deve ser positivo'),
  promotionalPrice: z.number().optional(),
  stock: z.number().int().nonnegative('Estoque não pode ser negativo')
});

export type AdminProductForm = z.infer<typeof adminProductSchema>;
