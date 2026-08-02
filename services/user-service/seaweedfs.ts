// SeaweedFS integration for node-microservices

const seaweedfs = require('seaweedfs-client');

class SeaweedFSService {
  constructor(options = {}) {
    this.client = new seaweedfs({
      server: options.server || 'localhost',
      port: options.port || 9333,
      scheme: options.scheme || 'http',
    });
  }

  async uploadFile(filePath, options = {}) {
    return this.client.upload(filePath, {
      collection: options.collection || 'default',
      ttl: options.ttl,
      maxMB: options.maxMB || 100,
      ...options,
    });
  }

  async uploadBuffer(buffer, fileName, options = {}) {
    return this.client.uploadBuffer(buffer, fileName, {
      collection: options.collection || 'default',
      ttl: options.ttl,
      maxMB: options.maxMB || 100,
      ...options,
    });
  }

  async downloadFile(fileId, savePath) {
    return this.client.download(fileId, savePath);
  }

  async downloadBuffer(fileId) {
    return this.client.downloadBuffer(fileId);
  }

  async getFileUrl(fileId) {
    return this.client.getFileUrl(fileId);
  }

  async deleteFile(fileId) {
    return this.client.delete(fileId);
  }

  async getFileInfo(fileId) {
    return this.client.getFileInfo(fileId);
  }

  async listFiles(volumeId) {
    return this.client.listFiles(volumeId);
  }

  async createVolume(collectionName, replication = '001') {
    return this.client.createVolume({
      collection: collectionName,
      replication: replication,
    });
  }

  async deleteVolume(volumeId) {
    return this.client.deleteVolume(volumeId);
  }

  async getVolumeStatus(volumeId) {
    return this.client.getVolumeStatus(volumeId);
  }

  async getSystemStatus() {
    return this.client.getSystemStatus();
  }

  async getMasterStatus() {
    return this.client.getMasterStatus();
  }

  async getVolumeServers() {
    return this.client.getVolumeServers();
  }

  async assignVolume(count = 1, replication = '001', collection = 'default') {
    return this.client.assignVolume({
      count: count,
      replication: replication,
      collection: collection,
    });
  }

  async lookupVolume(fileId) {
    return this.client.lookupVolume(fileId);
  }
}

module.exports = SeaweedFSService;
