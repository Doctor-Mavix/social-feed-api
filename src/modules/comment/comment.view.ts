import type { AuthorView } from '@modules/profile/profile.view';
import type { Comment } from './comment.types';

export interface CommentView {
  id: string;
  postId: string;
  text: string;
  author: AuthorView;
  createdAt: string;
}

export function toCommentView(comment: Comment, author: AuthorView): CommentView {
  return {
    id: comment.id,
    postId: comment.postId,
    text: comment.text,
    author,
    createdAt: comment.createdAt.toISOString(),
  };
}
