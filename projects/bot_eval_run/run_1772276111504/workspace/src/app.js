const express = require('express');
const app = express();

app.use(express.json());

// Health endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

// Import project routes
const projectRoutes = require('./modules/projects/routes');
app.use('/projects', projectRoutes);

module.exports = app;
