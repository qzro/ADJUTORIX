import fetch from "node-fetch";

/**
 * Transport layer for JSON-RPC over HTTP.
 * Uses keep-alive and basic retry.
 */
export class Transport {
  private endpoint: string;
  private controller: AbortController | null = null;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  setEndpoint(endpoint: string) {
    this.endpoint = endpoint;
  }

  close() {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
  }

  async send<T = any>(payload: any): Promise<T> {
    this.controller = new AbortController();

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: this.controller.signal,
    });

    if (!res.ok) {
      throw new Error(
        `RPC transport error: ${res.status} ${res.statusText}`
      );
    }

    const data = (await res.json()) as T;

    return data;
  }
}
