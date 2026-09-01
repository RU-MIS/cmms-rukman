import { Request } from 'express';

export interface PageParams {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
}

export function getPageParams(req: Request): PageParams {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? '25'), 10) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageMeta(total: number, params: PageParams) {
  return {
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}
