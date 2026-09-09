import type { Connection, Model } from 'mongoose';
import { Schema } from 'mongoose';

import type { ActorStatus } from '../auth.types';

export interface ActorDocument {
  _id: string;
  actorType: string;
  email: string;
  status: ActorStatus;
  displayName: string;
  passwordHash: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  roles: string[];
  permissions: string[];
  mfaSecret: string | null;
  mfaEnabledAt: Date | null;
  mfaBackupCodes: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const actorSchema = new Schema<ActorDocument>(
  {
    _id: { type: String, required: true },
    actorType: { type: String, required: true },
    email: { type: String, required: true },
    status: { type: String, required: true, default: 'pending' },
    displayName: { type: String, required: true },
    passwordHash: { type: String, required: true },
    phone: { type: String, default: null },
    emailVerifiedAt: { type: Date, default: null },
    phoneVerifiedAt: { type: Date, default: null },
    roles: { type: [String], default: [] },
    permissions: { type: [String], default: [] },
    mfaSecret: { type: String, default: null },
    mfaEnabledAt: { type: Date, default: null },
    mfaBackupCodes: { type: [String], default: [] },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'actors' },
);

// Mirrors the SQL unique constraint: the identity is the pair, not the address.
actorSchema.index({ actorType: 1, email: 1 }, { unique: true });

export interface AuthAuditDocument {
  _id: string;
  actorId: string | null;
  actorType: string;
  event: string;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, string>;
  createdAt: Date;
}

const authAuditSchema = new Schema<AuthAuditDocument>(
  {
    _id: { type: String, required: true },
    actorId: { type: String, default: null },
    actorType: { type: String, required: true },
    event: { type: String, required: true },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    requestId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'auth_audit',
  },
);

authAuditSchema.index({ actorId: 1, createdAt: -1 });
authAuditSchema.index({ event: 1, createdAt: -1 });

export type ActorModel = Model<ActorDocument>;
export type AuthAuditModel = Model<AuthAuditDocument>;

export function actorModel(connection: Connection): ActorModel {
  return connection.model<ActorDocument>('Actor', actorSchema);
}

export function authAuditModel(connection: Connection): AuthAuditModel {
  return connection.model<AuthAuditDocument>('AuthAudit', authAuditSchema);
}
