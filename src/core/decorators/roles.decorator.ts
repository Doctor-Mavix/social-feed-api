import type { AccessPatch } from '@core/decorators/metadata';
import { patchControllerAccess, patchRouteAccess } from '@core/decorators/metadata';
import type { TargetDecorator } from '@core/decorators/types';

function accessDecorator(patch: AccessPatch): TargetDecorator {
  return (target, propertyKey) => {
    if (propertyKey === undefined) {
      patchControllerAccess(target, patch);
      return;
    }

    patchRouteAccess(target.constructor, String(propertyKey), patch);
  };
}

export function Public(): TargetDecorator {
  return accessDecorator({ isPublic: true });
}

/**
 * Open to everyone, but the caller is identified when a token is present. For content that is
 * readable by anyone yet personalised for whoever is signed in — a timeline that says whether
 * you liked a post. An absent or invalid token renders the page logged-out; it never 401s.
 */
export function OptionalAuth(): TargetDecorator {
  return accessDecorator({ isPublic: true, isOptional: true });
}

export function Roles(...roles: string[]): TargetDecorator {
  return accessDecorator({ isPublic: false, roles });
}

export function Permissions(...permissions: string[]): TargetDecorator {
  return accessDecorator({ isPublic: false, permissions });
}
