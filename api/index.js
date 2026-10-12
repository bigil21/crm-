// Reuse the authenticated HTTP routes without opening a port or starting
// persistent workers inside a Vercel Function.
module.exports = require("../server").handleRequest;
