import path from "node:path";

import { z } from "zod";

import { Mutex } from "../state/locks.js";
import { readTextIfExists, writeFileAtomic } from "../util/paths.js";

export type ClientRecord = {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name?: string;
  createdAt: string;
};

export type TokenRecord = {
  accessToken: string;
  refreshToken?: string;
  clientId: string;
  subject: string;
  scopes: string[];
  expiresAt: string;
  createdAt: string;
};

export type OAuthStoreData = {
  clients: Record<string, ClientRecord>;
  tokens: Record<string, TokenRecord>;
};

const storeSchema = z
  .object({
    clients: z.record(z.string(), z.any()).default({}),
    tokens: z.record(z.string(), z.any()).default({}),
  })
  .default({ clients: {}, tokens: {} });

export class OAuthStore {
  private data: OAuthStoreData = { clients: {}, tokens: {} };
  private readonly lock = new Mutex();

  constructor(private readonly filePath: string) {}

  static atStateDir(stateDir: string): OAuthStore {
    return new OAuthStore(path.join(stateDir, "oauth-store.json"));
  }

  async load(): Promise<void> {
    const text = await readTextIfExists(this.filePath);
    this.data = text
      ? (storeSchema.parse(JSON.parse(text)) as OAuthStoreData)
      : { clients: {}, tokens: {} };
  }

  listClients(): ClientRecord[] {
    return Object.values(this.data.clients);
  }

  getClient(clientId: string): ClientRecord | undefined {
    return this.data.clients[clientId];
  }

  getToken(accessToken: string): TokenRecord | undefined {
    const token = this.data.tokens[accessToken];
    if (!token) return undefined;
    if (Date.parse(token.expiresAt) <= Date.now()) return undefined;
    return token;
  }

  async saveClient(client: ClientRecord): Promise<void> {
    await this.lock.runExclusive(async () => {
      this.data.clients[client.client_id] = client;
      await this.persist();
    });
  }

  async saveToken(token: TokenRecord): Promise<void> {
    await this.lock.runExclusive(async () => {
      this.data.tokens[token.accessToken] = token;
      await this.persist();
    });
  }

  private async persist(): Promise<void> {
    await writeFileAtomic(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`);
  }
}
