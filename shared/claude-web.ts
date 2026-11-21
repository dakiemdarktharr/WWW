export const claudeMcpPath = '/api/claude/mcp';
export const claudeWebControlPath = '/api/desktop/claude-web';
export const claudeWebBearer = /^Bearer (kw[co]_[A-Za-z0-9_-]{43})$/;

export function claudeConnectorOrigin(origin: string | string[] | undefined) {
  return origin === undefined || origin === 'https://claude.ai';
}
