import { loadEnvFile } from 'node:process';

export function loadLocalEnvironment(): void {
  if (process.env.NODE_ENV === 'production') return;

  try {
    loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
