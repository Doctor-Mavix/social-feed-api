export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewComment {
  id: string;
  postId: string;
  authorId: string;
  text: string;
}
