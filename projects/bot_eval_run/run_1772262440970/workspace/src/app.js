const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// In-memory repositories
const projectsRepo = {};
const tasksRepo = {};
const membersRepo = {};
const commentsRepo = {};

// Health endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

// Projects endpoints
const projectsModule = require('./modules/projects');
projectsModule.registerRoutes(app, projectsRepo, tasksRepo);

// Members endpoints
const membersModule = require('./modules/members');
membersModule.registerRoutes(app, projectsRepo, membersRepo);

// Tasks endpoints
const tasksModule = require('./modules/tasks');
tasksModule.registerRoutes(app, projectsRepo, tasksRepo, commentsRepo);

// Comments endpoints
const commentsModule = require('./modules/comments');
commentsModule.registerRoutes(app, tasksRepo, commentsRepo);

module.exports = { app };
