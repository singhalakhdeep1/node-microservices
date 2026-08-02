// Fluentd integration for node-microservices

const fluentLogger = require('fluent-logger');

class FluentdService {
  constructor(tag = 'myapp', options = {}) {
    const config = {
      host: options.host || 'localhost',
      port: options.port || 24224,
      timeout: options.timeout || 3.0,
      reconnectInterval: options.reconnectInterval || 600000,
      ...options,
    };

    this.sender = fluentLogger.createFluentSender(tag, config);
    this.tag = tag;
  }

  emit(label, data) {
    const fullTag = this.tag ? `${this.tag}.${label}` : label;
    return this.sender.emit(fullTag, data);
  }

  emitWithTime(label, data, timestamp) {
    const fullTag = this.tag ? `${this.tag}.${label}` : label;
    return this.sender.emit(fullTag, data, timestamp);
  }

  emitError(error, context = {}) {
    return this.emit('error', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      ...context,
    });
  }

  emitHttpRequest(req, res, duration) {
    return this.emit('http', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: duration,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  }

  emitDatabaseQuery(query, duration, resultCount) {
    return this.emit('database', {
      query: query,
      duration: duration,
      resultCount: resultCount,
    });
  }

  emitCustomEvent(label, data) {
    return this.emit(label, data);
  }

  end() {
    this.sender.end();
  }

  on('error', callback) {
    this.sender.on('error', callback);
  }

  isConnected() {
    return this.sender._isConnected;
  }
}

module.exports = FluentdService;
