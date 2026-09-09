import { inject } from 'tsyringe';

import { cursorQuerySchema } from '@core/database/pagination';
import type { CursorQuery } from '@core/database/pagination';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  OptionalAuth,
  Post,
  Use,
  Validate,
} from '@core/decorators';
import { ApiPayload } from '@core/http/api-response';
import { requestContext } from '@core/http/request-context';
import type { TypedRequest } from '@core/http/typed-request';
import type { UploadedFile } from '@shared/media/media.service';
import { multiFileUpload } from '@shared/media/upload.middleware';
import { handleParamsSchema } from '@modules/profile/profile.schemas';
import { MAX_POST_IMAGES, createPostSchema, postIdParamsSchema } from './post.schemas';
import type { CreatePostInput } from './post.schemas';
import { PostService } from './post.service';
import type { PostView } from './post.view';

function filesOf(req: TypedRequest): UploadedFile[] {
  // Multer only sets `files` when the request was multipart; a JSON post is text-only.
  return (req as { files?: UploadedFile[] }).files ?? [];
}

/** Anonymous readers get `liked: null` rather than a 401 — a public timeline stays public. */
function viewerId(): string | null {
  return requestContext.principal()?.id ?? null;
}

@Controller('/posts')
export class PostController {
  constructor(@inject(PostService) private readonly service: PostService) {}

  @Post('/')
  @Use(multiFileUpload('images', MAX_POST_IMAGES))
  @Validate({ body: createPostSchema })
  async create(req: TypedRequest<CreatePostInput>): Promise<PostView> {
    const principal = requestContext.requirePrincipal();
    const post = await this.service.create(principal.id, req.body, filesOf(req));

    return this.service.view(post, principal.id);
  }

  @Get('/:id')
  @OptionalAuth()
  @Validate({ params: postIdParamsSchema })
  async byId(req: TypedRequest<unknown, unknown, { id: string }>): Promise<PostView> {
    return this.service.view(await this.service.require(req.params.id), viewerId());
  }

  @Delete('/:id')
  @HttpCode(204)
  @Validate({ params: postIdParamsSchema })
  async remove(req: TypedRequest<unknown, unknown, { id: string }>): Promise<void> {
    await this.service.remove(requestContext.requirePrincipal().id, req.params.id);
  }

  // 200, not the 201 a POST defaults to: a like is idempotent and has no URL of its own.
  @Post('/:id/like')
  @HttpCode(200)
  @Validate({ params: postIdParamsSchema })
  async like(
    req: TypedRequest<unknown, unknown, { id: string }>,
  ): Promise<{ liked: boolean; likeCount: number }> {
    return this.service.like(requestContext.requirePrincipal().id, req.params.id);
  }

  @Delete('/:id/like')
  @Validate({ params: postIdParamsSchema })
  async unlike(
    req: TypedRequest<unknown, unknown, { id: string }>,
  ): Promise<{ liked: boolean; likeCount: number }> {
    return this.service.unlike(requestContext.requirePrincipal().id, req.params.id);
  }
}

/**
 * An author's timeline hangs off the profile, not off `/posts`: it is one person's page, and
 * `/profiles/:handle/posts` is the URL a client already holds after rendering the profile.
 */
@Controller('/profiles')
export class AuthorPostsController {
  constructor(@inject(PostService) private readonly service: PostService) {}

  @Get('/:handle/posts')
  @OptionalAuth()
  @Validate({ params: handleParamsSchema, query: cursorQuerySchema })
  async list(
    req: TypedRequest<unknown, CursorQuery, { handle: string }>,
  ): Promise<ApiPayload<PostView[]>> {
    const page = await this.service.listByAuthor(req.params.handle, req.query);
    const items = await this.service.views(page.items, viewerId());

    return ApiPayload.of(items, {
      meta: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    });
  }
}
