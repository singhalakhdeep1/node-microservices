import mongoose, { type HydratedDocument, type Model } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface UserAttrs {
  name: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
  avatarFid?: string;
  lastLoginAt?: Date;
}

interface UserMethods {
  comparePassword(candidate: string): Promise<boolean>;
}

export type UserDoc = HydratedDocument<UserAttrs, UserMethods>;

const userSchema = new mongoose.Schema<UserAttrs, Model<UserAttrs, object, UserMethods>, UserMethods>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    avatarFid: { type: String },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = String(ret._id);
        ret.hasAvatar = Boolean(ret.avatarFid);
        delete ret._id;
        delete ret.__v;
        delete ret.password;
        delete ret.avatarFid;
        return ret;
      },
    },
  },
);

userSchema.pre('save', async function hashPassword() {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function comparePassword(candidate: string) {
  return bcrypt.compare(candidate, this.password);
};

export const User = mongoose.model<UserAttrs, Model<UserAttrs, object, UserMethods>>('User', userSchema);
