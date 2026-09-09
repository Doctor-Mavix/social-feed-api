import type { Media, MediaStatus, MediaVariants } from './media.types';

export interface NewMedia {
  id: string;
  ownerType: string;
  ownerId: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
}

export interface MediaRepository {
  create(data: NewMedia): Promise<Media>;
  findById(id: string): Promise<Media | null>;
  /** For a list view: a feed page carrying four images per row must not issue eighty reads. */
  findManyByIds(ids: readonly string[]): Promise<Media[]>;
  listForOwner(ownerType: string, ownerId: string): Promise<Media[]>;
  /** Written by the processing job when it finishes, or fails. */
  setVariants(id: string, status: MediaStatus, variants: MediaVariants): Promise<Media | null>;
  remove(id: string): Promise<boolean>;
}
