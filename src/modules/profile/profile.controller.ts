import { inject } from 'tsyringe';

import { cursorQuerySchema } from '@core/database/pagination';
import type { CursorQuery } from '@core/database/pagination';
import { Controller, Get, HttpCode, Patch, Post, Public, Use, Validate } from '@core/decorators';
import { ApiPayload } from '@core/http/api-response';
import { BadRequestError } from '@core/errors/app-error';
import { requestContext } from '@core/http/request-context';
import type { TypedRequest } from '@core/http/typed-request';
import { singleFileUpload } from '@shared/media/upload.middleware';
import type { UploadedFile } from '@shared/media/media.service';
import { ProfileService } from './profile.service';
import { createProfileSchema, handleParamsSchema, updateProfileSchema } from './profile.schemas';
import type { CreateProfileInput, UpdateProfileInput } from './profile.schemas';
import { toProfileView } from './profile.view';
import type { ProfileView } from './profile.view';
import type { Profile } from './profile.types';

function fileOf(req: TypedRequest): UploadedFile {
  const file = (req as { file?: UploadedFile }).file;

  if (file === undefined) {
    throw new BadRequestError('An "avatar" file is required');
  }

  return file;
}

@Controller('/profiles')
export class ProfileController {
  constructor(@inject(ProfileService) private readonly service: ProfileService) {}

  private async view(profile: Profile): Promise<ProfileView> {
    return toProfileView(profile, await this.service.avatarUrls(profile));
  }

  @Post('/')
  @Validate({ body: createProfileSchema })
  async create(req: TypedRequest<CreateProfileInput>): Promise<ProfileView> {
    const principal = requestContext.requirePrincipal();

    return this.view(await this.service.create(principal.id, req.body));
  }

  @Get('/me')
  async me(): Promise<ProfileView> {
    return this.view(await this.service.requireOwn(requestContext.requirePrincipal().id));
  }

  @Patch('/me')
  @Validate({ body: updateProfileSchema })
  async update(req: TypedRequest<UpdateProfileInput>): Promise<ProfileView> {
    const principal = requestContext.requirePrincipal();

    return this.view(await this.service.update(principal.id, req.body));
  }

  // 200, not the 201 a POST defaults to: this replaces the avatar and answers with the profile,
  // so there is no new resource for a client to follow a Location header to.
  @Post('/me/avatar')
  @HttpCode(200)
  @Use(singleFileUpload('avatar'))
  async avatar(req: TypedRequest): Promise<ProfileView> {
    const principal = requestContext.requirePrincipal();

    return this.view(await this.service.setAvatar(principal.id, fileOf(req)));
  }

  // Public: a social profile that cannot be read without an account is a private one.
  @Get('/')
  @Public()
  @Validate({ query: cursorQuerySchema })
  async list(req: TypedRequest<unknown, CursorQuery>): Promise<ApiPayload<ProfileView[]>> {
    const page = await this.service.list(req.query);
    const items = await Promise.all(page.items.map(async (profile) => this.view(profile)));

    return ApiPayload.of(items, {
      meta: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    });
  }

  @Get('/:handle')
  @Public()
  @Validate({ params: handleParamsSchema })
  async byHandle(req: TypedRequest<unknown, unknown, { handle: string }>): Promise<ProfileView> {
    return this.view(await this.service.requireByHandle(req.params.handle));
  }
}
