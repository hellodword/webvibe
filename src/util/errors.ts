export class WebvibeError extends Error {
  constructor(
    message: string,
    readonly code = "WEBVIBE_ERROR",
    readonly status = 500,
  ) {
    super(message);
    this.name = "WebvibeError";
  }
}

export class BadRequestError extends WebvibeError {
  constructor(message: string) {
    super(message, "BAD_REQUEST", 400);
  }
}

export class UnauthorizedError extends WebvibeError {
  constructor(message = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401);
  }
}

export class ForbiddenError extends WebvibeError {
  constructor(message = "Forbidden") {
    super(message, "FORBIDDEN", 403);
  }
}

export class UnknownToolSurfaceError extends WebvibeError {
  constructor(toolName: string) {
    super(
      `UNKNOWN_TOOL_SURFACE: Tool '${toolName}' is not in the active webvibe 4.0 tool surface. Call workspace.context and retry with the current tool names.`,
      "UNKNOWN_TOOL_SURFACE",
      400,
    );
  }
}

export class NotFoundError extends WebvibeError {
  constructor(message = "Not found") {
    super(message, "NOT_FOUND", 404);
  }
}

export class TimeoutError extends WebvibeError {
  constructor(message = "Timed out") {
    super(message, "TIMEOUT", 504);
  }
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
