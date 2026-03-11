function Error(code, message) {
  this.code = code;
  this.message = message;
}

Error.prototype.toString = function() {
  return `${this.code}: ${this.message}`;
};

module.exports = { Error };
