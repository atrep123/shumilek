const express = require('express');
const app = express();

app.use(express.json());

// Health endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

// Import modules
require('./modules/projects/routes')(app);
require('./modules/tasks/routes')(app);
require('./modules/members/routes')(app);
require('./modules/comments/routes')(app);

module.exports = { app };
