const express = require('express');
const crypto = require('node:crypto');

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

// Projects routes
const projectsRoutes = require('./modules/projects/routes');
projectsRoutes(app, { projectsRepo, tasksRepo, membersRepo, commentsRepo, crypto });

// Tasks routes
const tasksRoutes = require('./modules/tasks/routes');
tasksRoutes(app, { projectsRepo, tasksRepo, membersRepo, commentsRepo, crypto });

// Members routes
const membersRoutes = require('./modules/members/routes');
membersRoutes(app, { projectsRepo, tasksRepo, membersRepo, commentsRepo, crypto });

// Comments routes
const commentsRoutes = require('./modules/comments/routes');
commentsRoutes(app, { projectsRepo, tasksRepo, membersRepo, commentsRepo, crypto });

module.exports = app;
