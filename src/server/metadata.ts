export function authorizationServerMetadata(publicBaseUrl: string): Record<string, unknown> {
  return {
    issuer: publicBaseUrl,
    authorization_endpoint: `${publicBaseUrl}/oauth/authorize`,
    token_endpoint: `${publicBaseUrl}/oauth/token`,
    registration_endpoint: `${publicBaseUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["plain", "S256"],
  };
}

export function protectedResourceMetadata(publicBaseUrl: string): Record<string, unknown> {
  return {
    resource: `${publicBaseUrl}/mcp`,
    authorization_servers: [publicBaseUrl],
    bearer_methods_supported: ["header"],
  };
}
