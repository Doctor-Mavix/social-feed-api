import { ConfigurationError } from '@core/errors/app-error';
import type { AppModule } from '@core/module';
import { FOLLOW_REPOSITORY } from '@modules/follow/follow.repository';
import { POST_REPOSITORY } from '@modules/post/post.repository';
import { FeedController } from './feed.controller';

/**
 * The feed owns no storage: it is a read over the graph and the posts. It registers nothing,
 * only checks that the two modules it reads are there — otherwise the failure would be a
 * resolution error on the first request instead of a clear one at boot.
 */
export const feedModule: AppModule = {
  name: 'feed',
  controllers: [FeedController],
  register({ container }) {
    const missing = [
      container.isRegistered(POST_REPOSITORY, true) ? null : 'post',
      container.isRegistered(FOLLOW_REPOSITORY, true) ? null : 'follow',
    ].filter((name): name is string => name !== null);

    if (missing.length > 0) {
      throw new ConfigurationError(
        `The feed module needs ${missing.join(' and ')} — add them to MODULES_ENABLED.`,
      );
    }
  },
};
