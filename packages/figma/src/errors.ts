/**
 * The Figma errors that waste time.
 *
 * The 404 is the worst: it looks like "the file does not exist" and it almost
 * always means "the file exists and your token has no access" — it lives in a
 * team the account is not a member of. A message that only says the first thing
 * sends someone off to double-check the URL for twenty minutes.
 */

export class FigmaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'FigmaError'
  }
}

export function describeStatus(status: number, context: { fileKey?: string; nodeId?: string }): FigmaError {
  switch (status) {
    case 401:
    case 403:
      return new FigmaError(
        `Figma rejected the token (${status}).`,
        status,
        'This is usually an expired or revoked token rather than a mistyped one. ' +
          'Regenerate it at figma.com/developers/api#access-tokens with `file_content:read` scope.',
      )
    case 404:
      return new FigmaError(
        `Figma returned 404 for node ${context.nodeId ?? '?'} in file ${context.fileKey ?? '?'}.`,
        status,
        'The node does not exist **or** your account has no access to that file. ' +
          'If the link opens fine in your browser it is the second one: the file lives in a team ' +
          'your account does not belong to, and the token inherits those permissions.',
      )
    case 429:
      return new FigmaError('Figma is rate limiting (429).', status, 'Retried automatically with backoff.')
    default:
      return new FigmaError(`Figma responded ${status}.`, status)
  }
}
