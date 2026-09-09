import { mongoConnectionOf } from '@core/database';
import { ConfigurationError } from '@core/errors/app-error';
import type { AppModule } from '@core/module';
import { PROFILE_REPOSITORY } from '@modules/profile/profile.repository';
import { SHARED_TOKENS } from '@shared/tokens';
import { MongoFollowRepository } from './mongo/follow.mongo.repository';
import { FollowController } from './follow.controller';
import { FOLLOW_REPOSITORY } from './follow.repository';
import { FollowRoomSource } from './follow.rooms';

export const followModule: AppModule = {
  name: 'follow',
  controllers: [FollowController],
  register({ container, adapter }) {
    if (!container.isRegistered(PROFILE_REPOSITORY, true)) {
      throw new ConfigurationError(
        'The follow module needs the profile module — add "profile" to MODULES_ENABLED.',
      );
    }

    container.registerInstance(
      FOLLOW_REPOSITORY,
      new MongoFollowRepository(mongoConnectionOf(adapter)),
    );

    // The realtime kit reads this token lazily at each handshake, so registering it here is
    // enough — the gateway was built before this module existed.
    container.register(SHARED_TOKENS.SocketRooms, { useClass: FollowRoomSource });
  },
};
