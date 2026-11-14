import { defineConfig } from 'drizzle-kit';

/** Só gera SQL a partir do esquema; não abre banco. Ver docs/modelo-de-dados.md. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
});
