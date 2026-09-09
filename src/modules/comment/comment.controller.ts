import { inject } from 'tsyringe';

import type { CursorQuery } from '@core/database/pagination';
import { Controller, Delete, Get, HttpCode, Post, Public, Validate } from '@core/decorators';
import { ApiPayload } from '@core/http/api-response';
import { requestContext } from '@core/http/request-context';
import type { TypedRequest } from '@core/http/typed-request';
import { postIdParamsSchema } from '@modules/post/post.schemas';
import { CommentService } from './comment.service';
import { commentIdParamsSchema, commentQuerySchema, createCommentSchema } from './comment.schemas';
import type { CreateCommentInput } from './comment.schemas';
import type { CommentView } from './comment.view';

@Controller('/posts')
export class CommentController {
  constructor(@inject(CommentService) private readonly service: CommentService) {}

  @Post('/:id/comments')
  @Validate({ body: createCommentSchema, params: postIdParamsSchema })
  async create(
    req: TypedRequest<CreateCommentInput, unknown, { id: string }>,
  ): Promise<CommentView> {
    const principal = requestContext.requirePrincipal();

    return this.service.view(await this.service.create(principal.id, req.params.id, req.body));
  }

  @Get('/:id/comments')
  @Public()
  @Validate({ params: postIdParamsSchema, query: commentQuerySchema })
  async list(
    req: TypedRequest<unknown, CursorQuery, { id: string }>,
  ): Promise<ApiPayload<CommentView[]>> {
    const page = await this.service.list(req.params.id, req.query);

    return ApiPayload.of(await this.service.views(page.items), {
      meta: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    });
  }
}

/**
 * Deleting a comment is not scoped to its post: the id is unique, and requiring the post in the
 * URL would only give a caller a second way to get it wrong.
 */
@Controller('/comments')
export class CommentAdminController {
  constructor(@inject(CommentService) private readonly service: CommentService) {}

  @Delete('/:id')
  @HttpCode(204)
  @Validate({ params: commentIdParamsSchema })
  async remove(req: TypedRequest<unknown, unknown, { id: string }>): Promise<void> {
    await this.service.remove(requestContext.requirePrincipal().id, req.params.id);
  }
}
