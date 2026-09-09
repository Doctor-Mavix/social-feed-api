import type { Profile } from './profile.types';

/**
 * What a profile looks like on the wire. Kept apart from the controller because the post,
 * comment and feed modules all embed an author, and three divergent shapes for the same thing
 * is how a client ends up with three code paths to render one avatar.
 */
export interface ProfileView {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  avatar: Record<string, string> | null;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: string;
}

/** The subset embedded next to a post or a comment: enough to render a byline, nothing more. */
export interface AuthorView {
  id: string;
  handle: string;
  displayName: string;
  avatar: Record<string, string> | null;
}

export function toProfileView(
  profile: Profile,
  avatar: Record<string, string> | null,
): ProfileView {
  return {
    id: profile.id,
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    location: profile.location,
    website: profile.website,
    avatar,
    followerCount: profile.followerCount,
    followingCount: profile.followingCount,
    postCount: profile.postCount,
    createdAt: profile.createdAt.toISOString(),
  };
}

export function toAuthorView(
  profile: Profile | undefined,
  authorId: string,
  avatar: Record<string, string> | null = null,
): AuthorView {
  // A post whose author deleted their profile still has to render: a missing byline is a
  // broken page, an "unknown" one is merely a sad one.
  if (profile === undefined) {
    return { id: authorId, handle: 'unknown', displayName: 'Unknown', avatar: null };
  }

  return {
    id: profile.id,
    handle: profile.handle,
    displayName: profile.displayName,
    avatar,
  };
}
