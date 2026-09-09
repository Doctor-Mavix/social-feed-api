import type { DependencyContainer } from 'tsyringe';

import { ALL_MODULES } from '@core/config/constants';
import type { DatabaseAdapter, DbProvider } from '@core/database/types';
import { ConfigurationError } from '@core/errors/app-error';
import type { Constructor } from '@core/types';

export interface ModuleRegistration {
  container: DependencyContainer;
  provider: DbProvider;
  adapter: DatabaseAdapter;
}

export interface AppModule {
  name: string;
  controllers: readonly Constructor[];
  /** Defaults to `API_PREFIX`; system modules such as health mount at the root. */
  mountPath?: string;
  /**
   * Runs once at boot, after the database is connected and before routes are mounted.
   *
   * The SQL half of the template also declared `softDeleteModels` here, because the Prisma
   * extension has to be scoped before the client is built. Mongoose states the same intent on
   * the schema itself, with `softDeletePlugin`, so a module owns its filtering instead of
   * announcing it to the bootstrap.
   */
  register?(registration: ModuleRegistration): void;
}

export function selectModules(
  modules: readonly AppModule[],
  enabled: readonly string[],
): AppModule[] {
  if (enabled.includes(ALL_MODULES)) {
    return [...modules];
  }

  const known = new Set(modules.map((module) => module.name));
  const unknown = enabled.filter((name) => !known.has(name));

  if (unknown.length > 0) {
    throw new ConfigurationError(
      `MODULES_ENABLED refers to unknown modules: ${unknown.join(', ')}. ` +
        `Known modules: ${[...known].join(', ')}.`,
    );
  }

  return modules.filter((module) => enabled.includes(module.name));
}

export function registerModules(
  modules: readonly AppModule[],
  registration: ModuleRegistration,
): void {
  for (const appModule of modules) {
    appModule.register?.(registration);
  }
}
