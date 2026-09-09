import type { Connection, UpdateQuery } from 'mongoose';

import { isDuplicateKey } from '@core/database/mongo/errors';
import { ConflictError } from '@core/errors/app-error';
import type { AuthRepository } from '../auth.repository';
import type { ActorPatch, ActorType, ActorWithSecrets, AuditEntry, NewActor } from '../auth.types';
import { actorModel, authAuditModel } from './actor.schema';
import type { ActorDocument, ActorModel, AuthAuditModel } from './actor.schema';

function toActor(document: ActorDocument): ActorWithSecrets {
  return {
    actor: {
      id: document._id,
      actorType: document.actorType,
      email: document.email,
      status: document.status,
      displayName: document.displayName,
      phone: document.phone,
      emailVerifiedAt: document.emailVerifiedAt,
      phoneVerifiedAt: document.phoneVerifiedAt,
      roles: document.roles,
      permissions: document.permissions,
      mfaEnabledAt: document.mfaEnabledAt,
      lastLoginAt: document.lastLoginAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    },
    secrets: {
      passwordHash: document.passwordHash,
      mfaSecret: document.mfaSecret,
      mfaBackupCodes: document.mfaBackupCodes,
    },
  };
}

/** Mirrors the SQL mapper: an absent key must not become an explicit `null` in the document. */
function toUpdate(patch: ActorPatch): UpdateQuery<ActorDocument> {
  const set: Partial<ActorDocument> = {};

  if (patch.status !== undefined) set.status = patch.status;
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.passwordHash !== undefined) set.passwordHash = patch.passwordHash;
  if (patch.emailVerifiedAt !== undefined) set.emailVerifiedAt = patch.emailVerifiedAt;
  if (patch.phoneVerifiedAt !== undefined) set.phoneVerifiedAt = patch.phoneVerifiedAt;
  if (patch.roles !== undefined) set.roles = [...patch.roles];
  if (patch.permissions !== undefined) set.permissions = [...patch.permissions];
  if (patch.mfaSecret !== undefined) set.mfaSecret = patch.mfaSecret;
  if (patch.mfaEnabledAt !== undefined) set.mfaEnabledAt = patch.mfaEnabledAt;
  if (patch.mfaBackupCodes !== undefined) set.mfaBackupCodes = [...patch.mfaBackupCodes];
  if (patch.lastLoginAt !== undefined) set.lastLoginAt = patch.lastLoginAt;

  return { $set: set };
}

export class MongoAuthRepository implements AuthRepository {
  private readonly actors: ActorModel;
  private readonly audit: AuthAuditModel;

  constructor(connection: Connection) {
    this.actors = actorModel(connection);
    this.audit = authAuditModel(connection);
  }

  async createActor(data: NewActor): Promise<ActorWithSecrets> {
    try {
      const document = await this.actors.create({
        _id: data.id,
        actorType: data.actorType,
        email: data.email,
        status: data.status,
        displayName: data.displayName,
        passwordHash: data.passwordHash,
        phone: data.phone,
        roles: [...data.roles],
        permissions: [...data.permissions],
      });

      return toActor(document.toObject());
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictError('This account already exists', { cause: error });
      }

      throw error;
    }
  }

  async findById(id: string): Promise<ActorWithSecrets | null> {
    const document = await this.actors.findById(id).lean<ActorDocument>().exec();

    return document === null ? null : toActor(document);
  }

  async findByEmail(actorType: ActorType, email: string): Promise<ActorWithSecrets | null> {
    const document = await this.actors.findOne({ actorType, email }).lean<ActorDocument>().exec();

    return document === null ? null : toActor(document);
  }

  async updateActor(id: string, patch: ActorPatch): Promise<ActorWithSecrets | null> {
    const document = await this.actors
      .findByIdAndUpdate(id, toUpdate(patch), { returnDocument: 'after' })
      .lean<ActorDocument>()
      .exec();

    return document === null ? null : toActor(document);
  }

  async recordAudit(entry: AuditEntry & { id: string }): Promise<void> {
    const { id, ...rest } = entry;

    await this.audit.create({ _id: id, ...rest });
  }

  async countAuditEvents(actorId: string, event: string): Promise<number> {
    return this.audit.countDocuments({ actorId, event }).exec();
  }
}
