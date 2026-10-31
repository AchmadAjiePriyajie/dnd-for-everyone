import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { DomainError } from './domain-error.js';

/**
 * Validasi body/param memakai runtime schema dari packages/shared, karena tipe
 * TypeScript tidak memeriksa request. Gagal → VALIDATION_FAILED dengan field pertama.
 */
export class SchemaValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const issue = result.error.issues[0];
    const field = issue?.path.length ? issue.path.join('.') : (issue?.code === 'unrecognized_keys' ? issue.keys.join(',') : '');
    throw new DomainError('VALIDATION_FAILED', 400, field ? { field } : {});
  }
}
