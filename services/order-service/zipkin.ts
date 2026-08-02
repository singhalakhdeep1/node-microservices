// Zipkin integration for node-microservices

const { Tracer, BatchRecorder, ExplicitContext, jsonEncoder } = require('zipkin');
const { HttpLogger } = require('zipkin-transport-http');

class ZipkinService {
  constructor(serviceName, zipkinUrl = 'http://localhost:9411') {
    this.serviceName = serviceName;
    
    const ctxImpl = new ExplicitContext();
    const recorder = new BatchRecorder({
      logger: new HttpLogger({
        endpoint: `${zipkinUrl}/api/v2/spans`,
        jsonEncoder: jsonEncoder.JSON_V2,
      }),
    });

    this.tracer = new Tracer({
      ctxImpl,
      recorder,
      localServiceName: serviceName,
    });
  }

  createSpan(name, parentId = null) {
    return this.tracer.createChildId(parentId);
  }

  recordAnnotation(spanId, annotation) {
    this.tracer.recordAnnotation(spanId, annotation);
  }

  recordBinary(spanId, key, value) {
    this.tracer.recordBinary(spanId, key, value);
  }

  recordServiceName(spanId, serviceName) {
    this.tracer.recordServiceName(spanId, serviceName);
  }

  recordRpc(spanId, name) {
    this.tracer.recordRpc(spanId, name);
  }

  recordBinaryAnnotation(spanId, key, value) {
    this.tracer.recordBinaryAnnotation(spanId, key, value);
  }

  recordMessage(spanId, messageId) {
    this.tracer.recordMessage(spanId, messageId);
  }

  recordClientSend(spanId) {
    this.tracer.recordClientSend(spanId);
  }

  recordClientReceive(spanId) {
    this.tracer.recordClientReceive(spanId);
  }

  recordServerSend(spanId) {
    this.tracer.recordServerSend(spanId);
  }

  recordServerReceive(spanId) {
    this.tracer.recordServerReceive(spanId);
  }

  recordLocalAddr(spanId, host, port) {
    this.tracer.recordLocalAddr(spanId, host, port);
  }

  recordRemoteAddr(spanId, host, port) {
    this.tracer.recordRemoteAddr(spanId, host, port);
  }

  scoped(spanId, callback) {
    return this.tracer.scoped(spanId, callback);
  }

  letId(spanId, callback) {
    return this.tracer.letId(spanId, callback);
  }

  getCurrentContext() {
    return this.tracer.ctxImpl.getCurrentContext();
  }

  setCurrentContext(context) {
    this.tracer.ctxImpl.setCurrentContext(context);
  }
}

module.exports = ZipkinService;
