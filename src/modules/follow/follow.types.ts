export interface Follow {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: Date;
}

export interface NewFollow {
  id: string;
  followerId: string;
  followingId: string;
}
