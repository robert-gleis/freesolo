import { describe, expect, it } from 'vitest';

import { parseGitHubRemote } from '../../src/core/git.js';

describe('parseGitHubRemote', () => {
  it('parses ssh remotes', () => {
    expect(parseGitHubRemote('git@github.com:robert-gleis/freesolo.git')).toEqual({
      host: 'github.com',
      owner: 'robert-gleis',
      repo: 'freesolo',
      remoteUrl: 'git@github.com:robert-gleis/freesolo.git',
      rootDir: ''
    });
  });

  it('parses https remotes', () => {
    expect(parseGitHubRemote('https://github.com/robert-gleis/freesolo.git')?.repo).toBe('freesolo');
  });
});
