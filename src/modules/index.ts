import type { AppModule } from '@core/module';
import { notificationModule } from '@shared/notifications/notification.module';
import { authModule } from './auth/auth.module';
import { commentModule } from './comment/comment.module';
import { feedModule } from './feed/feed.module';
import { followModule } from './follow/follow.module';
import { healthModule } from './health/health.module';
import { postModule } from './post/post.module';
import { profileModule } from './profile/profile.module';

/**
 * Registration order matters: a module resolves the tokens of the ones before it. Profiles
 * come first because everything else in this application is attached to one, and the feed
 * comes last because it reads both the graph and the posts.
 */
export const APP_MODULES: readonly AppModule[] = [
  healthModule,
  notificationModule,
  authModule,
  profileModule,
  followModule,
  postModule,
  commentModule,
  feedModule,
];
