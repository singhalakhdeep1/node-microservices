import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler, Events, HttpError, requireAdmin, requireUser, signToken, type Broker, type Cache, type Logger } from '@nms/shared';
import { User, type UserDoc } from '../models/User';
import type { SeaweedFSService } from '../seaweedfs';

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });
const updateSchema = z.object({ name: z.string().trim().min(1).max(100) });
const roleSchema = z.object({ role: z.enum(['user', 'admin']) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, 'Validation failed', result.error.flatten().fieldErrors);
  return result.data;
}

const adminEmails = () => (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const CACHE_TTL = Number(process.env.USER_CACHE_TTL ?? 3600);
const cacheKey = (id: string) => `user:${id}`;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)),
});

function session(user: UserDoc) {
  return { token: signToken({ id: user.id, email: user.email, role: user.role, name: user.name }), data: user.toJSON() };
}

export function userRoutes(deps: { broker: Broker; cache: Cache; logger: Logger; storage: SeaweedFSService | null }): Router {
  const { broker, cache, storage } = deps;
  const router = Router();

  router.post('/register', asyncHandler(async (req, res) => {
    const input = parse(registerSchema, req.body);
    if (await User.exists({ email: input.email })) throw new HttpError(409, 'User already exists');
    const user = await User.create({ ...input, role: adminEmails().includes(input.email) ? 'admin' : 'user' });
    await broker.publish(Events.USER_REGISTERED, { userId: user.id, email: user.email, name: user.name });
    res.status(201).json({ success: true, ...session(user) });
  }));

  router.post('/login', asyncHandler(async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = await User.findOne({ email: input.email }).select('+password');
    if (!user || !(await user.comparePassword(input.password))) throw new HttpError(401, 'Invalid credentials');
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ success: true, ...session(user) });
  }));

  router.get('/me', requireUser, asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw new HttpError(404, 'User not found');
    res.json({ success: true, data: user });
  }));

  router.patch('/me', requireUser, asyncHandler(async (req, res) => {
    const input = parse(updateSchema, req.body);
    const user = await User.findByIdAndUpdate(req.user!.id, input, { new: true, runValidators: true });
    if (!user) throw new HttpError(404, 'User not found');
    await cache.del(cacheKey(user.id));
    await broker.publish(Events.USER_UPDATED, { userId: user.id, name: user.name });
    res.json({ success: true, data: user });
  }));

  router.post('/me/avatar', requireUser, upload.single('avatar'), asyncHandler(async (req, res) => {
    if (!storage) throw new HttpError(503, 'File storage (SeaweedFS) is not configured');
    if (!req.file) throw new HttpError(400, 'Send an image (png, jpeg, gif, webp, max 2 MB) in the "avatar" field');
    const user = await User.findById(req.user!.id);
    if (!user) throw new HttpError(404, 'User not found');
    const { fid, size } = await storage.uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype, 'avatars');
    const previous = user.avatarFid;
    user.avatarFid = fid;
    await user.save();
    if (previous) storage.deleteFile(previous).catch(() => undefined);
    await cache.del(cacheKey(user.id));
    res.status(201).json({ success: true, data: { fid, size, url: `/api/users/${user.id}/avatar` } });
  }));

  router.get('/:id/avatar', asyncHandler(async (req, res) => {
    if (!storage) throw new HttpError(503, 'File storage (SeaweedFS) is not configured');
    const user = await User.findById(req.params.id).select('avatarFid');
    if (!user?.avatarFid) throw new HttpError(404, 'No avatar');
    const file = await storage.downloadBuffer(user.avatarFid);
    if (!file) throw new HttpError(404, 'No avatar');
    res.setHeader('content-type', file.contentType);
    res.setHeader('cache-control', 'public, max-age=300');
    // Public image: allow the storefront (another origin) to embed it despite helmet's same-origin CORP default.
    res.setHeader('cross-origin-resource-policy', 'cross-origin');
    res.send(file.data);
  }));

  router.get('/', requireAdmin, asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const [users, total] = await Promise.all([
      User.find().sort('-createdAt').skip((page - 1) * limit).limit(limit),
      User.countDocuments(),
    ]);
    res.json({ success: true, data: { users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
  }));

  // Cache-aside read: Redis first, MongoDB on a miss.
  router.get('/:id', requireUser, asyncHandler(async (req, res) => {
    if (req.user!.id !== req.params.id && req.user!.role !== 'admin') throw new HttpError(403, 'Forbidden');
    const { value, cached } = await cache.wrap(cacheKey(req.params.id), CACHE_TTL, async () => {
      const user = await User.findById(req.params.id);
      return user ? user.toJSON() : null;
    });
    if (!value) throw new HttpError(404, 'User not found');
    res.json({ success: true, data: value, cached });
  }));

  router.patch('/:id/role', requireAdmin, asyncHandler(async (req, res) => {
    const { role } = parse(roleSchema, req.body);
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!user) throw new HttpError(404, 'User not found');
    await cache.del(cacheKey(user.id));
    res.json({ success: true, data: user });
  }));

  return router;
}

/** Service-to-service lookups (order-service needs the buyer's name and email). */
export function internalUserRoutes(cache: Cache): Router {
  const router = Router();
  router.get('/:id', asyncHandler(async (req, res) => {
    const { value } = await cache.wrap(cacheKey(req.params.id), CACHE_TTL, async () => {
      const user = await User.findById(req.params.id);
      return user ? user.toJSON() : null;
    });
    if (!value) throw new HttpError(404, 'User not found');
    res.json({ success: true, data: value });
  }));
  return router;
}
