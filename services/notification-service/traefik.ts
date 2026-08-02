// Traefik integration for node-microservices

const axios = require('axios');

class TraefikService {
  constructor(apiUrl = 'http://localhost:8080') {
    this.apiUrl = apiUrl;
  }

  async getProviders() {
    const response = await axios.get(`${this.apiUrl}/api/providers`);
    return response.data;
  }

  async getHTTPRouters() {
    const response = await axios.get(`${this.apiUrl}/api/http/routers`);
    return response.data;
  }

  async getHTTPServices() {
    const response = await axios.get(`${this.apiUrl}/api/http/services`);
    return response.data;
  }

  async getHTTPMiddlewares() {
    const response = await axios.get(`${this.apiUrl}/api/http/middlewares`);
    return response.data;
  }

  async getTCPRouters() {
    const response = await axios.get(`${this.apiUrl}/api/tcp/routers`);
    return response.data;
  }

  async getTCPServices() {
    const response = await axios.get(`${this.apiUrl}/api/tcp/services`);
    return response.data;
  }

  async getEntryPoints() {
    const response = await axios.get(`${this.apiUrl}/api/entrypoints`);
    return response.data;
  }

  async createHTTPRouter(routerConfig) {
    const response = await axios.post(
      `${this.apiUrl}/api/http/routers/${routerConfig.name}`,
      routerConfig
    );
    return response.data;
  }

  async createHTTPService(serviceConfig) {
    const response = await axios.post(
      `${this.apiUrl}/api/http/services/${serviceConfig.name}`,
      serviceConfig
    );
    return response.data;
  }

  async createHTTPMiddleware(middlewareConfig) {
    const response = await axios.post(
      `${this.apiUrl}/api/http/middlewares/${middlewareConfig.name}`,
      middlewareConfig
    );
    return response.data;
  }

  async updateHTTPRouter(name, routerConfig) {
    const response = await axios.put(
      `${this.apiUrl}/api/http/routers/${name}`,
      routerConfig
    );
    return response.data;
  }

  async deleteHTTPRouter(name) {
    const response = await axios.delete(`${this.apiUrl}/api/http/routers/${name}`);
    return response.data;
  }

  async getServiceHealth(serviceName) {
    const response = await axios.get(
      `${this.apiUrl}/api/http/services/${serviceName}/health`
    );
    return response.data;
  }

  async getDashboardStats() {
    const response = await axios.get(`${this.apiUrl}/api/dashboard/stats`);
    return response.data;
  }
}

module.exports = TraefikService;
