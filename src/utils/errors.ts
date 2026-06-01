export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (resource = 'Resource') =>
  new AppError(404, `${resource} not found`);

export const unauthorized = (detail?: string) =>
  new AppError(401, 'Unauthorized', detail);

export const forbidden = (detail?: string) =>
  new AppError(403, 'Forbidden', detail);

export const badRequest = (detail?: string) =>
  new AppError(400, 'Bad request', detail);

export const conflict = (detail?: string) =>
  new AppError(409, 'Conflict', detail);

export const gone = (detail?: string) =>
  new AppError(410, 'Gone', detail);
