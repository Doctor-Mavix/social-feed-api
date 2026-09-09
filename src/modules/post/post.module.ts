import { TOKENS } from '@core/container/tokens';
import { mongoConnectionOf } from '@core/database';
import { ConfigurationError } from '@core/errors/app-error';
import type { AppModule } from '@core/module';
import { PROFILE_REPOSITORY } from '@modules/profile/profile.repository';
import { LikeCounter } from './like-counter';
import { LIKE_REPOSITORY } from './like.repository';
import { MongoLikeRepository } from './mongo/like.mongo.repository';
import { MongoPostRepository } from './mongo/post.mongo.repository';
import { AuthorPostsController, PostController } from './post.controller';
import { POST_REPOSITORY } from './post.repository';

export const postModule: AppModule = {
  name: 'post',
  controllers: [PostController, AuthorPostsController],
  register({ container, adapter }) {
    if (!container.isRegistered(PROFILE_REPOSITORY, true)) {
      throw new ConfigurationError(
        'The post module needs the profile module — add "profile" to MODULES_ENABLED.',
      );
    }

    const connection = mongoConnectionOf(adapter);

    container.registerInstance(POST_REPOSITORY, new MongoPostRepository(connection));
    container.registerInstance(LIKE_REPOSITORY, new MongoLikeRepository(connection));
    container.registerInstance(LikeCounter, new LikeCounter(container.resolve(TOKENS.Redis)));
  },
};
