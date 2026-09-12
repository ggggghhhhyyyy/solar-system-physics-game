/**
 * Vercel Node serverless function.
 * Browser POSTs catalog keys + epoch. This process talks to NASA.
 * Open URL proxy is rejected. Never import this file from the engine or React tree.
 */
import { handleHorizonsPost } from '../src/physics/ephemeris/horizonsApi.server.ts';

interface NodeReq {
  method?: string;
  body?: unknown;
}

interface NodeRes {
  status: (code: number) => { json: (body: unknown) => void };
}

export default async function handler(req: NodeReq, res: NodeRes): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const result = await handleHorizonsPost(req.body);
  res.status(result.status).json(result.body);
}
