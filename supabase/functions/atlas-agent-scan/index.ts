import {runResearch} from './research.ts';

type ResearchResult = Awaited<ReturnType<typeof runResearch>>;
type Job = { id: string; status: 'running' | 'succeeded' | 'failed'; result: ResearchResult | null; error: string | null };
type Options = {
  url: string; anonKey: string; serviceKey: string;
  research: () => Promise<ResearchResult>;
  fetcher?: typeof fetch;
  waitUntil?: (work: Promise<unknown>) => void;
};

const origins = new Set(['https://kaptinodium.github.io', 'https://supplier-atlas.speedycomet512.chatgpt.site']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicFields = 'id,status,result,error';
const researchFailure = 'The agent could not complete its live research. Start a new scan to try again.';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function makeScanHandler(options: Options) {
  const fetcher = options.fetcher ?? fetch;
  const userHeaders = (token: string) => ({apikey: options.anonKey, Authorization: token});
  const serviceHeaders = {
    apikey: options.serviceKey, Authorization: 'Bearer ' + options.serviceKey, 'Content-Type': 'application/json'
  };

  async function member(token: string) {
    if (!/^Bearer [^\s]+$/i.test(token)) throw new HttpError(401, 'Sign in to scan.');
    const headers = userHeaders(token);
    const userResponse = await fetcher(options.url + '/auth/v1/user', {headers});
    if (userResponse.status === 401 || userResponse.status === 403) throw new HttpError(401, 'Sign in to scan.');
    if (!userResponse.ok) throw new HttpError(503, 'Atlas could not verify your session.');
    const user = await userResponse.json();
    if (!uuid.test(user.id ?? '')) throw new HttpError(401, 'Sign in to scan.');
    const memberResponse = await fetcher(options.url + '/rest/v1/supplier_members?select=role' +
      '&active=eq.true&user_id=eq.' + user.id + '&limit=1', {headers});
    if (!memberResponse.ok) throw new HttpError(503, 'Atlas could not verify your membership.');
    const members = await memberResponse.json();
    if (!['owner','editor','viewer'].includes(members[0]?.role)) throw new HttpError(403, 'Active Atlas membership is required.');
    return user.id as string;
  }

  async function readJob(userId: string, token: string, id?: string) {
    const filter = id ? '&id=eq.' + id : '&status=eq.succeeded&order=finished_at.desc';
    const response = await fetcher(options.url + '/rest/v1/atlas_agent_scans?select=' + publicFields +
      '&user_id=eq.' + userId + filter + '&limit=1', {headers: userHeaders(token)});
    if (!response.ok) throw new HttpError(503, 'Atlas could not read the scan result.');
    const rows = await response.json();
    return (rows[0] ?? null) as Job | null;
  }

  async function reserve(userId: string, id: string, lease: string): Promise<Job & {claimed: boolean}> {
    const response = await fetcher(options.url + '/rest/v1/rpc/reserve_atlas_agent_scan', {
      method: 'POST', headers: serviceHeaders, body: JSON.stringify({p_user_id: userId, p_id: id, p_lease: lease})
    });
    if (response.status === 403) throw new HttpError(403, 'Active Atlas membership is required.');
    if (!response.ok) throw new HttpError(503, 'Atlas could not start or read the scan. Retry the request.');
    return await response.json();
  }

  async function complete(userId: string, id: string, lease: string) {
    let outcome;
    try {
      const result = await options.research();
      if (!result || !Array.isArray(result.reports) || !Number.isInteger(result.sourcesChecked) ||
          result.sourcesChecked < 1 || !Array.isArray(result.sourcesFailed) || !result.model ||
          !Number.isFinite(Date.parse(result.checkedAt))) throw Error();
      outcome = {status: 'succeeded', result, error: null};
    } catch {
      outcome = {status: 'failed', result: null, error: researchFailure};
    }
    // A replacement worker may own this request if the original runtime
    // exceeded its lease. It alone can commit an outcome for its lease.
    const response = await fetcher(options.url + '/rest/v1/atlas_agent_scans?user_id=eq.' + userId +
      '&id=eq.' + id + '&status=eq.running&lease_id=eq.' + lease, {
      method: 'PATCH', headers: serviceHeaders,
      body: JSON.stringify({...outcome, finished_at: new Date().toISOString()})
    });
    if (!response.ok) throw Error('Could not persist the agent result.');
  }

  return async (req: Request) => {
    const origin = req.headers.get('Origin');
    const headers: Record<string, string> = {
      'Content-Type':'application/json', 'Cache-Control':'private, no-store', Vary:'Origin'
    };
    const reply = (status: number, value?: unknown) => new Response(
      value === undefined ? null : JSON.stringify(value), {status, headers});
    if (origin && !origins.has(origin)) return reply(403, {error:'Unrecognized Atlas origin.'});
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Expose-Headers'] = 'Retry-After';
    if (req.method === 'OPTIONS') return reply(204);
    if (!['POST','GET'].includes(req.method)) return reply(405, {error:'Use GET or POST.'});
    try {
      const token = req.headers.get('Authorization') ?? '';
      const userId = await member(token);
      if (req.method === 'GET') {
        const latest = await readJob(userId, token);
        return latest ? reply(200, latest) : reply(204);
      }
      const input = await req.json().catch(() => null);
      if (!input || typeof input.requestId !== 'string' || !uuid.test(input.requestId)) {
        throw new HttpError(400, 'Provide a valid scan request ID.');
      }
      const id = input.requestId.toLowerCase();
      const lease = crypto.randomUUID();
      const {claimed, status, result, error} = await reserve(userId, id, lease);
      const job = {id, status, result, error};
      if (claimed) {
        const work = complete(userId, id, lease);
        if (options.waitUntil) {
          options.waitUntil(work.catch(() => console.error('Atlas scan worker could not save its result.')));
        } else {
          await work;
          const completed = await readJob(userId, token, id);
          if (completed && completed.status !== 'running') return reply(200, completed);
        }
      }
      if (job.status === 'running') {
        headers['Retry-After'] = '3';
        return reply(202, job);
      }
      return reply(200, job);
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, {error: error.message});
      return reply(503, {error:'The Atlas scan service is unavailable. Retry the same request.'});
    }
  };
}

const host = globalThis as typeof globalThis & {
  Deno?: { env: {get: (key: string) => string | undefined}; serve: (handler: (req: Request) => Promise<Response>) => unknown };
  EdgeRuntime?: {waitUntil: (promise: Promise<unknown>) => void};
};
if (host.Deno) {
  host.Deno.serve(makeScanHandler({
    url: host.Deno.env.get('SUPABASE_URL')!, anonKey: host.Deno.env.get('SUPABASE_ANON_KEY')!,
    serviceKey: host.Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, research: runResearch,
    waitUntil: host.EdgeRuntime?.waitUntil.bind(host.EdgeRuntime)
  }));
}
