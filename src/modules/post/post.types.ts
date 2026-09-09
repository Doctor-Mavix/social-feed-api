export interface Post {
  id: string;
  authorId: string;
  text: string;
  /** Media kit ids, in the order the author uploaded them. */
  imageIds: string[];
  /**
   * The durable copy of the like count. Redis holds the hot one; this is what Redis is rebuilt
   * from when a key expires or the server is replaced.
   */
  likeCount: number;
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewPost {
  id: string;
  authorId: string;
  text: string;
}

export interface PostCounterDelta {
  likeCount?: number;
  commentCount?: number;
}
