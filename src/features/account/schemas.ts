import { z } from 'zod';

export const accountSchema = z.object({
  firstName: z.string().min(2, 'Informe o nome'),
  lastName: z.string().min(2, 'Informe o sobrenome'),
  email: z.string().email('Informe um e-mail válido'),
  cpf: z
    .string()
    .optional()
    .refine((value) => !value || /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(value), {
      message: 'Use o formato 000.000.000-00'
    }),
  phone: z
    .string()
    .optional()
    .refine((value) => !value || /^\+?\d[\d\s()-]{8,}$/.test(value), {
      message: 'Informe um telefone válido'
    }),
  address: z
    .object({
      street: z.string().min(3, 'Informe a rua'),
      number: z.string().min(1, 'Informe o número'),
      complement: z.string().optional(),
      district: z.string().min(3, 'Informe o bairro'),
      city: z.string().min(3, 'Informe a cidade'),
      state: z.string().length(2, 'UF'),
      zipCode: z
        .string()
        .min(8, 'Informe o CEP')
        .refine((value) => /^\d{5}-?\d{3}$/.test(value), { message: 'Use o formato 00000-000' })
    })
    .optional()
});

export type AccountFormValues = z.infer<typeof accountSchema>;
