export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export function parsePage(query: Record<string, unknown>): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  return { page, limit, offset: (page - 1) * limit };
}

export function buildPageMeta(total: number, page: number, limit: number): PageMeta {
  return { total, page, limit, pages: Math.ceil(total / limit) };
}
