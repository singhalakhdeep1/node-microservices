// Consul integration for node-microservices

const consul = require('consul');

class ConsulService {
  constructor(host = 'localhost', port = 8500) {
    this.client = new consul({
      host: host,
      port: port,
    });
  }

  async registerService(serviceConfig) {
    const registration = {
      name: serviceConfig.name,
      address: serviceConfig.address || 'localhost',
      port: serviceConfig.port,
      check: {
        http: serviceConfig.healthCheck || `http://${serviceConfig.address}:${serviceConfig.port}/health`,
        interval: '10s',
        timeout: '5s',
      },
      tags: serviceConfig.tags || [],
    };

    return this.client.agent.service.register(registration);
  }

  async deregisterService(serviceId) {
    return this.client.agent.service.deregister(serviceId);
  }

  async getService(serviceName) {
    return this.client.agent.service.list().then(services => {
      const serviceIds = Object.keys(services).filter(id => id.startsWith(serviceName));
      return Promise.all(
        serviceIds.map(id => this.client.agent.service.get({ id }))
      );
    });
  }

  async getAllServices() {
    return this.client.agent.service.list();
  }

  async healthCheck(serviceName) {
    return this.client.health.service(serviceName);
  }

  async putKeyValue(key, value) {
    return this.client.kv.set(key, value);
  }

  async getKeyValue(key) {
    return this.client.kv.get(key);
  }

  async deleteKeyValue(key) {
    return this.client.kv.del(key);
  }

  async watchKey(key, callback) {
    const watch = this.client.watch({ method: this.client.kv.get, params: { key } });
    watch.on('change', (data) => {
      callback(data);
    });
  }

  async createSession(sessionConfig) {
    const session = {
      name: sessionConfig.name || 'service-session',
      ttl: sessionConfig.ttl || '30s',
      behavior: sessionConfig.behavior || 'release',
    };
    return this.client.session.create(session);
  }

  async renewSession(sessionId) {
    return this.client.session.renew(sessionId);
  }

  async destroySession(sessionId) {
    return this.client.session.destroy(sessionId);
  }

  async acquireLock(key, sessionId) {
    return this.client.kv.set(key, sessionId, { acquire: sessionId });
  }

  async releaseLock(key, sessionId) {
    return this.client.kv.set(key, null, { release: sessionId });
  }
}

module.exports = ConsulService;
