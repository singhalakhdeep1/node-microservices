// SeaweedFS integration over the master/volume HTTP API: assign a file id, upload, look up, download, delete.

export interface AssignResult {
  fid: string;
  url: string;
  publicUrl: string;
}

export interface StoredFile {
  data: Buffer;
  contentType: string;
}

export class SeaweedFSService {
  private readonly master: string;

  constructor(server = 'localhost', port = 9333, scheme = 'http') {
    this.master = `${scheme}://${server}:${port}`;
  }

  private volumeBase(url: string): string {
    return /^https?:\/\//.test(url) ? url : `http://${url}`;
  }

  async assign(collection = 'default', ttl?: string): Promise<AssignResult> {
    const qs = new URLSearchParams({ collection, ...(ttl ? { ttl } : {}) });
    const res = await fetch(`${this.master}/dir/assign?${qs}`, { signal: AbortSignal.timeout(5000) });
    const body = (await res.json()) as AssignResult & { error?: string };
    if (!res.ok || body.error) throw new Error(`SeaweedFS assign failed: ${body.error ?? res.status}`);
    return body;
  }

  async uploadBuffer(buffer: Buffer, fileName: string, contentType: string, collection = 'default'): Promise<{ fid: string; size: number }> {
    const { fid, url } = await this.assign(collection);
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType }), fileName);
    const res = await fetch(`${this.volumeBase(url)}/${fid}`, { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) });
    const body = (await res.json()) as { size?: number; error?: string };
    if (!res.ok || body.error) throw new Error(`SeaweedFS upload failed: ${body.error ?? res.status}`);
    return { fid, size: body.size ?? buffer.length };
  }

  async lookup(fid: string): Promise<string> {
    const volumeId = fid.split(',')[0];
    const res = await fetch(`${this.master}/dir/lookup?volumeId=${encodeURIComponent(volumeId)}`, { signal: AbortSignal.timeout(5000) });
    const body = (await res.json()) as { locations?: { url: string; publicUrl: string }[]; error?: string };
    const loc = body.locations?.[0];
    if (!loc) throw new Error(`SeaweedFS lookup failed: ${body.error ?? 'no locations'}`);
    return this.volumeBase(loc.url);
  }

  async getFileUrl(fid: string): Promise<string> {
    return `${await this.lookup(fid)}/${fid}`;
  }

  async downloadBuffer(fid: string): Promise<StoredFile | null> {
    const res = await fetch(await this.getFileUrl(fid), { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`SeaweedFS download failed: ${res.status}`);
    return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async deleteFile(fid: string): Promise<void> {
    await fetch(await this.getFileUrl(fid), { method: 'DELETE', signal: AbortSignal.timeout(5000) });
  }

  async systemStatus(): Promise<unknown> {
    const res = await fetch(`${this.master}/cluster/status`, { signal: AbortSignal.timeout(3000) });
    return res.json();
  }
}

export function seaweedFromEnv(): SeaweedFSService | null {
  if (!process.env.SEAWEEDFS_SERVER) return null;
  return new SeaweedFSService(process.env.SEAWEEDFS_SERVER, Number(process.env.SEAWEEDFS_PORT ?? 9333), process.env.SEAWEEDFS_SCHEME ?? 'http');
}
