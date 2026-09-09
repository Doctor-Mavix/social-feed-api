import { mongoConnectionOf } from '@core/database';
import type { AppModule } from '@core/module';
import { MongoProfileRepository } from './mongo/profile.mongo.repository';
import { ProfileController } from './profile.controller';
import { PROFILE_REPOSITORY } from './profile.repository';

/**
 * Registered before every other business module, because post, comment, follow and feed all
 * resolve `ProfileService` to attach an author to what they return.
 */
export const profileModule: AppModule = {
  name: 'profile',
  controllers: [ProfileController],
  register({ container, adapter }) {
    container.registerInstance(
      PROFILE_REPOSITORY,
      new MongoProfileRepository(mongoConnectionOf(adapter)),
    );
  },
};
