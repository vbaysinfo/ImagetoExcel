/** Errors with a message that is safe and useful to show to the end user. */
export class SketchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof SketchError) {
    return Response.json({ error: { code: err.code, message: err.message } } satisfies ApiErrorBody, {
      status: err.status,
    });
  }
  console.error("[sketch-to-excel]", err);
  return Response.json(
    {
      error: {
        code: "INTERNAL",
        message: "Something went wrong on the server. Please try again; if it keeps happening, contact the administrator.",
      },
    } satisfies ApiErrorBody,
    { status: 500 },
  );
}
