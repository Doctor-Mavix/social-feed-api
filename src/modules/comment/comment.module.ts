import { mongoConnectionOf } from '@core/database';
import { ConfigurationError } from '@core/errors/app-error';
import type { AppModule } from '@core/module';
import { POST_REPOSITORY } from '@modules/post/post.repository';
import { COMMENT_REPOSITORY } from './comment.repository';
import { CommentAdminController, CommentController } from './comment.controller';
import { MongoCommentRepository } from './mongo/comment.mongo.repository';

export const commentModule: AppModule = {
  name: 'comment',
  controllers: [CommentController, CommentAdminController],
  register({ container, adapter }) {
    if (!container.isRegistered(POST_REPOSITORY, true)) {
      throw new ConfigurationError(
        'The comment module needs the post module — add "post" to MODULES_ENABLED.',
      );
    }

    container.registerInstance(
      COMMENT_REPOSITORY,
      new MongoCommentRepository(mongoConnectionOf(adapter)),
    );
  },
};
