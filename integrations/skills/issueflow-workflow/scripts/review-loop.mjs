#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const writeReviewReportScriptPath = path.resolve(import.meta.dirname, 'write-review-report.mjs');

const execFileAsync = promisify(execFile);
const gates = new Set(['plan', 'implementation']);
const statuses = new Set(['pass', 'pass_with_findings', 'block']);
const maxRounds = 5;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };

  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];

    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    }

    args[key.slice(2)] = value;
  }

  return args;
}

function assertGate(gate) {
  if (!gates.has(gate)) {
    throw new Error(`Invalid gate "${gate}". Use "plan" or "implementation".`);
  }
}

function assertStatus(status) {
  if (!statuses.has(status)) {
    throw new Error(`Invalid status "${status}". Use "pass", "pass_with_findings", or "block".`);
  }
}

async function resolveGitPath(name) {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', `issueflow/${name}`]);
  return stdout.trim();
}

async function readSession() {
  const sessionPath = await resolveGitPath('session.json');
  const session = JSON.parse(await fs.readFile(sessionPath, 'utf8'));

  session.reviewLoops ??= {
    plan: { currentRound: 1, maxRounds },
    implementation: { currentRound: 1, maxRounds }
  };
  session.reviewLoops.plan ??= { currentRound: 1, maxRounds };
  session.reviewLoops.implementation ??= { currentRound: 1, maxRounds };

  return { sessionPath, session };
}

function reviewKind(gate) {
  return gate === 'plan' ? 'plan' : 'implementation';
}

function artifactKey(gate) {
  return gate === 'plan' ? 'planReview' : 'implementationReview';
}

function datedReviewArtifact(session, gate, round) {
  const date = process.env.ISSUEFLOW_REVIEW_DATE ?? new Date().toISOString().slice(0, 10);
  const filename = `${date}-issue-${session.issueNumber}-${reviewKind(gate)}-review-round-${round}.md`;
  return path.join(session.repoRoot, 'docs', 'issueflow', 'reviews', filename);
}

async function writeSession(sessionPath, session) {
  session.updatedAt = new Date().toISOString();
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
}

async function nextReview(gate) {
  assertGate(gate);
  const { session } = await readSession();
  const loop = session.reviewLoops[gate];
  const artifactPath = datedReviewArtifact(session, gate, loop.currentRound);

  console.log(`Gate: ${gate}`);
  console.log(`Round: ${loop.currentRound}/${loop.maxRounds}`);
  console.log(`Review artifact: ${artifactPath}`);
  console.log(`Spawn a fresh reviewer agent for ${gate} review round ${loop.currentRound}.`);
  console.log('The reviewer must write findings to the review artifact and return status pass, pass_with_findings, or block.');
}

async function recordReview(gate, status, artifact) {
  assertGate(gate);
  assertStatus(status);

  if (!artifact) {
    throw new Error('Missing --artifact path');
  }

  const { sessionPath, session } = await readSession();
  const loop = session.reviewLoops[gate];
  const absoluteArtifact = path.isAbsolute(artifact) ? artifact : path.join(session.repoRoot, artifact);

  session.reviewGates[gate] = status;
  session.artifacts[artifactKey(gate)] = absoluteArtifact;

  if (status === 'pass') {
    await writeSession(sessionPath, session);
    try {
      await execFileAsync('node', [writeReviewReportScriptPath], { cwd: session.repoRoot });
    } catch (error) {
      console.warn(
        `issueflow: failed to write REVIEW_REPORT.md: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    console.log('Gate passed with no findings. Continue to the next stage.');
    return;
  }

  if (status === 'block' || loop.currentRound >= maxRounds) {
    session.reviewGates[gate] = 'block';
    loop.currentRound = maxRounds;
    await writeSession(sessionPath, session);
    console.log('Do not proceed after round 5 if findings remain. Gate is blocked; ask the user how to proceed.');
    return;
  }

  session.reviewGates[gate] = 'pass_with_findings';
  loop.currentRound += 1;
  await writeSession(sessionPath, session);
  console.log(`Findings recorded from ${absoluteArtifact}.`);
  console.log('Next, spawn a separate fixer agent with the review artifact as input.');
  console.log(`Next review round: ${loop.currentRound}/${loop.maxRounds}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'next-review') {
    await nextReview(args.gate);
    return;
  }

  if (args.command === 'record-review') {
    await recordReview(args.gate, args.status, args.artifact);
    return;
  }

  throw new Error('Use "next-review" or "record-review".');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
