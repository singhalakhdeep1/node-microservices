/**
 * Service Discovery for Node Microservices
 * Implements service registration and discovery pattern
 */
class ServiceDiscovery {
  constructor() {
    this.services = new Map();
    this.heartbeatInterval = 30000; // 30 seconds
    this.heartbeatTimeout = 60000; // 60 seconds
  }

  registerService(serviceName, instanceId, host, port, healthCheckUrl, metadata = {}) {
    const instance = {
      serviceName,
      instanceId,
      host,
      port,
      healthCheckUrl,
      metadata,
      lastHeartbeat: Date.now(),
      isHealthy: true
    };

    if (!this.services.has(serviceName)) {
      this.services.set(serviceName, []);
    }

    // Remove existing instance with same ID
    this.services.set(serviceName, this.services.get(serviceName).filter(s => s.instanceId !== instanceId));
    this.services.get(serviceName).push(instance);

    console.log(`Registered service instance: ${serviceName}/${instanceId} at ${host}:${port}`);
  }

  deregisterService(serviceName, instanceId) {
    if (this.services.has(serviceName)) {
      this.services.set(serviceName, this.services.get(serviceName).filter(s => s.instanceId !== instanceId));
      console.log(`Deregistered service instance: ${serviceName}/${instanceId}`);
    }
  }

  discoverService(serviceName) {
    if (!this.services.has(serviceName) || this.services.get(serviceName).length === 0) {
      return null;
    }

    const healthyInstances = this.services.get(serviceName).filter(
      s => s.isHealthy && (Date.now() - s.lastHeartbeat) < this.heartbeatTimeout
    );

    if (healthyInstances.length === 0) {
      return null;
    }

    // Simple round-robin selection
    return healthyInstances[0];
  }

  discoverAllInstances(serviceName) {
    if (!this.services.has(serviceName)) {
      return [];
    }

    return this.services.get(serviceName).filter(
      s => s.isHealthy && (Date.now() - s.lastHeartbeat) < this.heartbeatTimeout
    );
  }

  sendHeartbeat(serviceName, instanceId) {
    if (this.services.has(serviceName)) {
      const instance = this.services.get(serviceName).find(s => s.instanceId === instanceId);
      if (instance) {
        instance.lastHeartbeat = Date.now();
        instance.isHealthy = true;
      }
    }
  }

  async healthCheck() {
    // In a real implementation, this would perform actual HTTP health checks
    for (const [serviceName, instances] of this.services) {
      for (const instance of instances) {
        // Simulate health check
        instance.isHealthy = true;
      }
    }
  }

  cleanupUnhealthyInstances() {
    const now = Date.now();

    for (const serviceName of this.services.keys()) {
      this.services.set(serviceName, this.services.get(serviceName).filter(
        s => (now - s.lastHeartbeat) < this.heartbeatTimeout
      ));

      if (this.services.get(serviceName).length === 0) {
        this.services.delete(serviceName);
      }
    }
  }

  getAllServices() {
    return new Map(this.services);
  }
}

module.exports = ServiceDiscovery;
