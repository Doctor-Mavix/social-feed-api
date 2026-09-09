import { inject } from 'tsyringe';

import { cursorQuerySchema } from '@core/database/pagination';
import type { CursorQuery } from '@core/database/pagination';
import { Controller, Get, Validate } from '@core/decorators';
import { ApiPayload } from '@core/http/api-response';
import { requestContext } from '@core/http/request-context';
import type { TypedRequest } from '@core/http/typed-request';
import { PostService } from '@modules/post/post.service';
import type { PostView } from '@modules/post/post.view';
import { FeedService } from './feed.service';

@Controller('/feed')
export class FeedController {
  constructor(
    @inject(FeedService) private readonly service: FeedService,
    @inject(PostService) private readonly posts: PostService,
  ) {}

  @Get('/')
  @Validate({ query: cursorQuerySchema })
  async home(req: TypedRequest<unknown, CursorQuery>): Promise<ApiPayload<PostView[]>> {
    const principal = requestContext.requirePrincipal();
    const page = await this.service.home(principal.id, req.query);
    const items = await this.posts.views(page.items, principal.id);

    return ApiPayload.of(items, {
      meta: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    });
  }
}
