import { inject } from 'tsyringe';

import { cursorQuerySchema } from '@core/database/pagination';
import type { CursorQuery } from '@core/database/pagination';
import { Controller, Delete, Get, HttpCode, Post, Public, Validate } from '@core/decorators';
import { ApiPayload } from '@core/http/api-response';
import { requestContext } from '@core/http/request-context';
import type { TypedRequest } from '@core/http/typed-request';
import { ProfileService } from '@modules/profile/profile.service';
import { handleParamsSchema } from '@modules/profile/profile.schemas';
import { toAuthorView } from '@modules/profile/profile.view';
import type { AuthorView } from '@modules/profile/profile.view';
import { FollowService } from './follow.service';
import type { Follow } from './follow.types';

interface HandleParams {
  handle: string;
}

@Controller('/profiles')
export class FollowController {
  constructor(
    @inject(FollowService) private readonly service: FollowService,
    @inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  // 200, not the 201 a POST defaults to: following is idempotent and creates no addressable
  // resource, so a client that sees 201 would reasonably look for a Location header.
  @Post('/:handle/follow')
  @HttpCode(200)
  @Validate({ params: handleParamsSchema })
  async follow(req: TypedRequest<unknown, unknown, HandleParams>): Promise<{ following: boolean }> {
    const principal = requestContext.requirePrincipal();

    return this.service.follow(principal.id, req.params.handle);
  }

  @Delete('/:handle/follow')
  @Validate({ params: handleParamsSchema })
  async unfollow(
    req: TypedRequest<unknown, unknown, HandleParams>,
  ): Promise<{ following: boolean }> {
    const principal = requestContext.requirePrincipal();

    return this.service.unfollow(principal.id, req.params.handle);
  }

  @Get('/:handle/followers')
  @Public()
  @Validate({ params: handleParamsSchema, query: cursorQuerySchema })
  async followers(
    req: TypedRequest<unknown, CursorQuery, HandleParams>,
  ): Promise<ApiPayload<AuthorView[]>> {
    const page = await this.service.listFollowers(req.params.handle, req.query);

    return this.render(page.items, page, (follow) => follow.followerId);
  }

  @Get('/:handle/following')
  @Public()
  @Validate({ params: handleParamsSchema, query: cursorQuerySchema })
  async following(
    req: TypedRequest<unknown, CursorQuery, HandleParams>,
  ): Promise<ApiPayload<AuthorView[]>> {
    const page = await this.service.listFollowing(req.params.handle, req.query);

    return this.render(page.items, page, (follow) => follow.followingId);
  }

  /**
   * Both listings return edges; what a client wants is people. The profiles are fetched in one
   * batch rather than one per row, which is the difference between 1 query and 20.
   */
  private async render(
    edges: readonly Follow[],
    page: { nextCursor: string | null; hasMore: boolean },
    sideOf: (follow: Follow) => string,
  ): Promise<ApiPayload<AuthorView[]>> {
    const ids = edges.map(sideOf);
    const byId = await this.profiles.mapByIds(ids);
    const items = await Promise.all(
      ids.map(async (id) => {
        const profile = byId.get(id);

        return toAuthorView(
          profile,
          id,
          profile === undefined ? null : await this.profiles.avatarUrls(profile),
        );
      }),
    );

    return ApiPayload.of(items, {
      meta: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    });
  }
}
