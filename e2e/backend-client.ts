import axios, { AxiosInstance } from 'axios';

export class BackendClient {
  private api: AxiosInstance;
  private token: string | null = null;

  constructor(baseURL = 'http://localhost:3000') {
    this.api = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async login(email = 'admin@atulyam.com', password = 'password123') {
    const response = await this.api.post('/v1/auth/login', { email, password });
    this.token = response.data.accessToken;
    this.api.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
    return response.data;
  }

  async getSales(storeId: string) {
    const response = await this.api.get('/v1/sales', { params: { storeId } });
    return response.data;
  }

  async getInventory(storeId: string, variantId?: string) {
    const response = await this.api.get('/v1/inventory', { params: { storeId, variantId } });
    return response.data;
  }

  async getNotifications() {
    const response = await this.api.get('/v1/notifications');
    return response.data;
  }
}
