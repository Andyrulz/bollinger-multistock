export class SwingServiceProxy {
  constructor(private readonly baseUrl = process.env.SWING_SERVICE_URL || 'http://127.0.0.1:3002') {}

  async request(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), method === 'POST' ? 600_000 : 5_000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const responseBody = await response.json().catch(() => ({ error: 'Invalid Swing service response' }));
      return { status: response.status, body: responseBody };
    } catch (error) {
      return {
        status: 503,
        body: {
          error: 'Swing scanner service unavailable',
          details: error instanceof Error ? error.message : 'Connection failed',
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
