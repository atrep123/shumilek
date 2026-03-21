var expect = require('chai').expect;

/**
 * Tests for defense-in-depth fixes in extension.ts:
 * 1. resolveWorkspaceUri rejects path traversal (..)
 * 2. markToolMutation caps mutationTools at 50
 * 3. abortControllerRequestId prevents stale abort-controller cleanup
 *
 * Functions are replicated here (same pattern as evictStaleHashes.test.ts)
 * because extension.ts requires heavy vscode mocking and the logic is testable in isolation.
 */

// ── Replicated: markToolMutation with cap ────────────────────
interface ToolSessionState {
  hadMutations: boolean;
  mutationTools: string[];
}

function markToolMutation(session: ToolSessionState | undefined, toolName: string): void {
  if (!session) return;
  session.hadMutations = true;
  if (session.mutationTools.length < 50 && !session.mutationTools.includes(toolName)) {
    session.mutationTools.push(toolName);
  }
}

// ── Replicated: path traversal rejection ─────────────────────
function rejectTraversal(inputPath: string): string | undefined {
  if (!inputPath) return 'path je povinny';
  const trimmed = inputPath.trim();
  if (!trimmed) return 'path je prazdny';
  const cleaned = trimmed.replace(/%2[fF]/g, '/').replace(/%5[cC]/g, '\\');
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  if (parts.some(p => p === '..')) {
    return 'cesta nesmi obsahovat ..';
  }
  return undefined; // no error
}

// ── Replicated: abortControllerRequestId logic ───────────────
function createAbortScenario() {
  let abortController: { signal: string } | undefined;
  let abortControllerRequestId = 0;

  function startRequest() {
    const localAbortController = { signal: `signal-${abortControllerRequestId + 1}` };
    const localRequestId = ++abortControllerRequestId;
    abortController = localAbortController;

    return {
      localRequestId,
      localAbortController,
      releaseGuardAndAbort: () => {
        if (abortControllerRequestId === localRequestId) {
          abortController = undefined;
        }
      }
    };
  }

  return {
    getAbortController: () => abortController,
    startRequest
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('markToolMutation cap', () => {
  it('adds tool name to mutationTools', () => {
    const session: ToolSessionState = { hadMutations: false, mutationTools: [] };
    markToolMutation(session, 'writeFile');
    expect(session.hadMutations).to.be.true;
    expect(session.mutationTools).to.deep.equal(['writeFile']);
  });

  it('does not add duplicate tool name', () => {
    const session: ToolSessionState = { hadMutations: false, mutationTools: ['writeFile'] };
    markToolMutation(session, 'writeFile');
    expect(session.mutationTools).to.deep.equal(['writeFile']);
  });

  it('does nothing when session is undefined', () => {
    expect(() => markToolMutation(undefined, 'writeFile')).to.not.throw();
  });

  it('caps mutationTools at 50 entries', () => {
    const session: ToolSessionState = { hadMutations: false, mutationTools: [] };
    for (let i = 0; i < 60; i++) {
      markToolMutation(session, `tool_${i}`);
    }
    expect(session.mutationTools).to.have.lengthOf(50);
    expect(session.mutationTools[49]).to.equal('tool_49');
  });

  it('still sets hadMutations even after cap', () => {
    const session: ToolSessionState = { hadMutations: false, mutationTools: [] };
    for (let i = 0; i < 55; i++) {
      markToolMutation(session, `t_${i}`);
    }
    expect(session.hadMutations).to.be.true;
    expect(session.mutationTools).to.have.lengthOf(50);
  });
});

describe('resolveWorkspaceUri path traversal rejection', () => {
  it('rejects path with ..', () => {
    expect(rejectTraversal('../../etc/passwd')).to.equal('cesta nesmi obsahovat ..');
  });

  it('rejects path with embedded ..', () => {
    expect(rejectTraversal('src/../../../etc/shadow')).to.equal('cesta nesmi obsahovat ..');
  });

  it('rejects backslash traversal', () => {
    expect(rejectTraversal('src\\..\\..\\secret')).to.equal('cesta nesmi obsahovat ..');
  });

  it('accepts normal relative path', () => {
    expect(rejectTraversal('src/utils.ts')).to.be.undefined;
  });

  it('accepts path with .. in name (not as segment)', () => {
    // "foo..bar" is not a traversal segment
    expect(rejectTraversal('src/foo..bar.ts')).to.be.undefined;
  });

  it('rejects encoded traversal', () => {
    expect(rejectTraversal('src%2F..%2F..%2Fetc')).to.equal('cesta nesmi obsahovat ..');
  });

  it('returns error for empty path', () => {
    expect(rejectTraversal('')).to.equal('path je povinny');
  });
});

describe('abortControllerRequestId race prevention', () => {
  it('clears controller when request is still current', () => {
    const scenario = createAbortScenario();
    const reqA = scenario.startRequest();
    expect(scenario.getAbortController()).to.equal(reqA.localAbortController);
    reqA.releaseGuardAndAbort();
    expect(scenario.getAbortController()).to.be.undefined;
  });

  it('does not clear controller when newer request exists', () => {
    const scenario = createAbortScenario();
    const reqA = scenario.startRequest();
    const reqB = scenario.startRequest();

    // reqB overwrote the global controller
    expect(scenario.getAbortController()).to.equal(reqB.localAbortController);

    // A finishes — must NOT clear B's controller
    reqA.releaseGuardAndAbort();
    expect(scenario.getAbortController()).to.equal(reqB.localAbortController);

    // B finishes — now it clears
    reqB.releaseGuardAndAbort();
    expect(scenario.getAbortController()).to.be.undefined;
  });

  it('handles three sequential requests correctly', () => {
    const scenario = createAbortScenario();
    const r1 = scenario.startRequest();
    const r2 = scenario.startRequest();
    const r3 = scenario.startRequest();

    // Only r3 is current
    expect(scenario.getAbortController()).to.equal(r3.localAbortController);

    // r1 and r2 releasing should not clear r3
    r1.releaseGuardAndAbort();
    r2.releaseGuardAndAbort();
    expect(scenario.getAbortController()).to.equal(r3.localAbortController);

    // r3 releasing clears it
    r3.releaseGuardAndAbort();
    expect(scenario.getAbortController()).to.be.undefined;
  });
});
