import { claudeMcpPath } from './claude-web.ts';

export const claudeResourceMetadataPath = '/.well-known/oauth-protected-resource' + claudeMcpPath;
export const claudeIssuerMetadataPath = '/.well-known/oauth-authorization-server';
export const claudeConsentPath = '/api/claude/oauth/consent';
export const claudeAuthorizePath = '/api/claude/oauth/authorize';
export const claudeRegisterPath = '/api/claude/oauth/register';
export const claudeTokenPath = '/api/claude/oauth/token';
export const claudeScopes = ['connector.connect', 'mesh.read'];

export function isClaudeOAuthPublicEndpoint(path: string) {
  return [claudeAuthorizePath, claudeRegisterPath, claudeTokenPath].includes(path);
}

export function claudeChallenge(origin: string) {
  return `Bearer resource_metadata="${origin}${claudeResourceMetadataPath}", scope="${claudeScopes.join(' ')}"`;
}

export function claudeMetadata(origin: string, issuer: boolean) {
  if (!issuer)
    return {
      resource: origin + claudeMcpPath,
      authorization_servers: [origin],
      scopes_supported: claudeScopes,
      bearer_methods_supported: ['header'],
    };
  return {
    issuer: origin,
    authorization_endpoint: origin + claudeAuthorizePath,
    token_endpoint: origin + claudeTokenPath,
    registration_endpoint: origin + claudeRegisterPath,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: claudeScopes,
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
  };
}
