import type { AuthorView } from '@modules/profile/profile.view';
import type { Post } from './post.types';

export interface PostView {
  id: string;
  text: string;
  author: AuthorView;
  images: Record<string, string>[];
  likeCount: number;
  commentCount: number;
  /** Null for an anonymous reader: "not liked" and "we do not know" are not the same thing. */
  liked: boolean | null;
  createdAt: string;
}

export function toPostView(
  post: Post,
  author: AuthorView,
  images: Record<string, string>[],
  likeCount: number,
  liked: boolean | null,
): PostView {
  return {
    id: post.id,
    text: post.text,
    author,
    images,
    likeCount,
    commentCount: post.commentCount,
    liked,
    createdAt: post.createdAt.toISOString(),
  };
}
