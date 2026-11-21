export const claudeMcpPath = '/api/claude/mcp';
export function claudeConnectorInstallUrl(endpoint: string) {
  const server = new URL(endpoint);
  if (
    server.username ||
    server.password ||
    server.search ||
    server.hash ||
    server.pathname !== claudeMcpPath ||
    !(
      server.protocol === 'https:' ||
      (server.protocol === 'http:' && server.hostname === '127.0.0.1')
    )
  )
    throw new Error('Invalid Kivuno connector address.');
  const url = new URL('https://claude.ai/customize/connectors');
  url.search = new URLSearchParams({
    modal: 'add-custom-connector',
    connectorName: 'Kivuno',
    connectorUrl: server.href,
  }).toString();
  return url.href;
}
export const claudeWebControlPath = '/api/desktop/claude-web';
export const claudeWebBearer = /^Bearer (kw[co]_[A-Za-z0-9_-]{43})$/;

export function claudeConnectorOrigin(origin: string | string[] | undefined) {
  return origin === undefined || origin === 'https://claude.ai';
}
