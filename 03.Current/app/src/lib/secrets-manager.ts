// GUID: LIB_SECRETS_MANAGER-000-v01
// @PHASE_3A: Azure Key Vault integration for centralized secrets management (DEPLOY-002, CONFIG-001).
// [Intent] Provides abstraction layer for fetching secrets from Azure Key Vault in production
//          or environment variables in development. Eliminates hardcoded secrets in source code.
// [Inbound Trigger] Imported by firebase-admin.ts, email.ts, and other modules needing secrets.
// [Downstream Impact] Production deployments must have Azure Key Vault configured with Managed Identity.
//                     Local development uses environment variables or Azure CLI authentication.

// GUID: LIB_SECRETS_MANAGER-001-v01
// [Intent] Lazy-loaded imports for Azure SDK to prevent build failures when packages not installed.
//          These imports only execute when Key Vault is actually used (production mode).
// [Inbound Trigger] First call to getSecret() in production environment.
// [Downstream Impact] Requires @azure/keyvault-secrets and @azure/identity packages in production.
//                     Development mode doesn't require these packages (uses env vars).
let SecretClient: any;
let DefaultAzureCredential: any;

// GUID: LIB_SECRETS_MANAGER-002-v01
// [Intent] Singleton Key Vault client instance to avoid re-authentication on every secret fetch.
//          Initialized lazily on first use in production mode.
// [Inbound Trigger] First call to getSecretClient() when USE_KEY_VAULT=true.
// [Downstream Impact] Reused across all secret fetches in the same process. Credentials cached.
let keyVaultClient: any = null;

// GUID: LIB_SECRETS_MANAGER-003-v01
// [Intent] Environment-based feature flag to control Key Vault usage.
//          Defaults to false for safety (uses env vars unless explicitly enabled).
// [Inbound Trigger] Read once at module initialization from process.env.
// [Downstream Impact] Set to 'true' in production Container Apps environment variables.
//                     Leave unset or 'false' for local development.
const USE_KEY_VAULT = process.env.USE_KEY_VAULT === 'true';

// GUID: LIB_SECRETS_MANAGER-004-v01
// [Intent] Azure Key Vault URL from environment variable. Required when USE_KEY_VAULT=true.
//          Format: https://<vault-name>.vault.azure.net/
// [Inbound Trigger] Read once at module initialization from process.env.
// [Downstream Impact] Must be set in production environment. Example: https://prixsix-secrets-vault.vault.azure.net/
const KEY_VAULT_URL = process.env.KEY_VAULT_URL;

// GUID: LIB_SECRETS_MANAGER-005-v01
// [Intent] In-memory cache for secrets to reduce Key Vault API calls and improve performance.
//          Secrets cached for the lifetime of the Node.js process (serverless functions: per-instance).
// [Inbound Trigger] Updated on each getSecret() call with cache miss.
// [Downstream Impact] Secret rotation requires process restart to pick up new values.
//                     Trade-off: Performance vs freshness. Acceptable for daily rotations.
const secretCache = new Map<string, { value: string; fetchedAt: number }>();

// GUID: LIB_SECRETS_MANAGER-006-v01
// [Intent] Cache TTL in milliseconds. Secrets cached for 5 minutes to balance freshness vs performance.
// [Inbound Trigger] Referenced by getSecret() to determine if cached value is still valid.
// [Downstream Impact] Changing this affects secret rotation latency. 5 min = reasonable compromise.
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// GUID: LIB_SECRETS_MANAGER-007-v01
// [Intent] Initialize Azure Key Vault client with DefaultAzureCredential for production authentication.
//          Supports Managed Identity (production) and Azure CLI (local development with az login).
// [Inbound Trigger] First call to getSecret() when USE_KEY_VAULT=true.
// [Downstream Impact] Throws error if KEY_VAULT_URL not set or Azure SDK packages not installed.
async function getSecretClient() {
  if (keyVaultClient) {
    return keyVaultClient;
  }

  if (!KEY_VAULT_URL) {
    throw new Error(
      'KEY_VAULT_URL environment variable is required when USE_KEY_VAULT=true'
    );
  }

  try {
    // Lazy load Azure SDK packages
    if (!SecretClient || !DefaultAzureCredential) {
      const keyVaultModule = await import('@azure/keyvault-secrets');
      const identityModule = await import('@azure/identity');
      SecretClient = keyVaultModule.SecretClient;
      DefaultAzureCredential = identityModule.DefaultAzureCredential;
    }

    // Initialize client with Managed Identity or Azure CLI credentials
    const credential = new DefaultAzureCredential();
    keyVaultClient = new SecretClient(KEY_VAULT_URL, credential);

    return keyVaultClient;
  } catch (error: any) {
    throw new Error(
      `Failed to initialize Azure Key Vault client: ${error.message}. ` +
      'Ensure @azure/keyvault-secrets and @azure/identity packages are installed.'
    );
  }
}

// GUID: LIB_SECRETS_MANAGER-008-v01
// [Intent] Fetch secret from Azure Key Vault with caching and error handling.
//          Uses secret name as Key Vault secret identifier (e.g., 'firebase-admin-key').
// [Inbound Trigger] Called by getSecretClient() after cache miss or TTL expiry.
// [Downstream Impact] Requires network call to Key Vault. Failures throw errors (no silent fallback).
async function fetchFromKeyVault(secretName: string): Promise<string> {
  const client = await getSecretClient();

  try {
    const secret = await client.getSecret(secretName);

    if (!secret.value) {
      throw new Error(`Secret '${secretName}' exists but has no value in Key Vault`);
    }

    return secret.value;
  } catch (error: any) {
    // SECURITY: Don't log secret names or values in production logs
    throw new Error(
      `Failed to fetch secret from Key Vault (${error.statusCode || 'unknown error'}). ` +
      'Verify Key Vault permissions and secret name.'
    );
  }
}

// GUID: LIB_SECRETS_MANAGER-009-v01
// [Intent] Main public interface for fetching secrets. Abstracts Key Vault vs environment variable logic.
//          Tries cache first, then Key Vault (if enabled), then env vars as fallback.
// [Inbound Trigger] Called by application code needing secrets (firebase-admin.ts, email.ts, etc.).
// [Downstream Impact] In production (USE_KEY_VAULT=true), fetches from Azure Key Vault.
//                     In development, uses environment variables for convenience.
//                     Throws error if secret not found in any source.
/**
 * Get a secret value from Azure Key Vault or environment variables.
 *
 * @param secretName - The name of the secret (Key Vault name or env var name)
 * @param options - Optional configuration
 * @param options.required - If true (default), throw error if secret not found
 * @param options.envVarName - Override environment variable name (defaults to secretName)
 * @returns The secret value
 * @throws Error if secret not found and required=true
 *
 * @example
 * // In production with USE_KEY_VAULT=true, fetches from Azure Key Vault
 * const apiKey = await getSecret('graph-client-secret');
 *
 * @example
 * // In development, falls back to environment variable
 * const apiKey = await getSecret('graph-client-secret', { envVarName: 'GRAPH_CLIENT_SECRET' });
 */
export async function getSecret(
  secretName: string,
  options: { required?: boolean; envVarName?: string } = {}
): Promise<string> {
  const { required = true, envVarName = secretName } = options;

  // GUID: LIB_SECRETS_MANAGER-010-v01
  // [Intent] Check cache first to avoid unnecessary Key Vault API calls.
  // [Inbound Trigger] Every getSecret() call checks cache before fetching.
  // [Downstream Impact] Cache hits return immediately. Cache misses trigger fetch.
  const cached = secretCache.get(secretName);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < CACHE_TTL) {
    return cached.value;
  }

  let secretValue: string | undefined;

  // GUID: LIB_SECRETS_MANAGER-011-v01
  // [Intent] Fetch from Azure Key Vault if enabled, otherwise use environment variables.
  // [Inbound Trigger] Cache miss or TTL expired.
  // [Downstream Impact] Production mode (USE_KEY_VAULT=true) requires Key Vault setup.
  //                     Development mode uses process.env for convenience.
  if (USE_KEY_VAULT) {
    try {
      secretValue = await fetchFromKeyVault(secretName);
    } catch (error: any) {
      // If Key Vault fails, try env var fallback (safety net for local dev with USE_KEY_VAULT accidentally set)
      console.warn(
        `Key Vault fetch failed for '${secretName}', falling back to environment variable`
      );
      secretValue = process.env[envVarName];
    }
  } else {
    // Development mode: Use environment variables
    secretValue = process.env[envVarName];
  }

  // GUID: LIB_SECRETS_MANAGER-012-v01
  // [Intent] Validate secret was found and cache it for future requests.
  // [Inbound Trigger] After fetch attempt (Key Vault or env var).
  // [Downstream Impact] Missing required secrets throw errors. Optional secrets return empty string.
  if (!secretValue) {
    if (required) {
      throw new Error(
        `Secret '${secretName}' not found. ` +
        (USE_KEY_VAULT
          ? `Check Azure Key Vault '${KEY_VAULT_URL}'.`
          : `Set environment variable '${envVarName}'.`)
      );
    }
    return '';
  }

  // Cache the secret
  secretCache.set(secretName, { value: secretValue, fetchedAt: now });

  return secretValue;
}

// GUID: LIB_SECRETS_MANAGER-013-v01
// [Intent] Clear the secret cache. Useful for testing or forcing fresh fetches.
// [Inbound Trigger] Called manually during tests or secret rotation scenarios.
// [Downstream Impact] Next getSecret() call will fetch from source (Key Vault or env var).
export function clearSecretCache(): void {
  secretCache.clear();
}

// GUID: LIB_SECRETS_MANAGER-014-v01
// [Intent] Get current cache statistics for monitoring and debugging.
// [Inbound Trigger] Called by health check or admin monitoring endpoints.
// [Downstream Impact] Returns cache size and secret names (not values) for visibility.
export function getSecretCacheStats(): { size: number; keys: string[] } {
  return {
    size: secretCache.size,
    keys: Array.from(secretCache.keys()),
  };
}
