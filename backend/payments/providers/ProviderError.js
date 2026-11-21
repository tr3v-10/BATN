class ProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.ambiguous = Boolean(options.ambiguous);
    this.httpStatus = options.httpStatus || null;
  }
}

module.exports = ProviderError;
