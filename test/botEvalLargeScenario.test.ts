import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  applyNodeProjectContractAutoFixes,
  applyNodeProjectRouteServiceAdapterBridges,
  buildNodeProjectContractFixGuidance,
  buildRepairPrompt,
  buildReviewerPrompt,
  buildRouteServiceMismatchGuidance,
  collectNodeProjectApiLargeOracleDiagnostics,
  computePrimaryGenerationTimeoutMs,
  computeReviewerTimeoutMs,
  computeTimeoutFallbackGenerationTimeoutMs,
  dedupeFileSpecsByPath,
  getTimeoutFallbackModelsForScenario,
  getTimeoutFallbackModelForScenario,
  isDeterministicFallbackEnabled,
  parseRouteServiceMismatchDiagnostics,
  promoteLargePatchToFullFromWorkspace,
  sanitizeReviewerNote,
  shouldRequireFullModeAfterLargeFailure,
  shouldStopAfterGenerationTimeout,
  validateNodeProjectApiLarge
} from '../scripts/botEval';

function writeFile(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function seedLargeWorkspace(params?: {
  includeReadme?: boolean;
  includePackage?: boolean;
  includeMembersModule?: boolean;
  sourceFilesTarget?: number;
}): string {
  const includeReadme = params?.includeReadme !== false;
  const includePackage = params?.includePackage !== false;
  const includeMembersModule = params?.includeMembersModule !== false;
  const sourceFilesTarget = params?.sourceFilesTarget ?? 12;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-node-project-large-'));

  if (includeReadme) {
    writeFile(root, 'README.md', '# Node Project API Large\n');
  }

  if (includePackage) {
    writeFile(root, 'package.json', JSON.stringify({
      name: 'node-project-api-large-fixture',
      private: true,
      version: '0.0.0',
      dependencies: {
        express: '^4.19.2'
      },
      devDependencies: {
        supertest: '^7.1.0'
      }
    }, null, 2));
  }

  writeFile(root, 'src/app.js', 'module.exports = function app() {};\n');
  writeFile(root, 'src/server.js', 'module.exports = {};\n');

  const modules = ['projects', 'tasks', 'comments'];
  if (includeMembersModule) modules.push('members');

  for (const moduleName of modules) {
    writeFile(root, `src/modules/${moduleName}/service.js`, 'module.exports = {};\n');
    writeFile(root, `src/modules/${moduleName}/routes.js`, 'module.exports = {};\n');
  }

  let createdSourceCount = 2 + modules.length * 2;
  let i = 1;
  while (createdSourceCount < sourceFilesTarget) {
    writeFile(root, `src/lib/extra${i}.js`, 'module.exports = {};\n');
    createdSourceCount += 1;
    i += 1;
  }

  return root;
}

function seedLargeWorkspaceWithContractRoutes(): string {
  const root = seedLargeWorkspace({ sourceFilesTarget: 12 });
  writeFile(
    root,
    'src/app.js',
    [
      "const express = require('express');",
      'const app = express();',
      'app.use(express.json());',
      "app.get('/health', (req, res) => res.status(200).json({ ok: true }));",
      "app.use('/projects', require('./modules/projects/routes'));",
      "app.use('/projects/:projectId/members', require('./modules/members/routes'));",
      "app.use('/projects/:projectId/tasks', require('./modules/tasks/routes'));",
      "app.use('/projects/:projectId/tasks/:taskId/comments', require('./modules/comments/routes'));",
      'module.exports = app;',
      ''
    ].join('\n')
  );
  writeFile(root, 'src/lib/id.js', "const { randomUUID } = require('node:crypto');\nmodule.exports = { generateId: () => randomUUID() };\n");
  writeFile(root, 'src/lib/errors.js', "module.exports = { sendError: (res, status, code, message) => res.status(status).json({ error: { code, message } }) };\n");
  writeFile(root, 'src/modules/projects/routes.js', "const r=require('express').Router();r.get('/',(q,s)=>s.json({projects:[]}));r.post('/',(q,s)=>s.status(201).json({project:{id:'p1',name:'x'}}));r.get('/:projectId',(q,s)=>s.json({project:{id:q.params.projectId,name:'x'}}));module.exports=r;\n");
  writeFile(root, 'src/modules/projects/service.js', 'module.exports = {};\n');
  writeFile(root, 'src/modules/members/routes.js', "const r=require('express').Router();r.post('/',(q,s)=>s.status(201).json({member:{id:'m1',userId:'u1',role:'owner'}}));r.get('/',(q,s)=>s.json({members:[]}));module.exports=r;\n");
  writeFile(root, 'src/modules/members/service.js', 'module.exports = {};\n');
  writeFile(root, 'src/modules/tasks/routes.js', "const r=require('express').Router();r.get('/',(q,s)=>s.json({tasks:[]}));r.post('/',(q,s)=>s.status(201).json({task:{id:'t1',status:'todo'}}));r.patch('/:taskId',(q,s)=>s.json({task:{id:q.params.taskId,status:'done'}}));module.exports=r;\n");
  writeFile(root, 'src/modules/tasks/service.js', 'module.exports = {};\n');
  writeFile(root, 'src/modules/comments/routes.js', "const r=require('express').Router();r.post('/',(q,s)=>s.status(201).json({comment:{id:'c1',message:'ok'}}));r.get('/',(q,s)=>s.json({comments:[]}));module.exports=r;\n");
  writeFile(root, 'src/modules/comments/service.js', 'module.exports = {};\n');
  return root;
}

describe('botEval large node-project scenario', function () {
  this.timeout(30_000);
  it('disables deterministic fallback for large scenario', () => {
    assert.equal(isDeterministicFallbackEnabled('node-project-api-large'), false);
    assert.equal(isDeterministicFallbackEnabled('node-api-oracle'), true);
  });

  it('fails validation when source files are below minimum', async () => {
    const workspace = seedLargeWorkspace({ sourceFilesTarget: 8 });
    try {
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /at least 12 source files/i.test(d)));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('fails validation when a required domain module is missing', async () => {
    const workspace = seedLargeWorkspace({ includeMembersModule: false, sourceFilesTarget: 12 });
    try {
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /src\/modules\/members\//i.test(d)));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('fails validation when README or package.json is missing', async () => {
    const missingReadme = seedLargeWorkspace({ includeReadme: false, sourceFilesTarget: 12 });
    try {
      const result = await validateNodeProjectApiLarge(missingReadme);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Missing required file: README\.md/i.test(d)));
    } finally {
      fs.rmSync(missingReadme, { recursive: true, force: true });
    }

    const missingPackage = seedLargeWorkspace({ includePackage: false, sourceFilesTarget: 12 });
    try {
      const result = await validateNodeProjectApiLarge(missingPackage);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Missing required file: package\.json/i.test(d)));
    } finally {
      fs.rmSync(missingPackage, { recursive: true, force: true });
    }
  });

  it('fails preflight when required route signatures are missing and skips command checks', async () => {
    const workspace = seedLargeWorkspace({ sourceFilesTarget: 12 });
    try {
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Missing route signature for \/health/i.test(d)));
      assert.ok(result.diagnostics.some(d => /Skipped oracle command checks/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags uuid package usage in sources', async () => {
    const workspace = seedLargeWorkspace({ sourceFilesTarget: 12 });
    try {
      writeFile(
        workspace,
        'src/modules/projects/service.js',
        'const { v4: uuidv4 } = require("uuid");\nmodule.exports = { createProject: () => ({ id: uuidv4() }) };\n'
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /do not use \"uuid\" package/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags invalid module helper import path ../lib/*', async () => {
    const workspace = seedLargeWorkspace({ sourceFilesTarget: 12 });
    try {
      writeFile(
        workspace,
        'src/modules/projects/service.js',
        'const id = require("../lib/id");\nmodule.exports = { makeId: () => id.nextId() };\n'
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Invalid shared helper import path/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags ambiguous module helper import ../../lib', async () => {
    const workspace = seedLargeWorkspace({ sourceFilesTarget: 12 });
    try {
      writeFile(
        workspace,
        'src/modules/projects/service.js',
        'const shared = require("../../lib");\nmodule.exports = { shared };\n'
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Ambiguous shared helper import/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags routes importing ../service instead of ./service', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/members/routes.js',
        [
          "const router = require('express').Router();",
          "const membersService = require('../service');",
          "router.get('/', async (_req, res) => res.json({ members: await membersService.getMembers('p1') }));",
          'module.exports = router;',
          ''
        ].join('\n')
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Route import contract mismatch in src\/modules\/members\/routes\.js/i.test(d)));
      assert.ok(result.diagnostics.some(d => /Skipped oracle command checks/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags uncaught throw in route handlers', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/members/routes.js',
        "const router = require('express').Router();router.post('/', () => { throw new Error('boom'); });module.exports = router;\n"
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Avoid uncaught throw/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags comments payload mismatch when using content instead of message', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/comments/routes.js',
        "const router = require('express').Router();router.post('/', (req, res) => res.status(201).json({ comment: { content: req.body.content } }));module.exports = router;\n"
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Comments contract mismatch: use payload field `message`/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags sendError helper export mismatch before oracle command checks', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/projects/routes.js',
        [
          "const router = require('express').Router();",
          "const { sendError } = require('../../lib/errors');",
          "router.get('/', (_req, res) => sendError(res, 500, 'INTERNAL_ERROR', 'x'));",
          "router.post('/', (_req, res) => res.status(201).json({ project: { id: 'p1', name: 'x' } }));",
          "router.get('/:projectId', (req, res) => res.json({ project: { id: req.params.projectId, name: 'x' } }));",
          'module.exports = router;',
          ''
        ].join('\n')
      );
      writeFile(
        workspace,
        'src/lib/errors.js',
        "function createErrorPayload(code, message) { return { error: { code, message } }; }\nmodule.exports = { createErrorPayload };\n"
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /sendError helper export mismatch/i.test(d)));
      assert.ok(result.diagnostics.some(d => /Skipped oracle command checks/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags generateId helper export mismatch before oracle command checks', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/projects/service.js',
        [
          "const { generateId } = require('../../lib/id');",
          'const projects = [];',
          "module.exports = { createProject: (name) => { const project = { id: generateId(), name }; projects.push(project); return project; }, getAllProjects: () => projects, getProjectById: (id) => projects.find(p => p.id === id) || null, getProjectByName: (name) => projects.find(p => p.name === name) || null };",
          ''
        ].join('\n')
      );
      writeFile(
        workspace,
        'src/lib/id.js',
        "const { randomUUID } = require('node:crypto');\nmodule.exports = { randomUUID };\n"
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /generateId helper export mismatch/i.test(d)));
      assert.ok(result.diagnostics.some(d => /Skipped oracle command checks/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags isolated local projects map in tasks service', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/tasks/service.js',
        "const projects = {}; module.exports = { list: () => Object.keys(projects) };\n"
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /State-sharing mismatch: tasks service should reuse shared projects repository/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags invalid crypto randomUUID aliasing pattern', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/projects/service.js',
        "const { v4: uuidv4 } = require('crypto').randomUUID;\nmodule.exports = { createProject: () => ({ id: uuidv4() }) };\n"
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Invalid randomUUID usage/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags randomUUID() usage without node:crypto binding', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/projects/service.js',
        [
          'const projects = [];',
          'async function createProject(name) {',
          "  const project = { id: randomUUID(), name: String(name || '') };",
          '  projects.push(project);',
          '  return project;',
          '}',
          'module.exports = { createProject, projects };',
          ''
        ].join('\n')
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /randomUUID binding mismatch in src\/modules\/projects\/service\.js/i.test(d)));
      assert.ok(result.diagnostics.some(d => /Skipped oracle command checks/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags missing project detail route signature in projects module', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/projects/routes.js',
        "const r=require('express').Router();r.get('/',(q,s)=>s.json({projects:[]}));r.post('/',(q,s)=>s.status(201).json({project:{id:'p1'}}));module.exports=r;\n"
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Missing route signature for project detail endpoint/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags comments->tasks cross-module API mismatch', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/comments/service.js',
        "const taskService = require('../tasks/service');\nmodule.exports = { add: (projectId) => taskService.getTasksByProject(projectId) };\n"
      );
      writeFile(
        workspace,
        'src/modules/tasks/service.js',
        "module.exports = { getTasks: () => [] };\n"
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Cross-module contract mismatch: comments service calls taskService\.getTasksByProject\(\)/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags route-service mismatch when routes call non-exported service methods', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/projects/routes.js',
        [
          "const r=require('express').Router();",
          "const projectsService=require('./service');",
          "r.get('/',async(q,s)=>s.json({projects:await projectsService.getAllProjects()}));",
          "r.get('/:projectId',async(q,s)=>s.json({project:await projectsService.getProjectById(q.params.projectId)}));",
          "r.post('/',async(q,s)=>s.status(201).json({project:await projectsService.createProject(q.body.name)}));",
          'module.exports=r;',
          ''
        ].join('\n')
      );
      writeFile(
        workspace,
        'src/modules/projects/service.js',
        "module.exports = { createProject: () => ({ id: 'p1' }), getProjects: () => [] };\n"
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Route-service contract mismatch \(projects\)/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('does not report false route-service mismatch for module.exports method shorthand bodies', async function () {
    this.timeout(30000);
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/projects/routes.js',
        [
          "const router = require('express').Router();",
          "const projectsService = require('./service');",
          "router.get('/', async (_req, res) => res.json({ projects: await projectsService.getAllProjects() }));",
          "router.get('/:projectId', async (req, res) => res.json({ project: await projectsService.getProjectById(req.params.projectId) }));",
          "router.post('/', async (req, res) => res.status(201).json({ project: await projectsService.createProject(req.body.name) }));",
          'module.exports = router;',
          ''
        ].join('\n')
      );
      writeFile(
        workspace,
        'src/modules/projects/service.js',
        [
          'module.exports = {',
          "  getAllProjects() { const sample = { id: 'p1', name: 'x' }; return [sample]; },",
          "  getProjectById(id) { return { id, name: 'x' }; },",
          "  getProjectByName(name) { return name ? { id: 'p2', name } : null; },",
          "  createProject(name) { return { id: 'p3', name }; }",
          '};',
          ''
        ].join('\n')
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(!result.diagnostics.some(d => /Route-service contract mismatch \(projects\)/i.test(d)));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('does not report false route-service mismatch for module.exports identifier object alias', async function () {
    this.timeout(30000);
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/members/routes.js',
        [
          "const router = require('express').Router();",
          "const membersService = require('./service');",
          "router.post('/', async (req, res) => res.status(201).json({ member: await membersService.createMember(req.body.userId, req.body.role) }));",
          'module.exports = router;',
          ''
        ].join('\n')
      );
      writeFile(
        workspace,
        'src/modules/members/service.js',
        [
          'const membersService = {',
          "  createMember(userId, role) { return { id: 'm1', userId, role }; },",
          '  getMembers() { return []; }',
          '};',
          'module.exports = membersService;',
          ''
        ].join('\n')
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(!result.diagnostics.some(d => /Route-service contract mismatch \(members\)/i.test(d)));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags POST create status mismatches for members/tasks/comments', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/members/routes.js',
        "const r=require('express').Router();r.post('/',(q,s)=>s.json({member:{id:'m1',userId:'u1',role:'owner'}}));r.get('/',(q,s)=>s.json({members:[]}));module.exports=r;\n"
      );
      writeFile(
        workspace,
        'src/modules/tasks/routes.js',
        "const r=require('express').Router();r.get('/',(q,s)=>s.json({tasks:[]}));r.post('/',(q,s)=>s.json({task:{id:'t1',status:'todo'}}));r.patch('/:taskId',(q,s)=>s.json({task:{id:q.params.taskId,status:'done'}}));module.exports=r;\n"
      );
      writeFile(
        workspace,
        'src/modules/comments/routes.js',
        "const r=require('express').Router();r.post('/',(q,s)=>s.json({comment:{id:'c1',message:'ok'}}));r.get('/',(q,s)=>s.json({comments:[]}));module.exports=r;\n"
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /POST \/projects\/:projectId\/members should return HTTP 201/i.test(d)));
      assert.ok(result.diagnostics.some(d => /POST \/projects\/:projectId\/tasks should return HTTP 201/i.test(d)));
      assert.ok(result.diagnostics.some(d => /POST \/projects\/:projectId\/tasks\/:taskId\/comments should return HTTP 201/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags tasks PATCH status contract when pending/open is allowed', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/tasks/routes.js',
        "const r=require('express').Router();r.get('/',(q,s)=>s.json({tasks:[]}));r.post('/',(q,s)=>s.status(201).json({task:{id:'t1',status:'todo'}}));r.patch('/:taskId',(q,s)=>{if(!['done','pending'].includes(q.body.status)){return s.status(400).json({error:{code:'BAD_REQUEST',message:'Invalid status'}})}return s.json({task:{id:q.params.taskId,status:q.body.status}})});module.exports=r;\n"
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /PATCH status must allow only "todo" or "done"/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('maps oracle logs to actionable contract diagnostics', () => {
    const sample = [
      'health + empty project list',
      'AssertionError [ERR_ASSERTION]: {"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}',
      '500 !== 200',
      'members endpoints',
      '200 !== 201',
      'tasks create/list/filter + patch status',
      '200 !== 201',
      "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n+ actual - expected\n+ undefined\n- 'Prepare spec'",
      'comments + not-found and payload contract',
      '200 !== 201',
      "TypeError: Cannot read properties of null (reading 'id')",
      'TypeError: projectsService.getProjectByName is not a function',
      'TypeError: sendError is not a function',
      'TypeError: errorHandler is not a function',
      'TypeError: generateId is not a function',
      'ReferenceError: randomUUID is not defined',
      "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n+ actual - expected\n+ '[object Object]'\n- 'Prepare spec'",
      'members endpoints',
      '201 !== 409',
      'project create/list/get + duplicate + validation',
      '0 !== 1'
    ].join('\n');
    const diagnostics = collectNodeProjectApiLargeOracleDiagnostics(sample);
    assert.ok(diagnostics.some(d => /GET \/health/i.test(d)));
    assert.ok(diagnostics.some(d => /POST \/projects\/:projectId\/members must return HTTP 201/i.test(d)));
    assert.ok(diagnostics.some(d => /POST \/projects\/:projectId\/tasks must return HTTP 201/i.test(d)));
    assert.ok(diagnostics.some(d => /POST \/projects\/:projectId\/tasks\/:taskId\/comments must return HTTP 201/i.test(d)));
    assert.ok(diagnostics.some(d => /generic INTERNAL_ERROR 500/i.test(d)));
    assert.ok(diagnostics.some(d => /Duplicate member add/i.test(d)));
    assert.ok(diagnostics.some(d => /project must be visible in list\/get/i.test(d)));
    assert.ok(diagnostics.some(d => /preserve task title/i.test(d)));
    assert.ok(diagnostics.some(d => /returned null entity/i.test(d)));
    assert.ok(diagnostics.some(d => /projectsService\.getProjectByName is missing/i.test(d)));
    assert.ok(diagnostics.some(d => /sendError helper contract mismatch/i.test(d)));
    assert.ok(diagnostics.some(d => /Route error-handler mismatch/i.test(d)));
    assert.ok(diagnostics.some(d => /generateId helper mismatch/i.test(d)));
    assert.ok(diagnostics.some(d => /randomUUID binding mismatch/i.test(d)));
    assert.ok(diagnostics.some(d => /Task payload mismatch/i.test(d)));
  });

  it('parses route-service mismatch diagnostics into deterministic method map', () => {
    const diagnostics = [
      'Route-service contract mismatch (projects): routes call projectsService.getProjectById() but service does not export "getProjectById".',
      'Route-service contract mismatch (projects): routes call projectsService.createProject() but service does not export "createProject".',
      'Route-service contract mismatch (projects): routes call projectsService.createProject() but service does not export "createProject".',
      'Route-service contract mismatch (tasks): routes call tasksService.updateTaskStatus() but service does not export "updateTaskStatus".',
      'Some unrelated diagnostic'
    ];
    const parsed = parseRouteServiceMismatchDiagnostics(diagnostics);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].moduleName, 'projects');
    assert.equal(parsed[0].serviceAlias, 'projectsService');
    assert.deepEqual(parsed[0].methods, ['createProject', 'getProjectById']);
    assert.equal(parsed[1].moduleName, 'tasks');
    assert.equal(parsed[1].serviceAlias, 'tasksService');
    assert.deepEqual(parsed[1].methods, ['updateTaskStatus']);
  });

  it('builds explicit route-service guidance only when mismatch diagnostics exist', () => {
    const diagnostics = [
      'Route-service contract mismatch (comments): routes call commentsService.getAllComments() but service does not export "getAllComments".',
      'Route-service contract mismatch (comments): routes call commentsService.addComment() but service does not export "addComment".'
    ];
    const lines = buildRouteServiceMismatchGuidance(diagnostics);
    const text = lines.join('\n');
    assert.ok(text.includes('ROUTE-SERVICE EXPORT MAP (AUTO-GENERATED)'));
    assert.ok(text.includes('module comments: service alias commentsService'));
    assert.ok(text.includes('required exported methods: addComment, getAllComments'));
    assert.ok(text.includes('expected file: src/modules/comments/service.js (or ts/mjs/cjs equivalent)'));

    const empty = buildRouteServiceMismatchGuidance(['Missing route signature for /health']);
    assert.deepEqual(empty, []);
  });

  it('builds node-project contract fix guidance from structural diagnostics', () => {
    const lines = buildNodeProjectContractFixGuidance([
      'Missing route signature for project detail endpoint /projects/:projectId',
      'Uses `new BadRequestError(...)` but src/lib/errors.* does not define/export BadRequestError',
      'State-sharing mismatch: members service should reuse shared projects repository, not isolated members map/array',
      'Task filtering contract mismatch: support ?status=todo|done and PATCH status updates.',
      'Skipped oracle command checks because structural contract did not pass.'
    ]);
    const text = lines.join('\n');
    assert.ok(text.includes('NODE PROJECT CONTRACT FIX MAP (AUTO-GENERATED)'));
    assert.ok(text.includes('projects routes: add `GET /:projectId` handler'));
    assert.ok(text.includes('do NOT use undefined `BadRequestError`/`NotFoundError`'));
    assert.ok(text.includes('members state: do not keep isolated `members` array/map'));
    assert.ok(text.includes('tasks contract: `GET /projects/:projectId/tasks?status=todo|done`'));
    assert.ok(text.includes('priority: resolve all structural diagnostics first'));
    assert.deepEqual(buildNodeProjectContractFixGuidance(['Missing route signature for /health']), []);
  });

  it('injects route-service export map into repair prompt only for large scenario mismatch', async () => {
    const prompt = await buildRepairPrompt(
      'BASE SPEC',
      {
        ok: false,
        diagnostics: [
          'Route-service contract mismatch (projects): routes call projectsService.getAllProjects() but service does not export "getAllProjects".'
        ],
        commands: []
      },
      undefined,
      undefined,
      'node-project-api-large'
    );
    assert.ok(prompt.includes('ROUTE-SERVICE EXPORT MAP (AUTO-GENERATED)'));
    assert.ok(prompt.includes('required exported methods: getAllProjects'));

    const promptWithoutMismatch = await buildRepairPrompt(
      'BASE SPEC',
      {
        ok: false,
        diagnostics: ['Missing route signature for /health'],
        commands: []
      },
      undefined,
      undefined,
      'node-project-api-large'
    );
    assert.ok(!promptWithoutMismatch.includes('ROUTE-SERVICE EXPORT MAP (AUTO-GENERATED)'));
  });

  it('injects node-project contract fix map into repair prompt when structural diagnostics are present', async () => {
    const prompt = await buildRepairPrompt(
      'BASE SPEC',
      {
        ok: false,
        diagnostics: [
          'Missing route signature for project detail endpoint /projects/:projectId',
          'Task filtering contract mismatch: support ?status=todo|done and PATCH status updates.',
          'Skipped oracle command checks because structural contract did not pass.'
        ],
        commands: []
      },
      undefined,
      undefined,
      'node-project-api-large'
    );
    assert.ok(prompt.includes('NODE PROJECT CONTRACT FIX MAP (AUTO-GENERATED)'));
    assert.ok(prompt.includes('projects routes: add `GET /:projectId` handler'));
    assert.ok(prompt.includes('tasks contract: `GET /projects/:projectId/tasks?status=todo|done`'));
  });

  it('injects route-service export map into reviewer prompt for large scenario mismatch', async () => {
    const prompt = await buildReviewerPrompt(
      'BASE SPEC',
      {
        ok: false,
        diagnostics: [
          'Route-service contract mismatch (tasks): routes call tasksService.createTask() but service does not export "createTask".',
          'Route-service contract mismatch (tasks): routes call tasksService.updateTaskStatus() but service does not export "updateTaskStatus".'
        ],
        commands: []
      },
      undefined,
      'node-project-api-large'
    );
    assert.ok(prompt.includes('ROUTE-SERVICE EXPORT MAP (AUTO-GENERATED)'));
    assert.ok(prompt.includes('module tasks: service alias tasksService'));
    assert.ok(prompt.includes('required exported methods: createTask, updateTaskStatus'));

    const promptWithoutMismatch = await buildReviewerPrompt(
      'BASE SPEC',
      {
        ok: false,
        diagnostics: ['Status code contract mismatch: POST /projects should return HTTP 201 on create.'],
        commands: []
      },
      undefined,
      'node-project-api-large'
    );
    assert.ok(!promptWithoutMismatch.includes('ROUTE-SERVICE EXPORT MAP (AUTO-GENERATED)'));
  });

  it('injects node-project contract fix map into reviewer prompt when structural diagnostics are present', async () => {
    const prompt = await buildReviewerPrompt(
      'BASE SPEC',
      {
        ok: false,
        diagnostics: [
          'Uses `new BadRequestError(...)` but src/lib/errors.* does not define/export BadRequestError',
          'State-sharing mismatch: members service should reuse shared projects repository, not isolated members map/array',
          'Skipped oracle command checks because structural contract did not pass.'
        ],
        commands: []
      },
      undefined,
      'node-project-api-large'
    );
    assert.ok(prompt.includes('NODE PROJECT CONTRACT FIX MAP (AUTO-GENERATED)'));
    assert.ok(prompt.includes('do NOT use undefined `BadRequestError`/`NotFoundError`'));
    assert.ok(prompt.includes('members state: do not keep isolated `members` array/map'));
  });

  it('deduplicates repeated file paths by keeping latest content', () => {
    const deduped = dedupeFileSpecsByPath([
      { path: 'src/modules/projects/routes.js', content: 'v1' },
      { path: 'src/modules/projects/routes.js', content: 'v2' },
      { path: 'src/modules/tasks/routes.js', content: 't1' }
    ]);
    assert.deepEqual(
      deduped.files.map(f => ({ path: f.path, content: f.content })),
      [
        { path: 'src/modules/projects/routes.js', content: 'v2' },
        { path: 'src/modules/tasks/routes.js', content: 't1' }
      ]
    );
    assert.equal(deduped.duplicates.length, 1);
    assert.equal(deduped.duplicates[0], 'src/modules/projects/routes.js');
  });

  it('adds route-service adapter wrappers when called methods have known aliases', () => {
    const files = [
      {
        path: 'src/modules/projects/routes.js',
        content: [
          "const router = require('express').Router();",
          "const projectsService = require('./service');",
          "router.get('/', async (_req, res) => res.json({ projects: await projectsService.getAllProjects() }));",
          "router.get('/:projectId', async (req, res) => res.json({ project: await projectsService.getProjectById(req.params.projectId) }));",
          "router.post('/', async (req, res) => res.status(201).json({ project: await projectsService.createProject(req.body.name) }));",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/projects/service.js',
        content: [
          'async function create(name) { return { id: "p1", name }; }',
          'async function getProjects() { return []; }',
          'async function getById(id) { return { id, name: "x" }; }',
          'module.exports = { create, getProjects, getById };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = patched.find(f => f.path === 'src/modules/projects/service.js');
    assert.ok(service, 'service file missing');
    const content = String(service?.content || '');
    assert.ok(content.includes('module.exports.getAllProjects = module.exports.getProjects;'));
    assert.ok(content.includes('module.exports.getProjectById = module.exports.getById;'));
    assert.ok(
      content.includes('module.exports.createProject = module.exports.create;')
      || content.includes('module.exports.createProject = async function createProjectBridge(')
    );
  });

  it('normalizes route service import ../service to ./service during adapter pass', () => {
    const files = [
      {
        path: 'src/modules/members/routes.js',
        content: [
          "const router = require('express').Router();",
          "const membersService = require('../service');",
          "router.get('/', async (_req, res) => res.json({ members: await membersService.getMembers('p1') }));",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/members/service.js',
        content: [
          'async function addMember(projectId, userId, role) { return { projectId, userId, role }; }',
          'async function getMembers(_projectId) { return []; }',
          'module.exports = { addMember, getMembers };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const route = patched.find(f => f.path === 'src/modules/members/routes.js');
    assert.ok(route, 'route file missing');
    const routeContent = String(route?.content || '');
    assert.ok(routeContent.includes("require('./service')"));
    assert.ok(!routeContent.includes("require('../service')"));
  });

  it('does not add route-service wrappers when no viable alias target exists', () => {
    const files = [
      {
        path: 'src/modules/tasks/routes.js',
        content: [
          "const router = require('express').Router();",
          "const tasksService = require('./service');",
          "router.delete('/:taskId', async (req, res) => res.json({ task: await tasksService.deleteTask(req.params.taskId) }));",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/tasks/service.js',
        content: [
          'async function getTasks() { return []; }',
          'module.exports = { getTasks };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = patched.find(f => f.path === 'src/modules/tasks/service.js');
    assert.ok(service, 'service file missing');
    const content = String(service?.content || '');
    assert.ok(!content.includes('module.exports.deleteTask ='));
  });

  it('bridges additional alias variants for tasks and members services', () => {
    const files = [
      {
        path: 'src/modules/tasks/routes.js',
        content: [
          "const router = require('express').Router();",
          "const tasksService = require('./service');",
          "router.get('/', async (req, res) => res.json({ tasks: await tasksService.getTasksByProjectId(req.params.projectId) }));",
          "router.patch('/:taskId', async (req, res) => res.json({ task: await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, req.body.status) }));",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/tasks/service.js',
        content: [
          'async function getTasksByProject(projectId) { return [{ id: "t1", projectId, status: "todo" }]; }',
          'async function setStatus(projectId, taskId, status) { return { id: taskId, projectId, status }; }',
          'module.exports = { getTasksByProject, setStatus };',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/members/routes.js',
        content: [
          "const router = require('express').Router();",
          "const membersService = require('./service');",
          "router.post('/', async (req, res) => res.json({ member: await membersService.addMember(req.params.projectId, req.body.userId, req.body.role) }));",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/members/service.js',
        content: [
          'async function addMemberToProject(projectId, userId, role) { return { projectId, userId, role }; }',
          'async function getMembersByProject(_projectId) { return []; }',
          'module.exports = { addMemberToProject, getMembersByProject };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const tasksService = patched.find(f => f.path === 'src/modules/tasks/service.js');
    const membersService = patched.find(f => f.path === 'src/modules/members/service.js');
    assert.ok(tasksService, 'tasks service missing');
    assert.ok(membersService, 'members service missing');
    const tasksContent = String(tasksService?.content || '');
    const membersContent = String(membersService?.content || '');
    assert.ok(tasksContent.includes('module.exports.getTasksByProjectId = module.exports.getTasksByProject;'));
    assert.ok(
      tasksContent.includes('module.exports.updateTaskStatus = module.exports.setStatus;')
      || tasksContent.includes('module.exports.updateTaskStatus = async function updateTaskStatusBridge(')
    );
    assert.ok(membersContent.includes('module.exports.addMember = async function addMemberBridge('));
    assert.ok(membersContent.includes('const result = await module.exports.addMemberToProject(projectId, userId, role);'));
    assert.ok(membersContent.includes('duplicate: false'));
  });

  it('bridges tasks updateTask route call to updateTaskStatus export', () => {
    const files = [
      {
        path: 'src/modules/tasks/routes.js',
        content: [
          "const router = require('express').Router();",
          "const taskService = require('./service');",
          "router.patch('/:taskId', async (req, res) => res.json({ task: await taskService.updateTask(req.params.projectId, req.params.taskId, req.body.status) }));",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/tasks/service.js',
        content: [
          'async function updateTaskStatus(projectId, taskId, status) { return { id: taskId, projectId, status }; }',
          'module.exports = { updateTaskStatus };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const tasksService = String(patched.find(f => f.path === 'src/modules/tasks/service.js')?.content || '');
    assert.ok(tasksService.includes('module.exports.updateTask = module.exports.updateTaskStatus;'));
  });

  it('synthesizes getAllProjects bridge from detected in-memory store', () => {
    const files = [
      {
        path: 'src/modules/projects/routes.js',
        content: [
          "const router = require('express').Router();",
          "const projectsService = require('./service');",
          "router.get('/', async (_req, res) => res.json({ projects: await projectsService.getAllProjects() }));",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/projects/service.js',
        content: [
          'const projects = [];',
          'async function createProject(name) {',
          "  const project = { id: `p_${projects.length + 1}`, name };",
          '  projects.push(project);',
          '  return project;',
          '}',
          'module.exports = { createProject };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = patched.find(f => f.path === 'src/modules/projects/service.js');
    assert.ok(service, 'service file missing');
    const content = String(service?.content || '');
    assert.ok(content.includes('module.exports.getAllProjects = async function getAllProjectsBridge() {'));
    assert.ok(content.includes('Array.isArray(projects) ? [...projects] : []'));
  });

  it('synthesizes project list/name bridges from object-map stores', () => {
    const files = [
      {
        path: 'src/modules/projects/routes.js',
        content: [
          "const router = require('express').Router();",
          "const projectsService = require('./service');",
          "router.get('/', async (_req, res) => res.json({ projects: await projectsService.getAllProjects() }));",
          "router.post('/', async (req, res) => { const dup = await projectsService.getProjectByName(req.body?.name); if (dup) return res.status(409).json({ error: { code: 'PROJECT_DUPLICATE', message: 'Project already exists' } }); return res.status(201).json({ project: await projectsService.createProject(req.body?.name) }); });",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/projects/service.js',
        content: [
          'let projects = {};',
          'async function createProject(name) {',
          "  const id = String(Object.keys(projects).length + 1);",
          '  const project = { id, name: String(name || "") };',
          '  projects[id] = project;',
          '  return project;',
          '}',
          'module.exports = { createProject, projects };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/projects/service.js')?.content || '');
    assert.ok(service.includes('module.exports.getAllProjects = async function getAllProjectsBridge()'));
    assert.ok(service.includes('Object.values(projects)'));
    assert.ok(service.includes('module.exports.getProjectByName = async function getProjectByNameBridge'));
    assert.ok(service.includes("return list.find(project => project && String(project.name || '').trim() === normalized) || null;"));
  });

  it('adds duplicate-member guard bridge for members service exports', () => {
    const files = [
      {
        path: 'src/modules/members/service.js',
        content: [
          'const members = [];',
          'async function addMember(projectId, userId, role) {',
          "  const member = { id: `${projectId}:${userId}`, projectId, userId, role: role || 'member' };",
          '  members.push(member);',
          '  return member;',
          '}',
          'async function getMembers(projectId) {',
          "  return members.filter(member => String(member.projectId) === String(projectId));",
          '}',
          'module.exports = { addMember, getMembers };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = patched.find(f => f.path === 'src/modules/members/service.js');
    assert.ok(service, 'service file missing');
    const content = String(service?.content || '');
    assert.ok(content.includes('const __botEvalMembersDupGuard = module.exports.addMember;'));
    assert.ok(content.includes('const __botEvalMembersDupStore = [];'));
    assert.ok(content.includes('module.exports.addMember = function addMember(projectId, userId, role) {'));
    assert.ok(!content.includes('module.exports.addMember = async function addMember(projectId, userId, role) {'));
    assert.ok(content.includes("String(member.userId || '') === userKey"));
    assert.ok(content.includes("String(member.projectId || '') === projectKey"));
  });

  it('adds duplicate-project guard bridge for projects service exports', () => {
    const files = [
      {
        path: 'src/modules/projects/service.js',
        content: [
          'const projects = [];',
          'async function createProject(name) {',
          "  const project = { id: `p_${projects.length + 1}`, name };",
          '  projects.push(project);',
          '  return project;',
          '}',
          'module.exports = { createProject, projects };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = patched.find(f => f.path === 'src/modules/projects/service.js');
    assert.ok(service, 'service file missing');
    const content = String(service?.content || '');
    assert.ok(content.includes('const __botEvalProjectsDupGuard = module.exports.createProject;'));
    assert.ok(content.includes('module.exports.createProject = function createProject(name) {'));
    assert.ok(!content.includes('module.exports.createProject = async function createProject(name) {'));
    assert.ok(content.includes("if (candidate && typeof candidate.then !== 'function') existing = candidate;"));
    assert.ok(content.includes('if (existing) return null;'));
  });

  it('adds duplicate-project guard bridge for object-map project stores', () => {
    const files = [
      {
        path: 'src/modules/projects/service.js',
        content: [
          'const projectsStore = {};',
          'function createProject(name) {',
          "  const id = String(Object.keys(projectsStore).length + 1);",
          '  const project = { id, name: String(name || "") };',
          '  projectsStore[id] = project;',
          '  return project;',
          '}',
          'module.exports = { createProject, projectsStore };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/projects/service.js')?.content || '');
    assert.ok(service.includes('Object.values(projectsStore).find('));
    assert.ok(service.includes('if (existing) return null;'));
  });

  it('replaces unsupported ../repository service import with canonical in-memory template', () => {
    const files = [
      {
        path: 'src/modules/projects/service.js',
        content: [
          "const repository = require('../repository');",
          'async function createProject(name) {',
          '  return repository.create(name);',
          '}',
          'module.exports = { createProject };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/projects/service.js')?.content || '');
    assert.ok(!service.includes("../repository"));
    assert.ok(service.includes("const { generateId } = require('../../lib/id');"));
    assert.ok(service.includes('module.exports = { getAllProjects, getProjectById, getProjectByName, createProject, projects };'));
  });

  it('replaces projects service when exported create() expects payload object with name field', () => {
    const files = [
      {
        path: 'src/modules/projects/service.js',
        content: [
          'const projects = {};',
          'function create(projectData) {',
          "  if (Object.values(projects).some(p => p.name === projectData.name)) throw { code: 'duplicate', message: 'Project already exists' };",
          "  const project = { id: String(Object.keys(projects).length + 1), ...projectData };",
          '  projects[project.id] = project;',
          '  return project;',
          '}',
          'module.exports = { create };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/projects/service.js')?.content || '');
    assert.ok(service.includes("const { generateId } = require('../../lib/id');"));
    assert.ok(service.includes('module.exports = { getAllProjects, getProjectById, getProjectByName, createProject, projects };'));
  });

  it('replaces services that call sendError(null, ...) with canonical template', () => {
    const files = [
      {
        path: 'src/modules/members/service.js',
        content: [
          "const errors = require('../../lib/errors');",
          'function getMembers(projectId) {',
          "  if (!projectId) return errors.sendError(null, 404, 'PROJECT_NOT_FOUND', 'Project not found');",
          '  return [];',
          '}',
          'function addMember(projectId, userId, role) {',
          "  if (!projectId) return errors.sendError(null, 404, 'PROJECT_NOT_FOUND', 'Project not found');",
          '  return { projectId, userId, role };',
          '}',
          'module.exports = { getMembers, addMember };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/members/service.js')?.content || '');
    assert.ok(service.includes('const projectsRepository = {};'));
    assert.ok(service.includes('module.exports = { getMembers, addMember, projectsRepository };'));
    assert.ok(!/sendError\s*\(\s*null\s*,/i.test(service));
  });

  it('replaces isolated members project-map service with route-compatible members store template', () => {
    const files = [
      {
        path: 'src/modules/members/service.js',
        content: [
          'let projects = {};',
          'function addMember(projectId, userId, role) {',
          '  if (!projects[projectId]) {',
          '    return null;',
          '  }',
          '  return { projectId, userId, role };',
          '}',
          'function getMembers(projectId) {',
          '  if (!projects[projectId]) return null;',
          '  return projects[projectId].members;',
          '}',
          'module.exports = { addMember, getMembers };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/members/service.js')?.content || '');
    assert.ok(service.includes('const projectsRepository = {};'));
    assert.ok(service.includes('async function addMember(projectId, userId, role) {'));
    assert.ok(service.includes("if (existing) return { duplicate: true, member: existing };"));
    assert.ok(service.includes('module.exports = { getMembers, addMember, projectsRepository };'));
  });

  it('replaces isolated members service even when map variable is not named "projects"', () => {
    const files = [
      {
        path: 'src/modules/members/service.js',
        content: [
          'let projectsStore = {};',
          'function addMemberToProject(projectId, userId, role) {',
          '  if (!projectsStore[projectId]) {',
          '    return null;',
          '  }',
          '  const project = projectsStore[projectId];',
          '  const existingMember = project.members.find(member => member.userId === userId);',
          '  if (existingMember) return null;',
          '  const member = { userId, role };',
          '  project.members.push(member);',
          '  return member;',
          '}',
          'module.exports = { addMemberToProject };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/members/service.js')?.content || '');
    assert.ok(service.includes('const projectsRepository = {};'));
    assert.ok(service.includes('module.exports = { getMembers, addMember, projectsRepository };'));
  });

  it('replaces members service when addProject bootstrap exists but addMember writes into uninitialized project map', () => {
    const files = [
      {
        path: 'src/modules/members/service.js',
        content: [
          'let projectsRepository = {};',
          'function addProject(projectId) {',
          '  if (!projectsRepository[projectId]) projectsRepository[projectId] = { members: [] };',
          '}',
          'function addMemberToProject(projectId, userId, role) {',
          '  const member = { userId, role };',
          '  projectsRepository[projectId].members.push(member);',
          '  return member;',
          '}',
          'module.exports = { addProject, addMemberToProject };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/members/service.js')?.content || '');
    assert.ok(service.includes('const projectsRepository = {};'));
    assert.ok(service.includes('module.exports = { getMembers, addMember, projectsRepository };'));
  });

  it('replaces tasks service coupled to project.tasks object with canonical tasks store template', () => {
    const files = [
      {
        path: 'src/modules/tasks/service.js',
        content: [
          "const projectsService = require('../../modules/projects/service');",
          'function createTask(projectId, title) {',
          '  const project = projectsService.getProjectById(projectId);',
          '  if (!project) return null;',
          '  const task = { id: "t1", title, status: "todo" };',
          '  project.tasks.push(task);',
          '  return task;',
          '}',
          'module.exports = { createTask };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/tasks/service.js')?.content || '');
    assert.ok(service.includes('const tasks = [];'));
    assert.ok(service.includes('async function createTask(projectId, title) {'));
    assert.ok(service.includes('module.exports = { getAllTasks, createTask, getTaskById, updateTaskStatus, tasks };'));
  });

  it('replaces comments service when it persists content instead of message field', () => {
    const files = [
      {
        path: 'src/modules/comments/service.js',
        content: [
          'const comments = [];',
          'function addComment(projectId, taskId, message) {',
          '  const comment = { projectId, taskId, content: message };',
          '  comments.push(comment);',
          '  return comment;',
          '}',
          'module.exports = { addComment, comments };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/comments/service.js')?.content || '');
    assert.ok(service.includes('async function addComment(projectId, taskId, message) {'));
    assert.ok(service.includes('message: String(message || \'\')'));
  });

  it('replaces comments service when addComment destructures { message } and couples to tasks update', () => {
    const files = [
      {
        path: 'src/modules/comments/service.js',
        content: [
          "const tasksService = require('../tasks/service');",
          'const comments = {};',
          'function addComment(projectId, taskId, { message }) {',
          "  if (!message) throw { code: 'invalid_input', message: 'Message is required' };",
          '  tasksService.updateTask(projectId, taskId, {});',
          '  const comment = { message };',
          '  if (!comments[taskId]) comments[taskId] = [];',
          '  comments[taskId].push(comment);',
          '  return comment;',
          '}',
          'module.exports = { addComment };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/comments/service.js')?.content || '');
    assert.ok(service.includes('async function addComment(projectId, taskId, message) {'));
    assert.ok(service.includes('module.exports = { getAllComments, addComment, comments };'));
    assert.ok(!service.includes('tasksService.updateTask('));
  });

  it('replaces comments service when it couples via getProjectByTaskId lookup', () => {
    const files = [
      {
        path: 'src/modules/comments/service.js',
        content: [
          "const projectsService = require('../projects/service');",
          'const comments = {};',
          'function addComment(projectId, taskId, message) {',
          '  const project = projectsService.getProjectByTaskId(taskId);',
          '  if (!project) return null;',
          '  const comment = { projectId, taskId, message };',
          '  if (!comments[taskId]) comments[taskId] = [];',
          '  comments[taskId].push(comment);',
          '  return comment;',
          '}',
          'module.exports = { addComment, comments };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/comments/service.js')?.content || '');
    assert.ok(service.includes('async function addComment(projectId, taskId, message) {'));
    assert.ok(service.includes('module.exports = { getAllComments, addComment, comments };'));
    assert.ok(!service.includes('getProjectByTaskId('));
  });

  it('normalizes comments service addComment signature when code expects comment.message object arg', () => {
    const files = [
      {
        path: 'src/modules/comments/service.js',
        content: [
          'module.exports = {',
          '  addComment(projectId, taskId, comment) {',
          '    const newComment = { projectId, taskId, message: comment.message };',
          '    return newComment;',
          '  }',
          '};',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = String(patched.find(f => f.path === 'src/modules/comments/service.js')?.content || '');
    assert.ok(service.includes("message: typeof comment === 'string' ? comment : String(comment?.message || '')"));
  });

  it('auto-fix inserts missing GET /:projectId in projects routes', () => {
    const files = [
      {
        path: 'src/modules/projects/routes.js',
        content: [
          "const router = require('express').Router();",
          "const projectsService = require('./service');",
          "router.get('/', async (_req, res) => res.json({ projects: await projectsService.getAllProjects() }));",
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const route = fixed.files.find(f => f.path === 'src/modules/projects/routes.js');
    assert.ok(route, 'projects route missing');
    const text = String(route?.content || '');
    assert.ok(text.includes("router.get('/:projectId'"));
    assert.ok(text.includes('projectsService.getProjectById'));
    assert.ok(fixed.appliedFixes.some(item => /added GET \/:projectId detail handler/i.test(item)));
  });

  it('auto-fix canonicalizes projects route when payload/validation contract is drifted', () => {
    const files = [
      {
        path: 'src/modules/projects/routes.js',
        content: [
          "const router = require('express').Router();",
          "const projectsService = require('./service');",
          "router.post('/', async (req, res) => {",
          "  const project = await projectsService.createProject(req.body);",
          "  return res.status(201).json(project);",
          '});',
          "router.get('/', async (_req, res) => { const projects = await projectsService.getAllProjects(); return res.json(projects); });",
          "router.get('/:projectId', async (req, res) => { const project = await projectsService.getProjectById(req.params.projectId); return res.json(project); });",
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const projects = String(fixed.files[0].content || '');
    assert.ok(projects.includes("const name = String(req.body?.name || \"\").trim();"));
    assert.ok(projects.includes("return res.status(201).json({ project });"));
    assert.ok(projects.includes("res.json({ projects"));
    assert.ok(projects.includes("return res.json({ project });"));
    assert.ok(fixed.appliedFixes.some(item => /canonicalized projects route contract/i.test(item)));
  });

  it('auto-fix normalizes POST success status to 201 across domain routes', () => {
    const files = [
      { path: 'src/modules/projects/routes.js', content: "const router=require('express').Router();router.post('/',async(req,res)=>res.json({project:{id:'p1'}}));module.exports=router;\n" },
      { path: 'src/modules/members/routes.js', content: "const router=require('express').Router();router.post('/',async(req,res)=>res.json({member:{id:'m1'}}));module.exports=router;\n" },
      { path: 'src/modules/tasks/routes.js', content: "const router=require('express').Router();router.post('/',async(req,res)=>res.json({task:{id:'t1'}}));module.exports=router;\n" },
      { path: 'src/modules/comments/routes.js', content: "const router=require('express').Router();router.post('/',async(req,res)=>res.json({comment:{id:'c1'}}));module.exports=router;\n" }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    for (const rel of files.map(f => f.path)) {
      const route = fixed.files.find(f => f.path === rel);
      assert.ok(route, `${rel} missing`);
      assert.ok(String(route?.content || '').includes('res.status(201).json('), `${rel} did not normalize to 201`);
    }
  });

  it('auto-fix normalizes members/comments payload keys', () => {
    const files = [
      {
        path: 'src/modules/members/routes.js',
        content: [
          "const router = require('express').Router();",
          "router.get('/', async (_req, res) => res.json({ members: [] }));",
          "router.post('/', async (req, res) => { const { name } = req.body; if (!name) return res.status(400).json({ error: { code: 'BAD', message: 'name is required' } }); return res.json({ member: { userId: req.body.name, role: 'owner' } }); });",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/comments/routes.js',
        content: [
          "const router = require('express').Router();",
          "router.get('/', async (_req, res) => res.json({ comments: [] }));",
          "router.post('/', async (req, res) => { const { content } = req.body; if (!content) return res.status(400).json({ error: { code: 'BAD', message: 'Content is required' } }); return res.json({ comment: { content: req.body.content } }); });",
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const members = String(fixed.files.find(f => f.path.endsWith('/members/routes.js'))?.content || '');
    const comments = String(fixed.files.find(f => f.path.endsWith('/comments/routes.js'))?.content || '');
    assert.ok(members.includes("Router({ mergeParams: true })"));
    assert.ok(comments.includes("Router({ mergeParams: true })"));
    assert.ok(
      members.includes('{ userId, role } = req.body')
      || members.includes("const userId = String(req.body?.userId || '').trim();")
    );
    assert.ok(
      members.includes('if (!userId || !role)')
      || members.includes('userId and role are required')
    );
    assert.ok(
      comments.includes('{ message } = req.body')
      || comments.includes("const message = String(req.body?.message || '').trim();")
    );
    assert.ok(
      comments.includes('if (!message)')
      || comments.includes('Message is required')
    );
    assert.ok(
      comments.includes('req.body.message')
      || comments.includes('addComment(req.params.projectId, req.params.taskId, message)')
    );
    assert.ok(!comments.includes('!content'));
  });

  it('auto-fix canonicalizes members/comments routes when GET / list endpoints are missing', () => {
    const files = [
      {
        path: 'src/modules/members/routes.js',
        content: [
          "const router = require('express').Router();",
          "router.post('/', async (_req, res) => res.status(201).json({ member: { userId: 'u1', role: 'owner' } }));",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/comments/routes.js',
        content: [
          "const router = require('express').Router();",
          "router.post('/', async (_req, res) => res.status(201).json({ comment: { message: 'ok' } }));",
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const members = String(fixed.files.find(f => f.path.endsWith('/members/routes.js'))?.content || '');
    const comments = String(fixed.files.find(f => f.path.endsWith('/comments/routes.js'))?.content || '');
    assert.ok(members.includes("Router({ mergeParams: true })"));
    assert.ok(comments.includes("Router({ mergeParams: true })"));
    assert.ok(members.includes("router.get('/',"));
    assert.ok(comments.includes("router.get('/',"));
    assert.ok(fixed.appliedFixes.some(item => /canonicalized members route contract/i.test(item)));
    assert.ok(fixed.appliedFixes.some(item => /canonicalized comments route contract/i.test(item)));
  });

  it('auto-fix canonicalizes members route when POST payload guard is missing even if GET exists', () => {
    const files = [
      {
        path: 'src/modules/members/routes.js',
        content: [
          "const express = require('express');",
          "const membersService = require('./service');",
          "const { sendError } = require('../../lib/errors');",
          'const router = express.Router({ mergeParams: true });',
          "router.get('/', async (_req, res) => res.json({ members: [] }));",
          "router.post('/', async (req, res) => {",
          "  const member = await membersService.addMember(req.params.projectId, req.body.userId, req.body.role);",
          "  if (!member) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');",
          "  return res.status(201).json({ member });",
          '});',
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const members = String(fixed.files[0].content || '');
    assert.ok(members.includes("const userId = String(req.body?.userId || '').trim();"));
    assert.ok(members.includes("if (!userId || !role) return sendError(res, 400, 'BAD_REQUEST', 'userId and role are required');"));
    assert.ok(fixed.appliedFixes.some(item => /canonicalized members route contract/i.test(item)));
  });

  it('auto-fix canonicalizes comments route when POST message guard is missing even if GET exists', () => {
    const files = [
      {
        path: 'src/modules/comments/routes.js',
        content: [
          "const express = require('express');",
          "const commentsService = require('./service');",
          "const { sendError } = require('../../lib/errors');",
          'const router = express.Router({ mergeParams: true });',
          "router.get('/', async (_req, res) => res.json({ comments: [] }));",
          "router.post('/', async (req, res) => {",
          "  const comment = await commentsService.addComment(req.params.projectId, req.params.taskId, req.body.message);",
          "  return res.status(201).json({ comment });",
          '});',
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const comments = String(fixed.files[0].content || '');
    assert.ok(comments.includes("const message = String(req.body?.message || '').trim();"));
    assert.ok(comments.includes("if (!message) return sendError(res, 400, 'BAD_REQUEST', 'Message is required');"));
    assert.ok(fixed.appliedFixes.some(item => /canonicalized comments route contract/i.test(item)));
  });

  it('auto-fix canonicalizes comments route when service calls omit projectId context', () => {
    const files = [
      {
        path: 'src/modules/comments/routes.js',
        content: [
          "const express = require('express');",
          "const commentsService = require('./service');",
          "const { sendError } = require('../../lib/errors');",
          'const router = express.Router({ mergeParams: true });',
          "router.get('/', async (req, res) => { const comments = await commentsService.getComments(req.params.taskId); return res.json({ comments }); });",
          "router.post('/', async (req, res) => {",
          "  const message = String(req.body?.message || '').trim();",
          "  if (!message) return sendError(res, 400, 'BAD_REQUEST', 'Message is required');",
          "  const comment = await commentsService.addComment(req.params.taskId, message);",
          "  return res.status(201).json({ comment });",
          '});',
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const comments = String(fixed.files[0].content || '');
    assert.match(comments, /commentsService\.(getAllComments|getComments)\(req\.params\.projectId,\s*req\.params\.taskId\)/);
    assert.ok(comments.includes('commentsService.addComment(req.params.projectId, req.params.taskId, message)'));
    assert.ok(fixed.appliedFixes.some(item => /canonicalized comments route contract/i.test(item)));
  });

  it('second adapter pass adds service wrappers after auto-fix canonicalizes routes', () => {
    const files = [
      {
        path: 'src/modules/members/routes.js',
        content: [
          "const router = require('express').Router();",
          "const membersService = require('./service');",
          "router.post('/', async (req, res) => res.status(201).json({ member: await membersService.addMember(req.params.projectId, req.body.userId, req.body.role) }));",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/members/service.js',
        content: [
          'const membersStore = {};',
          'async function createMember(projectId, userId, role) {',
          '  if (!membersStore[projectId]) membersStore[projectId] = [];',
          '  const member = { projectId, userId, role };',
          '  membersStore[projectId].push(member);',
          '  return member;',
          '}',
          'module.exports = { createMember };',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/comments/routes.js',
        content: [
          "const router = require('express').Router();",
          "const commentsService = require('./service');",
          "router.post('/', async (req, res) => res.status(201).json({ comment: await commentsService.createComment(req.params.projectId, req.params.taskId, req.body.message) }));",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/comments/service.js',
        content: [
          'const commentsStore = {};',
          'async function createComment(projectId, taskId, message) {',
          '  if (!commentsStore[projectId]) commentsStore[projectId] = {};',
          '  if (!commentsStore[projectId][taskId]) commentsStore[projectId][taskId] = [];',
          '  const comment = { projectId, taskId, message };',
          '  commentsStore[projectId][taskId].push(comment);',
          '  return comment;',
          '}',
          'module.exports = { createComment };',
          ''
        ].join('\n')
      }
    ];
    const pass1 = applyNodeProjectRouteServiceAdapterBridges(files);
    const auto = applyNodeProjectContractAutoFixes(pass1);
    const pass2 = applyNodeProjectRouteServiceAdapterBridges(auto.files);
    const membersService = String(pass2.find(f => f.path === 'src/modules/members/service.js')?.content || '');
    const commentsService = String(pass2.find(f => f.path === 'src/modules/comments/service.js')?.content || '');
    assert.ok(membersService.includes('module.exports.addMember = async function addMemberBridge('));
    assert.ok(membersService.includes('duplicate: false'));
    assert.ok(membersService.includes('module.exports.getMembers = async function getMembersBridge(projectId)'));
    assert.ok(!membersService.includes('module.exports.addMember = module.exports.createMember;'));
    assert.ok(commentsService.includes('module.exports.getAllComments = async function getAllCommentsBridge(projectId, taskId)'));
    assert.ok(commentsService.includes('commentsStore[projectKey]'));
    assert.ok(
      commentsService.includes('module.exports.addComment = module.exports.createComment;')
      || commentsService.includes('module.exports.addComment = async function addCommentBridge(')
    );
  });

  it('auto-fix injects duplicate guards for projects and members create routes', () => {
    const files = [
      {
        path: 'src/modules/projects/routes.js',
        content: [
          "const router = require('express').Router();",
          "const projectsService = require('./service');",
          "router.post('/', async (req, res) => { const name = String(req.body?.name || '').trim(); const project = await projectsService.createProject(name); return res.status(201).json({ project }); });",
          'module.exports = router;',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/members/routes.js',
        content: [
          "const router = require('express').Router();",
          "const membersService = require('./service');",
          "router.get('/', async (_req, res) => res.json({ members: [] }));",
          "router.post('/', async (req, res) => { const { userId, role } = req.body; const member = await membersService.addMember(req.params.projectId, userId, role); return res.status(201).json({ member }); });",
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const projects = String(fixed.files.find(f => f.path.endsWith('/projects/routes.js'))?.content || '');
    const members = String(fixed.files.find(f => f.path.endsWith('/members/routes.js'))?.content || '');
    assert.ok(projects.includes("'PROJECT_DUPLICATE'"));
    assert.ok(
      projects.includes('if (!project) return sendError(res, 409, \'PROJECT_DUPLICATE\'')
      || projects.includes('const duplicate = await projectsService.getProjectByName(name);')
    );
    assert.ok(
      members.includes("if (!member) return sendError(res, 409, 'MEMBER_DUPLICATE'")
      || members.includes("if (outcome.duplicate) return sendError(res, 409, 'MEMBER_DUPLICATE'")
    );
    assert.ok(!members.includes('const __existingMembers = typeof membersService.getMembers'));
  });

  it('auto-fix still injects project null duplicate guard when catch already contains duplicate branch', () => {
    const files = [
      {
        path: 'src/modules/projects/routes.js',
        content: [
          "const router = require('express').Router();",
          "const projectsService = require('./service');",
          "const { sendError } = require('../../lib/errors');",
          "router.post('/', async (req, res) => {",
          "  try {",
          "    const name = String(req.body?.name || '').trim();",
          "    const project = await projectsService.createProject(name);",
          "    return res.status(201).json({ project });",
          "  } catch (error) {",
          "    if (error.code === 'DUPLICATE') return sendError(res, 409, 'DUPLICATE', 'Project already exists');",
          "    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');",
          '  }',
          '});',
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const projects = String(fixed.files[0].content || '');
    assert.ok(
      projects.includes("if (!project) return sendError(res, 409, 'PROJECT_DUPLICATE'")
      || projects.includes("const duplicate = await projectsService.getProjectByName(name);")
    );
  });

  it('auto-fix still injects members duplicate null guard when catch already contains MEMBER_DUPLICATE branch', () => {
    const files = [
      {
        path: 'src/modules/members/routes.js',
        content: [
          "const router = require('express').Router();",
          "const membersService = require('./service');",
          "const { sendError } = require('../../lib/errors');",
          "router.get('/', async (_req, res) => res.json({ members: [] }));",
          "router.post('/', async (req, res) => {",
          "  try {",
          "    const { userId, role } = req.body;",
          "    const member = await membersService.addMember(req.params.projectId, userId, role);",
          "    return res.status(201).json({ member });",
          "  } catch (error) {",
          "    if (error.code === 'DUPLICATE') return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');",
          "    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');",
          '  }',
          '});',
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const members = String(fixed.files[0].content || '');
    assert.ok(
      members.includes("if (!member) return sendError(res, 409, 'MEMBER_DUPLICATE'")
      || members.includes("if (outcome.duplicate) return sendError(res, 409, 'MEMBER_DUPLICATE'")
    );
    assert.ok(!members.includes('const __existingMembers = typeof membersService.getMembers'));
  });

  it('auto-fix normalizes members create response when route expects outcome.member', () => {
    const files = [
      {
        path: 'src/modules/members/routes.js',
        content: [
          "const router = require('express').Router();",
          "const membersService = require('./service');",
          "const { sendError } = require('../../lib/errors');",
          "router.get('/', async (_req, res) => res.json({ members: [] }));",
          "router.post('/', async (req, res) => {",
          "  const outcome = await membersService.addMember(req.params.projectId, 'u1', 'owner');",
          "  if (!outcome) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');",
          "  if (outcome.duplicate) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');",
          "  return res.status(201).json({ member: outcome.member });",
          '});',
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const members = String(fixed.files[0].content || '');
    assert.ok(
      members.includes("const __memberValue = outcome && typeof outcome === 'object' && 'member' in outcome ? outcome.member : outcome;")
      || members.includes("if (outcome.duplicate) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');")
    );
    assert.ok(
      members.includes('return res.status(201).json({ member: __memberValue });')
      || members.includes('return res.status(201).json({ member: outcome.member });')
    );
  });

  it('auto-fix normalizes comments create response when service returns content instead of message', () => {
    const files = [
      {
        path: 'src/modules/comments/routes.js',
        content: [
          "const router = require('express').Router();",
          "router.get('/', async (_req, res) => res.json({ comments: [] }));",
          "router.post('/', async (req, res) => {",
          "  const comment = { content: req.body.message };",
          "  return res.status(201).json({ comment });",
          '});',
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const comments = String(fixed.files[0].content || '');
    assert.ok(
      comments.includes("const __commentValue = comment && typeof comment === 'object' && !('message' in comment) && 'content' in comment")
      || comments.includes("const message = String(req.body?.message || '').trim();")
    );
    assert.ok(
      comments.includes('return res.status(201).json({ comment: __commentValue });')
      || comments.includes('return res.status(201).json({ comment });')
    );
  });

  it('auto-fix normalizes tasks PATCH/status filter contract', () => {
    const files = [
      {
        path: 'src/modules/tasks/routes.js',
        content: [
          "const router = require('express').Router();",
          "router.get('/', async (req, res) => { const { status } = req.query; let tasks = []; if (status === 'done') { tasks = tasks.filter(task => task.status === 'done'); } return res.json({ tasks }); });",
          "router.patch('/:taskId', async (req, res) => { const { status } = req.body; if (!['done','pending'].includes(status)) return res.status(400).json({ error: { code: 'BAD', message: 'bad' } }); return res.json({ task: { id: req.params.taskId, status } }); });",
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const tasks = String(fixed.files.find(f => f.path.endsWith('/tasks/routes.js'))?.content || '');
    assert.ok(tasks.includes("Router({ mergeParams: true })"));
    assert.ok(tasks.includes("status !== 'todo' && status !== 'done'"));
    assert.ok(tasks.includes("'TASK_NOT_FOUND'"));
  });

  it('auto-fix normalizes tasks create payload from description to title', () => {
    const files = [
      {
        path: 'src/modules/tasks/routes.js',
        content: [
          "const router = require('express').Router();",
          "router.post('/', async (req, res) => { const { description } = req.body; if (!description) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Description is required' } }); const task = await tasksService.createTask(req.params.projectId, description); return res.status(201).json({ task }); });",
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const tasks = String(fixed.files.find(f => f.path.endsWith('/tasks/routes.js'))?.content || '');
    assert.ok(tasks.includes("const title = String(req.body?.title || \"\").trim();"));
    assert.ok(tasks.includes('if (!title)'));
    assert.ok(tasks.includes('Task title is required'));
    assert.ok(tasks.includes('createTask(req.params.projectId, title)'));
  });

  it('auto-fix normalizes tasks create payload from name to title', () => {
    const files = [
      {
        path: 'src/modules/tasks/routes.js',
        content: [
          "const router = require('express').Router();",
          "router.post('/', async (req, res) => { const name = String(req.body?.name || '').trim(); if (!name) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Name is required' } }); const task = await tasksService.addTask(req.params.projectId, name); return res.status(201).json({ task }); });",
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const tasks = String(fixed.files[0].content || '');
    assert.match(tasks, /const title = String\(req\.body\?\.title \|\| ["']{2}\)\.trim\(\);/);
    assert.ok(tasks.includes('if (!title)'));
    assert.ok(tasks.includes('Task title is required'));
    assert.match(tasks, /\b(?:addTask|createTask)\(req\.params\.projectId,\s*title\)/);
    assert.ok(fixed.appliedFixes.some(item => /canonicalized tasks route contract/i.test(item)));
  });

  it('auto-fix replaces syntactically invalid tasks route with canonical template', () => {
    const files = [
      {
        path: 'src/modules/tasks/routes.js',
        content: [
          "const router = require('express').Router();",
          "router.patch('/:taskId', async (req, res) => {",
          "  const { status } = req.body;",
          "  if (status !== 'todo' && status !== 'done') {",
          "    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Status must be",
          '});',
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const tasks = String(fixed.files.find(f => f.path.endsWith('/tasks/routes.js'))?.content || '');
    assert.ok(tasks.includes("router.patch('/:taskId'"));
    assert.ok(tasks.includes("status !== 'todo' && status !== 'done'"));
    assert.ok(tasks.includes("return sendError(res, 400, 'INVALID_STATUS'"));
    assert.doesNotThrow(() => new Function(tasks));
  });

  it('auto-fix replaces syntactically invalid server entrypoint with canonical template', () => {
    const files = [
      {
        path: 'src/server.js',
        content: [
          "const app = require('./app');",
          "module.exports.start = () => {",
          "  if (app) {",
          "    return app",
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const server = String(fixed.files[0].content || '');
    assert.ok(server.includes("const app = require('./app');"));
    assert.ok(server.includes('module.exports = app;'));
    assert.doesNotThrow(() => new Function(server));
  });

  it('auto-fix replaces syntactically invalid service module with canonical template', () => {
    const files = [
      {
        path: 'src/modules/comments/service.js',
        content: [
          'const comments = [',
          'module.exports = {',
          '  listComments() { return comments; }',
          '};',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const service = String(fixed.files[0].content || '');
    assert.ok(service.includes('async function getAllComments(projectId, taskId)'));
    assert.ok(service.includes('function addComment(projectId, taskId, message)'));
    assert.ok(service.includes("const { generateId } = require('../../lib/id');"));
    assert.doesNotThrow(() => new Function(service));
  });

  it('auto-fix replaces undefined BadRequestError/NotFoundError branches with sendError', () => {
    const files = [
      {
        path: 'src/modules/members/routes.js',
        content: [
          "const router = require('express').Router();",
          "router.post('/', async (_req, _res, next) => { throw new BadRequestError('x'); });",
          "router.get('/', async (_req, _res, next) => { next(new NotFoundError('missing')); });",
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const members = String(fixed.files[0].content || '');
    assert.ok(members.includes("const { sendError } = require('../../lib/errors');"));
    assert.ok(
      members.includes("return sendError(_res, 400, 'BAD_REQUEST'")
      || members.includes("return sendError(res, 400, 'BAD_REQUEST'")
      || members.includes("return sendError(res, 400, 'INVALID_INPUT'")
    );
    assert.ok(/sendError\s*\(/.test(members));
    assert.ok(!/new\s+BadRequestError|new\s+NotFoundError/.test(members));
  });

  it('auto-fix restores sendError binding when route calls sendError but imports only custom error classes', () => {
    const files = [
      {
        path: 'src/modules/comments/routes.js',
        content: [
          "const express = require('express');",
          "const { BadRequestError, NotFoundError } = require('../../lib/errors');",
          'const router = express.Router();',
          "router.post('/', (req, res) => {",
          "  if (!req.body?.message) return sendError(res, 400, 'BAD_REQUEST', 'Message is required');",
          "  return res.status(201).json({ comment: { message: req.body.message } });",
          '});',
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const comments = String(fixed.files[0].content || '');
    assert.ok(
      comments.includes("const { sendError } = require('../../lib/errors');")
      || /\b[A-Za-z_$][\w$]*\.sendError\s*\(/.test(comments)
    );
    assert.ok(comments.includes("return sendError(res, 400, 'BAD_REQUEST'"));
  });

  it('auto-fix repairs src/lib/errors.js when routes use sendError but helper is not exported', () => {
    const files = [
      {
        path: 'src/lib/errors.js',
        content: [
          'function createErrorPayload(code, message) {',
          '  return { error: { code, message } };',
          '}',
          'module.exports = { createErrorPayload };',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/projects/routes.js',
        content: [
          "const router = require('express').Router();",
          "const { sendError } = require('../../lib/errors');",
          "router.get('/', (_req, res) => sendError(res, 500, 'INTERNAL_ERROR', 'x'));",
          'module.exports = router;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const errors = String(fixed.files.find(f => f.path === 'src/lib/errors.js')?.content || '');
    assert.ok(/function\s+sendError\s*\(/.test(errors));
    assert.ok(/module\.exports\s*=\s*\{\s*sendError\s*\}/.test(errors));
  });

  it('auto-fix repairs src/lib/id.js when services call generateId but helper is not exported', () => {
    const files = [
      {
        path: 'src/lib/id.js',
        content: [
          "const { randomUUID } = require('node:crypto');",
          'module.exports = { randomUUID };',
          ''
        ].join('\n')
      },
      {
        path: 'src/modules/projects/service.js',
        content: [
          "const { generateId } = require('../../lib/id');",
          'module.exports = { createProject: (name) => ({ id: generateId(), name }) };',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const idLib = String(fixed.files.find(f => f.path === 'src/lib/id.js')?.content || '');
    assert.ok(/function\s+generateId\s*\(/.test(idLib));
    assert.ok(/module\.exports\s*=\s*\{\s*generateId\s*\}/.test(idLib));
  });

  it('auto-fix normalizes app route mounts to canonical required signatures', () => {
    const files = [
      {
        path: 'src/app.js',
        content: [
          "const express = require('express');",
          'const app = express();',
          'app.use(express.json());',
          "app.get('/health', (_req, res) => res.json({ ok: true }));",
          "app.use('/projects', require('./modules/projects/routes'));",
          "app.use('/projects/:projectId/members', require('./modules/members/routes'));",
          'module.exports = app;',
          ''
        ].join('\n')
      }
    ];
    const fixed = applyNodeProjectContractAutoFixes(files);
    const app = String(fixed.files.find(f => f.path === 'src/app.js')?.content || '');
    assert.ok(app.includes("app.use('/projects/:projectId/tasks', tasksRoutes);"));
    assert.ok(app.includes("app.use('/projects/:projectId/tasks/:taskId/comments', commentsRoutes);"));
  });

  it('promotes large-scenario patch output to full using workspace snapshot', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(workspace, 'node_modules/leftpad/index.js', 'module.exports = () => 0;\n');
      const promoted = await promoteLargePatchToFullFromWorkspace(
        {
          mode: 'patch',
          files: [
            {
              path: 'src/modules/tasks/routes.js',
              content: "module.exports = require('express').Router();\n"
            }
          ]
        },
        workspace,
        [
          'README.md',
          'package.json',
          'src/app.js',
          'src/server.js',
          'src/modules/projects/routes.js',
          'src/modules/projects/service.js',
          'src/modules/tasks/routes.js',
          'src/modules/tasks/service.js',
          'src/modules/members/routes.js',
          'src/modules/members/service.js',
          'src/modules/comments/routes.js',
          'src/modules/comments/service.js',
          'src/lib/errors.js',
          'src/lib/id.js'
        ]
      );
      assert.equal(promoted.promoted, true);
      assert.ok(promoted.files.some(f => f.path === 'README.md'));
      assert.ok(promoted.files.some(f => f.path === 'package.json'));
      assert.ok(promoted.files.some(f => f.path === 'src/app.js'));
      assert.ok(promoted.files.some(f => f.path === 'src/server.js'));
      assert.ok(promoted.files.some(f => f.path === 'src/modules/tasks/routes.js' && /Router/.test(f.content)));
      assert.ok(!promoted.files.some(f => f.path.startsWith('node_modules/')));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('promotes patch->full even when workspace snapshot misses core files by synthesizing templates', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-large-promote-fail-'));
    try {
      writeFile(workspace, 'README.md', '# only readme\n');
      writeFile(workspace, 'src/app.js', 'module.exports = {};\n');
      const promoted = await promoteLargePatchToFullFromWorkspace(
        { mode: 'patch', files: [{ path: 'src/modules/tasks/routes.js', content: 'module.exports = {};\n' }] },
        workspace,
        ['README.md', 'package.json', 'src/app.js', 'src/server.js']
      );
      assert.equal(promoted.promoted, true);
      assert.ok(promoted.synthesizedCoreFiles.includes('package.json'));
      assert.ok(promoted.synthesizedCoreFiles.includes('src/server.js'));
      assert.ok(promoted.files.some(f => f.path === 'package.json'));
      assert.ok(promoted.files.some(f => f.path === 'src/server.js'));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('synthesizes missing large core files when workspace snapshot is incomplete', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-large-promote-synth-'));
    try {
      writeFile(
        workspace,
        'src/modules/tasks/routes.js',
        "const router = require('express').Router(); module.exports = router;\n"
      );
      const promoted = await promoteLargePatchToFullFromWorkspace(
        { mode: 'patch', files: [{ path: 'src/modules/tasks/routes.js', content: "module.exports = require('express').Router();\n" }] },
        workspace,
        [
          'README.md',
          'package.json',
          'src/app.js',
          'src/server.js',
          'src/modules/projects/routes.js',
          'src/modules/projects/service.js',
          'src/modules/tasks/routes.js',
          'src/modules/tasks/service.js',
          'src/modules/members/routes.js',
          'src/modules/members/service.js',
          'src/modules/comments/routes.js',
          'src/modules/comments/service.js',
          'src/lib/errors.js',
          'src/lib/id.js'
        ]
      );
      assert.equal(promoted.promoted, true);
      assert.ok(promoted.synthesizedCoreFiles.includes('src/lib/id.js'));
      assert.ok(promoted.files.some(f => f.path === 'src/lib/id.js' && /randomUUID/.test(f.content)));
      assert.ok(promoted.files.some(f => f.path === 'src/lib/errors.js' && /sendError/.test(f.content)));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('uses workspace route files when patch contains only service files', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-route-bridge-'));
    try {
      writeFile(
        workspace,
        'src/modules/comments/routes.js',
        [
          "const router = require('express').Router();",
          "const commentsService = require('./service');",
          "router.post('/', async (req, res) => res.json({ comment: await commentsService.addComment(req.params.projectId, req.params.taskId, req.body.message) }));",
          'module.exports = router;',
          ''
        ].join('\n')
      );
      const files = [
        {
          path: 'src/modules/comments/service.js',
          content: [
            'async function createComment(projectId, taskId, message) { return { id: "c1", projectId, taskId, message }; }',
            'module.exports = { createComment };',
            ''
          ].join('\n')
        }
      ];
      const patched = applyNodeProjectRouteServiceAdapterBridges(files, workspace);
      const service = patched.find(f => f.path === 'src/modules/comments/service.js');
      assert.ok(service, 'service file missing');
      const content = String(service?.content || '');
      assert.ok(
        content.includes('module.exports.addComment = module.exports.createComment;')
        || content.includes('module.exports.addComment = async function addCommentBridge(')
      );
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('hydrates workspace service file when patch only changes routes and synthesizes missing methods', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-route-only-bridge-'));
    try {
      writeFile(
        workspace,
        'src/modules/projects/service.js',
        [
          'const projects = [];',
          'async function getAllProjects() { return [...projects]; }',
          'async function createProject(name) { const project = { id: String(projects.length + 1), name: String(name || "") }; projects.push(project); return project; }',
          'module.exports = { getAllProjects, createProject, projects };',
          ''
        ].join('\n')
      );
      const files = [
        {
          path: 'src/modules/projects/routes.js',
          content: [
            "const router = require('express').Router();",
            "const projectsService = require('./service');",
            "router.post('/', async (req, res) => {",
            "  const duplicate = await projectsService.getProjectByName(req.body?.name);",
            "  if (duplicate) return res.status(409).json({ error: { code: 'PROJECT_DUPLICATE', message: 'Project already exists' } });",
            "  const project = await projectsService.createProject(req.body?.name);",
            "  return res.status(201).json({ project });",
            '});',
            'module.exports = router;',
            ''
          ].join('\n')
        }
      ];
      const patched = applyNodeProjectRouteServiceAdapterBridges(files, workspace);
      const service = patched.find(f => f.path === 'src/modules/projects/service.js');
      assert.ok(service, 'service file should be hydrated from workspace');
      const content = String(service?.content || '');
      assert.ok(content.includes('module.exports.getProjectByName = async function getProjectByNameBridge'));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('injects node:crypto randomUUID binding into service when randomUUID() is unbound', () => {
    const files = [
      {
        path: 'src/modules/projects/service.js',
        content: [
          'const projects = [];',
          'async function createProject(name) {',
          "  const project = { id: randomUUID(), name: String(name || '') };",
          '  projects.push(project);',
          '  return project;',
          '}',
          'module.exports = { createProject, projects };',
          ''
        ].join('\n')
      }
    ];
    const patched = applyNodeProjectRouteServiceAdapterBridges(files);
    const service = patched.find(f => f.path === 'src/modules/projects/service.js');
    assert.ok(service, 'service file missing');
    const content = String(service?.content || '');
    assert.ok(content.includes("const { randomUUID } = require('node:crypto');"));
    assert.ok(content.includes('id: randomUUID()'));
  });

  it('requires full mode after structural failures and ignores trivial reviewer notes', () => {
    assert.equal(
      shouldRequireFullModeAfterLargeFailure(['Missing route signature for /health', 'Skipped oracle command checks because structural contract did not pass.']),
      false
    );
    assert.equal(
      shouldRequireFullModeAfterLargeFailure(['Missing required file: src/app.js']),
      true
    );
    assert.equal(
      shouldRequireFullModeAfterLargeFailure(['Missing route signature for /health']),
      false
    );
    assert.equal(
      shouldRequireFullModeAfterLargeFailure(['Route-service contract mismatch (projects): routes call missing methods in service export']),
      false
    );
    assert.equal(
      shouldRequireFullModeAfterLargeFailure(['Parse/write failed: Large scenario full output must include all core files. Missing: README.md']),
      true
    );
    assert.equal(
      shouldRequireFullModeAfterLargeFailure(['Parse/write failed: First iteration must use mode "full" with all core files. Missing: src/app.js']),
      true
    );
    assert.equal(
      shouldRequireFullModeAfterLargeFailure(['Parse/write failed: Large scenario requires mode "full" after structural contract failures; mode "patch" is not allowed for this iteration.']),
      true
    );
    assert.equal(
      shouldRequireFullModeAfterLargeFailure(['Command failed: node --test --test-concurrency=1 tests/oracle.test.js (exit=1, timedOut=false)']),
      false
    );
    assert.equal(sanitizeReviewerNote('text'), undefined);
    assert.equal(sanitizeReviewerNote('ok'), undefined);
    assert.equal(sanitizeReviewerNote('Looks good overall, but align service exports with route method calls.'), 'Looks good overall, but align service exports with route method calls.');
  });

  it('caps reviewer timeout for large scenario to avoid long hangs', () => {
    assert.equal(computeReviewerTimeoutMs(1200, 'node-project-api-large'), 180_000);
    assert.equal(computeReviewerTimeoutMs(90, 'node-project-api-large'), 90_000);
    assert.equal(computeReviewerTimeoutMs(1200, 'node-api-oracle'), 600_000);
  });

  it('caps primary generation timeout for large scenario to limit long single-call hangs', () => {
    assert.equal(computePrimaryGenerationTimeoutMs(1200, 'node-project-api-large', 'qwen2.5-coder:14b'), 600_000);
    assert.equal(computePrimaryGenerationTimeoutMs(480, 'node-project-api-large', 'qwen2.5-coder:14b'), 480_000);
    assert.equal(computePrimaryGenerationTimeoutMs(1200, 'node-project-api-large', 'qwen2.5-coder:32b'), 180_000);
    assert.equal(computePrimaryGenerationTimeoutMs(1200, 'node-api-oracle'), 1_200_000);
  });

  it('selects timeout fallback model only for large scenario and avoids no-op fallback', () => {
    assert.equal(
      getTimeoutFallbackModelForScenario('node-project-api-large', 'qwen2.5-coder:32b'),
      'qwen2.5-coder:7b'
    );
    assert.equal(
      getTimeoutFallbackModelForScenario('node-project-api-large', 'qwen2.5-coder:32b', 'qwen2.5-coder:14b'),
      'qwen2.5-coder:14b'
    );
    assert.equal(
      getTimeoutFallbackModelForScenario('node-project-api-large', 'qwen2.5-coder:32b', 'qwen2.5-coder:32b'),
      undefined
    );
    assert.equal(
      getTimeoutFallbackModelForScenario('node-api-oracle', 'qwen2.5-coder:32b', 'qwen2.5-coder:14b'),
      undefined
    );
  });

  it('builds timeout fallback chain with dedupe and primary-model exclusion', () => {
    assert.deepEqual(
      getTimeoutFallbackModelsForScenario('node-project-api-large', 'qwen2.5-coder:32b'),
      ['qwen2.5-coder:7b', 'qwen2.5:7b', 'qwen2.5:3b']
    );
    assert.deepEqual(
      getTimeoutFallbackModelsForScenario(
        'node-project-api-large',
        'qwen2.5-coder:32b',
        'qwen2.5-coder:7b, qwen2.5-coder:32b, qwen2.5-coder:7b, qwen2.5:3b'
      ),
      ['qwen2.5-coder:7b', 'qwen2.5:3b']
    );
    assert.deepEqual(
      getTimeoutFallbackModelsForScenario('node-api-oracle', 'qwen2.5-coder:32b', 'qwen2.5:7b'),
      []
    );
  });

  it('caps timeout-fallback generation call duration for large scenario', () => {
    assert.equal(computeTimeoutFallbackGenerationTimeoutMs(600_000, 'node-project-api-large'), 150_000);
    assert.equal(computeTimeoutFallbackGenerationTimeoutMs(120_000, 'node-project-api-large'), 120_000);
    assert.equal(computeTimeoutFallbackGenerationTimeoutMs(600_000, 'node-api-oracle'), 600_000);
  });

  it('stops early after generation timeout for large scenario', () => {
    assert.equal(shouldStopAfterGenerationTimeout('node-project-api-large', 1), true);
    assert.equal(shouldStopAfterGenerationTimeout('node-project-api-large', 0), false);
    assert.equal(shouldStopAfterGenerationTimeout('node-api-oracle', 1), false);
    assert.equal(shouldStopAfterGenerationTimeout('node-api-oracle', 2), true);
  });

  it('flags listen() usage in app/server entrypoints', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/server.js',
        "const app = require('./app');\napp.listen(3000);\n"
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Do not call listen\(\) in src\/app\.\* or src\/server\.\*/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('fails fast on invalid JS syntax with actionable diagnostics and skips oracle commands', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/modules/tasks/routes.js',
        [
          "const router = require('express').Router();",
          "router.patch('/:taskId', async (req, res) => {",
          "  const { status } = req.body;",
          "  if (!['todo', 'done'].includes(status)) {",
          "    return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'Status must be either ",
          '});',
          'module.exports = router;',
          ''
        ].join('\n')
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /JavaScript syntax check failed in src\/modules\/tasks\/routes\.js/i.test(d)));
      assert.ok(result.diagnostics.some(d => /Likely truncated\/incomplete JS content in src\/modules\/tasks\/routes\.js/i.test(d)));
      assert.ok(result.diagnostics.some(d => /Skipped oracle command checks/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('for invalid package.json, reports root cause once and skips syntax-check spam', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(workspace, 'package.json', '{"name":"broken",,,,}');
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Invalid package\.json/i.test(d)));
      assert.ok(result.diagnostics.some(d => /syntax checks skipped intentionally/i.test(d)));
      assert.ok(!result.diagnostics.some(d => /JavaScript syntax check failed in /i.test(d)));
      assert.ok(result.diagnostics.some(d => /Skipped oracle command checks/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('flags ESM app/server module format drift before oracle execution', async () => {
    const workspace = seedLargeWorkspaceWithContractRoutes();
    try {
      writeFile(
        workspace,
        'src/app.js',
        [
          "import express from 'express';",
          "import projectsRoutes from './modules/projects/routes';",
          "import membersRoutes from './modules/members/routes';",
          "import tasksRoutes from './modules/tasks/routes';",
          "import commentsRoutes from './modules/comments/routes';",
          "import { sendError } from './lib/errors';",
          'const app = express();',
          'app.use(express.json());',
          "app.get('/health', (_req, res) => res.status(200).json({ ok: true }));",
          "app.use('/projects', projectsRoutes);",
          "app.use('/projects/:projectId/members', membersRoutes);",
          "app.use('/projects/:projectId/tasks', tasksRoutes);",
          "app.use('/projects/:projectId/tasks/:taskId/comments', commentsRoutes);",
          'app.use((err, _req, res, next) => { if (err) { sendError(res, 500, "INTERNAL_ERROR", "x"); return; } next(); });',
          'export default app;',
          ''
        ].join('\n')
      );
      const result = await validateNodeProjectApiLarge(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.some(d => /Module format contract mismatch/i.test(d)));
      assert.ok(result.diagnostics.some(d => /ESM local import missing extension/i.test(d)));
      assert.ok(result.diagnostics.some(d => /Skipped oracle command checks/i.test(d)));
      assert.equal((result.commands || []).length, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('keeps oracle fixture assert density at least 20 asserts', () => {
    const oraclePath = path.join(
      __dirname,
      '..',
      'scripts',
      'botEval',
      'oracle',
      'node_project_api_large',
      'tests',
      'oracle.test.js'
    );
    const content = fs.readFileSync(oraclePath, 'utf8');
    const assertCount = (content.match(/\bassert\./g) || []).length;
    assert.ok(assertCount >= 20, `Expected >= 20 assert statements, found ${assertCount}`);
  });
});
