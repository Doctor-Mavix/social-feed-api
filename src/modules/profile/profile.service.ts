import { inject, injectable } from 'tsyringe';

import { buildCursorPage, encodeCursor } from '@core/database/pagination';
import type { CursorPage, CursorQuery } from '@core/database/pagination';
import { definedOnly } from '@core/database/patch';
import { ConflictError, NotFoundError } from '@core/errors/app-error';
import type { MediaService } from '@shared/media/media.service';
import type { UploadedFile } from '@shared/media/media.service';
import { SHARED_TOKENS } from '@shared/tokens';
import { PROFILE_REPOSITORY } from './profile.repository';
import type { ProfileRepository } from './profile.repository';
import type { CreateProfileInput, UpdateProfileInput } from './profile.schemas';
import type { CounterDelta, Profile } from './profile.types';
import { toAuthorView } from './profile.view';
import type { AuthorView } from './profile.view';

/** Owner type under which avatars are filed in the media kit. */
export const AVATAR_OWNER = 'profile-avatar';

@injectable()
export class ProfileService {
  constructor(
    @inject(PROFILE_REPOSITORY) private readonly repository: ProfileRepository,
    @inject(SHARED_TOKENS.Media) private readonly media: MediaService,
  ) {}

  /**
   * A profile is created once, by its own account. Registration deliberately does not do it:
   * choosing a handle is a decision, and defaulting it from an email address produces handles
   * nobody wants and everybody has to change.
   */
  async create(actorId: string, input: CreateProfileInput): Promise<Profile> {
    const existing = await this.repository.findById(actorId);

    if (existing !== null) {
      throw new ConflictError('This account already has a profile');
    }

    return this.repository.create({
      id: actorId,
      handle: input.handle,
      displayName: input.displayName,
      bio: input.bio,
      location: input.location,
      website: input.website,
    });
  }

  async requireOwn(actorId: string): Promise<Profile> {
    const profile = await this.repository.findById(actorId);

    if (profile === null) {
      throw new NotFoundError('This account has no profile yet');
    }

    return profile;
  }

  async requireByHandle(handle: string): Promise<Profile> {
    const profile = await this.repository.findByHandle(handle);

    if (profile === null) {
      throw new NotFoundError('This profile does not exist');
    }

    return profile;
  }

  async update(actorId: string, patch: UpdateProfileInput): Promise<Profile> {
    await this.requireOwn(actorId);

    const updated = await this.repository.update(actorId, definedOnly(patch));

    if (updated === null) {
      throw new NotFoundError('This account has no profile yet');
    }

    return updated;
  }

  async setAvatar(actorId: string, file: UploadedFile): Promise<Profile> {
    const profile = await this.requireOwn(actorId);
    const uploaded = await this.media.upload(AVATAR_OWNER, actorId, file);

    if (profile.avatarMediaId !== null) {
      // Best effort: an avatar nobody can reach any more is not worth failing the request that
      // replaced it, and the row is what the profile points at.
      await this.media.remove(profile.avatarMediaId);
    }

    const updated = await this.repository.update(actorId, { avatarMediaId: uploaded.id });

    if (updated === null) {
      throw new NotFoundError('This account has no profile yet');
    }

    return updated;
  }

  async list(query: CursorQuery): Promise<CursorPage<Profile>> {
    const rows = await this.repository.list(query);

    return buildCursorPage(rows, query.limit, (profile) => ({
      value: profile.createdAt.toISOString(),
      id: profile.id,
    }));
  }

  /** Used by the post and feed modules to attach an author to each row without an N+1. */
  async mapByIds(ids: readonly string[]): Promise<Map<string, Profile>> {
    const unique = [...new Set(ids)];
    const profiles = await this.repository.findManyByIds(unique);

    return new Map(profiles.map((profile) => [profile.id, profile]));
  }

  /** Called by follow and post when an edge appears or disappears. */
  async adjustCounters(id: string, delta: CounterDelta): Promise<void> {
    await this.repository.adjustCounters(id, delta);
  }

  async recount(id: string, counters: Required<CounterDelta>): Promise<void> {
    await this.repository.setCounters(id, counters);
  }

  /**
   * Bylines for a whole page: two queries and one batch of presigns, whatever the page size.
   * Every list that embeds an author goes through here so none of them reinvents the N+1.
   */
  async authorViews(ids: readonly string[]): Promise<Map<string, AuthorView>> {
    const profiles = await this.mapByIds(ids);
    const avatarIds = [...profiles.values()]
      .map((profile) => profile.avatarMediaId)
      .filter((id): id is string => id !== null);
    const urls = await this.media.presignMany(avatarIds);

    return new Map(
      [...profiles.values()].map((profile) => {
        const signed = profile.avatarMediaId === null ? undefined : urls.get(profile.avatarMediaId);
        const avatar =
          signed === undefined ? null : { original: signed.original, ...signed.variants };

        return [profile.id, toAuthorView(profile, profile.id, avatar)];
      }),
    );
  }

  /** Presigned avatar URLs, or null when the profile has no picture. */
  async avatarUrls(profile: Profile): Promise<Record<string, string> | null> {
    if (profile.avatarMediaId === null) {
      return null;
    }

    const urls = await this.media.urls(profile.avatarMediaId);

    return { original: urls.original, ...urls.variants };
  }

  static cursorOf(profile: Profile): string {
    return encodeCursor({ value: profile.createdAt.toISOString(), id: profile.id });
  }
}
