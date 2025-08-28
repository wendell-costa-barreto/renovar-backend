// api/index.js
const app = require('../server'); // adjust path if server.js is in root
module.exports = (req, res) => {
  app(req, res); // delegate handling to Express
};
