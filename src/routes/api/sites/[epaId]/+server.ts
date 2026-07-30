import { error, json } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { siteDetail } from '$lib/server/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const detail = await siteDetail(prisma, params.epaId);
  if (!detail) throw error(404, 'Site not found');
  return json(detail);
};
